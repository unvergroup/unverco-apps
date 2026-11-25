// Homeschool Planner ortak gorunum yardimcilari: veri yukleme, pencere / form kabugu, cocuk rengi, secim kutulari, hata metni.
// Kullanici verisi YALNIZ metin olarak yazilir (core/ui.js h()). Renk yalniz STUDENT_COLORS listesinden (CSS degiskeni, style yok).
import { guardWrite } from "../../../core/safe.js";
import { button, focusFirstInvalid, h, nextId, select } from "../../../core/ui.js";
import { icon as iconSvg } from "../../../core/icons.js";
import { DATA_COLLECTIONS, STUDENT_COLORS } from "../logic/schema.js";
import { studentsSorted } from "../logic/calc.js";
import { durText } from "../print/screens.js";

/** Tum veri + okul yili ayarlari (tek okuma). */
export async function loadAll(ctx) {
  const data = {};
  for (const c of DATA_COLLECTIONS) data[c] = await ctx.store.list(c);
  data.students = studentsSorted(data);
  return { data, prefs: await ctx.prefs.get() };
}

export const dur = (ctx, min) => durText(ctx.i18n.t, ctx.i18n.formatNumber, min);
export const colorIndex = (color) => Math.max(0, STUDENT_COLORS.indexOf(color));
/** Cocuk renk noktasi: data-color (0-9) -> CSS .kid-c<n>. */
export const kidDot = (s) => h("span", { class: `kid-dot kid-c${colorIndex(s?.color)}`, "aria-hidden": "true" });
export const kidName = (s) => h("span", { class: "kid-name" }, kidDot(s), h("span", { text: s?.name ?? "?" }));

/** Yasal uyari cumlesi (Records, Settings, belgeler, kilavuz): eyalet kurali tavsiyesi yok. */
export const legalNote = (ctx, id = "hs-legal") => h("p", { class: "legal-note", id, role: "note", text: ctx.i18n.t("hs.legal") });

// ---------- modal / form kabugu (Pet ile ayni sozlesme) ----------
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

// groups: [{ legend, nodes }]; onSave(form) -> true (kaydedildi, kapat) | false. extraActions: sol alt dugmeler (sil). Doner: Promise<boolean>.
export function openForm(ctx, { title, groups, onSave, saveLabel, extraActions = [] }) {
  const { t } = ctx.i18n;
  return new Promise((resolve) => {
    let saved = false;
    const guard = guardWrite((e) => ctx.fail(e));
    const form = h("form", { class: "form-sheet", novalidate: true },
      ...groups.map((g) => h("fieldset", { class: "form-group" }, g.legend ? h("legend", { text: g.legend }) : null, ...g.nodes)),
      h("div", { class: "dialog-actions" },
        ...extraActions,
        button({ id: "form-cancel", label: t("common.cancel"), onClick: () => m.close() }),
        button({ id: "form-save", label: saveLabel ?? t("common.save"), variant: "primary", type: "submit" })));
    form.addEventListener("submit", guard(async (e) => {
      e?.preventDefault?.();
      if (await onSave(form)) { saved = true; m.close(); } else focusFirstInvalid(form);
    }, "form-save"));
    const m = openModal(ctx, { title, children: [form], className: "form-dialog" });
    m.done.then(() => resolve(saved));
    form.querySelector("input:not([type=checkbox]):not([type=radio]), select, textarea")?.focus();
  });
}

export function selectField(opts) {
  const s = select(opts);
  const err = h("p", { class: "field-error", role: "alert" });
  s.element.append(err);
  s.setError = (msg) => { err.textContent = msg || ""; s.input.setAttribute("aria-invalid", msg ? "true" : "false"); };
  return s;
}

/** Onay kutulari grubu (fieldset). items: [{ value, label, checked, node? }]. Doner: { element, values(), setError }. */
export function checkGroup({ legend, items, id = nextId("cg"), cls = "" }) {
  const err = h("p", { class: "field-error", role: "alert" });
  const boxes = items.map((it, i) => {
    const box = h("input", { type: "checkbox", id: `${id}-${i}`, value: it.value, checked: Boolean(it.checked) });
    return { it, box };
  });
  const element = h("fieldset", { class: `field check-group ${cls}`.trim(), id },
    h("legend", { text: legend }),
    h("div", { class: "check-row" }, ...boxes.map(({ it, box }) => h("label", { class: "check", for: box.id }, box, it.node ?? h("span", { text: it.label })))),
    err);
  return { element, values: () => boxes.filter((b) => b.box.checked).map((b) => b.it.value), boxes, setError: (m) => { err.textContent = m || ""; } };
}

/** Radyo grubu. Doner: { element, value() }. */
export function radioGroup({ legend, name, items, value, cls = "" }) {
  const id = nextId("rg");
  const radios = items.map((it, i) => h("input", { type: "radio", name: `${name}-${id}`, id: `${id}-${i}`, value: it.value, checked: it.value === value }));
  const element = h("fieldset", { class: `field radio-group ${cls}`.trim() },
    h("legend", { text: legend }),
    h("div", { class: "check-row" }, ...radios.map((r, i) => h("label", { class: "check", for: r.id }, r, items[i].node ?? h("span", { text: items[i].label })))));
  return { element, radios, value: () => radios.find((r) => r.checked)?.value ?? value };
}

/** Dogrulama kodu -> metin. */
export function errText(ctx, code, o = {}) {
  const { t } = ctx.i18n;
  switch (code) {
    case "required": return t("hs.err.required");
    case "too_long": return t("hs.err.tooLong", { max: o.max ?? "" });
    case "range": return t("hs.err.range", { min: o.min ?? 0, max: o.max ?? "" });
    case "days": return t("hs.err.days");
    case "kids": return t("hs.err.kids");
    case "date": return t("hs.err.date");
    case "limit": return t("hs.err.limit", { max: o.max ?? "" });
    default: return t("hs.err.invalid");
  }
}

/** Ilerleme cubugu (deger yuzdesi null ise yalniz metin). */
export function progressBar({ label, value, pct, id }) {
  let bar = null;
  if (pct !== null) {
    const fill = h("span", { class: "pbar-fill" });
    fill.style.setProperty("--w", `${Math.max(0, Math.min(100, pct))}%`); // CSSOM (CSP style-src 'self' altinda izinli)
    bar = h("div", { class: "pbar", role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct)) }, fill);
  }
  return h("div", { class: "pbar-row", id }, h("div", { class: "pbar-label" }, h("span", { text: label }), h("strong", { text: value })), bar);
}

/** Cocuk secici (sekme benzeri dugmeler). onPick(id). allLabel verilirse "Hepsi" dugmesi de cikar (id ""). */
export function kidPicker(ctx, { students, selected, onPick, allLabel, id = "kid-picker" }) {
  const items = [...(allLabel ? [{ id: "", name: allLabel }] : []), ...students];
  return h("div", { class: "kid-picker", id, role: "group", "aria-label": ctx.i18n.t("hs.kid.pick") },
    ...items.map((s) => h("button", {
      type: "button", class: `chip kid-chip${s.id === selected ? " is-on" : ""}`, "aria-pressed": String(s.id === selected), "data-kid": s.id || "all",
      on: { click: () => onPick(s.id) },
    }, s.id ? kidDot(s) : null, h("span", { text: s.name }))));
}

/** Bos durum: cocuk yoksa "Add your first child" baglantisi. */
export function noKids(ctx) {
  const { t } = ctx.i18n;
  return h("div", { class: "empty", id: "no-kids" },
    h("span", { class: "empty-ico", "aria-hidden": "true" }, iconSvg("kids", { size: 30 })),
    h("h3", { text: t("hs.kids.emptyTitle") }), h("p", { text: t("hs.kids.emptyText") }),
    h("p", { class: "row center" },
      h("a", { class: "btn btn-primary", id: "go-add-kid", href: "#/kids/new", text: t("hs.kids.add") }),
      h("a", { class: "btn", id: "go-sample", href: "#/settings", text: t("hs.sample.where") })));
}

/** replaceChildren null / false / undefined cocuklari "null" metni olarak basar; bu yardimci onlari atar. */
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));

/** Bos durum kutusu: konuya uygun simge (kids / book / chart) + baslik + metin. */
export const emptyBox = ({ icon, title, text, id }) => h("div", { class: "empty", id },
  h("span", { class: "empty-ico", "aria-hidden": "true" }, iconSvg(icon, { size: 30 })), h("h3", { text: title }), text ? h("p", { text }) : null);
