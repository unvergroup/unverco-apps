// Homeschool Planner veri semasi: koleksiyonlar, sinirlar, sabit listeler, dogrulama ve onarim (yedekten geri yukleme).
// Saf islevler; DOM / depo bagimliligi yok. Tum metinler NFC, kirpilmis, sinirli uzunlukta. Tarih "YYYY-MM-DD".
import { isIsoDate } from "../../../core/dates.js";

export const DATA_COLLECTIONS = Object.freeze(["students", "subjects", "logs", "attendance", "grades", "books", "activities"]);
export const RECORD_LIMITS = Object.freeze({ students: 20, subjects: 400, logs: 30000, attendance: 10000, grades: 10000, books: 5000, activities: 5000 });

// Cocuk renkleri: acik ve koyu temada okunur (10 renk). Sira renk korlugune gore: kirmizi ve yesil yan yana DEGIL (mavi, turuncu, mor, yesil...).
export const STUDENT_COLORS = Object.freeze(["#2f6fde", "#c77d0a", "#8a4fd6", "#1f9d6b", "#d14b98", "#178a9e", "#d64545", "#6b7a1f", "#4b5bb8", "#b8562b"]);
export const SUBJECT_MODES = Object.freeze(["weekly", "loop"]);
export const ATT_KINDS = Object.freeze(["school", "field", "sick", "break"]);
export const COUNTED_KINDS = Object.freeze(["school", "field"]);
export const BOOK_STATUS = Object.freeze(["toread", "reading", "done"]);
export const GRADE_TYPES = Object.freeze(["percent", "letter"]);
export const LETTERS = Object.freeze(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "P", "S", "N"]);
export const MAX = Object.freeze({ name: 60, grade: 24, notes: 300, resource: 120, finalGrade: 10, title: 80, bookTitle: 120, author: 80, place: 80, letter: 4 });
export const MINUTES = Object.freeze({ subjectMin: 5, subjectMax: 480, logMax: 720 });
export const LOOP_MAX = 10;
export const MAX_COST_MINOR = 10 ** 9;

export const text = (v, max = 300) => (typeof v === "string" ? v.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const int = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
const days = (v) => [...new Set((Array.isArray(v) ? v : []).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
const date = (v) => (typeof v === "string" && isIsoDate(v) ? v : "");
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

// Sayi metni -> tamsayi (bos = null). { ok, value } | { ok:false, error }
export function parseIntText(raw, lo, hi, { allowEmpty = false } = {}) {
  const s = String(raw ?? "").trim();
  if (s === "") return allowEmpty ? { ok: true, value: null } : { ok: false, error: "required" };
  if (!/^[0-9]+$/.test(s)) return { ok: false, error: "range", min: lo, max: hi };
  const n = Number(s);
  return n >= lo && n <= hi ? { ok: true, value: n } : { ok: false, error: "range", min: lo, max: hi };
}

// Yuzde not: 0-100, en cok 1 ondalik ("92.5" / "92,5").
export function parsePercent(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!/^[0-9]{1,3}(\.[0-9])?$/.test(s)) return { ok: false, error: "range", min: 0, max: 100 };
  const n = Number(s);
  return n >= 0 && n <= 100 ? { ok: true, value: n } : { ok: false, error: "range", min: 0, max: 100 };
}

// ---- Kayit temizleyicileri: guvenilmeyen kaydi gecerli kayda cevirir (bilinmeyen alan atilir) ----
const CLEAN = {
  students: (r) => ({
    name: text(r.name, MAX.name) || "?",
    color: STUDENT_COLORS.includes(r.color) ? r.color : STUDENT_COLORS[0],
    grade: text(r.grade, MAX.grade),
    loopPerDay: int(r.loopPerDay, 0, LOOP_MAX, 2),
    notes: text(r.notes, MAX.notes),
  }),
  subjects: (r) => ({
    studentId: text(r.studentId, 64),
    name: text(r.name, MAX.name) || "?",
    core: r.core === true,
    mode: oneOf(r.mode, SUBJECT_MODES, "weekly"),
    days: days(r.days),
    loopOrder: int(r.loopOrder, 0, 10000, 0),
    minutes: int(r.minutes, MINUTES.subjectMin, MINUTES.subjectMax, 30),
    resource: text(r.resource, MAX.resource),
    costMinor: Number.isSafeInteger(r.costMinor) && r.costMinor >= 0 && r.costMinor <= MAX_COST_MINOR ? r.costMinor : null,
    finalGrade: text(r.finalGrade, MAX.finalGrade),
  }),
  logs: (r) => ({ date: date(r.date), studentId: text(r.studentId, 64), subjectId: text(r.subjectId, 64), minutes: int(r.minutes, 0, MINUTES.logMax, 0), note: text(r.note, MAX.notes) }),
  attendance: (r) => ({ date: date(r.date), studentId: text(r.studentId, 64), kind: oneOf(r.kind, ATT_KINDS, "school") }),
  grades: (r) => {
    const type = oneOf(r.type, GRADE_TYPES, "percent");
    const p = typeof r.percent === "number" && Number.isFinite(r.percent) && r.percent >= 0 && r.percent <= 100 ? Math.round(r.percent * 10) / 10 : null;
    return { studentId: text(r.studentId, 64), subjectId: text(r.subjectId, 64), date: date(r.date), title: text(r.title, MAX.title), type, percent: type === "percent" ? p : null, letter: type === "letter" ? text(r.letter, MAX.letter) : "" };
  },
  books: (r) => ({ studentId: text(r.studentId, 64), title: text(r.title, MAX.bookTitle) || "?", author: text(r.author, MAX.author), status: oneOf(r.status, BOOK_STATUS, "toread"), finishedOn: date(r.finishedOn), notes: text(r.notes, MAX.notes) }),
  activities: (r) => ({
    date: date(r.date), title: text(r.title, MAX.title) || "?", place: text(r.place, MAX.place),
    studentIds: [...new Set((Array.isArray(r.studentIds) ? r.studentIds : []).filter((x) => typeof x === "string" && x).map((x) => x.slice(0, 64)))].slice(0, RECORD_LIMITS.students),
    minutes: int(r.minutes, 0, MINUTES.logMax, 0), core: r.core === true, notes: text(r.notes, MAX.notes),
  }),
};

/** Yedekten gelen kaydi onarir. Doner: { record, repaired }. id / createdAt / updatedAt korunur. */
export function cleanRecord(collection, r) {
  const fn = CLEAN[collection];
  if (!fn) return { record: r, repaired: false };
  const base = { id: r.id, createdAt: typeof r.createdAt === "string" ? r.createdAt : undefined, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined };
  const record = { ...fn(r), ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) };
  const same = Object.keys(record).every((k) => JSON.stringify(record[k]) === JSON.stringify(r[k])) && Object.keys(r).every((k) => k in record);
  return { record, repaired: !same };
}

/** Form girdisini dogrular ve temizler. Doner: { ok, value, errors: { alan: kod } }. */
export function validate(collection, input) {
  const errors = {};
  const v = CLEAN[collection](input ?? {});
  const need = (k, raw) => { if (!text(raw, 1000)) errors[k] = "required"; };
  const len = (k, raw, max) => { if (typeof raw === "string" && raw.trim().length > max) errors[k] = "too_long"; };
  if (collection === "students") { need("name", input.name); len("name", input.name, MAX.name); len("grade", input.grade, MAX.grade); }
  if (collection === "subjects") {
    need("name", input.name); len("name", input.name, MAX.name);
    if (!input.studentId) errors.studentId = "required";
    if (v.mode === "weekly" && !v.days.length) errors.days = "days";
  }
  if (collection === "logs") { if (!v.date) errors.date = "date"; if (!v.studentId) errors.studentId = "required"; if (!v.subjectId) errors.subjectId = "required"; }
  if (collection === "attendance") { if (!v.date) errors.date = "date"; if (!v.studentId) errors.studentId = "required"; }
  if (collection === "grades") {
    if (!v.date) errors.date = "date"; if (!v.subjectId) errors.subjectId = "required";
    if (v.type === "percent" && v.percent === null) errors.percent = "range";
    if (v.type === "letter" && !v.letter) errors.letter = "required";
  }
  if (collection === "books") { need("title", input.title); len("title", input.title, MAX.bookTitle); if (v.status === "done" && input.finishedOn && !v.finishedOn) errors.finishedOn = "date"; }
  if (collection === "activities") { need("title", input.title); if (!v.date) errors.date = "date"; if (!v.studentIds.length) errors.studentIds = "kids"; }
  return { ok: Object.keys(errors).length === 0, value: v, errors };
}
