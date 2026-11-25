// Homeschool Planner hesaplari (saf islevler; DOM / depo yok). Kurallar: projeler/016-homeschool/spec/spec.md bolum 4.
// data: { students, subjects, logs, attendance, grades, books, activities } (dizi). prefs: okul yili ayarlari (core/settings.js sanitizePrefs).
// weekday: 0 = Pazartesi ... 6 = Pazar (core/dates.js).
import { addDays, compareIso, weekday } from "../../../core/dates.js";
import { COUNTED_KINDS } from "./schema.js";

const list = (v) => (Array.isArray(v) ? v : []);
export const inYear = (iso, prefs) => Boolean(iso) && (!prefs.yearStart || iso >= prefs.yearStart) && (!prefs.yearEnd || iso <= prefs.yearEnd);
const byOrder = (a, b) => (a.loopOrder ?? 0) - (b.loopOrder ?? 0) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.id).localeCompare(String(b.id));
const byName = (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" });

export const studentsSorted = (data) => list(data.students).slice().sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || byName(a, b));
export const subjectsOf = (data, studentId) => list(data.subjects).filter((s) => s.studentId === studentId).sort((a, b) => (a.mode === b.mode ? (a.mode === "loop" ? byOrder(a, b) : byName(a, b)) : a.mode === "weekly" ? -1 : 1));
export const loopSubjects = (data, studentId) => list(data.subjects).filter((s) => s.studentId === studentId && s.mode === "loop").sort(byOrder);
export const weeklyFor = (data, studentId, iso) => list(data.subjects).filter((s) => s.studentId === studentId && s.mode === "weekly" && s.days.includes(weekday(iso))).sort(byName);
export const logsOn = (data, studentId, iso) => list(data.logs).filter((l) => l.studentId === studentId && l.date === iso);
export const attendanceOf = (data, studentId, iso) => list(data.attendance).find((a) => a.studentId === studentId && a.date === iso) ?? null;
export const activitiesOf = (data, studentId) => list(data.activities).filter((a) => list(a.studentIds).includes(studentId));

// ---- Okul gunu kurali ----
// Doner: "school" | "field" | "sick" | "break" (acik kayit) | "auto" (kayit yok ama ders/etkinlik var ve otomatik yoklama acik) | null.
export function dayStatus(data, studentId, iso, prefs) {
  const rec = attendanceOf(data, studentId, iso);
  if (rec) return rec.kind;
  if (prefs.autoAttendance === false) return null;
  const any = list(data.logs).some((l) => l.studentId === studentId && l.date === iso) || activitiesOf(data, studentId).some((a) => a.date === iso);
  return any ? "auto" : null;
}
export const counts = (status) => status === "auto" || COUNTED_KINDS.includes(status);

/** Okul yili icinde sayilan gunler (artan sirali). to: bu gune kadar (dahil). */
export function schoolDaysFor(data, studentId, prefs, { to } = {}) {
  const cand = new Set();
  for (const a of list(data.attendance)) if (a.studentId === studentId) cand.add(a.date);
  if (prefs.autoAttendance !== false) {
    for (const l of list(data.logs)) if (l.studentId === studentId) cand.add(l.date);
    for (const a of activitiesOf(data, studentId)) cand.add(a.date);
  }
  return [...cand].filter((d) => inYear(d, prefs) && (!to || d <= to) && counts(dayStatus(data, studentId, d, prefs))).sort(compareIso);
}

// ---- Saatler (dakika olarak) ----
export function minutesFor(data, studentId, prefs, { core = false, to } = {}) {
  const subj = new Map(list(data.subjects).map((s) => [s.id, s]));
  let m = 0;
  for (const l of list(data.logs)) {
    if (l.studentId !== studentId || !inYear(l.date, prefs) || (to && l.date > to)) continue;
    if (core && !subj.get(l.subjectId)?.core) continue;
    m += l.minutes || 0;
  }
  for (const a of activitiesOf(data, studentId)) {
    if (!inYear(a.date, prefs) || (to && a.date > to) || (core && !a.core)) continue;
    m += a.minutes || 0;
  }
  return m;
}

/** Ders bazli toplam: [{ subject, minutes, lessons }] (cocugun tum dersleri, kayit olmasa da). Etkinlikler ayri satir: activities. */
export function subjectTotals(data, studentId, prefs) {
  const rows = subjectsOf(data, studentId).map((s) => ({ subject: s, minutes: 0, lessons: 0 }));
  const by = new Map(rows.map((r) => [r.subject.id, r]));
  for (const l of list(data.logs)) {
    if (l.studentId !== studentId || !inYear(l.date, prefs)) continue;
    const r = by.get(l.subjectId);
    if (r) { r.minutes += l.minutes || 0; r.lessons += 1; }
  }
  const acts = activitiesOf(data, studentId).filter((a) => inYear(a.date, prefs));
  return { rows, activities: { count: acts.length, minutes: acts.reduce((s, a) => s + (a.minutes || 0), 0), coreMinutes: acts.filter((a) => a.core).reduce((s, a) => s + (a.minutes || 0), 0) } };
}

/** Yarindan yil sonuna kadar kalan okul gunleri (ayardaki hafta gunleri). Yil sonu yoksa 0. */
export function remainingSchoolDays(today, prefs) {
  if (!prefs.yearEnd || today >= prefs.yearEnd) return 0;
  let d = addDays(today, 1);
  if (prefs.yearStart && d < prefs.yearStart) d = prefs.yearStart;
  let n = 0;
  for (let i = 0; d <= prefs.yearEnd && i < 800; i++, d = addDays(d, 1)) if (prefs.schoolDays.includes(weekday(d))) n++;
  return n;
}

const pct = (done, target) => (target > 0 ? Math.min(100, Math.round((done / target) * 1000) / 10) : null);

/** Hedefe ilerleme. Hedef 0 = yok (yuzde null). perWeekMin: hedef saate ulasmak icin haftada gereken dakika (yoksa null). */
export function progress(data, studentId, prefs, today) {
  const days = schoolDaysFor(data, studentId, prefs).length;
  const minutes = minutesFor(data, studentId, prefs);
  const coreMinutes = minutesFor(data, studentId, prefs, { core: true });
  const remainingDays = remainingSchoolDays(today, prefs);
  const tH = (prefs.targetHours || 0) * 60;
  const tC = (prefs.targetCoreHours || 0) * 60;
  const leftMin = Math.max(0, tH - minutes);
  const perWeekMin = tH > 0 && leftMin > 0 && remainingDays > 0 ? Math.ceil((leftMin / remainingDays) * prefs.schoolDays.length) : tH > 0 && leftMin === 0 ? 0 : null;
  return {
    days, minutes, coreMinutes, remainingDays,
    targetDays: prefs.targetDays || 0, targetMinutes: tH, targetCoreMinutes: tC,
    daysPct: pct(days, prefs.targetDays || 0), hoursPct: pct(minutes, tH), corePct: pct(coreMinutes, tC),
    daysLeft: Math.max(0, (prefs.targetDays || 0) - days), minutesLeft: leftMin, coreLeft: Math.max(0, tC - coreMinutes), perWeekMin,
  };
}

// ---- Loop ----
/** D gununden ONCEKI son loop kaydinin dersi (yoksa null). Ayni gunde birden cok ise en son eklenen. */
export function lastLoopBefore(data, studentId, iso) {
  const ids = new Set(loopSubjects(data, studentId).map((s) => s.id));
  let best = null;
  for (const l of list(data.logs)) {
    if (l.studentId !== studentId || !ids.has(l.subjectId) || l.date >= iso) continue;
    if (!best || l.date > best.date || (l.date === best.date && String(l.createdAt ?? "") > String(best.createdAt ?? ""))) best = l;
  }
  return best ? best.subjectId : null;
}

/** Sirali dongu penceresi: start'tan n ders (donerek, tekrarsiz). */
export function loopSlice(loop, start, n) {
  const k = Math.min(Math.max(0, n), loop.length);
  return Array.from({ length: k }, (_, i) => loop[(start + i) % loop.length]);
}

/** D gununun loop penceresi (gun icinde kaymaz). */
export function loopWindow(data, student, iso) {
  const loop = loopSubjects(data, student.id);
  if (!loop.length) return [];
  const last = lastLoopBefore(data, student.id, iso);
  const i = last ? loop.findIndex((s) => s.id === last) : -1;
  return loopSlice(loop, i + 1, student.loopPerDay ?? 0);
}

/** Bugun listesi: [{ subject, kind: "weekly"|"loop"|"extra", log }]. Pencere disindaki bugunku kayitlar "extra" olarak eklenir. */
export function dayPlan(data, student, iso) {
  const logs = logsOn(data, student.id, iso);
  const used = new Set();
  const take = (s) => { const l = logs.find((x) => x.subjectId === s.id && !used.has(x.id)); if (l) used.add(l.id); return l ?? null; };
  const items = [];
  for (const s of weeklyFor(data, student.id, iso)) items.push({ subject: s, kind: "weekly", log: take(s) });
  for (const s of loopWindow(data, student, iso)) if (!items.some((x) => x.subject.id === s.id)) items.push({ subject: s, kind: "loop", log: take(s) });
  const subj = new Map(list(data.subjects).map((s) => [s.id, s]));
  for (const l of logs) if (!used.has(l.id)) items.push({ subject: subj.get(l.subjectId) ?? null, kind: "extra", log: l });
  return items;
}

/** Haftalik plan (pazartesiden 7 gun): [{ date, school, weekly: [ders], loop: [ders] }]. Loop, haftanin basindaki yerden okul gunu basina n ilerler. */
export function weekPlan(data, student, monday, prefs) {
  const loop = loopSubjects(data, student.id);
  const last = lastLoopBefore(data, student.id, monday);
  let start = last ? loop.findIndex((s) => s.id === last) + 1 : 0;
  const n = student.loopPerDay ?? 0;
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const school = prefs.schoolDays.includes(weekday(d));
    const lp = school && loop.length ? loopSlice(loop, start, n) : [];
    if (school && loop.length) start = (start + Math.min(n, loop.length)) % loop.length;
    out.push({ date: d, school, weekly: weeklyFor(data, student.id, d), loop: lp });
  }
  return out;
}

/** Loop'ta bir sonraki ders (bugunden once yapilana gore). */
export function nextLoopId(data, student, iso) {
  return loopWindow(data, { ...student, loopPerDay: 1 }, iso)[0]?.id ?? null;
}

// ---- Notlar ----
export function gradeSummary(data, subjectId) {
  const gs = list(data.grades).filter((g) => g.subjectId === subjectId);
  const ps = gs.filter((g) => g.type === "percent" && typeof g.percent === "number");
  const avg = ps.length ? Math.round((ps.reduce((s, g) => s + g.percent, 0) / ps.length) * 10) / 10 : null;
  return { count: gs.length, average: avg };
}

/** Kitaplar: cocuga ait ya da tum aileye ("" studentId). */
export const booksFor = (data, studentId) => list(data.books).filter((b) => !studentId || b.studentId === studentId || b.studentId === "");

/** Dakika -> { h, m } */
export const hm = (min) => ({ h: Math.floor((min || 0) / 60), m: (min || 0) % 60 });
