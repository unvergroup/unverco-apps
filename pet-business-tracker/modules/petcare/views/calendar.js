// Takvim ekrani: ay / yil basligi + ileri / geri oklar, 7 gunluk aylik izgara (randevulu gunlerde 1-3 nokta), gune tiklayinca altta o gunun
// randevu listesi, ay / hafta gorunumu gecisi. Adres #/calendar/<YYYY-MM-DD> o gunu secili acar. Hafta Pazartesi'den baslar.
import { addDays, daysInMonth, isIsoDate, startOfWeek, toIso, todayIso, weekday, addMonths } from "../../../core/dates.js";
import { button, h } from "../../../core/ui.js";
import { getAppointmentsForDate } from "../logic/appointments.js";
import { appointmentCard, loadAll, openAppointmentDetail, openAppointmentForm } from "./common.js";
import { printCalendar } from "../print/screens.js";
import { openReminderSheet } from "./reminders.js";

const MAX_DOTS = 3;

export async function mountCalendar(ctx, root, param) {
  const { t, tn, formatDate } = ctx.i18n;
  const today = todayIso();
  const state = { sel: isIsoDate(param) ? param : today, mode: "month" };
  let data = await loadAll(ctx);

  const bar = h("div", { class: "cal-bar" });
  const grid = h("div", { class: "cal-grid-wrap" });
  const dayBox = h("section", { class: "cal-day", "aria-live": "polite" });

  // gun -> randevu sayisi (iptal edilenler sayilmaz)
  const counts = () => {
    const m = new Map();
    for (const a of data.appointments) if (a.status !== "cancelled") m.set(a.date, (m.get(a.date) ?? 0) + 1);
    return m;
  };
  const open = (a) => openAppointmentDetail(ctx, a.id, reload);
  const remind = (a) => openReminderSheet(ctx, a.id, reload);
  const create = async () => { if (await openAppointmentForm(ctx, { date: state.sel })) await reload(); };
  const step = (dir) => {
    state.sel = state.mode === "month" ? addMonths(state.sel, dir) : addDays(state.sel, 7 * dir);
    paint();
  };
  const weekdayNames = () => Array.from({ length: 7 }, (_, i) => formatDate(addDays("2024-01-01", i), { weekday: "short" })); // 2024-01-01 Pazartesi

  function paintBar() {
    const [y, m] = state.sel.split("-").map(Number);
    const first = startOfWeek(state.sel, 0);
    const title = state.mode === "month"
      ? formatDate(toIso(y, m, 1), { month: "long", year: "numeric" })
      : `${formatDate(first, { day: "numeric", month: "short" })} – ${formatDate(addDays(first, 6), { day: "numeric", month: "short", year: "numeric" })}`;
    const mode = (id, label) => h("button", { type: "button", class: "chip", id: `cal-${id}`, "aria-pressed": String(state.mode === id), text: label, on: { click: () => { state.mode = id; paint(); } } });
    bar.replaceChildren(
      h("div", { class: "cal-nav" },
        button({ id: "cal-prev", label: "", icon: "prev", ariaLabel: t(state.mode === "month" ? "cal.prevMonth" : "cal.prevWeek"), onClick: () => step(-1) }),
        h("h2", { class: "cal-title", id: "cal-title", "aria-live": "polite", text: title }),
        button({ id: "cal-next", label: "", icon: "next", ariaLabel: t(state.mode === "month" ? "cal.nextMonth" : "cal.nextWeek"), onClick: () => step(1) })),
      h("div", { class: "row" },
        button({ id: "cal-today", label: t("cal.today"), onClick: () => { state.sel = today; paint(); } }),
        h("div", { class: "chips", role: "group", "aria-label": t("cal.view") }, mode("month", t("cal.month")), mode("week", t("cal.week")))));
  }

  const dayCell = (iso, n, inMonth) => {
    const isSel = iso === state.sel;
    const dots = Math.min(MAX_DOTS, n);
    return h("button", {
      type: "button", class: `cal-cell${inMonth ? "" : " cal-out"}${iso === today ? " cal-today" : ""}`, "data-date": iso,
      "aria-pressed": String(isSel), "aria-current": iso === today ? "date" : undefined,
      "aria-label": `${formatDate(iso, { dateStyle: "full" })}${n ? `, ${tn("cal.count", n)}` : ""}`,
      on: { click: () => { state.sel = iso; paint(); document.querySelector(`.cal-cell[data-date="${iso}"]`)?.focus(); } },
    }, h("span", { class: "cal-num", text: String(Number(iso.slice(8))) }),
      h("span", { class: "cal-dots", "aria-hidden": "true" }, ...Array.from({ length: dots }, () => h("i", { class: "cal-dot" }))));
  };

  function paintGrid() {
    const c = counts();
    const [y, m] = state.sel.split("-").map(Number);
    const head = h("div", { class: "cal-head", "aria-hidden": "true" }, ...weekdayNames().map((n) => h("span", { text: n })));
    let cells;
    if (state.mode === "month") {
      const first = toIso(y, m, 1);
      const start = startOfWeek(first, 0);
      const rows = Math.ceil((weekday(first) + daysInMonth(y, m)) / 7);
      cells = Array.from({ length: rows * 7 }, (_, i) => { const d = addDays(start, i); return dayCell(d, c.get(d) ?? 0, d.slice(0, 7) === first.slice(0, 7)); });
    } else {
      const start = startOfWeek(state.sel, 0);
      cells = Array.from({ length: 7 }, (_, i) => { const d = addDays(start, i); return dayCell(d, c.get(d) ?? 0, true); });
    }
    grid.replaceChildren(head, h("div", { class: "cal-grid", role: "group", "aria-labelledby": "cal-title" }, ...cells));
  }

  function paintDay() {
    const days = state.mode === "week" ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(state.sel, 0), i)) : [state.sel];
    const section = (iso) => {
      const list = getAppointmentsForDate(data, iso);
      return h("div", { class: "stack cal-day-block", "data-day": iso },
        h("h3", { text: formatDate(iso, { dateStyle: "full" }) }),
        list.length ? h("div", { class: "appt-list" }, ...list.map((a) => appointmentCard(ctx, a, data, { onOpen: open, onRemind: remind }))) : h("p", { class: "muted", text: t("cal.noAppointments") }));
    };
    dayBox.replaceChildren(
      ...days.map(section),
      h("div", { class: "row" }, button({ id: "cal-new", label: t("cal.newOnDay"), variant: "primary", onClick: create }),
        button({ id: "cal-print", glyph: "print", label: t("pl.btn.calendar"), exportAction: true, onClick: () => printCalendar(ctx, { data, sel: state.sel, mode: state.mode }) })));
  }

  function paint() { paintBar(); paintGrid(); paintDay(); }
  async function reload() { data = await loadAll(ctx); paint(); }
  ctx.onExternalChange(reload);
  root.replaceChildren(h("h2", { class: "sr-only", text: t("cal.title") }), bar, grid, dayBox);
  paint();
}
