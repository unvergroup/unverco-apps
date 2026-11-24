// Gider ve kasa hesaplari. Saf islevler: DOM yok, ag yok. Para en kucuk birimin tamsayisidir.
// Kasa kurali: net kasa = TAHSIL EDILEN gelir (tamamlanmis + odenmis randevu) - toplam gider.
// Bekleyen tahsilat (tamamlanmis ama odenmemis) ve planlanan (henuz tamamlanmamis) tutar neta GIRMEZ: para henuz elde degil.
import { formatMinorPlain } from "../../../core/money.js";
import { csvCell } from "../../../core/backup.js";
import { revenueForRange } from "./calc.js";
import { EXPENSE_CATEGORIES } from "./schema.js";

const list = (v) => (Array.isArray(v) ? v.filter((e) => e && typeof e === "object") : []);
const amountOf = (e) => (Number.isSafeInteger(e.amount) && e.amount > 0 ? e.amount : 0);
const inRange = (e, from, to) => typeof e.date === "string" && e.date >= from && e.date <= to;

/** [from, to] (dahil) araligindaki giderler, en yeni ustte (ayni tarihte son eklenen ustte). */
export function expensesInRange(expenses, from, to) {
  return list(expenses)
    .filter((e) => inRange(e, from, to))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) || String(a.id).localeCompare(String(b.id))));
}

/** Aralikta toplam gider ve adet. */
export function expenseTotals(expenses, from, to) {
  let totalMinor = 0;
  let count = 0;
  for (const e of list(expenses)) {
    if (!inRange(e, from, to)) continue;
    count += 1;
    totalMinor += amountOf(e);
  }
  return { totalMinor, count };
}

/** Kategori bazli gider dagilimi (tutara gore azalan). share: 0-1 (toplam 0 ise 0). Bilinmeyen kategori "other" sayilir. */
export function expensesByCategory(expenses, from, to) {
  const map = new Map();
  for (const e of list(expenses)) {
    if (!inRange(e, from, to)) continue;
    const cat = EXPENSE_CATEGORIES.includes(e.category) ? e.category : "other";
    const row = map.get(cat) ?? { category: cat, count: 0, totalMinor: 0, share: 0 };
    row.count += 1;
    row.totalMinor += amountOf(e);
    map.set(cat, row);
  }
  const rows = [...map.values()];
  const total = rows.reduce((s, r) => s + r.totalMinor, 0);
  for (const r of rows) r.share = total > 0 ? r.totalMinor / total : 0;
  return rows.sort((a, b) => b.totalMinor - a.totalMinor || EXPENSE_CATEGORIES.indexOf(a.category) - EXPENSE_CATEGORIES.indexOf(b.category));
}

/**
 * Kasa durumu.
 * @returns {{ collectedMinor: number, expensesMinor: number, netMinor: number, pendingMinor: number, bookedMinor: number }}
 *   netMinor = collectedMinor - expensesMinor (NEGATIF olabilir); pendingMinor / bookedMinor neta dahil DEGIL.
 */
export function cashSummary(appointments, expenses, from, to) {
  const rev = revenueForRange(appointments, from, to);
  const exp = expenseTotals(expenses, from, to);
  return {
    collectedMinor: rev.earnedMinor, expensesMinor: exp.totalMinor, netMinor: rev.earnedMinor - exp.totalMinor,
    pendingMinor: rev.outstandingMinor, bookedMinor: rev.bookedMinor,
  };
}

// ---------- CSV ----------
/** Gider CSV sutunlari (sira sabit). */
export const EXPENSE_CSV_COLUMNS = Object.freeze(["date", "category", "description", "amount", "method"]);

/**
 * Giderleri CSV metnine cevirir: gelir CSV'siyle ayni kurallar (UTF-8 BOM, CRLF, ";" / "," ayraci, ondalik virgul / nokta,
 * metin hucrelerinde formul enjeksiyonu korumasi). Tarihe gore ARTAN (muhasebe sirasi).
 * @param {object[]} expenses ham gider kayitlari (zaten donem suzgecinden gecmis)
 * @param {{ headers: Record<string,string>, delimiter?: string, decimal?: string, categoryLabel?: (k:string)=>string, methodLabel?: (k:string)=>string }} o
 */
export function expenseCsvText(expenses, o) {
  const delimiter = o.delimiter === ";" ? ";" : ",";
  const decimal = o.decimal === "," ? "," : ".";
  const categoryLabel = o.categoryLabel ?? ((k) => k);
  const methodLabel = o.methodLabel ?? ((k) => k);
  const cell = (v) => csvCell(v, delimiter);
  const rows = list(expenses).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.id).localeCompare(String(b.id))));
  const lines = [EXPENSE_CSV_COLUMNS.map((k) => cell(o.headers[k] ?? k)).join(delimiter)];
  for (const e of rows) {
    lines.push([
      e.date, categoryLabel(e.category), e.description ?? "",
      formatMinorPlain(amountOf(e)).replace(".", decimal), e.paymentMethod ? methodLabel(e.paymentMethod) : "",
    ].map(cell).join(delimiter));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Gider CSV dosya adi: "pet-business-tracker-expenses-2026-11-01_2026-11-30.csv" (tum zamanlar: "...-expenses-all.csv"). */
export function expenseCsvFileName(from, to, slug = "unvercopbt") {
  return from <= "0000-01-01" && to >= "9999-12-31" ? `${slug}-expenses-all.csv` : `${slug}-expenses-${from}_${to}.csv`;
}
