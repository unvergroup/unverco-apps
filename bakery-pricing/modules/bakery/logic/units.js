// Birimler ve cevirme (saf; DOM yok). Agirlik <-> agirlik ve hacim <-> hacim her zaman cevrilir.
// Hacim <-> agirlik YALNIZ malzemede kullanicinin girdigi "1 cup = x g" (gramsPerCup) varsa cevrilir; yoksa null doner (tahmin YOK).
// Adet (pc) yalniz adete cevrilir.
// Olculer (ABD olculeri, NIST): 1 oz = 28,349523125 g; 1 lb = 453,59237 g; 1 US cup = 236,5882365 ml; 1 tbsp = cup/16; 1 tsp = cup/48.
export const WEIGHT = Object.freeze({ g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 });
export const VOLUME = Object.freeze({ ml: 1, l: 1000, cup: 236.5882365, tbsp: 236.5882365 / 16, tsp: 236.5882365 / 48 });
export const COUNT = Object.freeze({ pc: 1 });
export const UNITS = Object.freeze(["g", "kg", "oz", "lb", "ml", "l", "cup", "tbsp", "tsp", "pc"]);
export const ML_PER_CUP = VOLUME.cup;

/** "weight" | "volume" | "count" | null */
export const dimOf = (unit) => (unit in WEIGHT ? "weight" : unit in VOLUME ? "volume" : unit in COUNT ? "count" : null);
const factorOf = (unit) => WEIGHT[unit] ?? VOLUME[unit] ?? COUNT[unit];
const validDensity = (g) => typeof g === "number" && Number.isFinite(g) && g > 0;

/**
 * qty birimini `from`dan `to`ya cevirir. density: malzemenin "1 cup = x g" degeri (gramsPerCup) ya da null.
 * Donus: sayi (yuvarlanmamis) ya da cevrilemezse null.
 */
export function convert(qty, from, to, density = null) {
  if (typeof qty !== "number" || !Number.isFinite(qty)) return null;
  const a = dimOf(from);
  const b = dimOf(to);
  if (!a || !b) return null;
  if (a === b) return (qty * factorOf(from)) / factorOf(to);
  if (a === "count" || b === "count") return null;
  if (!validDensity(density)) return null;
  if (a === "volume") { // ml -> g
    const grams = ((qty * factorOf(from)) / ML_PER_CUP) * density;
    return grams / factorOf(to);
  }
  const ml = ((qty * factorOf(from)) / density) * ML_PER_CUP; // g -> ml
  return ml / factorOf(to);
}

/** Gorunen ondalik basamak: g / ml tam sayi; diger birimler (lb, oz, kg, l, cup, tbsp, tsp, pc) en cok 2. Ic hesap hassas kalir. */
export const displayDigits = (unit) => (unit === "g" || unit === "ml" ? 0 : 2);

/** Okunur gorunum birimi: kg < 1 -> g, l < 1 -> ml, lb < 0.1 -> oz (yalniz gosterim; ic hesap ayni miktar). Donus: { n, unit }. */
export function readableQty(n, unit) {
  if (typeof n !== "number" || !(n > 0)) return { n, unit };
  if (unit === "kg" && n < 1) return { n: n * 1000, unit: "g" };
  if (unit === "l" && n < 1) return { n: n * 1000, unit: "ml" };
  if (unit === "lb" && n < 0.1) return { n: n * 16, unit: "oz" };
  return { n, unit };
}

/** Intl secenekleri: displayDigits; pozitif ama o basamakta 0'a yuvarlanan miktar ("0 kg") 1 anlamli basamakla gosterilir (0.004 kg). */
export function displayOptions(n, unit) {
  const d = displayDigits(unit);
  return n > 0 && Math.round(n * 10 ** d) === 0 ? { maximumSignificantDigits: 1 } : { maximumFractionDigits: d };
}

/** Iki birim bu malzeme icin birbirine cevrilebilir mi. */
export const convertible = (from, to, density = null) => convert(1, from, to, density) !== null;
