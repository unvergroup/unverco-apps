// Activity: kayitlar (donem / tur / zarf suzgeci, arama), banka CSV ice aktarma, "My bank says..." mutabakati, CSV disa aktarma.
import { h, btn, field, openDialog } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { downloadText, pickTextFile } from "../../../core/files.js";
import { confirmedPayDates } from "../logic/schedule.js";
import { balanceOf } from "../logic/engine.js";
import { detectDecimal, detectDelimiter, guessColumns, parseAmountCell, parseCsv, rowsToItems, MAX_IMPORT_BYTES } from "../logic/csv.js";
import { csvTooWide, headerSig, importRecords, planBankImport } from "../logic/importer.js";
import { transactionsCsv } from "../logic/export.js";
import { importTransactions, reconcile } from "../logic/actions.js";
import { disclaimerNote, emptyState, envIcon, envIdOf, envName, findEnv, hello, md, money, readMoney } from "./common.js";
import { openTxEdit } from "./txedit.js";

const filters = { period: "this", type: "all", env: "all", q: "" };

export async function mountActivity(ctx, root, { state, result: res, today }) {
  const { t, formatDate } = ctx.i18n;
  root.append(hello(t("act.title"), t("act.sub")));
  root.append(h("div", { class: "toolbar" },
    btn({ label: t("act.import"), cls: "primary", icon: "upload", id: "act-import", onClick: () => openImport(ctx, state) }),
    btn({ label: t("act.reconcile"), icon: "scale", id: "act-reconcile", onClick: () => openReconcile(ctx, state, today) }),
    btn({ label: t("act.export"), icon: "download", id: "act-export", onClick: () => exportCsv(ctx, state, today) })));
  const pays = confirmedPayDates(state.transactions).filter((d) => d < res.periodStart);
  const lastStart = pays.length ? pays[pays.length - 1] : state.payPlan.startDate;
  const ranges = { this: [res.periodStart, "9999-12-31"], last: [lastStart < res.periodStart ? lastStart : res.periodStart, res.periodStart], all: ["0000-01-01", "9999-12-31"] };
  const per = field({ label: t("act.period"), id: "f-period", value: filters.period, options: [{ value: "this", label: t("act.thisPeriod") }, { value: "last", label: t("act.lastPeriod") }, { value: "all", label: t("act.all") }] });
  const typ = field({ label: t("act.type"), id: "f-type", value: filters.type, options: ["all", "expense", "income", "adjust"].map((v) => ({ value: v, label: t(`type.${v}`) })) });
  const env = field({ label: t("tx.envelope"), id: "f-env", value: filters.env, options: [{ value: "all", label: t("type.all") }, { value: "", label: t("env.uncategorized") }, ...state.envelopes.map((e) => ({ value: envIdOf(e), label: envName(ctx, e) }))] });
  const q = field({ label: t("act.search"), id: "f-q", type: "search", value: filters.q, attrs: { autocomplete: "off" } });
  const list = h("div", { id: "act-list" });
  const paint = () => {
    Object.assign(filters, { period: per.input.value, type: typ.input.value, env: env.input.value, q: q.input.value });
    const [from, to] = ranges[filters.period];
    const needle = filters.q.trim().toLowerCase();
    const rows = state.transactions.filter((x) => x.date >= from && x.date < to && (filters.type === "all" || x.type === filters.type)
      && (filters.env === "all" || (x.type === "expense" && (x.envelopeId || "") === filters.env)) && (!needle || String(x.note ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(a.createdAt) < String(b.createdAt) ? 1 : -1));
    if (!rows.length) { list.replaceChildren(emptyState("activity", t("act.emptyTitle"), t("act.emptyText"))); return; }
    const out = [];
    let day = "";
    let ul = null;
    for (const x of rows) {
      if (x.date !== day) { day = x.date; out.push(h("h3", { class: "dayhead", text: formatDate(day, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) })); ul = h("ul", { class: "list card glass" }); out.push(ul); }
      const e = findEnv(state, x.envelopeId);
      const label = x.note || (x.type === "income" ? t(x.source === "pay" ? "source.pay" : "type.income") : x.type === "adjust" ? t("source.reconcile") : envName(ctx, e));
      const ro = x.date < res.periodStart;
      const sign = x.type === "expense" ? -x.amountMinor : x.amountMinor;
      ul.append(h("li", { class: "item" },
        h("span", { class: "chipico" }, icon(x.type === "income" ? "banknote" : x.type === "adjust" ? "scale" : x.billId ? "receipt" : x.fundId ? "piggy" : envIcon(state, x.envelopeId))),
        h("span", { class: "tx" }, h("button", { type: "button", class: "linklike", id: `act-${x.id}`, "aria-label": t(ro ? "tx.viewNamed" : "tx.editNamed", { name: label }), on: { click: () => openTxEdit(ctx, state, x, { readOnly: ro }) } }, h("b", { text: label })),
          h("small", { text: [x.type === "expense" ? envName(ctx, e) : "", t(`source.${x.source || "manual"}`)].filter(Boolean).join(" · ") })),
        h("span", { class: `amt num${sign > 0 ? " plus" : ""}`, text: money(ctx, sign) })));
    }
    list.replaceChildren(...out);
  };
  for (const f of [per, typ, env]) f.input.addEventListener("change", paint);
  q.input.addEventListener("input", paint);
  root.append(h("div", { class: "filters" }, per.el, typ.el, env.el, q.el), list, disclaimerNote(ctx));
  paint();
}

function exportCsv(ctx, state, today) {
  const { t, csv } = ctx.i18n;
  const text = transactionsCsv(state.transactions, {
    headers: { date: t("csv.date"), type: t("csv.type"), amount: t("csv.amount"), envelope: t("csv.envelope"), note: t("csv.note"), source: t("csv.source"), billDue: t("csv.billDue") },
    delimiter: csv.delimiter, decimal: csv.decimal, envName: (id) => envName(ctx, findEnv(state, id)), typeName: (x) => t(`type.${x}`), sourceName: (s) => t(`source.${s}`),
  });
  downloadText(`${ctx.config.fileSlug}-${today}.csv`, text, "text/csv");
  ctx.notify(t("act.exported"));
}

function openReconcile(ctx, state, today) {
  const { t } = ctx.i18n;
  const d = openDialog({ title: t("rec.title"), id: "rec-dlg", closeLabel: t("common.close") });
  const cur = balanceOf(state.payPlan, state.transactions);
  const f = field({ label: t("rec.label"), id: "rec-amount", attrs: { inputmode: "decimal", autocomplete: "off" }, hint: t("rec.hint", { amount: money(ctx, cur) }) });
  d.body.append(f.el);
  d.foot.append(btn({ label: t("common.cancel"), id: "rec-cancel", onClick: () => d.close() }), btn({ label: t("rec.save"), cls: "primary", id: "rec-save", onClick: async () => {
    const v = readMoney(f.input.value, { allowNegative: true });
    if (!Number.isInteger(v)) { f.setError(t("setup.err.balance")); return; }
    try {
      await ctx.change(() => reconcile(ctx.store, v, today), (diff) => (diff === 0 ? t("rec.matches") : t("rec.adjusted", { amount: money(ctx, diff) })));
      d.close(true);
      ctx.refresh();
    } catch (e) { ctx.fail(e); }
  } }));
  f.input.focus();
}

// ---- Banka CSV ice aktarma sihirbazi ----
async function openImport(ctx, state) {
  const { t, formatDate } = ctx.i18n;
  const file = await pickTextFile(".csv,text/csv,text/plain", MAX_IMPORT_BYTES);
  if (!file) return;
  if (file.tooLarge) { ctx.notify(t("imp.tooLarge"), "error"); return; }
  const rows = parseCsv(file.text, detectDelimiter(file.text));
  if (rows.length < 1) { ctx.notify(t("imp.empty"), "error"); return; }
  if (csvTooWide(rows)) { ctx.notify(t("imp.tooWide"), "error"); return; } // onizleme yuz binlerce secenek cizmesin
  const head = rows[0];
  const sig = headerSig(head);
  const g = guessColumns(head);
  const last = state.prefs.lastImportMap;
  const useLast = last && last.cols === head.length && last.headerSig === sig;
  const m = useLast ? { ...last } : {
    date: g.date, description: g.description, amount: g.amount >= 0 ? g.amount : -1, debit: g.debit, credit: g.credit,
    hasHeader: g.date >= 0 || g.amount >= 0, dateFormat: "mdy", negativeIs: "expense", decimal: ".",
  };
  if (!useLast) {
    const colIdx = m.amount >= 0 ? m.amount : m.debit;
    m.decimal = colIdx >= 0 ? detectDecimal(rows.slice(1).map((r) => r[colIdx])).decimal : ".";
    if (m.date < 0) m.date = 0;
    if (m.amount < 0 && !(m.debit >= 0 && m.credit >= 0)) m.amount = Math.min(head.length - 1, 2);
    const sample = rows.slice(1, 20).map((r) => r[m.date]).join(" ");
    if (/\b(1[3-9]|2\d|3[01])[/.-]\d{1,2}[/.-]\d{2,4}/.test(sample)) m.dateFormat = "dmy";
    else if (/^\d{4}-/.test(rows[1]?.[m.date] ?? "")) m.dateFormat = "ymd";
  }
  const d = openDialog({ title: t("imp.title"), id: "imp-dlg", closeLabel: t("common.close") });
  d.dialog.classList.add("wide");
  const colOpts = [{ value: "-1", label: "—" }, ...head.map((c, i) => ({ value: String(i), label: m.hasHeader && c ? c : t("imp.column", { n: i + 1 }) }))];
  const sel = (key, label, opts) => { const f = field({ label, id: `imp-${key}`, value: String(m[key]), options: opts }); f.input.addEventListener("change", () => { m[key] = /^-?\d+$/.test(f.input.value) ? Number(f.input.value) : f.input.value; paint(); }); return f; };
  const fDate = sel("date", t("imp.dateCol"), colOpts), fDesc = sel("description", t("imp.descCol"), colOpts), fAmt = sel("amount", t("imp.amountCol"), colOpts);
  const fDebit = sel("debit", t("imp.debitCol"), colOpts), fCredit = sel("credit", t("imp.creditCol"), colOpts);
  const fFmt = sel("dateFormat", t("imp.dateFmt"), [{ value: "mdy", label: "MM/DD/YYYY" }, { value: "dmy", label: "DD/MM/YYYY" }, { value: "ymd", label: "YYYY-MM-DD" }]);
  const fDec = sel("decimal", t("imp.decimal"), [{ value: ".", label: t("imp.decDot") }, { value: ",", label: t("imp.decComma") }]);
  const fNeg = sel("negativeIs", t("imp.negative"), [{ value: "expense", label: t("imp.negExpense") }, { value: "income", label: t("imp.negIncome") }]);
  const hdr = h("input", { type: "checkbox", id: "imp-header", checked: m.hasHeader, on: { change: () => { m.hasHeader = hdr.checked; paint(); } } });
  const out = h("div", { id: "imp-out" });
  d.body.append(h("p", { class: "field-hint", text: t("imp.file", { name: file.name, n: rows.length }) }),
    h("div", { class: "formgrid two" }, fDate.el, fDesc.el, fAmt.el, fDec.el, fDebit.el, fCredit.el, fFmt.el, fNeg.el),
    h("label", { class: "check" }, hdr, t("imp.hasHeader")), out);
  const goBtn = btn({ label: t("imp.go", { n: 0 }), cls: "primary", id: "imp-go" });
  d.foot.append(btn({ label: t("common.cancel"), id: "imp-cancel", onClick: () => d.close() }), goBtn);

  let plan = null;
  const take = new Set(), link = new Set();
  const reasonKey = (r) => `imp.skip.${r}`;
  const row = (it, extra) => h("li", {}, h("span", {}, h("span", { class: "d", text: `${t("imp.line", { n: it.line })} · ${formatDate(it.date, { month: "short", day: "numeric" })} · ` }), it.description || "—"), h("span", { class: "num", text: money(ctx, it.type === "expense" ? -it.amountMinor : it.amountMinor) }), extra ?? null);
  function paint() {
    const map = { date: m.date, description: m.description, amount: m.amount, debit: m.debit, credit: m.credit };
    const { items, skipped } = rowsToItems(rows, map, { hasHeader: m.hasHeader, dateFormat: m.dateFormat, decimal: m.decimal, negativeIs: m.negativeIs });
    plan = planBankImport({ items, transactions: state.transactions, bills: state.bills });
    link.clear(); take.clear();
    for (const it of plan.fresh) if (it.bill) link.add(it.line);
    const body = rows.slice(m.hasHeader ? 1 : 0, (m.hasHeader ? 1 : 0) + 5);
    const amtCol = m.amount >= 0 ? m.amount : m.debit;
    const prev = h("div", { class: "preview-amts", id: "imp-preview" }, h("span", { class: "field-hint", text: t("imp.preview") }), body.map((r) => {
      const v = parseAmountCell(r[amtCol], { decimal: m.decimal });
      return h("span", { class: Number.isNaN(v) ? "tag gold" : "tag", text: `${r[amtCol] ?? ""} → ${Number.isNaN(v) ? t("imp.skip.amount") : money(ctx, v)}` });
    }));
    const group = (id, title, list, render) => h("div", { class: "imp-group", id }, h("h3", { text: `${title} (${list.length})` }), list.length ? h("ul", {}, list.map(render)) : null);
    const freshList = plan.fresh;
    out.replaceChildren(prev,
      group("imp-new", t("imp.new"), freshList, (it) => row(it, it.bill ? h("label", { class: "check" }, h("input", { type: "checkbox", id: `link-${it.line}`, checked: true, on: { change: (e) => { if (e.target.checked) link.add(it.line); else link.delete(it.line); } } }), t("imp.pays", { name: it.bill.name, date: md(ctx, it.bill.due) })) : null)),
      group("imp-dups", t("imp.dups"), plan.dups, (it) => row(it)),
      group("imp-maybe", t("imp.maybe"), plan.maybe, (it) => row(it, h("label", { class: "check" }, h("input", { type: "checkbox", id: `maybe-${it.line}`, on: { change: (e) => { if (e.target.checked) take.add(it.line); else take.delete(it.line); count(); } } }), t("imp.maybeMatch", { note: it.match.note || t(`source.${it.match.source}`), date: md(ctx, it.match.date) })))),
      group("imp-skipped", t("imp.skipped"), skipped, (s) => h("li", {}, h("span", { text: t("imp.line", { n: s.line }) }), h("span", { class: "d", text: t(reasonKey(s.reason)) }))));
    count();
  }
  const count = () => { goBtn.querySelector("span").textContent = t("imp.go", { n: plan.fresh.length + take.size }); goBtn.disabled = plan.fresh.length + take.size === 0; };
  goBtn.addEventListener("click", async () => {
    const recs = importRecords(plan, { linkBills: link, takeMaybe: take }, `imp-${Date.now().toString(36)}`);
    try {
      await ctx.change(() => importTransactions(ctx.store, recs, { ...m, cols: head.length, headerSig: sig }, new Date().toISOString()), t("imp.done", { n: recs.length, dups: plan.dups.length }));
      d.close(true);
      ctx.refresh();
    } catch (e) { ctx.fail(e); }
  });
  paint();
}
