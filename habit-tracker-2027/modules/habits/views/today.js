// E2 Today: gun puani halkasi, haftanin 7 mini halkasi, "Due today" / "Done" / "Not due today", tek dokunus isaret, sayac +/-,
// satir menusu (Rest day, Edit habit, Open in calendar), Undo, yedek hatirlatma seridi. Her dokunus aninda depoya yazilir.
import { h } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { addDays, monthKey, weekStartOf, yearOf } from "../logic/dates.js";
import { bestStreak, comebackCreated, dayScore, habitDays, isPeriodic, leftToday, targetOf, todayRow, unitOutcomes, yearStats } from "../logic/calc.js";
import { backupNudge, SNOOZE_MS } from "../logic/nudge.js";
import { actionSheet, durationText, iconBtn, ring, sectionH, streakText, textBtn, tile, topbar } from "./common.js";
import { backupNow } from "./data-actions.js";
import { openHabitEditor } from "./habit-editor.js";

export async function mountToday(ctx, root) {
  const render = async () => {
    const { i18n } = ctx;
    const { t } = i18n;
    const today = ctx.today();
    const { active, idx, prefs, entries } = await ctx.data();
    const ws = prefs.weekStart;
    const focusId = document.activeElement?.id;
    const score = dayScore(active, idx, today);
    const pctText = i18n.pct(score.pct ?? 0);

    // ---- ust cubuk ----
    const undo = ctx.repo.undoSize() ? textBtn("undo", t("common.undo"), async () => { await ctx.repo.undo(); ctx.notify(t("toast.undone"), "success"); await render(); }, { id: "undo-btn" }) : null;
    const wd = i18n.weekdayLong[new Date(`${today}T12:00:00`).getDay()];
    const dateLong = i18n.formatDate(today, { month: "long", day: "numeric" });
    const head = topbar([t("today.eyebrow"), h("span", { class: "m-only", text: ` · ${wd}` })], [h("span", { class: "d-only", text: `${wd}, ` }), dateLong], ...(undo ? [undo] : []));

    // ---- yedek seridi ----
    const nudge = backupNudge(prefs, entries.length);
    const strip = nudge.show ? h("div", { class: "nudge glass", id: "nudge", role: "status" },
      icon("shield", { size: 22, cls: "nudge-ico" }),
      h("span", { class: "nudge-text", text: nudge.never ? t("nudge.never") : i18n.tn("nudge.text", nudge.days) }),
      h("div", { class: "nudge-actions" },
        h("button", { type: "button", class: "btn btn--gold", id: "nudge-backup", text: t("nudge.btn"), on: { click: async () => { if (await backupNow(ctx)) await render(); } } }),
        h("button", { type: "button", class: "btn btn--ghost", id: "nudge-later", text: t("nudge.later"), on: { click: async () => { await ctx.repo.savePrefs({ backupNudgeSnoozedUntil: new Date(Date.now() + SNOOZE_MS).toISOString() }); await render(); } } }))) : null;

    if (!active.length) {
      root.replaceChildren(head, strip ?? "", h("section", { class: "empty glass", id: "today-empty" },
        h("h2", { text: t("today.empty") }),
        h("button", { type: "button", class: "btn btn--gold", id: "today-add", text: t("today.emptyBtn"), on: { click: () => openHabitEditor(ctx, null, render) } })));
      return;
    }

    // ---- satirlar ----
    const rows = active.map((x) => ({ habit: x, days: habitDays(idx, x), r: todayRow(x, habitDays(idx, x), today, ws) }));
    const act = async (habit, fn) => {
      const before = new Map(habitDays(idx, habit));
      const res = await fn();
      const after = new Map(before);
      if (res.after) after.set(today, res.after); else after.delete(today);
      const n = comebackCreated(habit, before, after, today, ws);
      ctx.undoToast(n ? t("toast.comeback", { n }) : t("toast.saved", { name: habit.name }), render);
      await render();
    };
    const rowEl = ({ habit, r }) => {
      const done = r.status === "done";
      let sub = null;
      if (r.status === "rest") sub = t("row.rest");
      else if (r.comebackNow && done) sub = t("row.welcomeBack");
      else if (habit.kind === "count") sub = h("span", {}, h("span", { class: "counter-num", text: String(r.value) }), " ", t(habit.unit ? "row.ofTargetUnit" : "row.ofTarget", { target: targetOf(habit), unit: habit.unit }));
      else if (isPeriodic(habit)) sub = t(habit.schedule.type === "weekly" ? "row.week" : "row.month", { done: r.unitDone, times: r.times });
      const bar = habit.kind === "count" && r.status !== "rest" ? h("div", { class: "bar", "aria-hidden": "true" }, h("i")) : null;
      if (bar) bar.firstChild.style.setProperty("width", `${Math.min(100, (r.value * 100) / targetOf(habit))}%`);
      const meta = [];
      if (r.comebackNow && done) meta.push(h("span", { class: "badge badge--gold" }, icon("comeback", { size: 14 }), t("row.comeback", { n: r.comebackNow })));
      if (r.streak > 0) meta.push(h("span", { class: `badge${done ? " badge--violet" : ""}` }, icon("flame", { size: 14 }), streakText(i18n, r.streak, r.unitWord)));
      if (r.status === "rest") meta.push(h("span", { class: "badge" }, icon("moon", { size: 14 }), t("row.rest")));
      const name = habit.name;
      let ctrl;
      if (habit.kind === "count") {
        ctrl = h("div", { class: "stepper", "data-rapid": "1" },
          h("button", { type: "button", class: "btn btn--icon", id: `minus-${habit.id}`, "aria-label": t("row.remove", { name }), disabled: r.value <= 0 ? true : null, on: { click: () => act(habit, () => ctx.repo.step(habit, today, -1)) } }, icon("minus", { size: 20 })),
          h("button", { type: "button", class: `btn btn--icon btn--neon${done ? " is-done" : ""}`, id: `plus-${habit.id}`, "aria-label": t("row.add", { name }), on: { click: () => act(habit, () => ctx.repo.step(habit, today, +1)) } }, icon(done ? "check" : "plus", { size: 20 })));
      } else {
        ctrl = h("button", { type: "button", role: "checkbox", class: `check hc-${habit.color}`, id: `chk-${habit.id}`, "aria-checked": done ? "true" : "false", "aria-label": name, on: { click: () => act(habit, () => ctx.repo.toggleCheck(habit, today)) } }, icon("check", { size: 24, sw: 2.5 }));
      }
      const more = h("button", { type: "button", class: "more", id: `more-${habit.id}`, "aria-label": t("row.menu", { name }), on: { click: () => menu(habit, r) } }, icon("dots", { size: 20 }));
      const el = h("div", { class: `habit glass${done ? " done" : ""}${r.status === "rest" ? " rest" : ""}`, id: `row-${habit.id}`, "data-habit": habit.id, "data-keep-pos": "1", "data-status": r.status },
        tile(habit),
        h("div", { class: "habit-body" }, h("div", { class: "habit-name", text: name }), sub ? h("div", { class: "habit-sub" }, sub) : null, bar),
        more, ctrl,
        meta.length ? h("div", { class: "habit-meta" }, meta) : null);
      // Satirin bos alanina dokunus: sayacta +1, onayda ac/kapa (fare / dokunma kolayligi; klavye dugmeleri kullanir).
      el.addEventListener("click", (e) => {
        if (e.target.closest("button, a, input, select")) return;
        if (habit.kind === "count") act(habit, () => ctx.repo.step(habit, today, +1));
        else act(habit, () => ctx.repo.toggleCheck(habit, today));
      });
      return el;
    };
    const menu = (habit, r) => actionSheet({
      title: habit.name, closeLabel: t("common.close"),
      items: [
        { id: "menu-rest", icon: "moon", label: t(r.status === "rest" ? "menu.unrest" : "menu.rest"), onClick: () => act(habit, () => ctx.repo.toggleRest(habit, today)) },
        { id: "menu-edit", icon: "edit", label: t("menu.edit"), onClick: () => openHabitEditor(ctx, habit, render) },
        { id: "menu-cal", icon: "cal", label: t("menu.calendar"), onClick: () => { ctx.monthHabit = habit.id; ctx.navigate(`month/${monthKey(today)}`); } },
      ],
    });

    const due = rows.filter((x) => x.r.bucket === "due");
    const doneRows = rows.filter((x) => x.r.bucket === "done");
    const notDue = rows.filter((x) => x.r.bucket === "notDue");
    const list = h("div", { class: "today-list" },
      sectionH(t("today.due"), i18n.tn("today.left", leftToday(rows.map((x) => x.r))), "h-due"),
      due.length ? h("div", { class: "row-gap", id: "list-due" }, due.map(rowEl)) : h("p", { class: "muted list-empty", id: "list-due", text: t("today.allDone") }),
      doneRows.length ? sectionH(t("today.doneH"), String(doneRows.length), "h-done") : null,
      doneRows.length ? h("div", { class: "row-gap", id: "list-done" }, doneRows.map(rowEl)) : null,
      notDue.length ? h("details", { class: "notdue", id: "notdue" }, h("summary", { class: "section-h" }, h("h2", { text: t("today.notDue") }), h("span", { text: String(notDue.length) })), h("div", { class: "row-gap", id: "list-notdue" }, notDue.map(rowEl))) : null);

    // ---- kahraman paneli ----
    const ws0 = weekStartOf(today, ws);
    const week = h("div", { class: "week", "aria-label": t("today.week"), role: "group" }, Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ws0, i);
      const s = d <= today ? dayScore(active, idx, d) : { pct: 0 };
      const lab = i18n.weekdayNarrow[new Date(`${d}T12:00:00`).getDay()];
      return h("div", { class: `wd${d === today ? " today" : ""}${d > today ? " future" : ""}`, "aria-label": `${i18n.formatDate(d, { weekday: "long" })}: ${s.pct === null || d > today ? "—" : i18n.pct(s.pct)}`, role: "img" }, h("div", { class: "dot" }, ring(s.pct ?? 0)), h("span", { "aria-hidden": "true", text: lab }));
    }));
    let restWeek = 0;
    for (const x of rows) for (let i = 0; i < 7; i++) { const e = x.days.get(addDays(ws0, i)); if (e && e.rest) restWeek++; }
    const left = leftToday(rows.map((x) => x.r)); // DUE TODAY basligiyla ayni tanim (cihaz turu C3)
    const heroLine = score.total === 0 && left === 0 ? t("today.nothing") : left === 0 ? t("today.allSet") : i18n.tn("today.toGo", left);
    const hero = h("section", { class: "hero glass", id: "hero", "aria-labelledby": "day-score" },
      h("div", { class: "ring-wrap ring-glow hero-ring" }, ring(score.pct ?? 0, { cls: "ring-hero" }), h("div", { class: "ring-label", "aria-hidden": "true" }, h("div", { class: "score-big" }, String(Math.round(score.pct ?? 0)), h("small", { text: "%" })))),
      h("div", { class: "hero-text" },
        h("h2", { id: "day-score-line", text: t("today.scoreLine", { done: score.done, total: score.total }) }),
        h("p", { class: "sr-only", id: "day-score", text: t("today.scoreFull", { done: score.done, total: score.total, pct: pctText }) }),
        h("p", { class: "hero-sub", text: heroLine }),
        h("div", { class: "habit-meta" },
          h("span", { class: "badge badge--emerald" }, icon("list", { size: 14 }), i18n.tn("today.left", left)),
          restWeek ? h("span", { class: "badge badge--rest" }, icon("moon", { size: 14 }), i18n.tn("today.restWeek", restWeek)) : null)),
      week);

    const ys = yearStats(active, idx, yearOf(today), today, ws);
    let best = { n: 0, unit: "day" };
    for (const x of rows) { const b = bestStreak(unitOutcomes(x.habit, x.days, today, ws)); if (b > best.n) best = { n: b, unit: x.r.unitWord }; }
    const stat = (ic, label, val, small) => h("div", { class: "stat glass" }, h("div", { class: "lbl" }, icon(ic, { size: 16 }), label), h("div", { class: "val" }, val, small ? h("small", { text: small === "%" ? small : ` ${small}` }) : null));
    const durParts = durationText(i18n, best.n, best.unit).replace(String(best.n), "").trim();
    const side = h("div", { class: "side-stack" }, h("div", { class: "mini-stats" },
      stat("trophy", t("stat.best"), String(best.n), durParts),
      stat("comeback", t("stat.comebacks"), String(ys.comebacks), t("stat.thisYear")),
      stat("grid", t("stat.yearScore"), ys.score === null ? "—" : String(Math.round(ys.score)), ys.score === null ? "" : "%"),
      stat("moon", t("stat.rest"), String(ys.restDays))));

    root.replaceChildren(head, strip ?? "", h("div", { class: "today-grid" }, h("div", {}, hero, side), list));
    const ex = notDueOpen && document.getElementById("notdue");
    if (ex) ex.open = true;
    document.getElementById("notdue")?.addEventListener("toggle", (e) => { notDueOpen = e.target.open; });
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  };
  let notDueOpen = false;
  await render();
  ctx.onExternalChange(render);
  return null;
}
