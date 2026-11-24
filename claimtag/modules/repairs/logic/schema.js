// Koleksiyon semalari, temizleme (cleanRecord), fabrikalar, dogrulama ve onarim (spec 3.0-3.7). Saf islevler: DOM yok, ag yok.
// Form yolu ve geri yukleme yolu AYNI cleanRecord'u kullanir. Onarim kayit DUSURMEZ (yalniz gecersiz id); bilinmeyen alan atilir
// (passcode / pin / pattern / password / unlock* dahil). Para alanlari en kucuk birimin tamsayisidir, aralik disi sinira cekilir.

import { isIsoDate, todayIso } from "../../../core/dates.js";
import { serialKey } from "./imei.js";
import { validatePhone } from "./phone.js";
import { warrantyEnd } from "./aging.js";
import { STATUSES, isReady, isClosed } from "./status.js";
import { LINE_KINDS, LINE_LIMITS, MAX_MINOR, PART_TYPES, PAYMENT_KINDS, PAYMENT_METHODS, QTY_MAX, QTY_MIN, validateLine } from "./calc.js";

export const COLLECTIONS = Object.freeze(["customers", "devices", "jobs"]);
export const SOURCES = Object.freeze(["manual", "sample"]);
export const DEVICE_TYPES = Object.freeze(["phone", "tablet", "laptop", "desktop", "other"]);
export const AREAS = Object.freeze(["case", "screen", "back", "lens", "buttons", "ports"]);
export const AREA_VALUES = Object.freeze(["ok", "scratches", "dents", "cracked", "not_checked"]);
export const TRI = Object.freeze(["yes", "no", "unknown"]);
export const ACCESSORIES = Object.freeze(["charger", "cable", "case", "sim", "memory_card", "stylus", "bag", "box"]);
export const TEST_VALUES = Object.freeze(["works", "fault", "untestable"]);
export const CHANNELS = Object.freeze(["whatsapp", "sms", "call", "email", "in_person", "other"]);
export const CONTACT_TEMPLATES = Object.freeze(["received", "approval", "part", "ready", "reminder", "reminder_later"]);
export const JOB_FLAGS = Object.freeze(["customer", "device"]); // [Varsayim] spec is repairFlags degerlerini saymaz
export const LIMITS = Object.freeze({
  jobs: 3000, customers: 3000, devices: 3000,
  name: 80, phone: 30, phoneDigits: 15, email: 120, address: 200, addressLines: 3, customerNote: 300,
  model: 60, serial: 40, color: 30,
  number: 20, problem: 300, accessoriesOther: 120, priorDamage: 300, testNote: 120, testItems: 12,
  lines: LINE_LIMITS.lines, payments: LINE_LIMITS.payments, contacts: 50, history: 60,
  warrantyDays: 3650, internalNote: 500, cancelReason: 120, paymentNote: 100, contactNote: 200, repairFlags: 5, id: 100,
});

/** Sabit test listeleri (spec 3.4). Other: madde yok, yalniz not. */
export const TEST_KEYS = Object.freeze({
  phone: Object.freeze(["touch", "front_camera", "rear_camera", "sensors", "display", "speaker", "charging", "buttons", "microphone", "wifi", "cellular", "biometrics"]),
  tablet: Object.freeze(["touch", "front_camera", "rear_camera", "sensors", "display", "speaker", "charging", "buttons", "microphone", "wifi", "cellular", "biometrics"]),
  laptop: Object.freeze(["display", "keyboard", "trackpad", "battery", "power", "charging", "ports", "fan", "wifi", "webcam", "audio", "os_boots"]),
  desktop: Object.freeze(["display", "keyboard", "trackpad", "battery", "power", "charging", "ports", "fan", "wifi", "webcam", "audio", "os_boots"]),
  other: Object.freeze([]),
});
const ALL_TEST_KEYS = new Set(Object.values(TEST_KEYS).flat());

export const DEFAULT_LABELS = Object.freeze({ noName: "(no name)", notRecorded: "(not recorded)", missingCustomer: "Missing customer", unknownDevice: "Unknown device" });

// ---------- metin ve sayi yardimcilari ----------
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const cpLen = (s) => [...s].length;
const cutCp = (s, n) => (cpLen(s) > n ? [...s].slice(0, n).join("") : s);
const asText = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

// NFC + kirpma + kontrol karakteri atma; tek satirda satir sonu / sekme bosluk olur. Kesmeden onceki hali de doner.
function normText(v, single) {
  let s = asText(v).normalize("NFC").replace(/\r\n?|\u2028|\u2029/g, "\n").replace(CONTROL, "");
  s = single ? s.replace(/[\n\t]+/g, " ") : s.replace(/\t/g, " ");
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
function decimal(fx, field, v, places, min, max, fallback) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n)) { fx.hit(field); return fallback; }
  const k = 10 ** places;
  let r = Math.sign(n) * Math.round(Math.abs(n) * k) / k + 0;
  if (r < min) r = min;
  if (r > max) r = max;
  if (r !== n) fx.hit(field);
  return r;
}
function en(fx, field, v, list, def) {
  if (list.includes(v)) return v;
  if (v !== undefined && v !== null) fx.hit(field);
  return def;
}
function day(fx, field, v, fallback) {
  if (typeof v === "string" && isIsoDate(v)) return v;
  if (v !== undefined && v !== null && v !== "") fx.hit(field);
  return fallback;
}
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
function stamp(fx, field, v, fallback) {
  if (typeof v === "string" && STAMP.test(v) && !Number.isNaN(Date.parse(v))) return v;
  if (v !== undefined && v !== null && v !== "") fx.hit(field);
  return fallback;
}
const dayOfStamp = (iso) => todayIso(new Date(iso));
const idOf = (v, fallback = "") => (typeof v === "string" ? v : fallback);

function meta(raw, fx, o) {
  const out = {};
  if (o.keepMeta === false) return out;
  for (const k of ["id", "createdAt", "updatedAt"]) if (typeof raw[k] === "string" && raw[k]) out[k] = raw[k];
  return out;
}
function dropUnknown(raw, known, fx) {
  for (const k of Object.keys(raw)) if (!known.includes(k)) fx.hit(`unknown:${k}`);
}

// ---------- test karti ----------
/** Bos test karti: tur icin sabit liste, hepsi null. */
export function emptyTests(type) {
  return { items: (TEST_KEYS[type] ?? []).map((key) => ({ key, before: null, after: null })), note: "" };
}
/** Tur degisince: yeni listenin anahtarlari kalir, ayni anahtarli degerler korunur, olmayanlar atilir; not korunur. */
export function syncTests(tests, type) {
  const old = new Map((Array.isArray(tests?.items) ? tests.items : []).filter((i) => i && typeof i.key === "string").map((i) => [i.key, i]));
  return {
    items: (TEST_KEYS[type] ?? []).map((key) => ({ key, before: old.get(key)?.before ?? null, after: old.get(key)?.after ?? null })),
    note: typeof tests?.note === "string" ? tests.note : "",
  };
}

// ---------- kayit temizleyiciler ----------
const CUSTOMER_KEYS = ["id", "createdAt", "updatedAt", "name", "phone", "phoneDigits", "email", "address", "note", "repairFlags", "source"];
const DEVICE_KEYS = ["id", "createdAt", "updatedAt", "customerId", "type", "model", "serial", "serialKey", "color", "source"];
const JOB_KEYS = ["id", "createdAt", "updatedAt", "number", "customerId", "deviceId", "status", "receivedAt", "receivedDate", "problem", "condition", "tests",
  "customerTested", "estimateMinor", "lines", "payments", "contacts", "history", "statusDate", "readyDate", "handedOverDate", "warrantyDays", "warrantyEnd",
  "internalNote", "cancelReason", "repairFlags", "source"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanCustomer(raw, fx, o) {
  const L = o.labels;
  dropUnknown(raw, CUSTOMER_KEYS, fx);
  let name = single(fx, "name", raw.name, LIMITS.name);
  if (!name) { name = L.noName; fx.hit("name"); }
  const phone = single(fx, "phone", raw.phone, LIMITS.phone);
  const v = validatePhone(phone);
  const flagged = Array.isArray(raw.repairFlags) && raw.repairFlags.includes("phone");
  if (!v.ok && !flagged) fx.hit("phone");
  let email = single(fx, "email", raw.email, LIMITS.email);
  if (email && !EMAIL.test(email)) { email = ""; fx.hit("email"); }
  return {
    ...meta(raw, fx, o),
    name, phone,
    phoneDigits: v.ok ? v.digits : cutCp(phone.replace(/[^0-9]/g, ""), LIMITS.phoneDigits),
    email,
    address: str(fx, "address", raw.address, LIMITS.address, { lines: LIMITS.addressLines }),
    note: str(fx, "note", raw.note, LIMITS.customerNote, { lines: 99 }),
    repairFlags: v.ok ? [] : ["phone"],
    source: en(fx, "source", raw.source, SOURCES, "manual"),
  };
}

function cleanDevice(raw, fx, o) {
  dropUnknown(raw, DEVICE_KEYS, fx);
  const serial = single(fx, "serial", raw.serial, LIMITS.serial);
  return {
    ...meta(raw, fx, o),
    customerId: idOf(raw.customerId),
    type: en(fx, "type", raw.type, DEVICE_TYPES, "other"),
    model: single(fx, "model", raw.model, LIMITS.model),
    serial,
    serialKey: serialKey(serial),
    color: single(fx, "color", raw.color, LIMITS.color),
    source: en(fx, "source", raw.source, SOURCES, "manual"),
  };
}

function cleanLine(raw, i, fx) {
  const r = obj(raw);
  const kind = en(fx, "lines", r.kind, LINE_KINDS, "other");
  const isPart = kind === "part";
  let name = single(fx, "lines", r.name, LINE_LIMITS.name);
  if (!name) { name = DEFAULT_LABELS.noName; fx.hit("lines"); }
  const id = typeof r.id === "string" && r.id && cpLen(r.id) <= LINE_LIMITS.id ? r.id : `l${i + 1}`;
  if (id !== r.id) fx.hit("lines");
  const hasCost = kind === "part" || kind === "other";
  return {
    id, kind, name,
    qty: decimal(fx, "lines", r.qty, 3, QTY_MIN, QTY_MAX, 1),
    unitMinor: int(fx, "lines", r.unitMinor, 0, MAX_MINOR, 0),
    taxRate: decimal(fx, "lines", r.taxRate, 2, 0, 100, null),
    costMinor: hasCost ? int(fx, "lines", r.costMinor, 0, MAX_MINOR, null) : null,
    supplier: isPart ? single(fx, "lines", r.supplier, LINE_LIMITS.supplier) : "",
    partType: isPart ? en(fx, "lines", r.partType, PART_TYPES, "unspecified") : "unspecified",
    toldCustomer: r.toldCustomer === true,
  };
}

function cleanList(fx, field, v, max, mapFn, keepLast = false) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) { fx.hit(field); return []; }
  let out = [];
  v.forEach((x, i) => {
    const m = x && typeof x === "object" && !Array.isArray(x) ? mapFn(x, i) : null;
    if (m) out.push(m); else fx.hit(field);
  });
  if (out.length > max) { out = keepLast ? out.slice(-max) : out.slice(0, max); fx.hit(field); }
  return out;
}

function cleanCondition(raw, fx) {
  const c = obj(raw);
  if (raw !== undefined && raw !== null && obj(raw) !== raw) fx.hit("condition");
  const areas = obj(c.areas);
  const acc = Array.isArray(c.accessories) ? ACCESSORIES.filter((a) => c.accessories.includes(a)) : [];
  if (Array.isArray(c.accessories) && c.accessories.some((a) => !ACCESSORIES.includes(a))) fx.hit("condition");
  return {
    areas: Object.fromEntries(AREAS.map((k) => [k, en(fx, "condition", areas[k], AREA_VALUES, "not_checked")])),
    liquid: en(fx, "condition", c.liquid, TRI, "unknown"),
    powersOn: en(fx, "condition", c.powersOn, TRI, "unknown"),
    accessories: acc,
    accessoriesOther: single(fx, "condition", c.accessoriesOther, LIMITS.accessoriesOther),
    priorDamage: str(fx, "condition", c.priorDamage, LIMITS.priorDamage, { lines: 99 }),
  };
}

function cleanTests(raw, fx, deviceType) {
  const t = obj(raw);
  const seen = new Set();
  const items = cleanList(fx, "tests", t.items, LIMITS.testItems, (it) => {
    if (typeof it.key !== "string" || !ALL_TEST_KEYS.has(it.key) || seen.has(it.key)) return null;
    seen.add(it.key);
    return { key: it.key, before: en(fx, "tests", it.before, TEST_VALUES, null), after: en(fx, "tests", it.after, TEST_VALUES, null) };
  });
  const note = single(fx, "tests", t.note, LIMITS.testNote);
  return deviceType ? syncTests({ items, note }, deviceType) : { items, note };
}

function cleanJob(raw, fx, o) {
  const L = o.labels;
  dropUnknown(raw, JOB_KEYS, fx);
  const now = o.now instanceof Date ? o.now : new Date();
  const status = en(fx, "status", raw.status, STATUSES, "received");
  const receivedAt = stamp(fx, "receivedAt", raw.receivedAt, now.toISOString());
  const receivedDate = day(fx, "receivedDate", raw.receivedDate, dayOfStamp(receivedAt));
  const statusDate = day(fx, "statusDate", raw.statusDate, receivedDate);

  let problem = str(fx, "problem", raw.problem, LIMITS.problem, { lines: 99 });
  if (!problem) { problem = L.notRecorded; fx.hit("problem"); }

  let readyDate = day(fx, "readyDate", raw.readyDate, null);
  if (isReady(status) && !readyDate) { readyDate = statusDate; fx.hit("readyDate"); }
  else if ((status === "cancelled" || (!isReady(status) && !isClosed(status))) && readyDate) { readyDate = null; fx.hit("readyDate"); }

  const pickedUp = status === "handed_over" || status === "returned_unrepaired";
  let handedOverDate = day(fx, "handedOverDate", raw.handedOverDate, null);
  if (pickedUp && !handedOverDate) { handedOverDate = statusDate; fx.hit("handedOverDate"); }
  else if (!pickedUp && handedOverDate) { handedOverDate = null; fx.hit("handedOverDate"); }

  let warrantyDays = int(fx, "warrantyDays", raw.warrantyDays, 0, LIMITS.warrantyDays, null) || null;
  if (warrantyDays && status !== "handed_over") { warrantyDays = null; fx.hit("warrantyDays"); }
  let wEnd = warrantyDays ? day(fx, "warrantyEnd", raw.warrantyEnd, null) : null;
  if (warrantyDays && !wEnd) wEnd = warrantyEnd(handedOverDate, warrantyDays);
  if (!warrantyDays && raw.warrantyEnd) fx.hit("warrantyEnd");

  const flags = Array.isArray(raw.repairFlags) ? JOB_FLAGS.filter((f) => raw.repairFlags.includes(f)).slice(0, LIMITS.repairFlags) : [];
  const tri = raw.customerTested === "yes" || raw.customerTested === "no" ? raw.customerTested : null;
  if (raw.customerTested !== undefined && raw.customerTested !== null && !tri) fx.hit("customerTested");

  return {
    ...meta(raw, fx, o),
    number: single(fx, "number", raw.number, LIMITS.number),
    customerId: idOf(raw.customerId),
    deviceId: idOf(raw.deviceId),
    status, receivedAt, receivedDate, problem,
    condition: cleanCondition(raw.condition, fx),
    tests: cleanTests(raw.tests, fx, o.deviceType),
    customerTested: tri,
    estimateMinor: int(fx, "estimateMinor", raw.estimateMinor, 0, MAX_MINOR, null),
    lines: cleanList(fx, "lines", raw.lines, LIMITS.lines, (l, i) => cleanLine(l, i, fx)),
    payments: cleanList(fx, "payments", raw.payments, LIMITS.payments, (p, i) => {
      const amountMinor = int(fx, "payments", p.amountMinor, 0, MAX_MINOR, 0);
      if (amountMinor < 1) return null; // 0 / eksi / sayi degil: sahte tutar uretilmez, odeme dusurulur
      return {
        id: typeof p.id === "string" && p.id ? cutCp(p.id, LINE_LIMITS.id) : `p${i + 1}`,
        kind: en(fx, "payments", p.kind, PAYMENT_KINDS, "payment"),
        amountMinor,
        date: day(fx, "payments", p.date, receivedDate),
        method: en(fx, "payments", p.method, PAYMENT_METHODS, "other"),
        note: single(fx, "payments", p.note, LIMITS.paymentNote),
      };
    }),
    contacts: cleanList(fx, "contacts", raw.contacts, LIMITS.contacts, (c, i) => {
      const at = stamp(fx, "contacts", c.at, receivedAt);
      return {
        id: typeof c.id === "string" && c.id ? cutCp(c.id, LINE_LIMITS.id) : `c${i + 1}`,
        at,
        date: day(fx, "contacts", c.date, dayOfStamp(at)),
        channel: en(fx, "contacts", c.channel, CHANNELS, "other"),
        template: c.template === null || c.template === undefined ? null : en(fx, "contacts", c.template, CONTACT_TEMPLATES, null),
        note: single(fx, "contacts", c.note, LIMITS.contactNote),
      };
    }),
    history: cleanList(fx, "history", raw.history, LIMITS.history, (h) => {
      if (!STATUSES.includes(h.to)) return null;
      const at = stamp(fx, "history", h.at, receivedAt);
      return { at, date: day(fx, "history", h.date, dayOfStamp(at)), from: STATUSES.includes(h.from) ? h.from : null, to: h.to };
    }, true),
    statusDate, readyDate, handedOverDate, warrantyDays, warrantyEnd: wEnd,
    internalNote: str(fx, "internalNote", raw.internalNote, LIMITS.internalNote, { lines: 99 }),
    cancelReason: single(fx, "cancelReason", raw.cancelReason, LIMITS.cancelReason),
    repairFlags: flags,
    source: en(fx, "source", raw.source, SOURCES, "manual"),
  };
}

const CLEANERS = { customer: cleanCustomer, device: cleanDevice, job: cleanJob };

/**
 * Tek kaydi temizler (form yolu ve geri yukleme yolu ayni). Girdiyi degistirmez.
 * @param {"customer" | "device" | "job"} kind
 * @param {unknown} raw
 * @param {{ now?: Date, labels?: object, deviceType?: string, keepMeta?: boolean }} [opts] keepMeta false -> id / createdAt / updatedAt tasinmaz
 * @returns {{ record: object, repaired: boolean, fixes: string[] }} fixes: onarilan alan adlari ("unknown:<ad>" atilan alan)
 */
export function cleanRecord(kind, raw, opts = {}) {
  const clean = CLEANERS[kind];
  if (!clean) throw new RangeError(`cleanRecord: unknown kind ${String(kind)}`);
  const fx = Fixes();
  const record = clean(obj(raw), fx, { ...opts, labels: { ...DEFAULT_LABELS, ...obj(opts.labels) } });
  return { record, repaired: fx.list.length > 0, fixes: fx.list };
}

// ---------- fabrikalar (id / createdAt / updatedAt'i store koyar) ----------
const make = (kind) => (input, opts) => cleanRecord(kind, input, { ...opts, keepMeta: false }).record;
/** Varsayilanlarla temizlenmis kayit. Dogrulama icin validate* kullanilir; fabrika eksik girdiyi sessizce onarir. */
export const createCustomer = make("customer");
export const createDevice = make("device");
export const createJob = make("job");

// ---------- dogrulama (form yolu: reddeder, onarmaz) ----------
function tooLong(v, max, o) {
  const s = normText(v, !o?.lines);
  return cpLen(s) > max || (o?.lines && s.split("\n").length > o.lines);
}
const finish = (errors, value) => ({ ok: Object.keys(errors).length === 0, errors, value });

/**
 * Musteri formunu dogrular. errors[alan] = "required" | "phone" | "phone_chars" | "email" | "too_long".
 * value: temizlenmis kayit (yalniz ok iken kaydedilir).
 */
export function validateCustomer(input, opts) {
  const r = obj(input);
  const e = {};
  const name = normText(r.name, true);
  if (!name) e.name = "required"; else if (cpLen(name) > LIMITS.name) e.name = "too_long";
  const v = validatePhone(normText(r.phone, true));
  if (!v.ok) e.phone = v.reason === "empty" ? "required" : v.reason === "chars" ? "phone_chars" : "phone";
  const email = normText(r.email, true);
  if (email && (cpLen(email) > LIMITS.email || !EMAIL.test(email))) e.email = cpLen(email) > LIMITS.email ? "too_long" : "email";
  if (tooLong(r.address, LIMITS.address, { lines: LIMITS.addressLines })) e.address = "too_long";
  if (tooLong(r.note, LIMITS.customerNote, { lines: 99 })) e.note = "too_long";
  return finish(e, createCustomer(input, opts));
}

/** Cihaz formunu dogrular: customerId zorunlu, tur listede, metinler sinirda. */
export function validateDevice(input, opts) {
  const r = obj(input);
  const e = {};
  if (typeof r.customerId !== "string" || !r.customerId) e.customerId = "required";
  if (r.type !== undefined && !DEVICE_TYPES.includes(r.type)) e.type = "enum";
  if (tooLong(r.model, LIMITS.model, { lines: 0 })) e.model = "too_long";
  if (tooLong(r.serial, LIMITS.serial, { lines: 0 })) e.serial = "too_long";
  if (tooLong(r.color, LIMITS.color, { lines: 0 })) e.color = "too_long";
  return finish(e, createDevice(input, opts));
}

/**
 * Is kaydini dogrular (kabul formu): musteri, cihaz, ariza (1-300), durum, tahmin, satir / odeme / haber sayilari, notlar.
 * errors[alan] = "required" | "too_long" | "enum" | "range" | "limit" | "invalid".
 */
export function validateJob(input, opts) {
  const r = obj(input);
  const e = {};
  if (typeof r.customerId !== "string" || !r.customerId) e.customerId = "required";
  if (typeof r.deviceId !== "string" || !r.deviceId) e.deviceId = "required";
  const problem = normText(r.problem, false);
  if (!problem) e.problem = "required"; else if (cpLen(problem) > LIMITS.problem) e.problem = "too_long";
  if (r.status !== undefined && !STATUSES.includes(r.status)) e.status = "enum";
  if (r.estimateMinor !== undefined && r.estimateMinor !== null && !(Number.isSafeInteger(r.estimateMinor) && r.estimateMinor >= 0 && r.estimateMinor <= MAX_MINOR)) e.estimateMinor = "range";
  if (r.lines !== undefined) {
    if (!Array.isArray(r.lines)) e.lines = "invalid";
    else if (r.lines.length > LIMITS.lines) e.lines = "limit";
    else if (r.lines.some((l) => Object.keys(validateLine(l)).length > 0)) e.lines = "invalid";
  }
  if (Array.isArray(r.payments) && r.payments.length > LIMITS.payments) e.payments = "limit";
  if (Array.isArray(r.contacts) && r.contacts.length > LIMITS.contacts) e.contacts = "limit";
  if (r.warrantyDays !== undefined && r.warrantyDays !== null && !(Number.isInteger(r.warrantyDays) && r.warrantyDays >= 0 && r.warrantyDays <= LIMITS.warrantyDays)) e.warrantyDays = "range";
  const longs = [["priorDamage", r.condition?.priorDamage, LIMITS.priorDamage, { lines: 99 }], ["accessoriesOther", r.condition?.accessoriesOther, LIMITS.accessoriesOther, { lines: 0 }], ["testNote", r.tests?.note, LIMITS.testNote, { lines: 0 }]];
  for (const [k, v, max, o] of longs) if (tooLong(v, max, o)) e[k] = "too_long";
  if (tooLong(r.internalNote, LIMITS.internalNote, { lines: 99 })) e.internalNote = "too_long";
  if (tooLong(r.cancelReason, LIMITS.cancelReason, { lines: 0 })) e.cancelReason = "too_long";
  return finish(e, createJob(input, opts));
}

// ---------- geri yukleme: onarim ve oksuz kayit baglama ----------
const validId = (v) => typeof v === "string" && v.length > 0 && v.length <= LIMITS.id;

/**
 * Yedekteki uc koleksiyonu temizler ve baglar (spec 3.0 Onarim). Gecersiz id'li ya da tekrar eden id'li kayit dusurulur (dropped),
 * baska hicbir sey dusmez. Oksuz is "Missing customer" / "Unknown device" yer tutucusuna baglanir.
 * Girdi degistirilmez. Sinir (3.000) denetimi cagiranindir.
 * @param {{ customers?: unknown, devices?: unknown, jobs?: unknown }} data
 * @param {{ now?: Date, labels?: object }} [opts]
 * @returns {{ customers: object[], devices: object[], jobs: object[], repaired: number, dropped: number }}
 *   repaired: onarilan kayit sayisi ("Repaired: {n} records"), yer tutucular sayilmaz
 */
export function migrateData(data, opts = {}) {
  const d = obj(data);
  const now = opts.now instanceof Date ? opts.now : new Date();
  const stamped = now.toISOString();
  const labels = { ...DEFAULT_LABELS, ...obj(opts.labels) };
  const repairedRecords = new Set();
  let dropped = 0;
  const run = (kind, list, extra) => {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || !validId(raw.id) || seen.has(raw.id)) { dropped += 1; continue; }
      seen.add(raw.id);
      const r = cleanRecord(kind, raw, { now, labels, ...(extra ? extra(raw) : {}) });
      if (r.repaired) repairedRecords.add(r.record);
      out.push(r.record);
    }
    return out;
  };
  const flag = (job, f) => { job.repairFlags = [...new Set([...job.repairFlags, f])]; };

  const customers = run("customer", d.customers);
  const custIds = new Set(customers.map((c) => c.id));
  let missingCustomer = null;
  const missingCustomerId = () => {
    if (!missingCustomer) {
      let id = "missing-customer";
      while (custIds.has(id)) id += "_";
      missingCustomer = { id, createdAt: stamped, updatedAt: stamped, name: labels.missingCustomer, phone: "", phoneDigits: "", email: "", address: "", note: "", repairFlags: ["phone"], source: "manual" };
      custIds.add(id);
      customers.push(missingCustomer);
    }
    return missingCustomer.id;
  };

  const devices = run("device", d.devices);
  for (const dev of devices) {
    if (!custIds.has(dev.customerId)) { dev.customerId = missingCustomerId(); repairedRecords.add(dev); }
  }
  const devById = new Map(devices.map((dv) => [dv.id, dv]));
  const unknownByCustomer = new Map();

  const jobs = run("job", d.jobs, (raw) => ({ deviceType: devById.get(raw.deviceId)?.type }));
  for (const job of jobs) {
    if (!custIds.has(job.customerId)) { job.customerId = missingCustomerId(); flag(job, "customer"); repairedRecords.add(job); }
    if (!devById.has(job.deviceId)) {
      let ph = unknownByCustomer.get(job.customerId);
      if (!ph) {
        let id = `unknown-device-${job.customerId}`.slice(0, LIMITS.id);
        while (devById.has(id)) id = `${id.slice(0, LIMITS.id - 1)}_`;
        ph = { id, createdAt: stamped, updatedAt: stamped, customerId: job.customerId, type: "other", model: labels.unknownDevice, serial: "", serialKey: "", color: "", source: "manual" };
        unknownByCustomer.set(job.customerId, ph);
        devById.set(id, ph);
        devices.push(ph);
      }
      job.deviceId = ph.id;
      flag(job, "device");
      repairedRecords.add(job);
    }
  }
  return { customers, devices, jobs, repaired: repairedRecords.size, dropped };
}
