// Koleksiyon semalari: malzeme (ingredients), tarif (recipes), siparis (orders); temizleme (cleanRecord) ve form dogrulamasi.
// Saf islevler: DOM yok, ag yok. Form yolu ve geri yukleme yolu AYNI cleanRecord'u kullanir; bilinmeyen alan atilir.
// Para en kucuk birimin tamsayisidir ve alan adi "Minor" ile biter (para birimi degisince core/data-actions.js bunlari olcekler).
// Tarih YYYY-MM-DD, saat HH:MM (24 saat) ya da "".
import { isIsoDate } from "../../../core/dates.js";
import { UNITS } from "./units.js";

export const COLLECTIONS = Object.freeze(["ingredients", "recipes", "orders"]);
export const SOURCES = Object.freeze(["manual", "sample"]);
// Siparis durum zinciri (ileri): sorgu -> onayli -> hazirlaniyor -> teslim -> odendi. "cancelled" zincir disidir.
export const STATUSES = Object.freeze(["inquiry", "confirmed", "in_progress", "delivered", "paid", "cancelled"]);
export const CHAIN = Object.freeze(["inquiry", "confirmed", "in_progress", "delivered", "paid"]);
export const RECORD_LIMITS = Object.freeze({ ingredients: 2000, recipes: 1000, orders: 20000 });
export const MAX_MINOR = 99_999_999; // 999.999,99 (USD)
export const LIMITS = Object.freeze({
  ...RECORD_LIMITS,
  name: 80, note: 300, yieldUnit: 24, phone: 30, email: 120, itemName: 80,
  qtyMax: 1_000_000, yieldMax: 100_000, laborMax: 10_000, densityMax: 2_000, overheadMax: 100,
  recipeLines: 60, orderLines: 40,
});

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const cut = (s, n) => ([...s].length > n ? [...s].slice(0, n).join("").trimEnd() : s);
function text(v, max, multiline = false) {
  let s = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  s = s.normalize("NFC").replace(/\r\n?|\u2028|\u2029/g, "\n").replace(CONTROL, "");
  s = multiline ? s.replace(/\t/g, " ") : s.replace(/[\n\t]+/g, " ");
  return cut(s.trim(), max);
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
/** Pozitif sayi (en cok 3 ondalik) ya da null. */
const posNum = (v, max) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 1000) / 1000 : null);
const minorOr = (v, def) => (Number.isSafeInteger(v) && v >= 0 && v <= MAX_MINOR ? v : def);

function meta(raw) {
  const out = {};
  for (const k of ["id", "createdAt", "updatedAt"]) if (typeof raw[k] === "string" && raw[k]) out[k] = raw[k];
  return out;
}

const KEYS = {
  ingredients: ["id", "createdAt", "updatedAt", "name", "pkgQty", "pkgUnit", "pkgPriceMinor", "gramsPerCup", "note", "source"],
  recipes: ["id", "createdAt", "updatedAt", "name", "items", "yieldQty", "yieldUnit", "packagingMinor", "laborMinutes", "overheadPct", "salePriceMinor", "note", "source"],
  orders: ["id", "createdAt", "updatedAt", "serial", "customerName", "phone", "email", "date", "time", "items", "deliveryFeeMinor", "discountMinor", "depositMinor", "status", "note", "source"],
};

/** Kaydi temizler. Donus: { record, repaired } (repaired: en az bir alan duzeltildi ya da atildi). */
export function cleanRecord(name, input) {
  const raw = obj(input);
  const keys = KEYS[name];
  if (!keys) throw new Error(`unknown collection: ${name}`);
  let repaired = Object.keys(raw).some((k) => !keys.includes(k));
  const fix = (cond) => { if (cond) repaired = true; };
  const out = { ...meta(raw) };
  const source = SOURCES.includes(raw.source) ? raw.source : "manual";
  if (name === "ingredients") {
    out.name = text(raw.name, LIMITS.name);
    const q = posNum(raw.pkgQty, LIMITS.qtyMax); fix(q === null); out.pkgQty = q ?? 1;
    fix(!UNITS.includes(raw.pkgUnit)); out.pkgUnit = UNITS.includes(raw.pkgUnit) ? raw.pkgUnit : "g";
    out.pkgPriceMinor = minorOr(raw.pkgPriceMinor, 0); fix(out.pkgPriceMinor !== raw.pkgPriceMinor);
    const d = raw.gramsPerCup === null || raw.gramsPerCup === undefined || raw.gramsPerCup === "" ? null : posNum(raw.gramsPerCup, LIMITS.densityMax);
    fix(d === null && raw.gramsPerCup !== null && raw.gramsPerCup !== undefined && raw.gramsPerCup !== ""); out.gramsPerCup = d;
    out.note = text(raw.note, LIMITS.note, true);
  } else if (name === "recipes") {
    out.name = text(raw.name, LIMITS.name);
    const items = Array.isArray(raw.items) ? raw.items : [];
    out.items = [];
    for (const it of items.slice(0, LIMITS.recipeLines)) {
      const o = obj(it);
      const q = posNum(o.qty, LIMITS.qtyMax);
      if (typeof o.ingredientId !== "string" || !o.ingredientId || q === null || !UNITS.includes(o.unit)) { repaired = true; continue; }
      out.items.push({ ingredientId: o.ingredientId, qty: q, unit: o.unit });
    }
    fix(items.length > LIMITS.recipeLines);
    const y = posNum(raw.yieldQty, LIMITS.yieldMax); fix(y === null); out.yieldQty = y ?? 1;
    out.yieldUnit = text(raw.yieldUnit, LIMITS.yieldUnit);
    out.packagingMinor = minorOr(raw.packagingMinor, 0); fix(raw.packagingMinor !== undefined && out.packagingMinor !== raw.packagingMinor);
    const lm = Number.isInteger(raw.laborMinutes) && raw.laborMinutes >= 0 && raw.laborMinutes <= LIMITS.laborMax ? raw.laborMinutes : 0;
    fix(raw.laborMinutes !== undefined && lm !== raw.laborMinutes); out.laborMinutes = lm;
    const op = raw.overheadPct === null || raw.overheadPct === undefined ? null
      : typeof raw.overheadPct === "number" && Number.isFinite(raw.overheadPct) && raw.overheadPct >= 0 && raw.overheadPct <= LIMITS.overheadMax ? raw.overheadPct : null;
    fix(op === null && raw.overheadPct !== null && raw.overheadPct !== undefined); out.overheadPct = op;
    const sp = raw.salePriceMinor === null || raw.salePriceMinor === undefined ? null : minorOr(raw.salePriceMinor, null);
    fix(sp === null && raw.salePriceMinor !== null && raw.salePriceMinor !== undefined); out.salePriceMinor = sp;
    out.note = text(raw.note, LIMITS.note, true);
  } else if (name === "orders") {
    out.serial = typeof raw.serial === "string" && /^[A-Z]{1,6}-\d{4}-\d{4,7}$/.test(raw.serial) ? raw.serial : "";
    out.customerName = text(raw.customerName, LIMITS.name);
    out.phone = text(raw.phone, LIMITS.phone);
    const em = text(raw.email, LIMITS.email); fix(em !== "" && !EMAIL.test(em)); out.email = em === "" || EMAIL.test(em) ? em : "";
    fix(!isIsoDate(raw.date)); out.date = isIsoDate(raw.date) ? raw.date : "1970-01-01";
    fix(raw.time !== undefined && raw.time !== "" && !TIME.test(raw.time)); out.time = TIME.test(raw.time ?? "") ? raw.time : "";
    const items = Array.isArray(raw.items) ? raw.items : [];
    out.items = [];
    for (const it of items.slice(0, LIMITS.orderLines)) {
      const o = obj(it);
      const q = posNum(o.qty, LIMITS.qtyMax);
      const nm = text(o.name, LIMITS.itemName);
      if (q === null || !nm) { repaired = true; continue; }
      out.items.push({ recipeId: typeof o.recipeId === "string" ? o.recipeId : "", name: nm, qty: q, unitPriceMinor: minorOr(o.unitPriceMinor, 0) });
    }
    fix(items.length > LIMITS.orderLines);
    for (const k of ["deliveryFeeMinor", "discountMinor", "depositMinor"]) {
      out[k] = minorOr(raw[k], 0); fix(raw[k] !== undefined && out[k] !== raw[k]);
    }
    fix(!STATUSES.includes(raw.status)); out.status = STATUSES.includes(raw.status) ? raw.status : "inquiry";
    out.note = text(raw.note, LIMITS.note, true);
  }
  out.source = source;
  return { record: out, repaired };
}

// ---- Form dogrulamasi: { ok, errors: { alan: kod } } (kodlar: required, too_long, range, email, time, unit, deposit) ----
export function checkIngredient(v) {
  const e = {};
  if (!text(v.name, 1000)) e.name = "required"; else if ([...text(v.name, 1000)].length > LIMITS.name) e.name = "too_long";
  if (!(typeof v.pkgQty === "number" && v.pkgQty > 0 && v.pkgQty <= LIMITS.qtyMax)) e.pkgQty = "range";
  if (!UNITS.includes(v.pkgUnit)) e.pkgUnit = "unit";
  if (!(Number.isSafeInteger(v.pkgPriceMinor) && v.pkgPriceMinor >= 0 && v.pkgPriceMinor <= MAX_MINOR)) e.pkgPriceMinor = "range";
  if (v.gramsPerCup !== null && !(typeof v.gramsPerCup === "number" && v.gramsPerCup > 0 && v.gramsPerCup <= LIMITS.densityMax)) e.gramsPerCup = "range";
  return { ok: Object.keys(e).length === 0, errors: e };
}

export function checkOrder(v, totalMinor) {
  const e = {};
  if (!text(v.customerName, 1000)) e.customerName = "required";
  if (!isIsoDate(v.date)) e.date = "required";
  if (v.time && !TIME.test(v.time)) e.time = "time";
  if (v.email && !EMAIL.test(v.email)) e.email = "email";
  if (!Array.isArray(v.items) || !v.items.length) e.items = "required";
  if (Number.isSafeInteger(totalMinor) && v.depositMinor > totalMinor) e.depositMinor = "deposit";
  return { ok: Object.keys(e).length === 0, errors: e };
}
