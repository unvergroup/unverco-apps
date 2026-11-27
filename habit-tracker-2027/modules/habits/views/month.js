// E3 Month: ay ileri/geri, "This month", aliskanlik secici, 7 sutunlu takvim (hafta basi ayara gore), gun puani halkasi ya da tek
// aliskanlik durumu, gelecek gunler soluk ve dokunulmaz, hucreye dokununca Day editor, ay ozeti, "Print this month" (D2).
import { h } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { daysInMonth, isoOf, monthKey, shiftMonth, weekday } from "../logic/dates.js";
import { dayScore, dayStatus, habitDays, monthSummary, targetOf } from "../logic/calc.js";
import { habitSelect, iconBtn, ring, sectionH, textBtn, tile, topbar } from "./common.js";
import { openDayEditor } from "./day-editor.js";
import { myMonthDoc } from "../print/docs.js";
import { docLabels } from "./doc-labels.js";
import { canvasMeasure } from "../../../core/canvas-doc.js";

export async function mountMonth(ctx, root, param) {
  const key = param ?? monthKey(ctx.today());
  const render = async () => {
    const { t, i18n } = ctx;
    const today = ctx.today();
    const { active, idx, prefs } = await ctx.data();
    const ws = prefs.weekStart;
    if (ctx.monthHabit && !active.some((x) => x.id === ctx.monthHabit)) ctx.monthHabit = "";
    const sel = active.find((x) => x.id === ctx.monthHabit) ?? null;
    const y = +key.slice(0, 4), m = +key.slice(5, 7) - 1;
    const title = `${i18n.monthsLong[m]} ${y}`;
    const focusId = document.activeElement?.id;

    const head = topbar(t("month.eyebrow"), title,
      h("div", { class: "pager" },
        iconBtn("left", t("month.prev"), () => ctx.navigate(`month/${shiftMonth(key, -1)}`), { id: "m-prev" }),
        iconBtn("right", t("month.next"), () => ctx.navigate(`month/${shiftMonth(key, 1)}`), { id: "m-next" }),
        iconBtn("printer", t("month.print"), () => printMonth(ctx, key), { id: "m-print" })));
    const toolbar = h("div", { class: "toolbar" },
      habitSelect(i18n, active, ctx.monthHabit, (v) => { ctx.monthHabit = v; render(); }, "m-habit"),
      textBtn(null, t("month.this"), () => ctx.navigate(`month/${monthKey(today)}`), { id: "m-this" }));

    const dim = daysInMonth(y, m);
    const lead = (weekday(isoOf(y, m, 1)) - ws + 7) % 7;
    const order = Array.from({ length: 7 }, (_, i) => (ws + i) % 7);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h("div", { class: "day empty", "aria-hidden": "true" }));
    for (let d = 1; d <= dim; d++) {
      const iso = isoOf(y, m, d);
      const dateText = i18n.formatDate(iso, { month: "long", day: "numeric" });
      const future = iso > today;
      let pct = 0, label, extra = null, pctText = "";
      let state = "";
      if (future) label = t("month.cellFuture", { date: dateText });
      else if (!sel) {
        const s = dayScore(active, idx, iso);
        pct = s.pct ?? 0;
        pctText = s.total ? i18n.pct(s.pct) : "";
        label = s.total ? t("month.cellAll", { date: dateText, done: s.done, total: s.total }) : t("month.cellNone", { date: dateText });
      } else {
        const e = habitDays(idx, sel).get(iso);
        state = dayStatus(sel, e);
        if (state === "done") { pct = 100; label = t("month.cellDone", { date: dateText }); }
        else if (state === "partial") { pct = (e.value * 100) / targetOf(sel); label = t("month.cellPartial", { date: dateText, value: e.value, target: targetOf(sel) }); pctText = `${e.value}/${targetOf(sel)}`; }
        else if (state === "rest") { label = t("month.cellRest", { date: dateText }); extra = icon("moon", { size: 18, cls: "rest-ico" }); }
        else label = t("month.cellNot", { date: dateText });
      }
      const b = h("button", { type: "button", class: `day${future ? " future" : ""}${iso === today ? " today" : ""}${state ? ` st-${state}` : ""}`, id: `d-${iso}`, "data-date": iso, "aria-label": label, disabled: future ? true : null },
        h("span", { class: "dn", "aria-hidden": "true", text: String(d) }), extra ?? ring(pct, { cls: state === "done" ? "ring-done" : "" }), h("span", { class: "pct", "aria-hidden": "true", text: pctText || " " }));
      if (!future) b.addEventListener("click", () => openDayEditor(ctx, iso, render));
      cells.push(b);
    }
    const cal = h("section", { class: "cal glass", "aria-label": t("month.calendar", { month: title }) },
      h("div", { class: "cal-head", "aria-hidden": "true" }, order.map((d) => h("div", { text: i18n.weekdayShort[d] }))),
      h("div", { class: "cal-grid", id: "cal-grid" }, cells));
    const legend = h("div", { class: "legend" },
      h("span", {}, ring(100, { cls: "ring-xs" }), t("month.legendScore")),
      h("span", {}, h("span", { class: "today-swatch", "aria-hidden": "true" }), t("month.legendToday")),
      h("span", { text: t("month.tap") }));

    let sn = 0, sd = 0;
    const sums = active.map((x) => {
      const r = monthSummary(x, habitDays(idx, x), key, today, ws);
      sn += r.num; sd += r.den;
      const bar = h("div", { class: "bar" }, h("i"));
      bar.firstChild.style.setProperty("width", `${Math.round(r.pct ?? 0)}%`);
      return h("div", { class: "sum-row glass", id: `sum-${x.id}` }, tile(x, "tile--sm"),
        h("div", { class: "sum-main" }, h("div", { class: "nm", text: x.name }), bar),
        h("div", { class: "fig" }, h("b", { text: i18n.pct(r.pct) }), t("month.ofDen", { done: r.num, den: r.den })));
    });
    root.replaceChildren(head, toolbar, h("div", { class: "month-grid" },
      h("div", {}, cal, legend),
      h("div", {}, sectionH(t("month.sum"), sd ? i18n.pct((sn * 100) / sd) : "—"), h("div", { class: "row-gap", id: "month-sums" }, sums))));
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  };
  await render();
  ctx.onExternalChange(render);
  return null;
}

/** D2 My month: ayin tum etkin aliskanliklari; hucre done / partial:N / rest. */
export async function printMonth(ctx, key) {
  const { i18n } = ctx;
  const { active, idx, prefs } = await ctx.data();
  const today = ctx.today();
  const y = +key.slice(0, 4), m = +key.slice(5, 7) - 1;
  const rows = active.map((x) => {
    const days = habitDays(idx, x);
    const cells = new Map();
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const e = days.get(isoOf(y, m, d));
      const st = dayStatus(x, e);
      if (st === "done") cells.set(d, "done");
      else if (st === "rest") cells.set(d, "rest");
      else if (st === "partial") cells.set(d, `partial:${e.value}`);
    }
    return { name: x.name, cells, rate: i18n.pct(monthSummary(x, days, key, today, prefs.weekStart).pct) };
  });
  const L = docLabels(ctx);
  const title = `${i18n.monthsLong[m]} ${y}`;
  await ctx.print({ filename: `month-${key}`, title, build: (paper, logo) => myMonthDoc({ year: y, month: m, title, rows }, { ...L, logo }, canvasMeasure(), paper) });
}
