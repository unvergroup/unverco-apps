// Veri sozlesmesi (schemaVersion 1). Tum tutarlar TAMSAYI kurus; tarihler yerel ISO "YYYY-MM-DD".
// Yazma denetimi: kesirli ya da sinir disi tutar hicbir koleksiyona yazilmaz (assert* atar).
import { isIsoDate } from "../../../core/dates.js";
import { cleanStrings } from "../../../core/sanitize.js";

export const MAX_AMOUNT = 10 ** 11; // IET ile ayni ust sinir (en kucuk birimde); csv.js bunu kullanir
export const DATA_COLLECTIONS = Object.freeze(["payPlan", "transactions", "bills", "envelopes", "funds", "fundMoves", "prefs"]);
export const RECORD_LIMITS = Object.freeze({ payPlan: 1, transactions: 20000, bills: 200, envelopes: 40, funds: 30, fundMoves: 10000, prefs: 1 });

export const FREQUENCIES = Object.freeze(["weekly", "biweekly", "semimonthly", "monthly", "irregular"]);
export const REPEATS = Object.freeze(["once", "weekly", "biweekly", "monthly", "everyNMonths"]);
export const TX_TYPES = Object.freeze(["expense", "income", "adjust"]);
export const TX_SOURCES = Object.freeze(["manual", "csv", "bill", "fund", "pay", "reconcile"]);
export const ENVELOPE_ICONS = Object.freeze(["cart", "utensils", "car", "house", "user", "baby", "ticket", "tag", "coffee", "gift", "heart", "paw"]);
export const PRESET_ENVELOPES = Object.freeze([
  { id: "groceries", key: "env.groceries", icon: "cart" },
  { id: "eatingOut", key: "env.eatingOut", icon: "utensils" },
  { id: "transport", key: "env.transport", icon: "car" },
  { id: "household", key: "env.household", icon: "house" },
  { id: "personal", key: "env.personal", icon: "user" },
  { id: "kids", key: "env.kids", icon: "baby" },
  { id: "fun", key: "env.fun", icon: "ticket" },
  { id: "other", key: "env.other", icon: "tag" },
]);
export const PRESET_IDS = Object.freeze(PRESET_ENVELOPES.map((e) => e.id));

export const isAmount = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT;
export const isSignedAmount = (v) => Number.isSafeInteger(v) && Math.abs(v) <= MAX_AMOUNT;

export class ValidationError extends Error {
  constructor(code, message) { super(message); this.name = "ValidationError"; this.code = code; }
}
const fail = (code, msg) => { throw new ValidationError(code, msg); };

export function assertTransaction(t) {
  if (!TX_TYPES.includes(t.type)) fail("bad_type", "Unknown transaction type.");
  if (!isIsoDate(t.date)) fail("bad_date", "Date must be YYYY-MM-DD.");
  if (t.type === "adjust") { if (!isSignedAmount(t.amountMinor) || t.amountMinor === 0) fail("bad_amount", "Amount must be a whole number of cents."); }
  else if (!isAmount(t.amountMinor)) fail("bad_amount", "Amount must be a whole number of cents.");
  if (t.source !== undefined && !TX_SOURCES.includes(t.source)) fail("bad_source", "Unknown source.");
  if (typeof t.note === "string" && t.note.length > 120) fail("bad_note", "Note is too long.");
  return t;
}

export function assertBill(b) {
  if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 60) fail("bad_name", "Name is required (max 60).");
  if (!isAmount(b.amountMinor)) fail("bad_amount", "Amount must be more than 0.");
  if (!REPEATS.includes(b.repeat)) fail("bad_repeat", "Unknown repeat.");
  if (!isIsoDate(b.firstDue)) fail("bad_date", "First due date is required.");
  if (b.repeat === "everyNMonths" && !(Number.isInteger(b.everyN) && b.everyN >= 2 && b.everyN <= 12)) fail("bad_n", "Every 2 to 12 months.");
  if (b.endDate && !isIsoDate(b.endDate)) fail("bad_date", "End date is not valid.");
  return b;
}

export function assertPlan(p) {
  if (!FREQUENCIES.includes(p.frequency)) fail("bad_frequency", "Unknown pay frequency.");
  if (!isAmount(p.amountMinor)) fail("bad_amount", "Paycheck must be more than 0.");
  if (!isSignedAmount(p.startBalanceMinor)) fail("bad_amount", "Balance must be a whole number of cents.");
  if ((p.frequency === "weekly" || p.frequency === "biweekly") && !isIsoDate(p.anchorDate)) fail("bad_date", "A payday date is required.");
  if (p.frequency === "irregular" && !isIsoDate(p.nextOverride)) fail("bad_date", "Next payday is required.");
  return p;
}

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DEPTH = 4; // kayit icinde en cok bu kadar ic ice nesne/dizi (semimonthly gunleri, ice aktarma eslemesi)
const depthOf = (v, d = 0) => (v && typeof v === "object" ? (d >= MAX_DEPTH ? Infinity : Math.max(d + 1, ...Object.values(v).map((x) => depthOf(x, d + 1)))) : d);
const ID_FIELDS = ["id", "envelopeId", "billId", "fundId", "transactionId", "presetId"];

const MAX_TEXT = 2000; // yedekteki herhangi bir metin alani (kimlik, ad, not, ayar) en cok bu kadar
const isMinorIn = (v, min) => Number.isSafeInteger(v) && v >= min && v <= MAX_AMOUNT;
const shortText = (v, n) => v === undefined || (typeof v === "string" && v.length <= n);
const FUND_MOVE_KINDS = ["auto", "manual", "spend", "release"];
// Kayit icerigi, formdan yazilan kayitla AYNI kurallardan gecer (assert*). Tutar hatasi "bad_amount", gerisi "invalid_file".
function checkRecord(name, r) {
  const bad = (what) => fail("invalid_file", `Bad ${what} in ${name}.`);
  try {
    if (name === "transactions") assertTransaction(r);
    else if (name === "bills") assertBill(r);
    else if (name === "payPlan") {
      assertPlan(r.frequency === "irregular" && !r.nextOverride ? { ...r, nextOverride: "2000-01-01" } : r); // onaydan sonra bos kalir
      if ((r.startDate && !isIsoDate(r.startDate)) || (r.nextOverride && !isIsoDate(r.nextOverride))) bad("date");
    }
  } catch (e) {
    if (e instanceof ValidationError && e.code !== "bad_amount") bad(e.code.replace(/^bad_/, ""));
    throw e;
  }
  if (name === "fundMoves") {
    if (!isSignedAmount(r.amountMinor) || r.amountMinor === 0) fail("bad_amount", "Bad amount in fundMoves.");
    if (!isIsoDate(r.date)) bad("date");
    if (!FUND_MOVE_KINDS.includes(r.kind)) bad("kind");
    if (r.period !== undefined && !isIsoDate(r.period)) bad("period");
  } else if (name === "envelopes") {
    if (!isMinorIn(r.limitPerPeriodMinor ?? 0, 0)) fail("bad_amount", "Bad limit in envelopes.");
    if (!shortText(r.name, 40) || !shortText(r.icon, 20)) bad("name");
  } else if (name === "funds") {
    if (!isMinorIn(r.targetMinor ?? 0, 0) || !isMinorIn(r.perPeriodMinor ?? 0, 0)) fail("bad_amount", "Bad amount in funds.");
    if (!shortText(r.name, 40)) bad("name");
    if (r.targetDate && !isIsoDate(r.targetDate)) bad("date");
  }
}

// Yedekten gelen veri: bilinmeyen koleksiyon atilir. Kimlik bicimi, zaman damgasi tipi, ic ice derinlik ve tamsayi tutar denetlenir;
// kayit icerigi assert* kurallarindan gecer, metinler gorunmez karakterlerden temizlenir;
// biri bozuksa dosyanin TAMAMI reddedilir (mevcut veri degismez).
export function sanitizeBackupData(data) {
  const out = {};
  for (const name of DATA_COLLECTIONS) {
    const list = Array.isArray(data[name]) ? data[name] : [];
    for (const r of list) {
      if (!r || typeof r !== "object" || Array.isArray(r)) fail("invalid_file", `Bad record in ${name}.`);
      if (!ID_RE.test(String(r.id))) fail("invalid_file", `Bad id in ${name}.`);
      for (const f of ID_FIELDS.slice(1)) if (r[f] !== undefined && r[f] !== "" && !ID_RE.test(String(r[f]))) fail("invalid_file", `Bad ${f} in ${name}.`);
      for (const f of ["createdAt", "updatedAt"]) if (r[f] !== undefined && (typeof r[f] !== "string" || r[f].length > 40 || Number.isNaN(Date.parse(r[f])))) fail("invalid_file", `Bad ${f} in ${name}.`);
      if (depthOf(r) > MAX_DEPTH) fail("invalid_file", `Too deeply nested record in ${name}.`);
      for (const [k, v] of Object.entries(r)) {
        if (/Minor$/.test(k) && !Number.isSafeInteger(v)) fail("bad_amount", `Amount in ${name} is not a whole number.`);
        if (typeof v === "string" && v.length > MAX_TEXT) fail("invalid_file", `Text too long in ${name}.`);
      }
    }
    if (list.length > RECORD_LIMITS[name]) fail("too_many", `Too many records in ${name}.`);
    const clean = list.map(cleanStrings);
    for (const r of clean) checkRecord(name, r);
    out[name] = clean;
  }
  return out;
}
