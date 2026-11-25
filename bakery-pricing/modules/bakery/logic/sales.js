// Aylik satis ozeti (saf). Satis = o ay teslim tarihli ve "odendi" durumundaki siparislerin toplami.
// Teslim edilip odenmemis siparisler "tahsil edilecek", acik siparislerde alinan kaporalar "alinan kapora" olarak AYRI gosterilir.
import { daysInMonth, toIso } from "../../../core/dates.js";
import { OPEN, lineTotal, orderCost, orderTotals } from "./orders.js";

export const monthRange = (ym) => { const [y, m] = ym.split("-").map(Number); return { from: toIso(y, m, 1), to: toIso(y, m, daysInMonth(y, m)) }; };
export const monthOf = (iso) => iso.slice(0, 7);
export function shiftMonth(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * Donus: { range, paid: { count, totalMinor, costMinor, profitMinor, unknownCost }, unpaid: { count, balanceMinor },
 *          deposits: { count, depositMinor }, cancelled, byProduct: [{ name, qty, totalMinor }], orders (ayin siparisleri) }
 */
export function monthSummary({ orders, recipes }, ym, costs) {
  const range = monthRange(ym);
  const inMonth = orders.filter((o) => o.date >= range.from && o.date <= range.to);
  const rById = new Map(recipes.map((r) => [r.id, r]));
  const paid = { count: 0, totalMinor: 0, costMinor: 0, profitMinor: 0, unknownCost: 0, extrasMinor: 0 };
  const unpaid = { count: 0, balanceMinor: 0 };
  const deposits = { count: 0, depositMinor: 0 };
  let cancelled = 0;
  const prod = new Map();
  for (const o of inMonth) {
    const tt = orderTotals(o);
    if (o.status === "paid") {
      paid.count += 1; paid.totalMinor += tt.totalMinor;
      const c = orderCost(o, costs, rById);
      paid.costMinor += c.costMinor; paid.unknownCost += c.unknown;
      for (const it of o.items ?? []) {
        const cur = prod.get(it.name) ?? { name: it.name, qty: 0, totalMinor: 0 };
        cur.qty += it.qty; cur.totalMinor += lineTotal(it);
        prod.set(it.name, cur);
      }
    } else if (o.status === "delivered") { unpaid.count += 1; unpaid.balanceMinor += tt.balanceMinor; }
    else if (OPEN.includes(o.status) && tt.depositMinor > 0) { deposits.count += 1; deposits.depositMinor += tt.depositMinor; }
    else if (o.status === "cancelled") cancelled += 1;
  }
  paid.profitMinor = paid.totalMinor - paid.costMinor;
  // Urun satirlari toplami ile odenen satis arasindaki fark: teslimat ucreti - indirim (ekran ve PDF'te ayri satir; toplam tutar).
  const byProduct = [...prod.values()].sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name));
  paid.extrasMinor = paid.totalMinor - byProduct.reduce((n, p) => n + p.totalMinor, 0);
  return { range, paid, unpaid, deposits, cancelled, byProduct, orders: inMonth };
}
