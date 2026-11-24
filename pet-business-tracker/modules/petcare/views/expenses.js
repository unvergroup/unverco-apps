// Giderler ve Kasa gorunumleri (Gelir ekraninin "Giderler" ve "Kasa" bolumleri) + gider formu.
// Gider = tarih, kategori, aciklama (istege bagli), tutar, odeme yontemi. Kullanici verisi yalniz metin dugumu olarak yazilir (core/ui.js h()).
// Kasa kurali (logic/expenses.js): net kasa = tahsil edilen gelir - gider; bekleyen tahsilat ve planlanan tutar neta GIRMEZ.
import { todayIso } from "../../../core/dates.js";
import { downloadText } from "../../../core/files.js";
import { formatMinorPlain } from "../../../core/money.js";
import { localizeNumber, parseMoneyText } from "../../../core/number-input.js";
import { guardWrite } from "../../../core/safe.js";
import { emptyState, field, h, table } from "../../../core/ui.js";
import { cashSummary, expenseCsvFileName, expenseCsvText, expenseTotals, expensesByCategory, expensesInRange } from "../logic/expenses.js";
import { EXPENSE_CATEGORIES, LIMITS, PAYMENT_METHODS, cleanRecord, validateExpense } from "../logic/schema.js";
import { errText, openForm, selectField } from "./common.js";

const catLabel = (ctx, k) => (EXPENSE_CATEGORIES.includes(k) ? ctx.i18n.t(`exp.cat.${k}`) : ctx.i18n.t("exp.cat.other"));
const methodLabel = (ctx, k) => (PAYMENT_METHODS.includes(k) ? ctx.i18n.t(`payment.${k}`) : "");

// Yatay cubuk (gelirdeki "hizmete gore" deseniyle ayni; genislik CSSOM ile, satir ici stil metni yok -> CSP)
const bar = (pct) => {
  const fill = h("span", { class: "bar-fill" });
  fill.style.setProperty("--w", `${Math.max(0, Math.min(100, pct))}%`);
  return h("span", { class: "bar", "aria-hidden": "true" }, fill);
};

// ---------- gider formu ----------
// opts: { expense? (duzenle), date? } -> Promise<boolean> (kaydedildi mi)
export async function openExpenseForm(ctx, opts = {}) {
  const { t } = ctx.i18n;
  const dec = ctx.i18n.decimal;
  const exp = opts.expense ?? null;

  const date = field({ label: t("appt.date"), type: "date", value: exp?.date ?? opts.date ?? todayIso(), required: true });
  const category = selectField({ label: t("exp.category"), value: exp?.category ?? "", options: [{ value: "", label: t("form.choose") }, ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(`exp.cat.${c}`) }))] });
  category.input.required = true;
  const description = field({ label: t("exp.description"), value: exp?.description ?? "", maxlength: LIMITS.expenseDescription });
  const amount = field({ label: t("exp.amount"), value: exp ? localizeNumber(formatMinorPlain(exp.amount), dec) : "", inputmode: "decimal", autocomplete: "off", required: true });
  const method = selectField({ label: t("appt.paymentMethod"), value: exp?.paymentMethod || "cash", options: PAYMENT_METHODS.map((p) => ({ value: p, label: t(`payment.${p}`) })) });

  return openForm(ctx, {
    title: exp ? t("exp.edit") : t("exp.add"),
    groups: [{ legend: t("exp.formGroup"), nodes: [date.element, category.element, description.element, amount.element, method.element] }],
    onSave: async () => {
      for (const f of [date, category, description, amount, method]) f.setError("");
      const text = amount.input.value.trim();
      const minor = text === "" ? undefined : parseMoneyText(text, { decimal: dec });
      const rec = {
        ...(exp ?? {}),
        date: date.input.value, category: category.input.value, description: description.input.value,
        amount: minor === undefined ? undefined : Number.isNaN(minor) || minor < 0 ? -1 : minor,
        paymentMethod: method.input.value,
      };
      const v = validateExpense(rec);
      const show = { date, category, description, amount, paymentMethod: method };
      for (const [k, code] of Object.entries(v.errors)) {
        show[k]?.setError(k === "amount" ? (code === "required" ? t("msg.required") : t("msg.invalidAmount")) : errText(ctx, code, LIMITS.expenseDescription));
      }
      if (!v.valid) return false;
      const clean = cleanRecord("expenses", rec, { keepMeta: false }).record;
      if (exp) await ctx.store.update("expenses", exp.id, clean);
      else {
        if ((await ctx.store.count("expenses")) + 1 > LIMITS.expenses) { ctx.notify(t("msg.limitReached", { max: LIMITS.expenses }), "error"); return false; }
        await ctx.store.add("expenses", clean);
      }
      ctx.notify(t(exp ? "msg.saved" : "msg.created"), "success");
      return true;
    },
  }).then((saved) => (saved ? { saved: true, date: date.input.value } : { saved: false }));
}

// ---------- Giderler gorunumu ----------
// api: { data, range, reload(focusSel?), setPeriodAll() } -> dugum dizisi (govdeye konur). Ekle / CSV dugmeleri expenseActions'tadir.
export function buildExpensesView(ctx, { data, range, reload }) {
  const { t, formatDate, formatNumber } = ctx.i18n;
  const fmt = ctx.money.format;
  const rows = expensesInRange(data.expenses, range.from, range.to);
  const totals = expenseTotals(data.expenses, range.from, range.to);
  const guard = guardWrite((e) => ctx.fail(e));
  const what = (e) => `${catLabel(ctx, e.category)}, ${formatDate(e.date)}, ${fmt(e.amount)}`;

  const remove = (e) => guard(async () => {
    if (!(await ctx.confirm({ title: t("exp.deleteTitle"), message: t("exp.deleteText") }))) return;
    await ctx.store.remove("expenses", e.id);
    ctx.notify(t("exp.deleted"), "success");
    await reload("#expense-add");
  }, `del-${e.id}`);
  const edit = (e) => async () => {
    const r = await openExpenseForm(ctx, { expense: e });
    if (r.saved) await reload(`[data-exp-edit="${e.id}"]`, r.date);
  };

  const list = rows.length
    ? table({
      caption: t("exp.listCaption"),
      columns: [
        { key: "date", label: t("appt.date"), nowrap: true, render: (e) => formatDate(e.date) },
        { key: "category", label: t("exp.category"), render: (e) => catLabel(ctx, e.category) },
        { key: "description", label: t("exp.description"), narrowHide: false, render: (e) => e.description },
        { key: "method", label: t("appt.paymentMethod"), render: (e) => methodLabel(ctx, e.paymentMethod) },
        { key: "amount", label: t("exp.amount"), align: "num", render: (e) => fmt(e.amount) },
        { key: "actions", label: t("exp.actions"), actions: true, render: (e) => h("span", { class: "row exp-actions" },
          h("button", { type: "button", class: "btn", "data-exp-edit": e.id, "aria-label": t("exp.editAria", { what: what(e) }), text: t("common.edit"), on: { click: edit(e) } }),
          h("button", { type: "button", class: "btn btn-danger", "data-exp-delete": e.id, "aria-label": t("exp.deleteAria", { what: what(e) }), text: t("common.delete"), on: { click: remove(e) } })) },
      ],
      rows,
    })
    : emptyState({ title: t("exp.empty"), text: t("exp.emptyHint") });

  // Gorsel dil geliriyle aynidir: tek kahraman tutar (money-label / money-value), altinda kayit sayisi.
  return [
    h("section", { class: "card exp-hero", "aria-label": t("exp.total") },
      h("p", { class: "money-label", text: t("exp.total") }),
      h("p", { class: "exp-total", id: "expense-total", text: fmt(totals.totalMinor) }),
      h("p", { class: "money-sub", id: "expense-count", text: ctx.i18n.tn("exp.count", totals.count, { n: formatNumber(totals.count) }) })),
    h("section", { class: "stack exp-list", "aria-label": t("exp.listCaption") }, h("h3", { text: t("exp.listCaption") }), list),
  ];
}

// Gider CSV'si (secili donem). Tarihe gore artan; bos donemde indirme yok, uyari var.
export function exportExpensesCsv(ctx, { data, range }) {
  const { t } = ctx.i18n;
  const rows = expensesInRange(data.expenses, range.from, range.to);
  if (!rows.length) { ctx.notify(t("exp.csvEmpty"), "warn"); return; }
  const text = expenseCsvText(rows, {
    headers: { date: t("appt.date"), category: t("exp.category"), description: t("exp.description"), amount: t("exp.amount"), method: t("appt.paymentMethod") },
    delimiter: ctx.i18n.csv.delimiter, decimal: ctx.i18n.csv.decimal,
    categoryLabel: (k) => catLabel(ctx, k), methodLabel: (k) => methodLabel(ctx, k),
  });
  if (downloadText(expenseCsvFileName(range.from, range.to, ctx.config.fileSlug), text, "text/csv")) ctx.notify(t("exp.csvDone"), "success");
}

// ---------- Kasa gorunumu ----------
export function buildCashView(ctx, { data, range }) {
  const { t, formatPercent } = ctx.i18n;
  const fmt = ctx.money.format;
  const cash = cashSummary(data.appointments, data.expenses, range.from, range.to);
  const cats = expensesByCategory(data.expenses, range.from, range.to);
  const negative = cash.netMinor < 0;
  const status = negative ? "negative" : cash.netMinor === 0 ? "even" : "positive";
  const line = (id, label, value, cls = "") => h("div", { class: `ledger-row ${cls}`.trim() }, h("dt", { text: label }), h("dd", { id, text: value }));

  // Hic hareket yoksa (ne tahsilat, ne gider, ne bekleyen) net kasa kartinin altinda yonlendirici bos durum olur; cubuklar gosterilmez.
  const idle = cash.collectedMinor === 0 && cash.expensesMinor === 0 && cash.pendingMinor === 0;
  const empty = emptyState({ title: t("cash.emptyTitle"), text: t("cash.emptyText") });
  empty.id = "cash-empty";

  return [
    h("section", { class: `card cash-card${negative ? " is-negative" : ""}`, id: "cash-card", "data-state": status, "aria-label": t("cash.net") },
      h("p", { class: "money-label", text: t("cash.net") }),
      h("p", { class: "cash-net", id: "cash-net", text: fmt(cash.netMinor) }),
      h("p", { class: "cash-status", id: "cash-status", text: t(`cash.status.${status}`) }),
      h("dl", { class: "ledger" },
        line("cash-collected", t("income.total"), fmt(cash.collectedMinor)),
        line("cash-expenses", t("exp.total"), fmt(cash.expensesMinor), "is-out")),
      h("p", { class: "muted cash-formula", text: t("cash.formula") })),
    idle ? empty : null,
    idle ? null : h("section", { class: "card money-card is-pending", id: "cash-pending-card", "aria-label": t("cash.pendingLabel") },
      h("p", { class: "money-label", text: t("cash.pendingLabel") }),
      h("p", { class: "cash-pending", id: "cash-pending", text: fmt(cash.pendingMinor) }),
      h("p", { class: "money-hint", text: t("cash.pendingNote") })),
    idle ? null : h("section", { class: "card stack", "aria-label": t("cash.byCategory") },
      h("h3", { text: t("cash.byCategory") }),
      cats.length
        ? h("ul", { class: "bars", id: "cash-categories" }, ...cats.map((r) => h("li", { class: "bar-row" },
            h("span", { class: "bar-label", text: catLabel(ctx, r.category) }),
            bar(r.share * 100),
            h("span", { class: "bar-value", text: `${fmt(r.totalMinor)} · ${formatPercent(Math.round(r.share * 1000) / 10)}` }))))
        : h("p", { class: "muted", text: t("exp.empty") })),
  ].filter(Boolean);
}

