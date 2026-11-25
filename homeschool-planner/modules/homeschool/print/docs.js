// Yazdirilabilir belge MODELLERI (saf veri; DOM yok). Cizim print/render.js, tetik core/print.js requestPrint.
// Belge: { id, title, period, sections[], notes[], empty }. section: { kind:"table", heading?, columns:[{ key, label, num? }], rows, total? }
//   | { kind:"kv", heading?, rows:[[etiket, deger, guclu?]] } | { kind:"note", heading?, text } | { kind:"empty", text }.
// L (etiket yardimcilari): { t, tn, formatDate, formatNumber, formatCurrency, dur(dakika), kind(k), status(k), weekday(iso) }.
// Her belgenin notlarinda yasal uyari cumlesi bulunur (hs.legal). "Record summary" resmi transkript DEGILDIR (hs.doc.record.note).
import { addDays } from "../../../core/dates.js";
import { booksFor, dayStatus, gradeSummary, inYear, logsOn, progress, schoolDaysFor, subjectTotals, subjectsOf, weekPlan } from "../logic/calc.js";

const list = (v) => (Array.isArray(v) ? v : []);
const stamp = (L, now) => L.t("hs.doc.generated", { date: L.formatDate(now, { dateStyle: "long" }) });
const legalNotes = (L, now, extra = []) => [...extra, L.t("hs.legal"), stamp(L, now)];
const yearText = (L, prefs) => `${prefs.yearName}: ${L.formatDate(prefs.yearStart, { dateStyle: "long" })} – ${L.formatDate(prefs.yearEnd, { dateStyle: "long" })}`;
const emptyDoc = (L, { id, title, period, now }) => ({ id, title, period, sections: [{ kind: "empty", text: L.t("hs.doc.empty") }], notes: legalNotes(L, now), empty: true });
const targetText = (L, done, target, fmt) => (target > 0 ? L.t("hs.doc.ofTarget", { done: fmt(done), target: fmt(target) }) : fmt(done));

// ---- 1. Haftalik plan ----
export function buildWeekDoc(L, { data, prefs, students, monday, now = new Date() }) {
  const title = L.t("hs.doc.week.title");
  const period = L.t("hs.doc.week.period", { from: L.formatDate(monday, { dateStyle: "long" }), to: L.formatDate(addDays(monday, 6), { dateStyle: "long" }) });
  if (!students.length) return emptyDoc(L, { id: "week", title, period, now });
  const sections = students.map((s) => {
    const rows = weekPlan(data, s, monday, prefs)
      .filter((d) => d.school || d.weekly.length)
      .map((d) => ({
        day: L.formatDate(d.date, { weekday: "short", month: "short", day: "numeric" }),
        lessons: d.weekly.map((x) => x.name).join(", ") || "—",
        loop: d.loop.map((x) => x.name).join(" → ") || "—",
        done: "☐",
      }));
    return {
      kind: "table", heading: [s.name, s.grade].filter(Boolean).join(" · "),
      columns: [{ key: "day", label: L.t("hs.doc.day") }, { key: "lessons", label: L.t("hs.plan.weekly") }, { key: "loop", label: L.t("hs.plan.loop") }, { key: "done", label: L.t("hs.doc.check"), num: true }],
      rows: rows.length ? rows : [{ day: "—", lessons: L.t("hs.plan.noSchoolDays"), loop: "", done: "" }],
    };
  });
  return { id: "week", title, period, sections, notes: legalNotes(L, now, [L.t("hs.doc.week.note")]), empty: false };
}

// ---- 2. Yoklama ve saat kaydi (yil) ----
export function buildAttendanceDoc(L, { data, prefs, students, now = new Date() }) {
  const title = L.t("hs.doc.att.title");
  const period = yearText(L, prefs);
  if (!students.length) return emptyDoc(L, { id: "attendance", title, period, now });
  const subj = new Map(list(data.subjects).map((x) => [x.id, x]));
  const sections = [];
  for (const s of students) {
    const days = schoolDaysFor(data, s.id, prefs);
    const p = progress(data, s.id, prefs, now.toISOString().slice(0, 10));
    sections.push({ kind: "kv", heading: [s.name, s.grade].filter(Boolean).join(" · "), rows: [
      [L.t("hs.prog.days"), targetText(L, p.days, p.targetDays, (n) => L.formatNumber(n)), true],
      [L.t("hs.prog.hours"), targetText(L, p.minutes, p.targetMinutes, L.dur)],
      [L.t("hs.prog.core"), targetText(L, p.coreMinutes, p.targetCoreMinutes, L.dur)],
    ] });
    const rows = days.map((d) => {
      const logs = logsOn(data, s.id, d);
      const acts = list(data.activities).filter((a) => a.date === d && list(a.studentIds).includes(s.id));
      const min = logs.reduce((n, l) => n + (l.minutes || 0), 0) + acts.reduce((n, a) => n + (a.minutes || 0), 0);
      const st = dayStatus(data, s.id, d, prefs);
      return {
        date: L.formatDate(d, { dateStyle: "medium" }),
        kind: L.kind(st === "auto" ? "school" : st),
        what: [...logs.map((l) => subj.get(l.subjectId)?.name ?? "?"), ...acts.map((a) => a.title)].join(", ") || "—",
        time: L.dur(min),
      };
    });
    sections.push({
      kind: "table", heading: L.t("hs.doc.att.daysOf", { name: s.name }),
      columns: [{ key: "date", label: L.t("hs.doc.date") }, { key: "kind", label: L.t("hs.doc.kind") }, { key: "what", label: L.t("hs.doc.what") }, { key: "time", label: L.t("hs.doc.time"), num: true }],
      rows: rows.length ? rows : [{ date: "—", kind: "", what: L.t("hs.doc.empty"), time: "" }],
      total: { label: L.tn("hs.doc.daysCount", days.length), value: L.dur(p.minutes) },
    });
  }
  return { id: "attendance", title, period, sections, notes: legalNotes(L, now), empty: false };
}

// ---- 3. Ders ozeti ----
const subjectRows = (L, data, prefs, s) => {
  const { rows, activities } = subjectTotals(data, s.id, prefs);
  const out = rows.map(({ subject, minutes, lessons }) => {
    const g = gradeSummary(data, subject.id);
    return {
      subject: subject.name, core: subject.core ? L.t("hs.subj.coreShort") : "",
      lessons: L.formatNumber(lessons), hours: L.dur(minutes),
      avg: g.average === null ? "" : `${L.formatNumber(g.average)}%`, final: subject.finalGrade || "",
      resource: subject.resource || "",
    };
  });
  if (activities.count) out.push({ subject: L.t("hs.act.title"), core: "", lessons: L.formatNumber(activities.count), hours: L.dur(activities.minutes), avg: "", final: "", resource: "" });
  return out;
};

export function buildSubjectsDoc(L, { data, prefs, students, now = new Date() }) {
  const title = L.t("hs.doc.subj.title");
  const period = yearText(L, prefs);
  if (!students.length) return emptyDoc(L, { id: "subjects", title, period, now });
  const sections = students.map((s) => {
    const rows = subjectRows(L, data, prefs, s);
    const p = progress(data, s.id, prefs, now.toISOString().slice(0, 10));
    return {
      kind: "table", heading: [s.name, s.grade].filter(Boolean).join(" · "),
      columns: [{ key: "subject", label: L.t("hs.subj.name") }, { key: "core", label: L.t("hs.subj.core") }, { key: "lessons", label: L.t("hs.doc.lessons"), num: true }, { key: "hours", label: L.t("hs.doc.time"), num: true }, { key: "avg", label: L.t("hs.grade.avg"), num: true }, { key: "final", label: L.t("hs.subj.final") }, { key: "resource", label: L.t("hs.subj.resource") }],
      rows: rows.length ? rows : [{ subject: L.t("hs.subj.none"), core: "", lessons: "", hours: "", avg: "", final: "", resource: "" }],
      total: { label: L.t("hs.doc.total"), value: L.dur(p.minutes) },
    };
  });
  return { id: "subjects", title, period, sections, notes: legalNotes(L, now), empty: false };
}

// ---- 4. Okuma listesi ----
export function buildReadingDoc(L, { data, students, studentId = "", now = new Date() }) {
  const title = L.t("hs.doc.read.title");
  const who = studentId ? students.find((s) => s.id === studentId)?.name ?? "" : L.t("hs.allKids");
  const books = booksFor(data, studentId).slice().sort((a, b) => (a.status === b.status ? String(a.title).localeCompare(String(b.title)) : ["done", "reading", "toread"].indexOf(a.status) - ["done", "reading", "toread"].indexOf(b.status)));
  if (!books.length) return emptyDoc(L, { id: "reading", title, period: who, now });
  const names = new Map(list(students).map((s) => [s.id, s.name]));
  const rows = books.map((b) => ({ title: b.title, author: b.author || "", reader: b.studentId ? names.get(b.studentId) ?? "" : L.t("hs.book.family"), status: L.status(b.status), finished: b.finishedOn ? L.formatDate(b.finishedOn) : "" }));
  const done = books.filter((b) => b.status === "done").length;
  return {
    id: "reading", title, period: who,
    sections: [{ kind: "table", columns: [{ key: "title", label: L.t("hs.book.title") }, { key: "author", label: L.t("hs.book.author") }, { key: "reader", label: L.t("hs.book.reader") }, { key: "status", label: L.t("hs.book.status") }, { key: "finished", label: L.t("hs.book.finished") }], rows, total: { label: L.tn("hs.book.doneCount", done), value: "" } }],
    notes: [stamp(L, now)], empty: false,
  };
}

// ---- 5. Portfolyo kapagi + yil ozeti (tek cocuk) ----
export function buildPortfolioDoc(L, { data, prefs, student, school = "", now = new Date() }) {
  const title = L.t("hs.doc.port.title");
  if (!student) return emptyDoc(L, { id: "portfolio", title, period: prefs.yearName, now });
  const p = progress(data, student.id, prefs, now.toISOString().slice(0, 10));
  const acts = list(data.activities).filter((a) => list(a.studentIds).includes(student.id) && inYear(a.date, prefs)).sort((a, b) => a.date.localeCompare(b.date));
  const books = booksFor(data, student.id).filter((b) => b.status === "done");
  const sections = [
    { kind: "kv", heading: L.t("hs.doc.port.student"), rows: [
      [L.t("hs.kid.name"), student.name, true], [L.t("hs.kid.grade"), student.grade || "—"], [L.t("hs.doc.port.school"), school || "—"],
      [L.t("hs.year.name"), prefs.yearName], [L.t("hs.doc.port.dates"), `${L.formatDate(prefs.yearStart, { dateStyle: "long" })} – ${L.formatDate(prefs.yearEnd, { dateStyle: "long" })}`],
    ] },
    { kind: "kv", heading: L.t("hs.doc.port.summary"), rows: [
      [L.t("hs.prog.days"), targetText(L, p.days, p.targetDays, (n) => L.formatNumber(n)), true],
      [L.t("hs.prog.hours"), targetText(L, p.minutes, p.targetMinutes, L.dur)],
      [L.t("hs.prog.core"), targetText(L, p.coreMinutes, p.targetCoreMinutes, L.dur)],
      [L.t("hs.doc.port.books"), L.formatNumber(books.length)], [L.t("hs.doc.port.acts"), L.formatNumber(acts.length)],
    ] },
    { kind: "table", heading: L.t("hs.doc.subj.title"), columns: [{ key: "subject", label: L.t("hs.subj.name") }, { key: "hours", label: L.t("hs.doc.time"), num: true }, { key: "final", label: L.t("hs.subj.final") }, { key: "resource", label: L.t("hs.subj.resource") }], rows: subjectRows(L, data, prefs, student) },
  ];
  if (books.length) sections.push({ kind: "table", heading: L.t("hs.doc.read.title"), columns: [{ key: "title", label: L.t("hs.book.title") }, { key: "author", label: L.t("hs.book.author") }, { key: "finished", label: L.t("hs.book.finished") }], rows: books.map((b) => ({ title: b.title, author: b.author || "", finished: b.finishedOn ? L.formatDate(b.finishedOn) : "" })) });
  if (acts.length) sections.push({ kind: "table", heading: L.t("hs.act.title"), columns: [{ key: "date", label: L.t("hs.doc.date") }, { key: "title", label: L.t("hs.act.name") }, { key: "place", label: L.t("hs.act.place") }, { key: "time", label: L.t("hs.doc.time"), num: true }], rows: acts.map((a) => ({ date: L.formatDate(a.date), title: a.title, place: a.place || "", time: L.dur(a.minutes) })) });
  sections.push({ kind: "note", heading: L.t("hs.doc.port.samples"), text: L.t("hs.doc.port.samplesText") });
  return { id: "portfolio", title, period: `${student.name} · ${prefs.yearName}`, sections, notes: legalNotes(L, now), empty: false };
}

// ---- 6. Kayit ozeti (transkript benzeri; resmi DEGIL) ----
export function buildRecordDoc(L, { data, prefs, students, school = "", now = new Date() }) {
  const title = L.t("hs.doc.record.title");
  const period = yearText(L, prefs);
  if (!students.length) return emptyDoc(L, { id: "record", title, period, now });
  const sections = [];
  for (const s of students) {
    const p = progress(data, s.id, prefs, now.toISOString().slice(0, 10));
    sections.push({ kind: "kv", heading: [s.name, s.grade].filter(Boolean).join(" · "), rows: [
      [L.t("hs.doc.port.school"), school || "—"], [L.t("hs.prog.days"), L.formatNumber(p.days)], [L.t("hs.prog.hours"), L.dur(p.minutes)], [L.t("hs.prog.core"), L.dur(p.coreMinutes)],
    ] });
    const rows = subjectsOf(data, s.id).map((x) => {
      const t = subjectTotals(data, s.id, prefs).rows.find((r) => r.subject.id === x.id);
      const g = gradeSummary(data, x.id);
      return { subject: x.name, core: x.core ? L.t("hs.subj.coreShort") : "", hours: L.dur(t ? t.minutes : 0), grade: x.finalGrade || (g.average === null ? "—" : `${L.formatNumber(g.average)}%`) };
    });
    sections.push({ kind: "table", columns: [{ key: "subject", label: L.t("hs.subj.name") }, { key: "core", label: L.t("hs.subj.core") }, { key: "hours", label: L.t("hs.doc.time"), num: true }, { key: "grade", label: L.t("hs.doc.record.grade"), num: true }], rows: rows.length ? rows : [{ subject: L.t("hs.subj.none"), core: "", hours: "", grade: "" }] });
  }
  return { id: "record", title, period, sections, notes: legalNotes(L, now, [L.t("hs.doc.record.note")]), empty: false };
}
