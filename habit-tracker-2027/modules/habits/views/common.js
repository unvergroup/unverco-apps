// Ekranlarin ortak parcalari: halka, simge karosu, ust cubuk, bolum basligi, aliskanlik secici, eylem sayfasi, metin yardimcilari.
import { h, nextId } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { diffDays, localIso } from "../logic/dates.js";
import { targetOf } from "../logic/calc.js";

/** Ilerleme halkasi; pct 0..100 (null -> bos iz). --p CSSOM ile verilir (CSP: satir ici stil yok). */
export function ring(pct, { cls = "", label = null } = {}) {
  const el = h("div", { class: `ring${cls ? " " + cls : ""}`, role: label ? "img" : null, "aria-label": label, "aria-hidden": label ? null : "true" });
  el.style.setProperty("--p", String(Math.max(0, Math.min(100, Math.round(pct ?? 0)))));
  return el;
}

export function tile(habit, cls = "") {
  return h("div", { class: `tile hc-${habit.color}${cls ? " " + cls : ""}`, "aria-hidden": "true" }, icon(habit.icon, { size: 22 }));
}

export function topbar(eyebrow, title, ...actions) {
  return h("header", { class: "topbar" },
    h("div", { class: "topbar-text" }, h("div", { class: "eyebrow" }, ...[].concat(eyebrow)), h("h1", { id: "screen-title" }, ...[].concat(title))),
    actions.length ? h("div", { class: "topbar-actions" }, ...actions) : null);
}

export const sectionH = (title, right = null, id = null) => h("div", { class: "section-h" }, h("h2", { id, text: title }), right !== null ? h("span", { text: right }) : null);

export function iconBtn(name, label, onClick, { id, cls = "" } = {}) {
  return h("button", { type: "button", class: `btn btn--icon${cls ? " " + cls : ""}`, id, "aria-label": label, title: label, on: { click: onClick } }, icon(name, { size: 20 }));
}

export function textBtn(name, label, onClick, { id, cls = "" } = {}) {
  return h("button", { type: "button", class: `btn${cls ? " " + cls : ""}`, id, on: { click: onClick } }, name ? icon(name, { size: 20 }) : null, h("span", { text: label }));
}

/** "All habits" + etkin aliskanliklar; yerel <select> (klavye ve ekran okuyucu dogal). */
export function habitSelect(i18n, habits, value, onChange, id) {
  const sel = h("select", { id, class: "select-native", "aria-label": i18n.t("month.habit"), on: { change: () => onChange(sel.value) } },
    h("option", { value: "", text: i18n.t("month.all") }),
    habits.map((x) => h("option", { value: x.id, text: x.name })));
  sel.value = value ?? "";
  return h("label", { class: "select" }, sel, icon("down", { size: 18 }));
}

export function streakText(i18n, n, unit = "day") {
  return i18n.tn(`streak.${unit}`, n);
}
export function durationText(i18n, n, unit = "day") {
  return i18n.tn(`unit.${unit}s`, n);
}

export function scheduleText(i18n, habit) {
  const s = habit.schedule ?? {};
  if (s.type === "days") {
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.filter((d) => s.days.includes(d)).map((d) => i18n.weekdayShort[d]).join(", ");
  }
  if (s.type === "weekly") return i18n.tn("sched.weekly", s.times);
  if (s.type === "monthly") return i18n.tn("sched.monthly", s.times);
  return i18n.t("sched.daily");
}

export function amountText(i18n, habit, value) {
  return habit.unit ? i18n.t("row.countOfUnit", { value, target: targetOf(habit), unit: habit.unit }) : i18n.t("row.countOf", { value, target: targetOf(habit) });
}

/** "today" / "yesterday" / "N days ago" */
export function agoText(i18n, isoTime, today = localIso()) {
  const n = diffDays(localIso(new Date(isoTime)), today);
  if (n <= 0) return i18n.t("when.today");
  if (n === 1) return i18n.t("when.yesterday");
  return i18n.tn("when.days", n);
}

export function backupStatus(prefs, today, i18n) {
  return prefs.lastBackupAt ? i18n.t("side.backedUp", { when: agoText(i18n, prefs.lastBackupAt, today) }) : i18n.t("side.notBacked");
}

/** Eylem sayfasi (yerel <dialog>; Esc kapatir, odak icerde). items: [{ id, icon, label, onClick }] */
export function actionSheet({ title, items, closeLabel }) {
  const tid = nextId("as");
  const dlg = h("dialog", { class: "dialog sheet", "aria-labelledby": tid },
    h("h2", { id: tid, class: "sheet-title", text: title }),
    h("div", { class: "sheet-list" }, items.map((it) => h("button", { type: "button", class: "sheet-item", id: it.id, on: { click: () => { dlg.close(); it.onClick(); } } }, icon(it.icon, { size: 20 }), h("span", { text: it.label })))),
    h("button", { type: "button", class: "btn sheet-close", text: closeLabel, on: { click: () => dlg.close() } }));
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector(".sheet-item")?.focus();
  return dlg;
}

/** Gecmis bildirimi icin satir anahtari. */
export const rowId = (prefix, habit) => `${prefix}-${habit.id}`;
