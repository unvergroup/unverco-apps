// Kayitlar ekrani: gelir / gider listesi, suzgecler, donem toplami, ekle / duzenle / sil formu (fis fotografi dahil), CSV disa aktarim, banka CSV ice aktarma.
// Kullanici verisi YALNIZ metin dugumu olarak yazilir (core/ui.js h()). Fis goruntusu data-URL'dir ve ozellik atamasiyla verilir (CSP img-src data:).
import { addMonths, todayIso } from "../../../core/dates.js";
import { downloadText } from "../../../core/files.js";
import { formatMinorPlain } from "../../../core/money.js";
import { localizeNumber, parseMoneyText } from "../../../core/number-input.js";
import { guardWrite } from "../../../core/safe.js";
import { button, emptyState, field, h } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { filterEntries, monthRange, totals, yearRange } from "../logic/calc.js";
import { entriesCsv } from "../logic/csv.js";
import { METHODS, OTHER_KEY, RECORD_LIMITS, RECEIPTS_BUDGET_CHARS, TEXT_LIMITS, categoryLabel, cleanRecord, validateEntry } from "../logic/schema.js";
import { categoriesOf, disclaimer, errText, loadData, openForm, segmented, selectField, withId, fill } from "./common.js";
import { openImport } from "./import.js";
import { resizePhoto } from "./receipt.js";

export const PERIODS = Object.freeze(["thisMonth", "lastMonth", "thisYear", "lastYear", "all"]);
const PAGE = 100;
const state = { period: "thisMonth", type: "", scope: "", categoryId: "", q: "", shown: PAGE };

export function periodRange(id, today = todayIso()) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (id === "thisMonth") return monthRange(y, m);
  if (id === "lastMonth") { const p = addMonths(`${today.slice(0, 7)}-01`, -1); return monthRange(Number(p.slice(0, 4)), Number(p.slice(5, 7))); }
  if (id === "thisYear") return yearRange(y);
  if (id === "lastYear") return yearRange(y - 1);
  return null;
}

const receiptImg = (src, alt, cls = "receipt-img") => { const img = h("img", { class: cls, alt }); img.src = src; return img; };

// ---------- form ----------
// opts: { entry? (duzenle), type? } -> Promise<boolean>
export async function openEntryForm(ctx, opts = {}) {
  const { t } = ctx.i18n;
  const dec = ctx.i18n.decimal;
  const data = await loadData(ctx);
  const e = opts.entry ?? null;
  let type = e?.type ?? opts.type ?? "expense";
  let receipt = e?.receipt ?? "";

  const typeSeg = segmented({ name: "entry-type", legend: t("entry.type"), value: type, options: [{ value: "income", label: t("type.income") }, { value: "expense", label: t("type.expense") }], onChange: (v) => { type = v; paintType(); } });
  const date = withId(field({ label: t("entry.date"), type: "date", value: e?.date ?? todayIso(), required: true }), "entry-date");
  const amount = withId(field({ label: t("entry.amount"), value: e ? localizeNumber(formatMinorPlain(e.amount), dec) : "", inputmode: "decimal", autocomplete: "off", required: true, placeholder: localizeNumber("0.00", dec) }), "entry-amount");
  const category = selectField({ id: "entry-category", label: t("entry.category"), value: "", options: [] });
  const party = withId(field({ label: t("entry.party.expense"), value: e?.party ?? "", maxlength: TEXT_LIMITS.party, autocomplete: "off" }), "entry-party");
  const partyList = h("datalist", { id: "entry-party-list" });
  party.input.setAttribute("list", "entry-party-list");
  const method = selectField({ id: "entry-method", label: t("entry.method"), value: e?.method ?? "", options: [{ value: "", label: t("common.none") }, ...METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))] });
  const scopeSeg = segmented({ name: "entry-scope", legend: t("entry.scope"), value: e?.scope ?? "business", options: [{ value: "business", label: t("scope.business") }, { value: "personal", label: t("scope.personal") }] });
  const note = withId(field({ label: t("entry.note"), value: e?.note ?? "", multiline: true, maxlength: TEXT_LIMITS.note }), "entry-note");
  note.input.rows = 2;

  // Fis fotografi
  const fileInput = h("input", { type: "file", accept: "image/*", id: "entry-receipt-file", class: "sr-only" });
  const receiptErr = h("p", { class: "field-error", role: "alert" });
  const receiptBox = h("div", { class: "receipt-box", id: "entry-receipt-box" });
  const paintReceipt = () => {
    fill(receiptBox, 
      receipt ? receiptImg(receipt, t("entry.receiptAlt"), "receipt-thumb") : null,
      h("div", { class: "row" },
        h("label", { class: "btn btn-secondary", for: fileInput.id, id: "entry-receipt-add" }, icon("camera", { size: 18 }), h("span", { text: receipt ? t("entry.receiptReplace") : t("entry.receiptAdd") })),
        receipt ? button({ id: "entry-receipt-remove", label: t("entry.receiptRemove"), onClick: () => { receipt = ""; paintReceipt(); } }) : null));
  };
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!f) return;
    receiptErr.textContent = "";
    try { receipt = await resizePhoto(f); paintReceipt(); } catch { receiptErr.textContent = t("entry.receiptError"); }
  });
  paintReceipt();

  const paintType = () => {
    const keep = category.input.value || e?.categoryId || "";
    const list = categoriesOf(data, type, t, e?.categoryId);
    const want = list.some((c) => c.id === keep) ? keep : `cat-${OTHER_KEY[type]}`;
    category.input.replaceChildren(...list.map((c) => h("option", { value: c.id, text: categoryLabel(c, t), selected: c.id === want })));
    category.input.value = want;
    party.element.querySelector("label").textContent = t(`entry.party.${type}`);
    const names = [...new Set(data.entries.filter((x) => x.type === type && x.party).map((x) => x.party))].slice(0, 200);
    partyList.replaceChildren(...names.map((n) => h("option", { value: n })));
  };
  paintType();

  const remove = (close) => button({
    id: "entry-delete", label: t("common.delete"), variant: "danger", onClick: async () => {
      if (!(await ctx.confirm({ title: t("entry.deleteTitle"), message: t("entry.deleteText") }))) return;
      try { await ctx.store.remove("entries", e.id); ctx.notify(t("entry.deleted"), "success"); close(); } catch (err) { ctx.fail(err); }
    },
  });

  return openForm(ctx, {
    title: e ? t("entry.edit") : type === "income" ? t("entry.addIncome") : t("entry.addExpense"),
    groups: [
      { legend: "", nodes: [typeSeg.element, date.element, amount.element, category.element, party.element, partyList] },
      { legend: t("entry.more"), nodes: [method.element, scopeSeg.element, note.element, h("div", { class: "field" }, h("p", { class: "field-label", text: t("entry.receipt") }), fileInput, receiptBox, h("p", { class: "field-hint", text: t("entry.receiptHint") }), receiptErr)] },
    ],
    extraActions: e ? [remove] : [],
    onSave: async () => {
      for (const f of [date, amount, category, party, note, method]) f.setError("");
      const text = amount.input.value.trim();
      const minor = text === "" ? undefined : parseMoneyText(text, { decimal: dec });
      const rec = {
        businessId: e?.businessId ?? data.business.id, type, date: date.input.value,
        amount: minor === undefined ? undefined : Number.isNaN(minor) || minor <= 0 ? -1 : minor,
        categoryId: category.input.value, party: party.input.value, method: method.input.value, scope: scopeSeg.value(), note: note.input.value,
        receipt, source: e?.source ?? "",
      };
      const v = validateEntry(rec);
      const show = { date, amount, categoryId: category, party, note, method };
      for (const [k, code] of Object.entries(v.errors)) {
        if (k === "amount") amount.setError(code === "required" ? t("msg.required") : t("msg.invalidAmount"));
        else show[k]?.setError(errText(ctx, code, k === "note" ? TEXT_LIMITS.note : TEXT_LIMITS.party));
      }
      if (!v.valid) return false;
      if (receipt && receipt !== (e?.receipt ?? "")) {
        const used = data.allEntries.reduce((n, x) => n + (x.id !== e?.id && x.receipt ? x.receipt.length : 0), 0);
        if (used + receipt.length > RECEIPTS_BUDGET_CHARS) { receiptErr.textContent = t("entry.receiptFull"); return false; }
      }
      const clean = cleanRecord("entries", rec, { keepMeta: false }).record;
      if (e) await ctx.store.update("entries", e.id, clean);
      else await ctx.store.add("entries", clean, { check: (n) => { if (n >= RECORD_LIMITS.entries) throw Object.assign(new Error("limit"), { code: "limit_reached" }); } });
      ctx.notify(t(e ? "msg.saved" : "msg.created"), "success");
      return true;
    },
  });
}

// ---------- CSV ----------
export function exportEntriesCsv(ctx, data, rows, range) {
  const { t } = ctx.i18n;
  if (!rows.length) { ctx.notify(t("csv.empty"), "warn"); return false; }
  const bizName = new Map(data.businesses.map((b) => [b.id, b.name]));
  const text = entriesCsv(rows, {
    headers: { date: t("entry.date"), type: t("entry.type"), category: t("entry.category"), party: t("csv.party"), amount: t("entry.amount"), signed: t("csv.signed"),
      method: t("entry.method"), scope: t("entry.scope"), note: t("entry.note"), business: t("csv.business"), receipt: t("entry.receipt"), yes: t("common.yes") },
    delimiter: ctx.i18n.csv.delimiter, decimal: ctx.i18n.csv.decimal, digits: ctx.i18n.digits,
    categoryName: data.catName, methodName: (k) => t(`method.${k}`), typeName: (k) => t(`type.${k}`), scopeName: (k) => t(`scope.${k}`), businessName: (id) => bizName.get(id) ?? "",
  });
  const span = range ? `${range.from}_${range.to}` : "all";
  if (downloadText(`${ctx.config.fileSlug}-${span}.csv`, text, "text/csv")) { ctx.notify(t("csv.done"), "success"); return true; }
  return false;
}

// ---------- ekran ----------
export async function mountEntries(ctx, root) {
  const { t, formatDate, formatNumber } = ctx.i18n;
  const fmt = ctx.money.format;
  const guard = guardWrite((e) => ctx.fail(e));
  let data;

  const draw = async (focusSel) => {
    data = await loadData(ctx);
    const range = periodRange(state.period);
    const rows = filterEntries(data.entries, { range, type: state.type || undefined, scope: state.scope || undefined, categoryId: state.categoryId || undefined, q: state.q, categoryName: data.catName });
    const sum = totals(rows.map((r) => ({ ...r, scope: "business" })));
    const sel = (id, label, value, options, key) => {
      const s = selectField({ id, label, value, options, onChange: (v) => { state[key] = v; state.shown = PAGE; draw(`#${id}`); } });
      return s.element;
    };
    const catOptions = [{ value: "", label: t("common.all") },
      ...["income", "expense"].flatMap((ty) => categoriesOf(data, ty, t).filter((c) => !state.type || c.type === state.type).map((c) => ({ value: c.id, label: `${categoryLabel(c, t)} (${t(`type.${ty}`)})` })))];
    if (!catOptions.some((o) => o.value === state.categoryId)) state.categoryId = "";
    const search = withId(field({ label: t("common.search"), type: "search", value: state.q, autocomplete: "off" }), "entries-search");
    search.input.addEventListener("change", () => { state.q = search.input.value; state.shown = PAGE; draw("#entries-search"); });

    const item = (e) => h("li", { class: "entry-item" },
      h("button", { type: "button", class: "entry-btn", "data-entry": e.id, "data-type": e.type, on: { click: async () => { if (await openEntryForm(ctx, { entry: e })) await draw(); } } },
        h("span", { class: "entry-main" },
          h("span", { class: "entry-cat", text: data.catName(e.categoryId) }),
          h("span", { class: "entry-sub", text: [formatDate(e.date), e.party, e.scope === "personal" ? t("scope.personal") : ""].filter(Boolean).join(" · ") })),
        e.receipt ? h("span", { class: "entry-receipt", title: t("entry.receipt") }, icon("camera", { size: 16 })) : null,
        h("span", { class: `entry-amt is-${e.type}`, text: fmt(e.type === "expense" ? -e.amount : e.amount) })));

    const list = rows.length
      ? h("ul", { class: "entry-list", id: "entry-list", "aria-label": t("entries.list") }, ...rows.slice(0, state.shown).map(item))
      : emptyState({ title: data.entries.length ? t("entries.noMatch") : t("entries.empty"), text: data.entries.length ? t("entries.noMatchHint") : t("entries.emptyHint") });
    const more = rows.length > state.shown ? button({ id: "entries-more", label: t("entries.more", { n: formatNumber(rows.length - state.shown) }), onClick: () => { state.shown += PAGE; draw("#entries-more"); } }) : null;

    fill(root, 
      h("div", { class: "screen-head" },
        h("h2", { text: t("entries.title") }),
        h("p", { class: "muted biz-chip", text: data.business.name })),
      h("div", { class: "row action-row" },
        button({ id: "add-income", label: t("entry.addIncome"), variant: "primary", glyph: "plus", onClick: async () => { if (await openEntryForm(ctx, { type: "income" })) await draw("#add-income"); } }),
        button({ id: "add-expense", label: t("entry.addExpense"), variant: "primary", glyph: "plus", onClick: async () => { if (await openEntryForm(ctx, { type: "expense" })) await draw("#add-expense"); } }),
        button({ id: "import-csv", label: t("import.button"), glyph: "download", onClick: async () => { if (await openImport(ctx)) { state.period = "all"; await draw("#import-csv"); } } }),
        button({ id: "export-csv", label: t("csv.export"), exportAction: true, onClick: guard(async () => exportEntriesCsv(ctx, data, rows, range)) })),
      h("div", { class: "card filters", id: "entries-filters" },
        sel("filter-period", t("filter.period"), state.period, PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) })), "period"),
        sel("filter-type", t("entry.type"), state.type, [{ value: "", label: t("common.all") }, { value: "income", label: t("type.income") }, { value: "expense", label: t("type.expense") }], "type"),
        sel("filter-scope", t("entry.scope"), state.scope, [{ value: "", label: t("common.all") }, { value: "business", label: t("scope.business") }, { value: "personal", label: t("scope.personal") }], "scope"),
        sel("filter-category", t("entry.category"), state.categoryId, catOptions, "categoryId"),
        search.element),
      h("dl", { class: "card sum-strip", id: "entries-sum" },
        h("div", {}, h("dt", { text: t("dash.income") }), h("dd", { class: "is-income", id: "sum-income", text: fmt(sum.incomeMinor) })),
        h("div", {}, h("dt", { text: t("dash.expenses") }), h("dd", { class: "is-expense", id: "sum-expense", text: fmt(sum.expenseMinor) })),
        h("div", {}, h("dt", { text: t("dash.net") }), h("dd", { id: "sum-net", text: fmt(sum.netMinor) })),
        h("div", {}, h("dt", { text: t("entries.count") }), h("dd", { id: "sum-count", text: formatNumber(rows.length) }))),
      list, more, disclaimer(ctx));
    if (focusSel) root.querySelector(focusSel)?.focus();
  };
  await draw();
  ctx.onExternalChange(() => draw());
}
