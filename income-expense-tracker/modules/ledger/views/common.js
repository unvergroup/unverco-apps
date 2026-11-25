// Ortak gorunum yardimcilari: veri yukleme, etiketler (L), pencere / form kabugu, secim alani, hata metni, cubuk, uyari cumlesi.
import { button, focusFirstInvalid, h, nextId, select } from "../../../core/ui.js";
import { guardWrite } from "../../../core/safe.js";
import { OTHER_KEY, categoryLabel, presetCategoryRecords } from "../logic/schema.js";
import { ofBusiness } from "../logic/calc.js";

/** replaceChildren null / false degerleri "null" metni olarak basar; bu yardimci onlari atar. */
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

/** Ilk acilis / tum veri silindikten sonra: hazir kategoriler ve en az bir isletme. */
export async function ensureBase(ctx) {
  const s = await ctx.ledger.get();
  if (!s.seeded || (await ctx.store.count("categories")) === 0) {
    await ctx.store.transact("categories", (list) => {
      const have = new Set(list.map((c) => c.id));
      const t = new Date().toISOString();
      const add = presetCategoryRecords().filter((p) => !have.has(p.id)).map((p) => ({ ...p, hidden: false, createdAt: t, updatedAt: t }));
      return { list: [...list, ...add], result: null };
    });
    await ctx.ledger.save({ seeded: true });
  }
  return ctx.business.ensure();
}

/** Etkin isletmenin verisi + kategoriler. */
export async function loadData(ctx) {
  const business = await ensureBase(ctx);
  const [entries, trips, categories, businesses, ledger] = await Promise.all([
    ctx.store.list("entries"), ctx.store.list("trips"), ctx.store.list("categories"), ctx.business.list(), ctx.ledger.get(),
  ]);
  const catById = new Map(categories.map((c) => [c.id, c]));
  return {
    business, businesses, ledger, categories, catById,
    allEntries: entries,
    entries: ofBusiness(entries, business.id),
    trips: ofBusiness(trips, business.id),
    catName: (id) => categoryLabel(catById.get(id), ctx.i18n.t),
  };
}

/** Gorunur kategoriler (bir tur), ada gore; "Diger" en sonda. */
export function categoriesOf(data, type, t, keep = "") {
  const other = `cat-${OTHER_KEY[type]}`;
  return data.categories.filter((c) => c.type === type && (!c.hidden || c.id === keep))
    .sort((a, b) => (a.id === other ? 1 : b.id === other ? -1 : categoryLabel(a, t).localeCompare(categoryLabel(b, t))));
}

/** Rapor / belge etiketleri. */
export function labels(ctx, data) {
  const { t, tn, formatDate, formatCurrency, formatNumber, formatPercent, locale } = ctx.i18n;
  return {
    t, tn, formatDate, formatCurrency, formatNumber, formatPercent,
    category: data.catName,
    method: (k) => (k ? t(`method.${k}`) : ""),
    monthName: (m) => new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2026, m - 1, 1)),
    unit: data.ledger.distanceUnit,
    digits: ctx.i18n.digits,
    currency: ctx.i18n.currency,
  };
}

export const disclaimer = (ctx, id = "") => h("p", { class: "disclaimer muted", id: id || undefined, text: ctx.i18n.t("disclaimer.tax") });

// Yatay cubuk (genislik CSSOM ile; satir ici stil metni yok -> CSP)
export const bar = (pct, cls = "") => {
  const fill = h("span", { class: `bar-fill ${cls}`.trim() });
  fill.style.setProperty("--w", `${Math.max(0, Math.min(100, pct))}%`);
  return h("span", { class: "bar", "aria-hidden": "true" }, fill);
};

// ---------- modal / form kabugu ----------
export function openModal(ctx, { title, children, className = "" }) {
  const titleId = nextId("mt");
  const dlg = h("dialog", { class: `dialog sheet ${className}`.trim(), "aria-labelledby": titleId });
  dlg.append(
    h("div", { class: "sheet-head" },
      h("h2", { id: titleId, text: title }),
      h("button", { type: "button", class: "btn btn-icon sheet-close", "aria-label": ctx.i18n.t("common.close"), text: "×", on: { click: () => dlg.close() } })),
    ...children);
  const done = new Promise((resolve) => dlg.addEventListener("close", () => { dlg.remove(); resolve(); }));
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close: () => dlg.close(), done };
}

/** Form penceresi. groups: [{ legend, nodes }]; onSave() -> true (kapat) | false (acik kal). extraActions: ek dugmeler (sil). Doner: Promise<boolean>. */
export function openForm(ctx, { title, groups, onSave, saveLabel, extraActions = [] }) {
  const { t } = ctx.i18n;
  return new Promise((resolve) => {
    let saved = false;
    const guard = guardWrite((e) => ctx.fail(e));
    const form = h("form", { class: "form-sheet", novalidate: true },
      ...groups.map((g) => h("fieldset", { class: "form-group" }, g.legend ? h("legend", { text: g.legend }) : null, ...g.nodes)),
      h("div", { class: "dialog-actions" },
        ...extraActions.map((a) => a(() => { saved = true; m.close(); })),
        button({ label: t("common.cancel"), onClick: () => m.close() }),
        button({ id: "form-save", label: saveLabel ?? t("common.save"), variant: "primary", type: "submit" })));
    form.addEventListener("submit", guard(async (e) => {
      e.preventDefault();
      if (await onSave(form)) { saved = true; m.close(); } else focusFirstInvalid(form);
    }, "form-save"));
    const m = openModal(ctx, { title, children: [form], className: "form-dialog" });
    m.done.then(() => resolve(saved));
    form.querySelector("input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea")?.focus();
  });
}

export function selectField(opts) {
  const s = select(opts);
  const err = h("p", { class: "field-error", role: "alert" });
  s.element.append(err);
  s.setError = (msg) => { err.textContent = msg || ""; s.input.setAttribute("aria-invalid", msg ? "true" : "false"); };
  return s;
}

/** Iki-uc secenekli dugme grubu (radyo). -> { element, value(), set(v) } */
export function segmented({ name, legend, value, options, onChange }) {
  const id = nextId(name);
  const inputs = options.map((o) => {
    const inp = h("input", { type: "radio", name: id, id: `${id}-${o.value}`, value: o.value, checked: o.value === value });
    if (onChange) inp.addEventListener("change", () => onChange(o.value));
    return { o, inp };
  });
  const element = h("fieldset", { class: "segmented", "data-name": name },
    h("legend", { class: "seg-legend", text: legend }),
    h("div", { class: "seg-row" }, ...inputs.map(({ o, inp }) => h("label", { class: "seg", for: inp.id, "data-value": o.value }, inp, h("span", { text: o.label })))));
  return { element, value: () => inputs.find((x) => x.inp.checked)?.o.value ?? value, set: (v) => { for (const x of inputs) x.inp.checked = x.o.value === v; } };
}

/** field() kendi kimligini uretir; sabit kimlik gerekiyorsa (testler, odak geri verme) girdi ve etiket birlikte yeniden adlandirilir. */
export function withId(f, id) {
  f.input.id = id;
  f.element.querySelector("label")?.setAttribute("for", id);
  return f;
}

export function errText(ctx, code, max) {
  const { t } = ctx.i18n;
  switch (code) {
    case "required": return t("msg.required");
    case "too_long": return t("msg.tooLong", { max });
    default: return t("msg.invalidValue");
  }
}
