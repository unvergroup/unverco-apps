// Yazdirilabilir rapor MODELLERI (saf veri; DOM yok): aylik ozet, yillik kar-zarar, kategori dokumu, kilometre kaydi.
// Cizim print/render.js'te (ekran / tarayici yazdirma) ve core/canvas-doc.js'te (iPhone PDF). Belge: { id, title, period, sections[], notes[], empty }.
// L: { t, tn, formatDate, formatCurrency, formatNumber, category(id), method(k), monthName(m), unit, digits, currency }
import { byCategory, monthRange, monthlyTable, profitAndLoss, totals, yearRange, inRange } from "../logic/calc.js";
import { mileageSummary, milesText, rateText } from "../logic/mileage.js";

export const REPORTS = Object.freeze(["month", "pl", "categories", "mileage"]);

const notesOf = (L, now) => [L.t("report.generated", { date: L.formatDate(now, { dateStyle: "long" }) }), L.t("disclaimer.tax")];
const emptyDoc = (L, { id, title, period, now }) => ({ id, title, period, sections: [{ kind: "empty", text: L.t("report.empty") }], notes: notesOf(L, now), empty: true });
const sumRow = (L, rows) => rows.reduce((n, r) => n + r.totalMinor, 0);

function catTable(L, heading, rows, totalLabel) {
  return {
    kind: "table", heading,
    columns: [{ key: "cat", label: L.t("entry.category"), primary: true }, { key: "n", label: L.t("report.count"), num: true }, { key: "amount", label: L.t("entry.amount"), num: true, amount: true }],
    rows: rows.map((r) => ({ cat: L.category(r.categoryId), n: L.formatNumber(r.count), amount: L.formatCurrency(r.totalMinor) })),
    total: { label: totalLabel, value: L.formatCurrency(sumRow(L, rows)) },
  };
}
const personalNote = (L, p) => (p.personalIncomeMinor || p.personalExpenseMinor
  ? { kind: "note", text: L.t("report.personalNote", { income: L.formatCurrency(p.personalIncomeMinor), expense: L.formatCurrency(p.personalExpenseMinor) }) } : null);

// ---- 1. Aylik ozet ----
export function monthDoc(L, { entries, year, month, now = new Date() }) {
  const range = monthRange(year, month);
  const title = L.t("report.month.title");
  const period = `${L.monthName(month)} ${year}`;
  const inMonth = entries.filter((e) => inRange(e.date, range));
  if (!inMonth.length) return emptyDoc(L, { id: "month", title, period, now });
  const p = profitAndLoss(entries, range);
  const list = [...inMonth].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const sections = [
    { kind: "kv", heading: L.t("report.summary"), rows: [[L.t("dash.income"), L.formatCurrency(p.incomeMinor)], [L.t("dash.expenses"), L.formatCurrency(p.expenseMinor)], [L.t("dash.net"), L.formatCurrency(p.netMinor), true]] },
    p.income.length ? catTable(L, L.t("report.incomeByCat"), p.income, L.t("report.totalIncome")) : null,
    p.expense.length ? catTable(L, L.t("report.expenseByCat"), p.expense, L.t("report.totalExpenses")) : null,
    {
      kind: "table", heading: L.t("report.allEntries"),
      columns: [
        { key: "date", label: L.t("entry.date"), primary: true, nowrap: true }, { key: "type", label: L.t("entry.type"), nowrap: true }, { key: "cat", label: L.t("entry.category"), primary: true },
        { key: "party", label: L.t("entry.party") }, { key: "scope", label: L.t("entry.scope"), nowrap: true }, { key: "amount", label: L.t("entry.amount"), num: true, amount: true },
      ],
      rows: list.map((e) => ({ date: L.formatDate(e.date, { dateStyle: "short" }), type: L.t(`type.${e.type}`), cat: L.category(e.categoryId), party: e.party ?? "",
        scope: L.t(`scope.${e.scope}`), amount: L.formatCurrency(e.type === "expense" ? -e.amount : e.amount) })),
    },
    personalNote(L, p),
  ].filter(Boolean);
  return { id: "month", title, period, sections, notes: notesOf(L, now), empty: false };
}

// ---- 2. Yillik kar-zarar (kategori bazli) ----
export function plDoc(L, { entries, year, now = new Date() }) {
  const range = yearRange(year);
  const title = L.t("report.pl.title");
  const period = L.t("report.yearPeriod", { year });
  const p = profitAndLoss(entries, range);
  if (!p.income.length && !p.expense.length && !p.personalIncomeMinor && !p.personalExpenseMinor) return emptyDoc(L, { id: "pl", title, period, now });
  const months = monthlyTable(entries, year);
  const sections = [
    catTable(L, L.t("report.income"), p.income, L.t("report.totalIncome")),
    catTable(L, L.t("report.expenses"), p.expense, L.t("report.totalExpenses")),
    { kind: "kv", heading: L.t("report.result"), rows: [[L.t("report.totalIncome"), L.formatCurrency(p.incomeMinor)], [L.t("report.totalExpenses"), L.formatCurrency(p.expenseMinor)], [L.t(p.netMinor < 0 ? "report.netLoss" : "report.netProfit"), L.formatCurrency(p.netMinor), true]] },
    {
      kind: "table", heading: L.t("report.byMonth"),
      columns: [{ key: "m", label: L.t("report.month"), primary: true, nowrap: true }, { key: "inc", label: L.t("dash.income"), num: true }, { key: "exp", label: L.t("dash.expenses"), num: true }, { key: "net", label: L.t("dash.net"), num: true, amount: true }],
      rows: months.map((r) => ({ m: L.monthName(r.month), inc: L.formatCurrency(r.incomeMinor), exp: L.formatCurrency(r.expenseMinor), net: L.formatCurrency(r.netMinor) })),
      total: { label: L.t("report.yearTotal"), value: L.formatCurrency(p.netMinor) },
    },
    personalNote(L, p),
  ].filter(Boolean);
  return { id: "pl", title, period, sections, notes: notesOf(L, now), empty: false };
}

// ---- 3. Kategori dokumu: her kategori ayri tablo (kayitlar + ara toplam) ----
export function categoriesDoc(L, { entries, year, now = new Date() }) {
  const range = yearRange(year);
  const title = L.t("report.categories.title");
  const period = L.t("report.yearPeriod", { year });
  const sections = [];
  for (const type of ["income", "expense"]) {
    for (const c of byCategory(entries, type, range)) {
      const rows = entries.filter((e) => e.type === type && e.scope !== "personal" && e.categoryId === c.categoryId && inRange(e.date, range))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      sections.push({
        kind: "table", heading: `${L.t(`type.${type}`)} · ${L.category(c.categoryId)}`,
        columns: [{ key: "date", label: L.t("entry.date"), primary: true, nowrap: true }, { key: "party", label: L.t("entry.party"), primary: true }, { key: "note", label: L.t("entry.note") }, { key: "amount", label: L.t("entry.amount"), num: true, amount: true }],
        rows: rows.map((e) => ({ date: L.formatDate(e.date, { dateStyle: "short" }), party: e.party ?? "", note: e.note ?? "", amount: L.formatCurrency(e.amount) })),
        total: { label: L.t("report.subtotal"), value: L.formatCurrency(c.totalMinor) },
      });
    }
  }
  if (!sections.length) return emptyDoc(L, { id: "categories", title, period, now });
  const t = totals(entries, range);
  sections.push({ kind: "kv", heading: L.t("report.result"), rows: [[L.t("report.totalIncome"), L.formatCurrency(t.incomeMinor)], [L.t("report.totalExpenses"), L.formatCurrency(t.expenseMinor)], [L.t("dash.net"), L.formatCurrency(t.netMinor), true]] });
  return { id: "categories", title, period, sections, notes: notesOf(L, now), empty: false };
}

// ---- 4. Kilometre kaydi (ayri sayfa): tarih, amac, mesafe; oran girildiyse mesafe x oran ----
export function mileageDoc(L, { trips, year, rateMilli, now = new Date() }) {
  const range = yearRange(year);
  const title = L.t("report.mileage.title");
  const period = L.t("report.yearPeriod", { year });
  const s = mileageSummary(trips, range, rateMilli, L.digits);
  if (!s.rows.length) return emptyDoc(L, { id: "mileage", title, period, now });
  const unit = L.t(`unit.${L.unit}`);
  const sections = [
    {
      kind: "table", heading: L.t("report.trips"),
      columns: [{ key: "date", label: L.t("entry.date"), primary: true, nowrap: true }, { key: "purpose", label: L.t("trip.purpose"), primary: true }, { key: "note", label: L.t("entry.note") }, { key: "miles", label: L.t("trip.distanceUnit", { unit }), num: true, amount: true }],
      rows: s.rows.map((t) => ({ date: L.formatDate(t.date, { dateStyle: "short" }), purpose: t.purpose, note: t.note ?? "", miles: L.formatNumber(t.miles10 / 10, { maximumFractionDigits: 1 }) })),
      total: { label: L.t("trip.totalDistance"), value: `${L.formatNumber(s.miles10 / 10, { maximumFractionDigits: 1 })} ${unit}` },
    },
    {
      kind: "kv", heading: L.t("report.summary"),
      rows: [
        [L.t("trip.count"), L.formatNumber(s.trips)],
        [L.t("trip.totalDistance"), `${milesText(s.miles10)} ${unit}`],
        ...(s.amountMinor === null ? [[L.t("trip.rate"), L.t("trip.noRate")]] : [[L.t("trip.rate"), L.t("trip.rateValue", { rate: rateText(rateMilli), unit, currency: L.currency })], [L.t("trip.amount"), L.formatCurrency(s.amountMinor), true]]),
      ],
    },
    { kind: "note", text: L.t("trip.rateNote") },
  ];
  return { id: "mileage", title, period, sections, notes: notesOf(L, now), empty: false };
}

export function buildReport(id, L, args) {
  if (id === "month") return monthDoc(L, args);
  if (id === "categories") return categoriesDoc(L, args);
  if (id === "mileage") return mileageDoc(L, args);
  return plDoc(L, args);
}
