// Tarif maliyeti ve fiyat onerisi (saf). Para: en kucuk birimin tamsayisi. Ara degerler kesirli hesaplanir, YALNIZ asagidaki adimlarda yuvarlanir:
//   malzeme toplami = yuvarla(satir maliyetlerinin TAM toplami)         (satirlar ekranda tek tek yuvarlanmis gosterilir)
//   iscilik         = yuvarla(dakika x saat ucreti / 60)
//   ara toplam      = malzeme + ambalaj + iscilik
//   genel gider     = yuvarla(ara toplam x genel gider % / 100)
//   parti maliyeti  = ara toplam + genel gider                          (karttaki satirlar toplama birebir uyar)
//   birim maliyet   = yuvarla(parti / verim)
//   onerilen birim  = yukari(parti / verim x carpan); carpan: kar payi (markup) 1 + p/100, marj (margin) 1 / (1 - p/100)
//   onerilen parti  = yukari(parti x carpan)
//   ("yukari": hedefi saglayan EN KUCUK fiyat; kural urunler/is-cantasi/modules/pricing/logic.js recommended() ile ayni:
//    yakina yuvarlama 262,08 -> 262 verirdi ve marj %39,98 ile hedefin altinda kalirdi.)
// Yuvarlama: yarim sifirdan uzaga (0,5 -> 1). Fiyat onerisi YALNIZ kullanicinin girdigi maliyet ve hedeften hesaplanir.
import { convert } from "./units.js";

/** Yarim sifirdan uzaga yuvarlar; kayan nokta artigini (2.4999999998) tolere eder. */
export function roundMinor(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return NaN;
  const a = Math.abs(x);
  const r = Math.floor(a + 0.5 + 1e-7);
  return x < 0 ? -r : r;
}

/** Hedefi saglayan en kucuk tamsayi (kayan nokta artigi 3145,0000000004 -> 3145). */
export function ceilMinor(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return NaN;
  return Math.ceil(x - 1e-7);
}

/** Malzemenin bir satirdaki kesirli maliyeti (en kucuk birim) ya da cevrilemezse null. */
export function lineCostExact(ing, qty, unit) {
  if (!ing || !(ing.pkgQty > 0)) return null;
  const inPkg = convert(qty, unit, ing.pkgUnit, ing.gramsPerCup ?? null);
  if (inPkg === null) return null;
  return (ing.pkgPriceMinor * inPkg) / ing.pkgQty;
}

/** Carpan; gecersiz hedefte null (marj %100 ve ustu tanimsiz). */
export function priceFactor(mode, pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0) return null;
  if (mode === "markup") return 1 + pct / 100;
  if (pct >= 100) return null;
  return 1 / (1 - pct / 100);
}

/**
 * Tarifin maliyet dokumu. prefs: { hourlyRateMinor, overheadPct, pricingMode, targetPct }. ingById: Map(id -> malzeme).
 * Donus: { lines[], ingredientsMinor, packagingMinor, laborMinor, subtotalMinor, overheadPct, overheadMinor, batchMinor, yieldQty,
 *          unitCostExact, unitMinor, suggestedUnitMinor, suggestedBatchMinor, missing, sale }
 * sale: { priceMinor, profitMinor, marginPct, status: "none" | "loss" | "below" | "ok" }
 */
export function recipeCost(recipe, ingById, prefs) {
  const r = recipe ?? {};
  const lines = [];
  let exact = 0;
  let missing = 0;
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const ing = ingById.get(it.ingredientId);
    const c = ing ? lineCostExact(ing, it.qty, it.unit) : null;
    if (c === null) missing += 1; else exact += c;
    lines.push({ ingredientId: it.ingredientId, name: ing ? ing.name : "", qty: it.qty, unit: it.unit, exact: c, costMinor: c === null ? null : roundMinor(c), ok: c !== null, reason: ing ? (c === null ? "convert" : "") : "deleted" });
  }
  const ingredientsMinor = roundMinor(exact);
  const packagingMinor = Number.isSafeInteger(r.packagingMinor) ? r.packagingMinor : 0;
  const rate = Number.isSafeInteger(prefs?.hourlyRateMinor) ? prefs.hourlyRateMinor : 0;
  const laborMinor = roundMinor(((Number.isInteger(r.laborMinutes) ? r.laborMinutes : 0) * rate) / 60);
  const subtotalMinor = ingredientsMinor + packagingMinor + laborMinor;
  const overheadPct = typeof r.overheadPct === "number" ? r.overheadPct : typeof prefs?.overheadPct === "number" ? prefs.overheadPct : 0;
  const overheadMinor = roundMinor((subtotalMinor * overheadPct) / 100);
  const batchMinor = subtotalMinor + overheadMinor;
  const yieldQty = r.yieldQty > 0 ? r.yieldQty : 1;
  const unitCostExact = batchMinor / yieldQty;
  const unitMinor = roundMinor(unitCostExact);
  const f = priceFactor(prefs?.pricingMode, prefs?.targetPct);
  const suggestedUnitMinor = f === null ? null : ceilMinor(unitCostExact * f);
  const suggestedBatchMinor = f === null ? null : ceilMinor(batchMinor * f);
  return { lines, ingredientsMinor, packagingMinor, laborMinor, subtotalMinor, overheadPct, overheadMinor, batchMinor, yieldQty, unitCostExact, unitMinor, suggestedUnitMinor, suggestedBatchMinor, missing, sale: saleCheck(r.salePriceMinor, unitMinor, suggestedUnitMinor) };
}

/** Kullanicinin satis fiyati kontrolu. marginPct: fiyatin yuzde kaci kar (1 ondalik). */
export function saleCheck(priceMinor, unitMinor, suggestedUnitMinor) {
  if (!Number.isSafeInteger(priceMinor)) return { priceMinor: null, profitMinor: null, marginPct: null, status: "none" };
  const profitMinor = priceMinor - unitMinor;
  const marginPct = priceMinor > 0 ? Math.round((profitMinor / priceMinor) * 1000) / 10 : null;
  const status = profitMinor < 0 ? "loss" : suggestedUnitMinor !== null && priceMinor < suggestedUnitMinor ? "below" : "ok";
  return { priceMinor, profitMinor, marginPct, status };
}

/** Bir malzemeyi kullanan tarifler (fiyat degisince "N tarif guncellendi" bildirimi icin). */
export const recipesUsing = (recipes, ingredientId) => recipes.filter((r) => (r.items ?? []).some((it) => it.ingredientId === ingredientId));

/** Tum tariflerin maliyeti: Map(recipeId -> recipeCost). */
export function costAll(recipes, ingredients, prefs) {
  const ingById = new Map(ingredients.map((i) => [i.id, i]));
  return new Map(recipes.map((r) => [r.id, recipeCost(r, ingById, prefs)]));
}
