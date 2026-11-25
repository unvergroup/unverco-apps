// Income & Expense Tracker veri semasi: koleksiyonlar, sinirlar, hazir kategoriler, dogrulama ve temizleme. Saf; DOM / ag yok.
// Tutarlar en kucuk birimin TAMSAYISIdir (cent). Mesafe ONDALIK BIR basamakli sayi olarak onda bir tamsayi tutulur (miles10: 12.5 mi = 125).
import { isIsoDate } from "../../../core/dates.js";

export const COLLECTIONS = Object.freeze({ entries: "entries", categories: "categories", trips: "trips", businesses: "businesses" });

export const RECORD_LIMITS = Object.freeze({ entries: 20000, categories: 200, trips: 10000, businesses: 5 });
export const MAX_BUSINESSES = 5;
export const MAX_AMOUNT = 10 ** 11; // 1 milyar USD (en kucuk birimde)
export const TEXT_LIMITS = Object.freeze({ party: 120, note: 500, categoryName: 60, purpose: 160, businessName: 120, businessLine: 160 });

// Fis fotografi: cihazda kucultulur; tek fis ust siniri ve tum fislerin toplam ust siniri (yedek dosyasi 10 MB altinda kalsin).
export const MAX_RECEIPT_CHARS = 200_000;
export const RECEIPTS_BUDGET_CHARS = 6_000_000;

export const TYPES = Object.freeze(["income", "expense"]);
export const METHODS = Object.freeze(["cash", "card", "bank", "check", "online", "other"]);
export const SCOPES = Object.freeze(["business", "personal"]);

// Hazir kategoriler (sade adlar; vergi satiri degil). key sabittir, gorunen ad dil dosyasindan gelir (cat.<key>).
export const PRESET_CATEGORIES = Object.freeze({
  income: Object.freeze(["sales", "services", "tips", "interest", "other_income"]),
  expense: Object.freeze([
    "advertising", "bank_fees", "contractors", "education", "equipment", "home_office", "insurance", "meals",
    "phone_internet", "professional", "rent", "software", "supplies", "travel", "utilities", "vehicle", "other_expense",
  ]),
});
export const OTHER_KEY = Object.freeze({ income: "other_income", expense: "other_expense" });

const str = (v) => (typeof v === "string" ? v.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "");
const ts = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : new Date().toISOString());

export const isAmount = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT;
export const isReceipt = (v) => typeof v === "string" && v.length <= MAX_RECEIPT_CHARS && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v);

/** Hazir kategori kayitlari (ilk acilista bir kez yazilir). id kararlidir: "cat-<key>". */
export function presetCategoryRecords() {
  const out = [];
  for (const type of TYPES) for (const key of PRESET_CATEGORIES[type]) out.push({ id: `cat-${key}`, type, key, name: "" });
  return out;
}

// ---- Dogrulama (form) -> { valid, errors: { alan: kod } } ----
export function validateEntry(e) {
  const errors = {};
  if (!TYPES.includes(e.type)) errors.type = "required";
  if (!isIsoDate(e.date)) errors.date = "required";
  if (e.amount === undefined || e.amount === null || e.amount === "") errors.amount = "required";
  else if (!isAmount(e.amount)) errors.amount = "invalid";
  if (typeof e.categoryId !== "string" || !e.categoryId) errors.categoryId = "required";
  if (str(e.party).length > TEXT_LIMITS.party) errors.party = "too_long";
  if (str(e.note).length > TEXT_LIMITS.note) errors.note = "too_long";
  if (e.method !== undefined && e.method !== "" && !METHODS.includes(e.method)) errors.method = "invalid";
  if (e.receipt && !isReceipt(e.receipt)) errors.receipt = "invalid";
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateTrip(t) {
  const errors = {};
  if (!isIsoDate(t.date)) errors.date = "required";
  if (!str(t.purpose)) errors.purpose = "required";
  else if (str(t.purpose).length > TEXT_LIMITS.purpose) errors.purpose = "too_long";
  if (!Number.isSafeInteger(t.miles10) || t.miles10 <= 0 || t.miles10 > 1_000_000) errors.miles10 = "invalid";
  if (str(t.note).length > TEXT_LIMITS.note) errors.note = "too_long";
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateCategoryName(name) {
  const n = str(name);
  if (!n) return "required";
  if (n.length > TEXT_LIMITS.categoryName) return "too_long";
  return "";
}

// ---- Temizleme (yedekten / depodan gelen guvenilmeyen kayit) -> { record, repaired } ----
// keepMeta: id / createdAt / updatedAt korunur (geri yukleme). Form yazmasinda false.
export function cleanRecord(collection, raw, { keepMeta = true } = {}) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const meta = keepMeta ? { id: r.id, createdAt: ts(r.createdAt), updatedAt: ts(r.updatedAt) } : {};
  let rec;
  if (collection === "entries") {
    rec = {
      businessId: str(r.businessId),
      type: TYPES.includes(r.type) ? r.type : "expense",
      date: isIsoDate(r.date) ? r.date : new Date().toISOString().slice(0, 10),
      amount: isAmount(r.amount) ? r.amount : Number.isSafeInteger(r.amount) && r.amount < 0 && -r.amount <= MAX_AMOUNT ? -r.amount : 0,
      categoryId: str(r.categoryId),
      party: str(r.party).slice(0, TEXT_LIMITS.party),
      method: METHODS.includes(r.method) ? r.method : "",
      note: str(r.note).slice(0, TEXT_LIMITS.note),
      scope: SCOPES.includes(r.scope) ? r.scope : "business",
      receipt: isReceipt(r.receipt) ? r.receipt : "",
      source: r.source === "import" || r.source === "sample" ? r.source : "",
    };
  } else if (collection === "trips") {
    rec = {
      businessId: str(r.businessId),
      date: isIsoDate(r.date) ? r.date : new Date().toISOString().slice(0, 10),
      purpose: str(r.purpose).slice(0, TEXT_LIMITS.purpose),
      miles10: Number.isSafeInteger(r.miles10) && r.miles10 > 0 && r.miles10 <= 1_000_000 ? r.miles10 : 0,
      note: str(r.note).slice(0, TEXT_LIMITS.note),
      source: r.source === "sample" ? "sample" : "",
    };
  } else if (collection === "categories") {
    const type = TYPES.includes(r.type) ? r.type : "expense";
    const key = typeof r.key === "string" && PRESET_CATEGORIES[type].includes(r.key) ? r.key : "";
    rec = { type, key, name: str(r.name).slice(0, TEXT_LIMITS.categoryName), hidden: r.hidden === true };
    if (!key && !rec.name) rec.name = "?";
  } else if (collection === "businesses") {
    rec = {
      name: str(r.name).slice(0, TEXT_LIMITS.businessName),
      line1: str(r.line1).slice(0, TEXT_LIMITS.businessLine),
      line2: str(r.line2).slice(0, TEXT_LIMITS.businessLine),
    };
  } else {
    rec = { ...r };
  }
  const record = { ...rec, ...meta };
  const comparable = (o) => JSON.stringify(Object.fromEntries(Object.keys(rec).map((k) => [k, o[k]])));
  return { record, repaired: keepMeta && comparable(r) !== comparable(rec) };
}

/** Kategori gorunen adi: kullanici adi verdiyse o, yoksa hazir adin cevirisi. */
export const categoryLabel = (cat, t) => (!cat ? t("cat.unknown") : cat.name ? cat.name : cat.key ? t(`cat.${cat.key}`) : t("cat.unknown"));
