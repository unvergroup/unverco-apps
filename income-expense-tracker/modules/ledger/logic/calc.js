// Hesaplar (saf): donem, toplamlar, aylik tablo, kategori dagilimi, kar-zarar. Yalniz isletme (scope = business) kayitlari kara girer;
// kisisel kayitlar ayri satirda gosterilir, kar hesabina girmez. Vergi hesabi YOKTUR.
import { daysInMonth, toIso } from "../../../core/dates.js";

const num = (v) => (Number.isSafeInteger(v) ? v : 0);

export const yearRange = (year) => ({ from: toIso(year, 1, 1), to: toIso(year, 12, 31) });
export const monthRange = (year, month) => ({ from: toIso(year, month, 1), to: toIso(year, month, daysInMonth(year, month)) });
export const inRange = (date, r) => typeof date === "string" && date >= r.from && date <= r.to;

/** Etkin isletmenin kayitlari (businessId eslesir). */
export const ofBusiness = (list, businessId) => (Array.isArray(list) ? list : []).filter((r) => r && r.businessId === businessId);

/** Liste filtresi: { range?, type?, scope?, categoryId?, q? }. Tarihe gore yeni once, ayni gunde son eklenen once. */
export function filterEntries(entries, { range, type, scope, categoryId, q, categoryName } = {}) {
  const needle = String(q ?? "").trim().toLocaleLowerCase();
  return entries
    .filter((e) => (!range || inRange(e.date, range))
      && (!type || e.type === type)
      && (!scope || e.scope === scope)
      && (!categoryId || e.categoryId === categoryId)
      && (!needle || [e.party, e.note, categoryName ? categoryName(e.categoryId) : ""].some((s) => String(s ?? "").toLocaleLowerCase().includes(needle))))
    .sort((a, b) => (a.date === b.date ? String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) : a.date < b.date ? 1 : -1));
}

/** Donem toplamlari: { incomeMinor, expenseMinor, netMinor, count, personalIncomeMinor, personalExpenseMinor }. */
export function totals(entries, range) {
  const out = { incomeMinor: 0, expenseMinor: 0, netMinor: 0, count: 0, personalIncomeMinor: 0, personalExpenseMinor: 0 };
  for (const e of entries) {
    if (range && !inRange(e.date, range)) continue;
    const a = num(e.amount);
    if (e.scope === "personal") {
      if (e.type === "income") out.personalIncomeMinor += a; else out.personalExpenseMinor += a;
      continue;
    }
    out.count += 1;
    if (e.type === "income") out.incomeMinor += a; else out.expenseMinor += a;
  }
  out.netMinor = out.incomeMinor - out.expenseMinor;
  return out;
}

/** Yilin 12 ayi: [{ month: 1..12, incomeMinor, expenseMinor, netMinor, count }] (yalniz isletme kayitlari). */
export function monthlyTable(entries, year) {
  const rows = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, incomeMinor: 0, expenseMinor: 0, netMinor: 0, count: 0 }));
  const yr = String(year);
  for (const e of entries) {
    if (e.scope === "personal" || typeof e.date !== "string" || e.date.slice(0, 4) !== yr) continue;
    const r = rows[Number(e.date.slice(5, 7)) - 1];
    if (!r) continue;
    r.count += 1;
    if (e.type === "income") r.incomeMinor += num(e.amount); else r.expenseMinor += num(e.amount);
  }
  for (const r of rows) r.netMinor = r.incomeMinor - r.expenseMinor;
  return rows;
}

/** Kategori dagilimi (bir tur, bir donem; yalniz isletme): [{ categoryId, totalMinor, count, share }] buyukten kucuge. */
export function byCategory(entries, type, range) {
  const map = new Map();
  let all = 0;
  for (const e of entries) {
    if (e.type !== type || e.scope === "personal" || (range && !inRange(e.date, range))) continue;
    const m = map.get(e.categoryId) ?? { categoryId: e.categoryId, totalMinor: 0, count: 0 };
    m.totalMinor += num(e.amount);
    m.count += 1;
    map.set(e.categoryId, m);
    all += num(e.amount);
  }
  return [...map.values()].map((m) => ({ ...m, share: all ? m.totalMinor / all : 0 })).sort((a, b) => b.totalMinor - a.totalMinor || String(a.categoryId).localeCompare(String(b.categoryId)));
}

/** Kar-zarar: { income: [...byCategory], expense: [...], incomeMinor, expenseMinor, netMinor, personal{...} }. */
export function profitAndLoss(entries, range) {
  const t = totals(entries, range);
  return {
    income: byCategory(entries, "income", range),
    expense: byCategory(entries, "expense", range),
    incomeMinor: t.incomeMinor, expenseMinor: t.expenseMinor, netMinor: t.netMinor,
    personalIncomeMinor: t.personalIncomeMinor, personalExpenseMinor: t.personalExpenseMinor,
  };
}

/** Kayitlarda gecen yillar (yeni once) + icinde bulunulan yil. */
export function yearsOf(lists, currentYear) {
  const ys = new Set([currentYear]);
  for (const list of lists) for (const r of list ?? []) if (typeof r?.date === "string" && /^\d{4}/.test(r.date)) ys.add(Number(r.date.slice(0, 4)));
  return [...ys].sort((a, b) => b - a);
}
