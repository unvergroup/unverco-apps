// Ortak gorunum yardimcilari: veri yukleme, pencere / form kabugu, sayi ve para alanlari, birim secici, durum rozeti.
// Kullanici verisi YALNIZ textContent ile yazilir (core/ui.js h()).
import { add, button, field, focusFirstInvalid, h, nextId, put, select } from "../../../core/ui.js";
import { guardWrite } from "../../../core/safe.js";
import { formatMinorPlain } from "../../../core/money.js";
import { localizeNumber, parseMoneyText, parseNumberText } from "../../../core/number-input.js";
import { costAll } from "../logic/costing.js";
import { UNITS, displayOptions } from "../logic/units.js";

/** Tum veri + tum tariflerin canli maliyeti (malzeme fiyati degisince her ekran yeniden hesaplar). */
export async function loadAll(ctx) {
  const [ingredients, recipes, orders, prefs] = await Promise.all([ctx.store.list("ingredients"), ctx.store.list("recipes"), ctx.store.list("orders"), ctx.prefs.get()]);
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
  ingredients.sort(byName);
  recipes.sort(byName);
  return { ingredients, recipes, orders, prefs, costs: costAll(recipes, ingredients, prefs), ingById: new Map(ingredients.map((i) => [i.id, i])), recById: new Map(recipes.map((r) => [r.id, r])) };
}

export const unitLabel = (ctx, u) => ctx.i18n.t(`unit.${u}`);
export const unitOptions = (ctx) => UNITS.map((u) => ({ value: u, label: unitLabel(ctx, u) }));
/** Miktar + birim: "2.5 cup", "375 g" (g / ml tam sayi, digerleri en cok 2 ondalik; logic/units.js displayDigits). */
export const qtyText = (ctx, q, u) => `${ctx.i18n.formatNumber(q, displayOptions(q, u))} ${unitLabel(ctx, u)}`;
export const statusChip = (ctx, status) => h("span", { class: "badge status-badge", "data-status": status, text: ctx.i18n.t(`status.${status}`) });
export const yieldText = (ctx, r) => `${ctx.i18n.formatNumber(r.yieldQty, { maximumFractionDigits: 3 })} ${r.yieldUnit || ctx.i18n.t("recipe.unitsDefault")}`;

// ---- pencere / form ----
export function openModal(ctx, { title, children, className = "" }) {
  const titleId = nextId("mt");
  const dlg = h("dialog", { class: `dialog sheet ${className}`.trim(), "aria-labelledby": titleId });
  add(dlg, 
    h("div", { class: "sheet-head" },
      h("h2", { id: titleId, text: title }),
      h("button", { type: "button", class: "btn btn-icon sheet-close", "aria-label": ctx.i18n.t("common.close"), text: "×", on: { click: () => dlg.close() } })),
    ...children);
  const done = new Promise((resolve) => dlg.addEventListener("close", () => { dlg.remove(); resolve(); }));
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close: () => dlg.close(), done };
}

/** groups: [{ legend, nodes }]; onSave(form) -> true (kapat) | false (acik kal). Doner: Promise<boolean>. */
export function openForm(ctx, { title, groups, onSave, saveLabel, extra = [] }) {
  const { t } = ctx.i18n;
  return new Promise((resolve) => {
    let saved = false;
    const guard = guardWrite((e) => ctx.fail(e));
    const form = h("form", { class: "form-sheet", novalidate: true },
      ...groups.map((g) => h("fieldset", { class: "form-group" }, h("legend", { text: g.legend }), ...g.nodes)),
      ...extra,
      h("div", { class: "dialog-actions" },
        button({ label: t("common.cancel"), onClick: () => m.close() }),
        button({ id: "form-save", label: saveLabel ?? t("common.save"), variant: "primary", type: "submit" })));
    form.addEventListener("submit", guard(async () => {
      if (await onSave(form)) { saved = true; m.close(); } else focusFirstInvalid(form);
    }, "form-save"));
    const m = openModal(ctx, { title, children: [form], className: "form-dialog" });
    m.done.then(() => resolve(saved));
    form.querySelector("input:not([type=checkbox]), select, textarea")?.focus();
  });
}

export function selectField(opts) {
  const s = select(opts);
  const err = h("p", { class: "field-error", role: "alert" });
  add(s.element, err);
  s.setError = (msg) => { err.textContent = msg || ""; s.input.setAttribute("aria-invalid", msg ? "true" : "false"); };
  return s;
}

export function errText(ctx, code, params = {}) {
  const { t } = ctx.i18n;
  const map = { required: "msg.required", too_long: "msg.tooLong", range: "msg.range", email: "msg.email", time: "msg.time", unit: "msg.unit", deposit: "msg.deposit", convert: "msg.convert" };
  return t(map[code] ?? "msg.invalid", params);
}

/** Sayi alani (yerel ondalik ayraci). read(): sayi | null (bos) | NaN (gecersiz). */
export function numberField(ctx, { label, value = null, hint, id, required = false }) {
  const dec = ctx.i18n.decimal;
  const f = field({ label, value: value === null || value === undefined ? "" : localizeNumber(String(value), dec), inputmode: "decimal", autocomplete: "off", hint, id, required });
  f.read = () => { const s = f.input.value.trim(); return s === "" ? null : parseNumberText(s, { decimal: dec }); };
  return f;
}
/** Para alani. read(): en kucuk birim tamsayi | null (bos) | NaN. */
export function moneyField(ctx, { label, value = null, hint, id, required = false }) {
  const dec = ctx.i18n.decimal;
  const f = field({ label, value: Number.isSafeInteger(value) ? localizeNumber(formatMinorPlain(value), dec) : "", inputmode: "decimal", autocomplete: "off", hint, id, required });
  f.read = () => { const s = f.input.value.trim(); return s === "" ? null : parseMoneyText(s, { decimal: dec }); };
  return f;
}

/** Yazdir dugmesi: core/print.js requestPrint tek kapisindan gecer (cagiran verir). */
export const printButton = (ctx, { id, label, onClick }) => button({ id, glyph: "print", label, exportAction: true, onClick });

/** Bos durum + eylem dugmeleri. */
export const emptyBox = (title, text, ...actions) => h("div", { class: "empty card" }, h("h3", { text: title }), text ? h("p", { class: "muted", text }) : null, actions.length ? h("div", { class: "row center-row" }, ...actions) : null);
