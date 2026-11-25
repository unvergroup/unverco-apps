// CSV disa aktarim (saf): ders saati kaydi ve yoklama. Sutun basliklari cagiranin dilinde verilir (labels).
// Formul enjeksiyonu korumasi core/backup.js csvCell'dedir. Dakika sayi olarak yazilir (tablolarda toplanabilsin).
import { toCsv } from "../../../core/backup.js";
import { dayStatus, inYear, schoolDaysFor } from "./calc.js";

const list = (v) => (Array.isArray(v) ? v : []);

/** Ders kayitlari + etkinlikler: date, student, subject, core, minutes, note (tarih sirali). */
export function hoursCsv(data, prefs, L) {
  const kids = new Map(list(data.students).map((s) => [s.id, s]));
  const subj = new Map(list(data.subjects).map((s) => [s.id, s]));
  const rows = [];
  for (const l of list(data.logs)) {
    if (!inYear(l.date, prefs) || !kids.has(l.studentId)) continue;
    const s = subj.get(l.subjectId);
    rows.push({ date: l.date, student: kids.get(l.studentId).name, subject: s ? s.name : "", core: s && s.core ? L.yes : L.no, minutes: l.minutes || 0, note: l.note || "" });
  }
  for (const a of list(data.activities)) {
    if (!inYear(a.date, prefs)) continue;
    for (const id of list(a.studentIds)) if (kids.has(id)) rows.push({ date: a.date, student: kids.get(id).name, subject: a.title, core: a.core ? L.yes : L.no, minutes: a.minutes || 0, note: [L.activity, a.place].filter(Boolean).join(": ") });
  }
  rows.sort((x, y) => x.date.localeCompare(y.date) || x.student.localeCompare(y.student));
  return toCsv(rows, [{ key: "date", label: L.date }, { key: "student", label: L.student }, { key: "subject", label: L.subject }, { key: "core", label: L.core }, { key: "minutes", label: L.minutes }, { key: "note", label: L.note }]);
}

/** Sayilan okul gunleri + acik kayitli tum gunler: date, student, status, counted. */
export function attendanceCsv(data, prefs, L) {
  const rows = [];
  for (const k of list(data.students)) {
    const counted = new Set(schoolDaysFor(data, k.id, prefs));
    const dates = new Set([...counted, ...list(data.attendance).filter((a) => a.studentId === k.id && inYear(a.date, prefs)).map((a) => a.date)]);
    for (const d of [...dates].sort()) {
      const st = dayStatus(data, k.id, d, prefs);
      rows.push({ date: d, student: k.name, status: L.kind(st === "auto" ? "school" : st), counted: counted.has(d) ? L.yes : L.no });
    }
  }
  rows.sort((x, y) => x.date.localeCompare(y.date) || x.student.localeCompare(y.student));
  return toCsv(rows, [{ key: "date", label: L.date }, { key: "student", label: L.student }, { key: "status", label: L.status }, { key: "counted", label: L.counted }]);
}
