// Banka dokumu CSV ice aktarma penceresi: dosya sec -> sutun esle (tarih, aciklama, tutar ya da giren / cikan) -> onizle -> aktar.
// Yinelenen kayit (ayni tarih + tutar + tur + aciklama) atlanir. Aktarilan kayitlar etkin isletmeye, secilen "varsayilan" kategorilere yazilir
// ve source: "import" tasir. Dosya 2 MB ve 3.000 satirla sinirlidir. Hicbir veri cihazdan cikmaz.
import { pickTextFile } from "../../../core/files.js";
import { guardWrite } from "../../../core/safe.js";
import { button, h } from "../../../core/ui.js";
import { MAX_IMPORT_BYTES, detectDecimal, detectDelimiter, guessColumns, parseCsv, planImport, rowsToItems } from "../logic/csv.js";
import { OTHER_KEY, RECORD_LIMITS, categoryLabel } from "../logic/schema.js";
import { categoriesOf, loadData, openModal, segmented, selectField, fill } from "./common.js";

export async function openImport(ctx) {
  const { t, formatDate, formatNumber } = ctx.i18n;
  const fmt = ctx.money.format;
  const data = await loadData(ctx);
  const guard = guardWrite((e) => ctx.fail(e));
  let rows = null;
  let fileName = "";
  let imported = false;

  const body = h("div", { class: "stack import-body", id: "import-body" });
  const m = openModal(ctx, { title: t("import.title"), children: [body], className: "form-dialog import-dialog" });

  const start = () => {
    fill(body, 
      h("p", { text: t("import.intro") }),
      h("p", { class: "muted", text: t("import.privacy") }),
      h("div", { class: "row" }, button({ id: "import-pick", label: t("import.pick"), variant: "primary", onClick: pick }), button({ label: t("common.cancel"), onClick: () => m.close() })));
    body.querySelector("#import-pick")?.focus();
  };

  const pick = async () => {
    const f = await pickTextFile(".csv,text/csv,text/plain", MAX_IMPORT_BYTES);
    if (!f) return;
    if (f.tooLarge) { ctx.notify(t("import.tooLarge"), "error"); return; }
    const parsed = parseCsv(f.text, detectDelimiter(f.text));
    if (parsed.length < 1 || Math.max(...parsed.map((r) => r.length)) < 2) { ctx.notify(t("import.unreadable"), "error"); return; }
    rows = parsed;
    fileName = f.name;
    mapping();
  };

  const mapping = () => {
    const header = rows[0];
    const g = guessColumns(header);
    const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
    const colOpts = (withNone) => [...(withNone ? [{ value: "-1", label: t("import.none") }] : []),
      ...Array.from({ length: width }, (_, i) => ({ value: String(i), label: `${i + 1}: ${String(header[i] ?? "").slice(0, 40) || "—"}` }))];
    const hasHeader = h("input", { type: "checkbox", id: "import-has-header", checked: g.date >= 0 || g.amount >= 0 || g.description >= 0 });
    const dateCol = selectField({ id: "import-col-date", label: t("import.colDate"), value: String(Math.max(0, g.date)), options: colOpts(false) });
    const descCol = selectField({ id: "import-col-desc", label: t("import.colDesc"), value: String(g.description >= 0 ? g.description : Math.min(1, width - 1)), options: colOpts(true) });
    const twoCols = g.amount < 0 && g.debit >= 0 && g.credit >= 0;
    const mode = segmented({ name: "import-mode", legend: t("import.amountMode"), value: twoCols ? "two" : "one",
      options: [{ value: "one", label: t("import.modeOne") }, { value: "two", label: t("import.modeTwo") }], onChange: () => { paintMode(); preview(); } });
    const amountCol = selectField({ id: "import-col-amount", label: t("import.colAmount"), value: String(g.amount >= 0 ? g.amount : width - 1), options: colOpts(false) });
    const debitCol = selectField({ id: "import-col-debit", label: t("import.colOut"), value: String(g.debit >= 0 ? g.debit : width - 2), options: colOpts(false) });
    const creditCol = selectField({ id: "import-col-credit", label: t("import.colIn"), value: String(g.credit >= 0 ? g.credit : width - 1), options: colOpts(false) });
    const neg = selectField({ id: "import-negative", label: t("import.negative"), value: "expense", options: [{ value: "expense", label: t("import.negExpense") }, { value: "income", label: t("import.negIncome") }] });
    const dateFmt = selectField({ id: "import-date-format", label: t("import.dateFormat"), value: ctx.i18n.locale === "en-US" ? "mdy" : "dmy", options: ["mdy", "dmy", "ymd"].map((v) => ({ value: v, label: t(`import.fmt.${v}`) })) });
    // Ondalik ayirici DOSYADAN tahmin edilir (dilden bagimsiz); kullanici degistirirse bir daha otomatik degismez.
    const decimal = selectField({ id: "import-decimal", label: t("import.decimal"), value: ".", options: [{ value: ".", label: t("import.dec.dot") }, { value: ",", label: t("import.dec.comma") }] });
    let decimalTouched = false;
    decimal.input.addEventListener("change", () => { decimalTouched = true; });
    const decNote = h("p", { class: "muted", id: "import-decimal-note" });
    const force = h("input", { type: "checkbox", id: "import-force" });
    const catSel = (type, id) => selectField({ id, label: t(`import.cat.${type}`), value: `cat-${OTHER_KEY[type]}`, options: categoriesOf(data, type, t).map((c) => ({ value: c.id, label: categoryLabel(c, t) })) });
    const incCat = catSel("income", "import-cat-income");
    const expCat = catSel("expense", "import-cat-expense");
    const scope = segmented({ name: "import-scope", legend: t("entry.scope"), value: "business", options: [{ value: "business", label: t("scope.business") }, { value: "personal", label: t("scope.personal") }] });
    const out = h("div", { class: "stack", id: "import-preview", "aria-live": "polite" });
    let ready = { items: [], fresh: [], dups: [], skipped: [] };

    const paintMode = () => {
      const two = mode.value() === "two";
      amountCol.element.hidden = two; neg.element.hidden = two;
      debitCol.element.hidden = !two; creditCol.element.hidden = !two;
    };
    const amountValues = () => {
      const two = mode.value() === "two";
      const cols = two ? [+debitCol.input.value, +creditCol.input.value] : [+amountCol.input.value];
      return (hasHeader.checked ? rows.slice(1) : rows).slice(0, 500).flatMap((r) => cols.map((c) => r[c])).filter((v) => v !== undefined && String(v).trim() !== "");
    };
    const lineList = (id, list, text) => h("div", { class: "line-list", id, tabindex: "0", role: "region", "aria-label": text },
      h("ul", {}, ...list.map((x) => h("li", { text: x }))));
    const preview = () => {
      const two = mode.value() === "two";
      const det = detectDecimal(amountValues());
      if (!decimalTouched) decimal.input.value = det.decimal;
      decNote.textContent = t(det.sure ? "import.decDetected" : "import.decGuess", { sep: t(det.decimal === "," ? "import.dec.comma" : "import.dec.dot") });
      const map = { date: +dateCol.input.value, description: +descCol.input.value, amount: two ? -1 : +amountCol.input.value, debit: two ? +debitCol.input.value : -1, credit: two ? +creditCol.input.value : -1 };
      const r = rowsToItems(rows, map, { hasHeader: hasHeader.checked, dateFormat: dateFmt.input.value, decimal: decimal.input.value, digits: ctx.i18n.digits, negativeIs: neg.input.value });
      const plan = planImport(r.items, data.entries, { force: force.checked });
      const dupCount = force.checked ? planImport(r.items, data.entries).dups.length : plan.dups.length;
      ready = { items: r.items, fresh: plan.fresh, dups: plan.dups, skipped: r.skipped };
      const money = (it) => fmt(it.type === "expense" ? -it.amountMinor : it.amountMinor);
      fill(out,
        h("p", { id: "import-counts", class: "banner banner-info", text: t("import.counts", { ready: formatNumber(plan.fresh.length), dups: formatNumber(plan.dups.length), skipped: formatNumber(r.skipped.length) }) }),
        r.items.length ? h("div", { class: "stack", id: "import-amounts" },
          h("p", { class: "field-label", text: t("import.amountCheck") }),
          lineList("import-amount-list", r.items.slice(0, 5).map((it) => t("import.amountLine", { line: it.line, raw: it.raw, amount: money(it) })), t("import.amountCheck"))) : null,
        dupCount ? h("div", { class: "stack", id: "import-dups" },
          h("p", { class: "field-label", text: t("import.dupTitle", { n: formatNumber(dupCount) }) }),
          lineList("import-dup-list", (force.checked ? planImport(r.items, data.entries).dups : plan.dups).map((it) => t("import.dupLine", { line: it.line, date: formatDate(it.date), text: it.description || "—", amount: money(it) })), t("import.dupTitle", { n: dupCount })),
          h("label", { class: "check", for: force.id }, force, h("span", { text: t("import.forceAll") }))) : null,
        r.skipped.length ? h("div", { class: "stack", id: "import-skipped" },
          h("p", { class: "field-label", text: t("import.skippedTitle", { n: formatNumber(r.skipped.length) }) }),
          lineList("import-skip-list", r.skipped.map((s) => t(`import.skip.${s.reason}`, { line: s.line })), t("import.skippedTitle", { n: r.skipped.length }))) : null);
      go.disabled = plan.fresh.length === 0;
    };

    const go = h("button", { type: "button", id: "import-go", class: "btn btn-primary", text: t("import.go") });
    go.addEventListener("click", guard(async () => {
      if (!ready.fresh.length) return;
      const bizId = data.business.id;
      const n = await ctx.store.transactMany(["entries"], (tx) => {
        if (tx.count("entries") + ready.fresh.length > RECORD_LIMITS.entries) throw Object.assign(new Error("limit"), { code: "limit_reached" });
        for (const it of ready.fresh) {
          tx.add("entries", { businessId: bizId, type: it.type, date: it.date, amount: it.amountMinor, categoryId: it.type === "income" ? incCat.input.value : expCat.input.value,
            party: it.description, method: "bank", note: "", scope: scope.value(), receipt: "", source: "import" });
        }
        return ready.fresh.length;
      });
      imported = true;
      ctx.notify(t("import.done", { n: formatNumber(n) }), "success");
      m.close();
    }));

    for (const el of [hasHeader, dateCol.input, descCol.input, amountCol.input, debitCol.input, creditCol.input, neg.input, dateFmt.input, decimal.input, force]) el.addEventListener("change", preview);
    fill(body, 
      h("p", { class: "muted", id: "import-file", text: t("import.file", { name: fileName, rows: formatNumber(rows.length) }) }),
      h("label", { class: "check", for: hasHeader.id }, hasHeader, h("span", { text: t("import.hasHeader") })),
      h("div", { class: "grid-2" }, dateCol.element, dateFmt.element, descCol.element, h("div", { class: "stack" }, decimal.element, decNote)),
      mode.element,
      h("div", { class: "grid-2" }, amountCol.element, neg.element, debitCol.element, creditCol.element),
      h("div", { class: "grid-2" }, incCat.element, expCat.element),
      scope.element,
      out,
      h("div", { class: "dialog-actions" }, button({ label: t("common.back"), onClick: start }), go));
    paintMode();
    preview();
  };

  start();
  await m.done;
  return imported;
}
