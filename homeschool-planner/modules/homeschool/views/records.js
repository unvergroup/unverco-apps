// Kayitlar ekrani (#/records): sekmeler Progress | Attendance | Grades.
// Progress: cocuk basina gun / saat / temel saat (kullanicinin KENDI hedefine gore), haftalik gereken, ders bazli saat; dort belge yazdirma.
// Attendance: cocuk + ay secici, ay izgarasi (dokun -> durum dongusu: - / School / Field trip / Sick / Break), sayaclar.
// Grades: not listesi, ekle / duzenle / sil (yuzde ya da harf), ders ortalamasi. Yasal uyari cumlesi her sekmede.
import { addDays, addMonths, daysInMonth, todayIso, toIso, weekday } from "../../../core/dates.js";
import { button, createTabs, field, h } from "../../../core/ui.js";
import { ATT_KINDS, GRADE_TYPES, LETTERS, MAX, RECORD_LIMITS, parsePercent, validate } from "../logic/schema.js";
import { attendanceOf, counts, dayStatus, gradeSummary, inYear, progress, schoolDaysFor, subjectTotals, subjectsOf } from "../logic/calc.js";
import { printAttendance, printPortfolio, printRecord, printSubjects } from "../print/screens.js";
import { colorIndex, dur, errText, kidDot, kidPicker, legalNote, loadAll, noKids, openForm, progressBar, radioGroup, selectField, fill, emptyBox } from "./common.js";

const CYCLE = ["", ...ATT_KINDS]; // dokunma dongusu

async function openGradeForm(ctx, data, { student, grade = null }) {
  const { t } = ctx.i18n;
  const subs = subjectsOf(data, student.id);
  const g = grade ?? { subjectId: subs[0]?.id ?? "", date: todayIso(), title: "", type: "percent", percent: null, letter: "" };
  const subject = selectField({ id: "grd-subject", label: t("hs.subj.name"), value: g.subjectId, options: subs.map((s) => ({ value: s.id, label: s.name })) });
  const when = field({ id: "grd-date", label: t("hs.doc.date"), type: "date", value: g.date });
  const title = field({ id: "grd-title", label: t("hs.grade.what"), value: g.title, maxlength: MAX.title, hint: t("hs.grade.whatHint") });
  const type = radioGroup({ legend: t("hs.grade.type"), name: "grd-type", value: g.type, items: GRADE_TYPES.map((k) => ({ value: k, label: t(`hs.grade.${k}`) })) });
  const pct = field({ id: "grd-percent", label: t("hs.grade.percentLabel"), value: g.percent === null ? "" : String(g.percent).replace(".", ctx.i18n.decimal), inputmode: "decimal", autocomplete: "off" });
  const letter = selectField({ id: "grd-letter", label: t("hs.grade.letterLabel"), value: g.letter || "A", options: LETTERS.map((l) => ({ value: l, label: l })) });
  const sync = () => { pct.element.hidden = type.value() !== "percent"; letter.element.hidden = type.value() !== "letter"; };
  for (const r of type.radios) r.addEventListener("change", sync);
  sync();
  const extra = grade ? [button({ id: "grd-delete", label: t("common.delete"), variant: "danger", onClick: async () => {
    if (!(await ctx.confirm({ title: t("hs.grade.deleteTitle"), message: t("hs.grade.deleteText") }))) return;
    await ctx.store.remove("grades", grade.id); document.querySelector("dialog.form-dialog[open]")?.close(); ctx.refresh();
  } })] : [];
  return openForm(ctx, {
    title: grade ? t("hs.grade.edit") : t("hs.grade.add"), extraActions: extra,
    groups: [{ legend: student.name, nodes: [subject.element, when.element, title.element, type.element, pct.element, letter.element] }],
    onSave: async () => {
      const isPct = type.value() === "percent";
      const p = isPct ? parsePercent(pct.input.value) : { ok: true, value: null };
      pct.setError(p.ok ? "" : errText(ctx, "range", { min: 0, max: 100 }));
      const v = validate("grades", { studentId: student.id, subjectId: subject.input.value, date: when.input.value, title: title.input.value, type: type.value(), percent: p.value, letter: letter.input.value });
      when.setError(v.errors.date ? errText(ctx, "date") : "");
      if (!v.ok || !p.ok) return false;
      if (grade) await ctx.store.update("grades", grade.id, v.value);
      else await ctx.store.add("grades", v.value, { check: (n) => { if (n >= RECORD_LIMITS.grades) throw Object.assign(new Error("limit"), { code: "limit_reached" }); } });
      ctx.notify(t("hs.saved"), "success");
      return true;
    },
  });
}

export async function mountRecords(ctx, root, param) {
  const { t, tn, formatDate, formatNumber } = ctx.i18n;
  const today = todayIso();
  let { data, prefs } = await loadAll(ctx);
  let tab = "progress";
  let sel = data.students.some((s) => s.id === param) ? param : data.students[0]?.id ?? "";
  let month = today.slice(0, 7);
  let busy = false;
  const body = h("div", { class: "stack" });
  const reload = async () => { ({ data, prefs } = await loadAll(ctx)); paint(); };
  ctx.onExternalChange(reload);
  const biz = await ctx.business.get();
  const school = biz.name || "";

  const target = (done, tgt, fmt) => (tgt > 0 ? t("hs.doc.ofTarget", { done: fmt(done), target: fmt(tgt) }) : fmt(done));

  function paintProgress() {
    const kids = data.students;
    const cards = kids.map((s) => {
      const p = progress(data, s.id, prefs, today);
      const tot = subjectTotals(data, s.id, prefs);
      return h("section", { class: `card kid-card kid-c${colorIndex(s.color)}`, "data-kid": s.id, id: `prog-${s.id}` },
        h("div", { class: "kid-head" }, h("h3", {}, h("span", { class: "kid-name" }, kidDot(s), h("span", { text: s.name })), s.grade ? h("span", { class: "muted kid-grade", text: s.grade }) : null)),
        progressBar({ id: `prog-days-${s.id}`, label: t("hs.prog.days"), value: target(p.days, p.targetDays, (n) => formatNumber(n)), pct: p.daysPct }),
        progressBar({ id: `prog-hours-${s.id}`, label: t("hs.prog.hours"), value: target(p.minutes, p.targetMinutes, (m) => dur(ctx, m)), pct: p.hoursPct }),
        progressBar({ id: `prog-core-${s.id}`, label: t("hs.prog.core"), value: target(p.coreMinutes, p.targetCoreMinutes, (m) => dur(ctx, m)), pct: p.corePct }),
        h("p", { class: "muted", id: `prog-pace-${s.id}`, text: p.targetMinutes > 0 ? (p.perWeekMin === 0 ? t("hs.prog.reached") : p.perWeekMin === null ? t("hs.prog.noDaysLeft") : t("hs.prog.pace", { time: dur(ctx, p.perWeekMin), days: formatNumber(p.remainingDays) })) : t("hs.prog.noTarget") }),
        h("details", { class: "subject-hours" }, h("summary", { text: t("hs.prog.bySubject") }),
          h("ul", { class: "mini-list" }, ...tot.rows.map((r) => h("li", {}, h("span", { text: r.subject.name }), h("span", { class: "muted", text: `${tn("hs.doc.lessonsCount", r.lessons)} · ${dur(ctx, r.minutes)}` }))),
            tot.activities.count ? h("li", {}, h("span", { text: t("hs.act.title") }), h("span", { class: "muted", text: dur(ctx, tot.activities.minutes) })) : null)));
    });
    const kidsSel = (all) => (all ? data.students : data.students.filter((s) => s.id === sel));
    fill(body, 
      legalNote(ctx, "rec-legal"),
      h("p", { class: "muted", id: "rec-year", text: `${prefs.yearName}: ${formatDate(prefs.yearStart, { dateStyle: "medium" })} – ${formatDate(prefs.yearEnd, { dateStyle: "medium" })}` }),
      prefs.targetDays || prefs.targetHours ? null : h("p", { class: "banner banner-info", id: "rec-set-target" }, h("span", { text: t("hs.prog.setTarget") }), " ", h("a", { href: "#/settings", text: t("hs.prog.setTargetLink") })),
      h("div", { class: "card stack", id: "rec-print" },
        h("h3", { text: t("hs.rec.printTitle") }),
        h("p", { class: "muted", text: t("hs.rec.printHint") }),
        h("div", { class: "row" },
          button({ id: "rec-print-att", label: t("hs.doc.att.title"), glyph: "print", exportAction: true, onClick: () => printAttendance(ctx, { data, prefs, students: kidsSel(true) }) }),
          button({ id: "rec-print-subj", label: t("hs.doc.subj.title"), glyph: "print", exportAction: true, onClick: () => printSubjects(ctx, { data, prefs, students: kidsSel(true) }) }),
          button({ id: "rec-print-record", label: t("hs.doc.record.title"), glyph: "print", exportAction: true, onClick: () => printRecord(ctx, { data, prefs, students: kidsSel(true), school }) })),
        h("div", { class: "row" },
          h("label", { for: "rec-port-kid", class: "muted", text: t("hs.doc.port.title") }),
          h("select", { id: "rec-port-kid", class: "status-select", "aria-label": t("hs.kid.pick") }, ...data.students.map((s) => h("option", { value: s.id, text: s.name, selected: s.id === sel }))),
          button({ id: "rec-print-port", label: t("hs.rec.printPortfolio"), glyph: "print", variant: "primary", exportAction: true, onClick: () => {
            const id = document.getElementById("rec-port-kid").value;
            printPortfolio(ctx, { data, prefs, student: data.students.find((s) => s.id === id), school });
          } }))),
      h("div", { class: "kid-grid" }, ...cards));
  }

  const cycle = (kid, iso) => async () => {
    if (busy) return;
    busy = true;
    try {
      const rec = attendanceOf(data, kid.id, iso);
      const next = CYCLE[(CYCLE.indexOf(rec ? rec.kind : "") + 1) % CYCLE.length];
      if (!next) await ctx.store.remove("attendance", rec.id);
      else if (rec) await ctx.store.update("attendance", rec.id, { kind: next });
      else await ctx.store.add("attendance", { date: iso, studentId: kid.id, kind: next });
      await reload();
      document.querySelector(`[data-date="${iso}"]`)?.focus();
    } catch (e) { ctx.fail(e); } finally { busy = false; }
  };

  function paintAttendance() {
    const kid = data.students.find((s) => s.id === sel);
    const [y, m] = month.split("-").map(Number);
    const first = toIso(y, m, 1);
    const n = daysInMonth(y, m);
    const lead = weekday(first);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h("span", { class: "cal-cell cal-out", "aria-hidden": "true" }));
    let monthCount = 0;
    for (let d = 1; d <= n; d++) {
      const iso = toIso(y, m, d);
      const st = dayStatus(data, kid.id, iso, prefs);
      const inside = inYear(iso, prefs);
      if (inside && counts(st)) monthCount++;
      const label = `${formatDate(iso, { dateStyle: "full" })}: ${st ? t(`hs.att.${st}`) : t("hs.att.none")}`;
      cells.push(h("button", { type: "button", class: `cal-cell att-${st || "none"}${iso === today ? " cal-today" : ""}${inside ? "" : " is-outside"}`, "data-date": iso, "aria-label": label, title: label, on: { click: cycle(kid, iso) } },
        h("span", { class: "cal-day", text: formatNumber(d) }), st ? h("span", { class: "att-mark", "aria-hidden": "true", text: t(`hs.att.short.${st}`) }) : null));
    }
    const yearCount = schoolDaysFor(data, kid.id, prefs).length;
    const weekdays = [0, 1, 2, 3, 4, 5, 6].map((d) => h("span", { class: "cal-head", text: t(`hs.day.${d}`) }));
    fill(body, 
      legalNote(ctx, "att-legal"),
      kidPicker(ctx, { students: data.students, selected: sel, onPick: (id) => { sel = id; paint(); } }),
      h("div", { class: "row toolbar" },
        button({ id: "att-prev", icon: "prev", ariaLabel: t("hs.att.prevMonth"), label: "", onClick: () => { month = addMonths(first, -1).slice(0, 7); paint(); } }),
        h("strong", { id: "att-month", class: "att-month", text: formatDate(first, { month: "long", year: "numeric" }) }),
        button({ id: "att-next", icon: "next", ariaLabel: t("hs.att.nextMonth"), label: "", onClick: () => { month = addMonths(first, 1).slice(0, 7); paint(); } })),
      h("p", { class: "muted", id: "att-hint", text: t("hs.att.tapHint") }),
      h("p", { class: "muted", id: "att-sick-note", text: t("hs.att.sickNote") }),
      h("div", { class: `att-cal kid-c${colorIndex(kid.color)}`, id: "att-cal", role: "group", "aria-label": t("hs.att.calendar", { name: kid.name }) }, ...weekdays, ...cells),
      h("ul", { class: "att-legend", "aria-label": t("hs.att.legend") }, ...["auto", ...ATT_KINDS].map((k) => h("li", {}, h("span", { class: `att-swatch att-${k}`, "aria-hidden": "true", text: t(`hs.att.short.${k}`) }), h("span", { text: t(`hs.att.${k}`) })))),
      h("p", { class: "count-pill att-counts", id: "att-counts", role: "status" },
        ...t("hs.att.counts", { month: formatNumber(monthCount), year: formatNumber(yearCount) }).split(" · ").map((part) => h("span", { text: part }))));
  }

  function paintGrades() {
    const kid = data.students.find((s) => s.id === sel);
    const subs = subjectsOf(data, kid.id);
    const names = new Map(subs.map((s) => [s.id, s.name]));
    const gs = data.grades.filter((g) => g.studentId === kid.id).sort((a, b) => b.date.localeCompare(a.date));
    fill(body, 
      kidPicker(ctx, { students: data.students, selected: sel, onPick: (id) => { sel = id; paint(); } }),
      h("p", { class: "muted", text: t("hs.grade.intro") }),
      h("div", { class: "row toolbar" }, subs.length
        ? button({ id: "grd-add", label: t("hs.grade.add"), glyph: "plus", variant: "primary", onClick: async () => { if (await openGradeForm(ctx, data, { student: kid })) await reload(); } })
        : h("a", { class: "btn", href: `#/kids/${encodeURIComponent(kid.id)}`, text: t("hs.subj.add") })),
      subs.length ? h("ul", { class: "mini-list", id: "grd-avg" }, ...subs.map((s) => {
        const sum = gradeSummary(data, s.id);
        return h("li", {}, h("span", { text: s.name }), h("span", { class: "muted", text: [sum.average === null ? "" : t("hs.grade.avgLine", { avg: formatNumber(sum.average) }), s.finalGrade ? t("hs.grade.finalLine", { g: s.finalGrade }) : "", tn("hs.grade.count", sum.count)].filter(Boolean).join(" · ") }));
      })) : null,
      gs.length ? h("ul", { class: "item-list", id: "grd-list" }, ...gs.map((g) => h("li", {}, h("button", { type: "button", class: "item-row", "data-grade": g.id, on: { click: async () => { if (await openGradeForm(ctx, data, { student: kid, grade: g })) await reload(); } } },
        h("span", { class: "item-main" }, h("strong", { text: names.get(g.subjectId) ?? t("hs.subj.deleted") }), h("span", { class: "muted", text: [formatDate(g.date), g.title].filter(Boolean).join(" · ") })),
        h("span", { class: "badge", text: g.type === "percent" ? `${formatNumber(g.percent)}%` : g.letter })))))
        : emptyBox({ icon: "chart", title: t("hs.grade.emptyTitle"), text: t("hs.grade.emptyText") }));
  }

  function paint() {
    if (!data.students.length) { fill(root, h("h2", { text: t("hs.nav.records") }), noKids(ctx)); return; }
    if (!data.students.some((s) => s.id === sel)) sel = data.students[0].id;
    const tabs = createTabs({ label: t("hs.nav.records"), selected: tab, items: [{ id: "progress", label: t("hs.rec.progress") }, { id: "attendance", label: t("hs.rec.attendance") }, { id: "grades", label: t("hs.rec.grades") }], onSelect: (id) => { tab = id; paint(); } });
    fill(root, h("div", { class: "page-head" }, h("h2", { text: t("hs.nav.records") })), tabs.element, body);
    if (tab === "progress") paintProgress(); else if (tab === "attendance") paintAttendance(); else paintGrades();
  }
  void addDays;
  paint();
}
