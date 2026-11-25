// Siparis hesaplari (saf): kalem toplami, kapora / kalan, durum zinciri, yaklasan liste, malzeme ihtiyaci (alisveris listesi).
import { mulQty } from "../../../core/money.js";
import { CHAIN } from "./schema.js";
import { convert } from "./units.js";
import { roundMinor } from "./costing.js";

const int = (v) => (Number.isSafeInteger(v) ? v : 0);
export const OPEN = Object.freeze(["inquiry", "confirmed", "in_progress"]);
export const ACTIVE = Object.freeze(["confirmed", "in_progress"]); // uretimi planlanan (alisveris listesine girer)

/** Kalem tutari = yuvarla(adet x birim fiyat). */
export const lineTotal = (it) => mulQty(int(it.unitPriceMinor), typeof it.qty === "number" ? it.qty : 0);

/** { itemsMinor, deliveryFeeMinor, discountMinor, totalMinor, depositMinor, paidMinor, balanceMinor } */
export function orderTotals(o) {
  const itemsMinor = (o.items ?? []).reduce((s, it) => s + lineTotal(it), 0);
  const fee = int(o.deliveryFeeMinor);
  const disc = Math.min(int(o.discountMinor), itemsMinor + fee);
  const totalMinor = itemsMinor + fee - disc;
  const depositMinor = Math.min(int(o.depositMinor), totalMinor);
  const paidMinor = o.status === "paid" ? totalMinor : o.status === "cancelled" ? depositMinor : depositMinor;
  const balanceMinor = o.status === "paid" || o.status === "cancelled" ? 0 : totalMinor - depositMinor;
  return { itemsMinor, deliveryFeeMinor: fee, discountMinor: disc, totalMinor, depositMinor, paidMinor, balanceMinor };
}

/** Onerilen kapora: toplamin yuzdesi, yuvarlanmis. */
export const suggestedDeposit = (totalMinor, pct) => roundMinor((int(totalMinor) * (typeof pct === "number" ? pct : 0)) / 100);

/** Zincirde bir sonraki durum ya da null (odendi / iptal sonrasi yok). */
export function nextStatus(status) {
  const i = CHAIN.indexOf(status);
  return i < 0 || i === CHAIN.length - 1 ? null : CHAIN[i + 1];
}

/** Tahmini maliyet: kalem adedi x tarifin birim maliyeti (tarifi silinmis kalem maliyetsiz sayilir). */
export function orderCost(o, costs, recipesById) {
  let exact = 0;
  let unknown = 0;
  for (const it of o.items ?? []) {
    const c = it.recipeId ? costs.get(it.recipeId) : null;
    if (!c || !recipesById.has(it.recipeId)) { unknown += 1; continue; }
    exact += c.unitCostExact * it.qty;
  }
  return { costMinor: roundMinor(exact), unknown };
}

/** Yaklasan ve geciken acik siparisler (sorgu / onayli / hazirlaniyor), tarih + saat sirali. */
export function upcoming(orders, today) {
  return orders.filter((o) => OPEN.includes(o.status)).sort(byWhen).map((o) => ({ order: o, late: o.date < today }));
}
export const byWhen = (a, b) => (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")) || String(a.serial).localeCompare(String(b.serial));

/**
 * Siparislerin malzeme ihtiyaci. Kalem adedi / tarif verimi = parti sayisi; her tarif satiri malzemenin PAKET birimine cevrilir.
 * Donus: { rows: [{ ingredient, need (paket biriminde), unit, packages, costMinor (gereken kadar), buyMinor (paket x fiyat) }], missing: [{ recipe, line }], unknownItems }
 */
export function requirements(orders, recipes, ingredients) {
  const rById = new Map(recipes.map((r) => [r.id, r]));
  const iById = new Map(ingredients.map((i) => [i.id, i]));
  const need = new Map();
  const missing = [];
  let unknownItems = 0;
  for (const o of orders) {
    for (const it of o.items ?? []) {
      const r = it.recipeId ? rById.get(it.recipeId) : null;
      if (!r) { unknownItems += 1; continue; }
      const batches = it.qty / (r.yieldQty > 0 ? r.yieldQty : 1);
      for (const line of r.items ?? []) {
        const ing = iById.get(line.ingredientId);
        const q = ing ? convert(line.qty, line.unit, ing.pkgUnit, ing.gramsPerCup ?? null) : null;
        if (q === null) { missing.push({ recipe: r.name, ingredient: ing ? ing.name : "", unit: line.unit }); continue; }
        need.set(ing.id, (need.get(ing.id) ?? 0) + q * batches);
      }
    }
  }
  const rows = [...need.entries()].map(([id, q]) => {
    const ing = iById.get(id);
    const packages = Math.max(1, Math.ceil(q / ing.pkgQty - 1e-9));
    return { ingredient: ing, need: Math.round(q * 1000) / 1000, unit: ing.pkgUnit, packages, costMinor: roundMinor((ing.pkgPriceMinor * q) / ing.pkgQty), buyMinor: packages * ing.pkgPriceMinor };
  }).sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name, undefined, { sensitivity: "base" }));
  return { rows, missing, unknownItems };
}

/** Musteri adlari (tekrarsiz, son kullanilan bilgileriyle): sipariste otomatik tamamlama. */
export function customers(orders) {
  const m = new Map();
  for (const o of [...orders].sort((a, b) => String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")))) {
    if (o.customerName) m.set(o.customerName.toLocaleLowerCase(), { name: o.customerName, phone: o.phone ?? "", email: o.email ?? "" });
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
