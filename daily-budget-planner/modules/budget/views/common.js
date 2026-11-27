// Ekranlarin ortak parcalari (yalniz gorunum; hesap logic/ altindadir).
import { h } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { PRESET_ENVELOPES } from "../logic/schema.js";
import { formatMinorPlain, parseMoneyLoose } from "../../../core/money.js";

export const envIdOf = (e) => e.presetId || e.id;
export function envName(ctx, e) {
  if (!e) return ctx.i18n.t("env.uncategorized");
  if (e.presetId && !e.name) { const p = PRESET_ENVELOPES.find((x) => x.id === e.presetId); return p ? ctx.i18n.t(p.key) : e.presetId; }
  return e.name;
}
export const findEnv = (state, id) => state.envelopes.find((e) => envIdOf(e) === id);
export const envIcon = (state, id) => findEnv(state, id)?.icon || "tag";

export const md = (ctx, iso) => ctx.i18n.formatDate(iso, { month: "short", day: "numeric" });
export const wmd = (ctx, iso) => ctx.i18n.formatDate(iso, { weekday: "short", month: "short", day: "numeric" });
export const money = (ctx, minor) => ctx.i18n.formatCurrency(minor);

export function dateChip(ctx, iso) {
  return h("span", { class: "date", "aria-hidden": "true" }, h("small", { text: ctx.i18n.formatDate(iso, { month: "short" }) }), h("b", { class: "num", text: String(Number(iso.slice(8, 10))) }));
}

export function hello(title, sub) {
  return h("div", { class: "hello" }, h("h1", { text: title }), sub ? h("p", { text: sub }) : null);
}

export const disclaimerNote = (ctx) => h("p", { class: "note", id: "disclaimer" }, icon("shield", { size: 14 }), " ", ctx.i18n.t("disclaimer"));

/** Para alani okuma: yalniz core/money.js. Bos/0 -> NaN ya da 0. */
export const readMoney = (value, opts) => parseMoneyLoose(value, opts);
export const plainMoney = (minor) => formatMinorPlain(minor); // form alani degeri ("12.50")

export function emptyState(iconName, title, text, action) {
  return h("div", { class: "empty" }, h("span", { class: "chipico" }, icon(iconName)), h("span", {}, h("b", { text: title }), text), action ?? null);
}

/** Halka bar genisligi: CSP'ye uygun (CSSOM). */
export function bar(pct, cls = "") {
  const i = h("i", { class: cls });
  i.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  return h("div", { class: "bar" }, i);
}
