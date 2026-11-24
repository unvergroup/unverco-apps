// Pet Business Tracker koleksiyon semalari: musteri (clients), hayvan (pets), randevu (appointments); temizleme (cleanRecord), fabrikalar ve dogrulama.
// Saf islevler: DOM yok, ag yok. Form yolu ve geri yukleme yolu AYNI cleanRecord'u kullanir; bilinmeyen alan atilir.
// Para en kucuk birimin tamsayisidir (0-999999); agirlik gramdir (0-200000); tarih YYYY-MM-DD, saat HH:MM (24 saat).
// Baglar: pets.clientId -> clients.id; appointments.clientId -> clients.id, appointments.petId -> pets.id (store / geri yukleme baglar).

import { isIsoDate, todayIso } from "../../../core/dates.js";
import { STATUSES } from "./status.js";
import { DEFAULT_DURATION, MAX_DURATION, MAX_PRICE, MIN_DURATION, endTimeOf, isTime } from "./calc.js";
import { RECURRENCE_RULES } from "./recurrence.js";

export const COLLECTIONS = Object.freeze(["clients", "pets", "appointments", "expenses"]);
export const SOURCES = Object.freeze(["manual", "sample"]);
export const SPECIES = Object.freeze(["dog", "cat", "bird", "rabbit", "fish", "reptile", "other"]);
export const GENDERS = Object.freeze(["male", "female", "unknown"]);
export const TEMPERAMENTS = Object.freeze(["calm", "friendly", "nervous", "aggressive", "unknown"]);
export const SERVICES = Object.freeze(["grooming", "bath", "nail_trim", "teeth_cleaning", "ear_cleaning", "flea_treatment", "walking", "sitting", "boarding", "training", "checkup", "other"]);
export const PAYMENT_METHODS = Object.freeze(["cash", "card", "transfer", "other"]);
// Gider kategorileri (ceviri anahtari: expense.cat.<kategori>). Siralama: formdaki ve dagilimdaki sira.
export const EXPENSE_CATEGORIES = Object.freeze(["supplies", "rent", "utilities", "transport", "salary", "marketing", "equipment", "fees", "other"]);
export const DEFAULT_LABELS = Object.freeze({ noName: "(no name)" });

export const MAX_WEIGHT = 200000;
// Gider tutari ust siniri (en kucuk birim): randevu fiyatindan yuksek, cunku kira / maas / ekipman 9.999,99'u asabilir. 99.999.999 = 999.999,99 (USD).
export const MAX_EXPENSE = 99_999_999;
export const MAX_PHOTO_CHARS = 120000; // JPEG data-URL ust siniri (yaklasik 400 px / kalite 0.7 foto 30-60 bin karakter); yedek 10 MB sinirini korur
// TEK SINIR KAYNAGI: koleksiyon basina en cok kayit. Form, ayarlar ekrani, yedek alma VE geri yukleme hep buradan okur (core/settings.js, core/backup.js).
export const RECORD_LIMITS = Object.freeze({ clients: 3000, pets: 5000, appointments: 20000, expenses: 20000 });
export const LIMITS = Object.freeze({
  ...RECORD_LIMITS,
  name: 80, phone: 30, email: 120, address: 200, clientNote: 300,
  petName: 60, breed: 60, color: 30, microchip: 20, vaccinations: 300, allergies: 200, medicalNotes: 300, specialInstructions: 300,
  serviceNote: 200, note: 300, id: 100, expenseDescription: 200,
  weight: MAX_WEIGHT, price: MAX_PRICE, expense: MAX_EXPENSE, durationMin: MIN_DURATION, durationMax: MAX_DURATION,
});

// ---------- metin ve sayi yardimcilari ----------
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const cpLen = (s) => [...s].length;
const cutCp = (s, n) => (cpLen(s) > n ? [...s].slice(0, n).join("") : s);
const asText = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

// NFC + kirpma + kontrol karakteri atma; tek satirda satir sonu / sekme bosluk olur.
function normText(v, singleLine) {
  let s = asText(v).normalize("NFC").replace(/\r\n?|\u2028|\u2029/g, "\n").replace(CONTROL, "");
  s = singleLine ? s.replace(/[\n\t]+/g, " ") : s.replace(/\t/g, " ");
  return s.trim();
}

function Fixes() {
  const list = [];
  return { list, hit: (f) => { if (!list.includes(f)) list.push(f); } };
}

function str(fx, field, v, max, o = {}) {
  let s = normText(v, !o.lines);
  if (o.lines && s.split("\n").length > o.lines) {
    s = s.split("\n").slice(0, o.lines).join("\n");
    fx.hit(field);
  }
  if (cpLen(s) > max) {
    s = cutCp(s, max).trimEnd();
    fx.hit(field);
  }
  return s;
}
const single = (fx, field, v, max) => str(fx, field, v, max);
const multi = (fx, field, v, max) => str(fx, field, v, max, { lines: 99 });

// Tamsayi: yarim sifirdan uzaga yuvarlanir, [min, max]'a cekilir; yok / bos -> fallback (rapor yok); sayi degilse fallback + rapor.
function int(fx, field, v, min, max, fallback) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n)) { fx.hit(field); return fallback; }
  let r = Math.sign(n) * Math.round(Math.abs(n)) + 0;
  if (r < min) r = min;
  if (r > max) r = max;
  if (r !== n) fx.hit(field);
  return r;
}
function en(fx, field, v, list, def) {
  if (list.includes(v)) return v;
  if (v !== undefined && v !== null && v !== "") fx.hit(field);
  return def;
}
function day(fx, field, v, fallback) {
  if (typeof v === "string" && isIsoDate(v)) return v;
  if (v !== undefined && v !== null && v !== "") fx.hit(field);
  return fallback;
}
const idOf = (v) => (typeof v === "string" ? v : "");

/** Cihazda kucultulmus pet fotografi mi: yalniz `data:image/jpeg;base64,...` ve boyut siniri icinde. */
export const isPhotoDataUrl = (v) => typeof v === "string" && v.length <= MAX_PHOTO_CHARS && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v);

/** Hatirlatma gonderildi zamani: gecerli tarih-saat metni ya da "". */
const stamp = (fx, field, v) => {
  if (typeof v === "string" && v !== "" && v.length <= 40 && !Number.isNaN(Date.parse(v))) return v;
  if (v !== undefined && v !== null && v !== "") fx.hit(field);
  return "";
};

function meta(raw, o) {
  const out = {};
  if (o.keepMeta === false) return out;
  for (const k of ["id", "createdAt", "updatedAt"]) if (typeof raw[k] === "string" && raw[k]) out[k] = raw[k];
  return out;
}
function dropUnknown(raw, known, fx) {
  for (const k of Object.keys(raw)) if (!known.includes(k)) fx.hit(`unknown:${k}`);
}

// ---------- kayit temizleyiciler ----------
const CLIENT_KEYS = ["id", "createdAt", "updatedAt", "name", "phone", "email", "address", "note", "source"];
const PET_KEYS = ["id", "createdAt", "updatedAt", "clientId", "name", "species", "breed", "color", "weight", "birthDate", "gender", "microchip",
  "vaccinations", "vaccineDue", "allergies", "medicalNotes", "temperament", "specialInstructions", "photo", "source"];
const APPOINTMENT_KEYS = ["id", "createdAt", "updatedAt", "clientId", "petId", "date", "time", "duration", "endTime", "service", "serviceNote", "status",
  "price", "paid", "paymentMethod", "recurrenceId", "recurrenceRule", "note", "reminderSentAt", "source"];
const EXPENSE_KEYS = ["id", "createdAt", "updatedAt", "date", "category", "description", "amount", "paymentMethod", "source"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanClient(raw, fx, o) {
  dropUnknown(raw, CLIENT_KEYS, fx);
  let name = single(fx, "name", raw.name, LIMITS.name);
  if (!name) { name = o.labels.noName; fx.hit("name"); }
  let email = single(fx, "email", raw.email, LIMITS.email);
  if (email && !EMAIL.test(email)) { email = ""; fx.hit("email"); }
  return {
    ...meta(raw, o),
    name,
    phone: single(fx, "phone", raw.phone, LIMITS.phone),
    email,
    address: multi(fx, "address", raw.address, LIMITS.address),
    note: multi(fx, "note", raw.note, LIMITS.clientNote),
    source: en(fx, "source", raw.source, SOURCES, "manual"),
  };
}

function cleanPet(raw, fx, o) {
  dropUnknown(raw, PET_KEYS, fx);
  let name = single(fx, "name", raw.name, LIMITS.petName);
  if (!name) { name = o.labels.noName; fx.hit("name"); }
  let photo = "";
  if (raw.photo !== undefined && raw.photo !== null && raw.photo !== "") {
    if (isPhotoDataUrl(raw.photo)) photo = raw.photo; else fx.hit("photo"); // gecersiz / cok buyuk fotograf atilir
  }
  return {
    ...meta(raw, o),
    clientId: idOf(raw.clientId),
    name,
    species: en(fx, "species", raw.species, SPECIES, "other"),
    breed: single(fx, "breed", raw.breed, LIMITS.breed),
    color: single(fx, "color", raw.color, LIMITS.color),
    weight: int(fx, "weight", raw.weight, 0, MAX_WEIGHT, 0),
    birthDate: day(fx, "birthDate", raw.birthDate, ""),
    gender: en(fx, "gender", raw.gender, GENDERS, "unknown"),
    microchip: single(fx, "microchip", raw.microchip, LIMITS.microchip),
    vaccinations: multi(fx, "vaccinations", raw.vaccinations, LIMITS.vaccinations),
    vaccineDue: day(fx, "vaccineDue", raw.vaccineDue, ""),
    allergies: multi(fx, "allergies", raw.allergies, LIMITS.allergies),
    medicalNotes: multi(fx, "medicalNotes", raw.medicalNotes, LIMITS.medicalNotes),
    temperament: en(fx, "temperament", raw.temperament, TEMPERAMENTS, "unknown"),
    specialInstructions: multi(fx, "specialInstructions", raw.specialInstructions, LIMITS.specialInstructions),
    photo,
    source: en(fx, "source", raw.source, SOURCES, "manual"),
  };
}

function cleanAppointment(raw, fx, o) {
  dropUnknown(raw, APPOINTMENT_KEYS, fx);
  const now = o.now instanceof Date ? o.now : new Date();
  let time = single(fx, "time", raw.time, 5);
  if (!isTime(time)) { if (raw.time !== undefined && raw.time !== null && raw.time !== "") fx.hit("time"); time = "09:00"; }
  const duration = int(fx, "duration", raw.duration, MIN_DURATION, MAX_DURATION, DEFAULT_DURATION);
  if (raw.paid !== undefined && raw.paid !== null && typeof raw.paid !== "boolean") fx.hit("paid");
  const paid = raw.paid === true;
  let paymentMethod = en(fx, "paymentMethod", raw.paymentMethod, PAYMENT_METHODS, "");
  if (!paid && paymentMethod) { paymentMethod = ""; fx.hit("paymentMethod"); }
  let recurrenceRule = en(fx, "recurrenceRule", raw.recurrenceRule, RECURRENCE_RULES, "");
  const recurrenceId = single(fx, "recurrenceId", raw.recurrenceId, LIMITS.id);
  if (recurrenceRule && !recurrenceId) { recurrenceRule = ""; fx.hit("recurrenceRule"); }
  return {
    ...meta(raw, o),
    clientId: idOf(raw.clientId),
    petId: idOf(raw.petId),
    date: day(fx, "date", raw.date, todayIso(now)),
    time,
    duration,
    endTime: endTimeOf(time, duration),
    service: en(fx, "service", raw.service, SERVICES, "other"),
    serviceNote: multi(fx, "serviceNote", raw.serviceNote, LIMITS.serviceNote),
    status: en(fx, "status", raw.status, STATUSES, "scheduled"),
    price: int(fx, "price", raw.price, 0, MAX_PRICE, 0),
    paid,
    paymentMethod,
    recurrenceId,
    recurrenceRule,
    note: multi(fx, "note", raw.note, LIMITS.note),
    reminderSentAt: stamp(fx, "reminderSentAt", raw.reminderSentAt),
    source: en(fx, "source", raw.source, SOURCES, "manual"),
  };
}

// Gider: tarih, kategori, aciklama (istege bagli), tutar (en kucuk birim, 0-MAX_EXPENSE), odeme yontemi (bos = belirtilmedi).
function cleanExpense(raw, fx, o) {
  dropUnknown(raw, EXPENSE_KEYS, fx);
  const now = o.now instanceof Date ? o.now : new Date();
  return {
    ...meta(raw, o),
    date: day(fx, "date", raw.date, todayIso(now)),
    category: en(fx, "category", raw.category, EXPENSE_CATEGORIES, "other"),
    description: multi(fx, "description", raw.description, LIMITS.expenseDescription),
    amount: int(fx, "amount", raw.amount, 0, MAX_EXPENSE, 0),
    paymentMethod: en(fx, "paymentMethod", raw.paymentMethod, PAYMENT_METHODS, ""),
    source: en(fx, "source", raw.source, SOURCES, "manual"),
  };
}

const CLEANERS = { clients: cleanClient, pets: cleanPet, appointments: cleanAppointment, expenses: cleanExpense };

/**
 * Tek kaydi temizler (form yolu ve geri yukleme yolu ayni). Girdiyi degistirmez; kayit DUSURMEZ.
 * @param {"clients" | "pets" | "appointments" | "expenses"} collection
 * @param {unknown} raw
 * @param {{ now?: Date, labels?: object, keepMeta?: boolean }} [opts] keepMeta false -> id / createdAt / updatedAt tasinmaz
 * @returns {{ record: object, repaired: boolean, fixes: string[] }} fixes: onarilan alan adlari ("unknown:<ad>" atilan alan)
 */
export function cleanRecord(collection, raw, opts = {}) {
  const clean = CLEANERS[collection];
  if (!clean) throw new RangeError(`cleanRecord: unknown collection ${String(collection)}`);
  const fx = Fixes();
  const record = clean(obj(raw), fx, { ...opts, labels: { ...DEFAULT_LABELS, ...obj(opts.labels) } });
  return { record, repaired: fx.list.length > 0, fixes: fx.list };
}

// ---------- fabrikalar (id / createdAt / updatedAt'i store koyar) ----------
/** Yeni musteri (varsayilanlarla temizlenmis). */
export const createClient = (overrides = {}, opts) => cleanRecord("clients", overrides, { ...opts, keepMeta: false }).record;
/** Yeni hayvan; clientId parametresi overrides'taki clientId'yi ezer. */
export const createPet = (clientId, overrides = {}, opts) => cleanRecord("pets", { ...obj(overrides), clientId }, { ...opts, keepMeta: false }).record;
/** Yeni randevu; clientId / petId parametreleri overrides'i ezer. endTime hesaplanir. */
export const createAppointment = (clientId, petId, overrides = {}, opts) =>
  cleanRecord("appointments", { ...obj(overrides), clientId, petId }, { ...opts, keepMeta: false }).record;

/** Yeni gider (varsayilanlarla temizlenmis). */
export const createExpense = (overrides = {}, opts) => cleanRecord("expenses", overrides, { ...opts, keepMeta: false }).record;

// ---------- dogrulama (form yolu: reddeder, onarmaz) ----------
const tooLong = (v, max, lines) => {
  const s = normText(v, !lines);
  return cpLen(s) > max;
};
const finish = (errors) => ({ valid: Object.keys(errors).length === 0, errors });
const isInt = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const missingId = (v) => typeof v !== "string" || v === "";

/** Musteri dogrulama. errors[alan] = "required" | "email" | "too_long" | "enum". */
export function validateClient(record) {
  const r = obj(record);
  const e = {};
  const name = normText(r.name, true);
  if (!name) e.name = "required"; else if (cpLen(name) > LIMITS.name) e.name = "too_long";
  if (tooLong(r.phone, LIMITS.phone, false)) e.phone = "too_long";
  const email = normText(r.email, true);
  if (email && (cpLen(email) > LIMITS.email || !EMAIL.test(email))) e.email = cpLen(email) > LIMITS.email ? "too_long" : "email";
  if (tooLong(r.address, LIMITS.address, true)) e.address = "too_long";
  if (tooLong(r.note, LIMITS.clientNote, true)) e.note = "too_long";
  if (r.source !== undefined && !SOURCES.includes(r.source)) e.source = "enum";
  return finish(e);
}

/**
 * Hayvan dogrulama: clientId ve ad zorunlu; tur / cinsiyet / mizac listede; agirlik 0-200000 tamsayi; dogum tarihi gecerli ve gelecekte degil.
 * errors[alan] = "required" | "too_long" | "enum" | "range" | "invalid" | "future".
 * @param {object} record
 * @param {{ today?: string }} [opts]
 */
export function validatePet(record, opts) {
  const r = obj(record);
  const e = {};
  if (missingId(r.clientId)) e.clientId = "required";
  const name = normText(r.name, true);
  if (!name) e.name = "required"; else if (cpLen(name) > LIMITS.petName) e.name = "too_long";
  if (r.species !== undefined && !SPECIES.includes(r.species)) e.species = "enum";
  if (r.gender !== undefined && !GENDERS.includes(r.gender)) e.gender = "enum";
  if (r.temperament !== undefined && !TEMPERAMENTS.includes(r.temperament)) e.temperament = "enum";
  if (r.weight !== undefined && !isInt(r.weight, 0, MAX_WEIGHT)) e.weight = "range";
  if (r.vaccineDue !== undefined && r.vaccineDue !== "" && (typeof r.vaccineDue !== "string" || !isIsoDate(r.vaccineDue))) e.vaccineDue = "invalid";
  if (r.photo !== undefined && r.photo !== "" && !isPhotoDataUrl(r.photo)) e.photo = "invalid";
  if (r.birthDate !== undefined && r.birthDate !== "") {
    if (typeof r.birthDate !== "string" || !isIsoDate(r.birthDate)) e.birthDate = "invalid";
    else if (r.birthDate > (opts?.today ?? todayIso())) e.birthDate = "future";
  }
  const longs = [["breed", LIMITS.breed, false], ["color", LIMITS.color, false], ["microchip", LIMITS.microchip, false],
    ["vaccinations", LIMITS.vaccinations, true], ["allergies", LIMITS.allergies, true], ["medicalNotes", LIMITS.medicalNotes, true],
    ["specialInstructions", LIMITS.specialInstructions, true]];
  for (const [k, max, lines] of longs) if (tooLong(r[k], max, lines)) e[k] = "too_long";
  if (r.source !== undefined && !SOURCES.includes(r.source)) e.source = "enum";
  return finish(e);
}

/**
 * Randevu dogrulama: clientId / petId / tarih / saat zorunlu; sure 15-480; hizmet / durum / odeme yontemi listede; fiyat 0-999999 tamsayi;
 * paid boolean; kural bilinen ve recurrenceId ile birlikte.
 * errors[alan] = "required" | "invalid" | "range" | "enum" | "too_long".
 */
export function validateAppointment(record) {
  const r = obj(record);
  const e = {};
  if (missingId(r.clientId)) e.clientId = "required";
  if (missingId(r.petId)) e.petId = "required";
  if (typeof r.date !== "string" || r.date === "") e.date = "required"; else if (!isIsoDate(r.date)) e.date = "invalid";
  if (typeof r.time !== "string" || r.time === "") e.time = "required"; else if (!isTime(r.time)) e.time = "invalid";
  if (r.duration !== undefined && !isInt(r.duration, MIN_DURATION, MAX_DURATION)) e.duration = "range";
  if (r.service !== undefined && !SERVICES.includes(r.service)) e.service = "enum";
  if (r.status !== undefined && !STATUSES.includes(r.status)) e.status = "enum";
  if (r.price !== undefined && !isInt(r.price, 0, MAX_PRICE)) e.price = "range";
  if (r.paid !== undefined && typeof r.paid !== "boolean") e.paid = "invalid";
  if (r.paymentMethod !== undefined && r.paymentMethod !== "" && !PAYMENT_METHODS.includes(r.paymentMethod)) e.paymentMethod = "enum";
  if (r.recurrenceRule !== undefined && r.recurrenceRule !== "") {
    if (!RECURRENCE_RULES.includes(r.recurrenceRule)) e.recurrenceRule = "enum";
    else if (typeof r.recurrenceId !== "string" || r.recurrenceId === "") e.recurrenceId = "required";
  }
  if (tooLong(r.serviceNote, LIMITS.serviceNote, true)) e.serviceNote = "too_long";
  if (tooLong(r.note, LIMITS.note, true)) e.note = "too_long";
  if (r.source !== undefined && !SOURCES.includes(r.source)) e.source = "enum";
  return finish(e);
}

/**
 * Gider dogrulama: tarih, kategori ve tutar ZORUNLU; tutar 1-MAX_EXPENSE tamsayi (0 gider olmaz); kategori / odeme yontemi listede; aciklama en cok 200.
 * errors[alan] = "required" | "invalid" | "range" | "enum" | "too_long".
 */
export function validateExpense(record) {
  const r = obj(record);
  const e = {};
  if (typeof r.date !== "string" || r.date === "") e.date = "required"; else if (!isIsoDate(r.date)) e.date = "invalid";
  if (typeof r.category !== "string" || r.category === "") e.category = "required"; else if (!EXPENSE_CATEGORIES.includes(r.category)) e.category = "enum";
  if (r.amount === undefined || r.amount === null) e.amount = "required"; else if (!isInt(r.amount, 1, MAX_EXPENSE)) e.amount = "range";
  if (r.paymentMethod !== undefined && r.paymentMethod !== "" && !PAYMENT_METHODS.includes(r.paymentMethod)) e.paymentMethod = "enum";
  if (tooLong(r.description, LIMITS.expenseDescription, true)) e.description = "too_long";
  if (r.source !== undefined && !SOURCES.includes(r.source)) e.source = "enum";
  return finish(e);
}
