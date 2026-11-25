// Bugun ekrani (#/today[/<tarih>]): tarih ileri / geri (gecmis gune kayit), "tum cocuklara okul gunu", grup dersi / gezi,
// cocuk basina renkli kart: gun durumu, planli dersler (haftalik + loop penceresi), TEK DOKUNUS "Done" (ikinci dokunus geri alir),
// sure duzenleme, ek ders. Kurallar: logic/calc.js dayPlan / dayStatus.
import { addDays, isIsoDate, todayIso, weekday } from "../../../core/dates.js";
import { button, field, h } from "../../../core/ui.js";
import { ATT_KINDS, MINUTES, parseIntText } from "../logic/schema.js";
import { attendanceOf, dayPlan, dayStatus, subjectsOf } from "../logic/calc.js";
import { colorIndex, dur, errText, kidName, loadAll, noKids, openForm, selectField, fill } from "./common.js";
import { openActivityForm } from "./library.js";

export async function mountToday(ctx, root, param) {
  const { t, formatDate } = ctx.i18n;
  const today = todayIso();
  let day = param && isIsoDate(param) ? param : today;
  let { data, prefs } = await loadAll(ctx);
  let busy = false;

  const reload = async () => { ({ data, prefs } = await loadAll(ctx)); paint(); };
  ctx.onExternalChange(reload);
  const act = (fn) => async () => {
    if (busy) return;
    busy = true;
    try { await fn(); await reload(); } catch (e) { ctx.fail(e); } finally { busy = false; }
  };
  const go = (d) => { location.hash = d === today ? "#/today" : `#/today/${d}`; };

  const setStatus = (studentId, kind) => act(async () => {
    const rec = attendanceOf(data, studentId, day);
    if (!kind) { if (rec) await ctx.store.remove("attendance", rec.id); return; }
    if (rec) await ctx.store.update("attendance", rec.id, { kind });
    else await ctx.store.add("attendance", { date: day, studentId, kind });
  })();

  const toggleDone = (student, item) => act(async () => {
    if (item.log) await ctx.store.remove("logs", item.log.id);
    else await ctx.store.add("logs", { date: day, studentId: student.id, subjectId: item.subject.id, minutes: item.subject.minutes ?? prefs.defaultMinutes, note: "" });
  })();

  // Sure / not duzenleme (yapilmis ders) ve ek ders (planda olmayan) ayni form.
  const openLogForm = async (student, { log = null, subjectId = "" } = {}) => {
    const subs = subjectsOf(data, student.id);
    if (!subs.length) { ctx.navigate(`kids/${student.id}`); return; }
    const subSel = selectField({ id: "log-subject", label: t("hs.subj.name"), value: log ? log.subjectId : subjectId || subs[0].id, options: subs.map((s) => ({ value: s.id, label: s.name })) });
    const first = subs.find((s) => s.id === (log ? log.subjectId : subSel.input.value));
    const minutes = field({ id: "log-minutes", label: t("hs.log.minutes"), value: String(log ? log.minutes : first?.minutes ?? prefs.defaultMinutes), inputmode: "numeric", autocomplete: "off", hint: t("hs.log.minutesHint", { max: MINUTES.logMax }) });
    subSel.input.addEventListener("change", () => { if (!log) minutes.input.value = String(subs.find((s) => s.id === subSel.input.value)?.minutes ?? prefs.defaultMinutes); });
    const note = field({ id: "log-note", label: t("hs.log.note"), value: log?.note ?? "", maxlength: 300 });
    const extra = log ? [button({ id: "log-delete", label: t("hs.log.undo"), variant: "danger", onClick: async () => { await ctx.store.remove("logs", log.id); document.querySelector("dialog[open]")?.close(); await reload(); } })] : [];
    const ok = await openForm(ctx, {
      title: log ? t("hs.log.edit") : t("hs.log.extra"), extraActions: extra,
      groups: [{ legend: `${student.name} · ${formatDate(day, { dateStyle: "medium" })}`, nodes: [subSel.element, minutes.element, note.element] }],
      onSave: async () => {
        const m = parseIntText(minutes.input.value, 0, MINUTES.logMax);
        minutes.setError(m.ok ? "" : errText(ctx, m.error, m));
        if (!m.ok) return false;
        const rec = { date: day, studentId: student.id, subjectId: subSel.input.value, minutes: m.value, note: note.input.value };
        if (log) await ctx.store.update("logs", log.id, rec); else await ctx.store.add("logs", rec);
        return true;
      },
    });
    if (ok) { ctx.notify(t("hs.saved"), "success"); await reload(); }
  };

  const markAll = act(async () => {
    for (const s of data.students) if (!attendanceOf(data, s.id, day)) await ctx.store.add("attendance", { date: day, studentId: s.id, kind: "school" });
    ctx.notify(t("hs.today.allMarked"), "success");
  });

  function kidCard(s) {
    const items = dayPlan(data, s, day);
    const st = dayStatus(data, s.id, day, prefs);
    const rec = attendanceOf(data, s.id, day);
    const total = items.reduce((n, x) => n + (x.log ? x.log.minutes || 0 : 0), 0)
      + data.activities.filter((a) => a.date === day && a.studentIds.includes(s.id)).reduce((n, a) => n + (a.minutes || 0), 0);
    const statusSel = h("select", { id: `td-status-${s.id}`, class: "status-select", "aria-label": t("hs.att.label", { name: s.name }), on: { change: (e) => setStatus(s.id, e.target.value) } },
      h("option", { value: "", text: st === "auto" ? t("hs.att.auto") : t("hs.att.none"), selected: !rec }),
      ...ATT_KINDS.map((k) => h("option", { value: k, text: t(`hs.att.${k}`), selected: rec?.kind === k })));
    const rows = items.map((x) => {
      const done = Boolean(x.log);
      const name = x.subject ? x.subject.name : t("hs.subj.deleted");
      const sid = x.subject ? x.subject.id : x.log.subjectId;
      return h("li", { class: `lesson${done ? " is-done" : ""}`, "data-subject": sid, "data-kind": x.kind },
        h("button", {
          type: "button", class: "btn btn-done", id: `done-${s.id}-${sid}`, "aria-pressed": String(done),
          "aria-label": done ? t("hs.today.undoAria", { subject: name }) : t("hs.today.doneAria", { subject: name }),
          disabled: !x.subject && !done,
          on: { click: () => (x.subject ? toggleDone(s, x) : act(() => ctx.store.remove("logs", x.log.id))()) },
        }, h("span", { class: "done-box", "aria-hidden": "true" }), h("span", { class: "done-text", text: done ? t("hs.today.done") : t("hs.today.markDone") })),
        h("span", { class: "lesson-main" },
          h("span", { class: "lesson-name", text: name }),
          h("span", { class: "lesson-meta" },
            x.kind === "loop" ? h("span", { class: "tag tag-loop", text: t("hs.plan.loopTag") }) : null,
            x.kind === "extra" ? h("span", { class: "tag", text: t("hs.today.extraTag") }) : null,
            x.subject?.core ? h("span", { class: "tag tag-core", text: t("hs.subj.coreShort") }) : null,
            h("span", { class: "muted", text: dur(ctx, done ? x.log.minutes : x.subject?.minutes ?? 0) }))),
        done ? button({ id: `edit-${s.id}-${sid}`, label: t("hs.log.editShort"), ariaLabel: t("hs.log.editAria", { subject: name }), glyph: "edit", onClick: () => openLogForm(s, { log: x.log }) }) : null);
    });
    return h("section", { class: `card kid-card kid-c${colorIndex(s.color)}`, "data-kid": s.id, "aria-labelledby": `kid-h-${s.id}` },
      h("div", { class: "kid-head" },
        h("h3", { id: `kid-h-${s.id}` }, kidName(s), s.grade ? h("span", { class: "muted kid-grade", text: s.grade }) : null),
        h("span", { class: "count-pill", id: `td-total-${s.id}`, text: dur(ctx, total) })),
      h("div", { class: "row status-row" }, h("label", { for: statusSel.id, class: "muted", text: t("hs.att.day") }), statusSel),
      rows.length ? h("ul", { class: "lesson-list" }, ...rows) : h("p", { class: "muted", text: subjectsOf(data, s.id).length ? t("hs.today.nothing") : t("hs.today.noSubjects") }),
      h("div", { class: "row" },
        subjectsOf(data, s.id).length
          ? button({ id: `td-extra-${s.id}`, label: t("hs.log.extra"), glyph: "plus", onClick: () => openLogForm(s) })
          : h("a", { class: "btn", id: `td-subjects-${s.id}`, href: `#/kids/${encodeURIComponent(s.id)}`, text: t("hs.subj.add") })));
  }

  function paint() {
    const head = h("div", { class: "page-head" },
      h("div", {},
        h("h2", { text: day === today ? t("hs.today.title") : t("hs.today.dayTitle") }),
        h("p", { class: "page-date", id: "td-date-text", text: formatDate(day, { dateStyle: "full" }) })),
      h("div", { class: "row date-nav" },
        button({ id: "td-prev", ariaLabel: t("hs.today.prev"), icon: "prev", label: "", onClick: () => go(addDays(day, -1)) }),
        day !== today ? button({ id: "td-today", label: t("hs.today.backToday"), onClick: () => go(today) }) : null,
        button({ id: "td-next", ariaLabel: t("hs.today.next"), icon: "next", label: "", onClick: () => go(addDays(day, 1)) }),
        h("input", { type: "date", id: "td-date", class: "date-input", value: day, "aria-label": t("hs.today.pickDate"), on: { change: (e) => { if (isIsoDate(e.target.value)) go(e.target.value); } } })));
    if (!data.students.length) { fill(root, head, noKids(ctx)); return; }
    const offDay = !prefs.schoolDays.includes(weekday(day));
    fill(root, ...[head,
      offDay ? h("p", { class: "banner banner-info", id: "td-offday", text: t("hs.today.offDay") }) : null,
      h("div", { class: "row toolbar today-actions" },
        button({ id: "td-all-school", label: t("hs.today.markAll"), glyph: "check", variant: "primary", onClick: markAll }),
        button({ id: "td-group", label: t("hs.act.addShort"), glyph: "kids", onClick: async () => { if (await openActivityForm(ctx, data, { date: day })) await reload(); } })),
      h("div", { class: "kid-grid" }, ...data.students.map(kidCard))].filter(Boolean));
  }
  paint();
}
