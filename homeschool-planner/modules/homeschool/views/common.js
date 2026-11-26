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

/** Ilerleme halkasi (SVG; yalniz sunum): done / planned oraninda dolar; renk cocuk renginden (CSS). Metin yanindadir, halka aria-hidden. */
export function ring(done, planned) {
  const NS = "http://www.w3.org/2000/svg";
  const C = 2 * Math.PI * 18;
  const frac = planned > 0 ? Math.max(0, Math.min(1, done / planned)) : 0;
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 44 44", class: "ring", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  const mk = (cls, extra = {}) => { const c = document.createElementNS(NS, "circle"); for (const [k, v] of Object.entries({ cx: 22, cy: 22, r: 18, class: cls, ...extra })) c.setAttribute(k, String(v)); return c; };
  svg.append(mk("ring-track"), mk("ring-value", { "stroke-dasharray": `${(frac * C).toFixed(2)} ${C.toFixed(2)}` }));
  return svg;
}

/** Yasal uyari cumlesi (Records, Settings, belgeler, kilavuz): eyalet kurali tavsiyesi yok. */
export const legalNote = (ctx, id = "hs-legal") => h("p", { class: "legal-note", id, role: "note" }, iconSvg("info", { size: 20 }), h("span", { text: ctx.i18n.t("hs.legal") }));

// ---------- modal / form kabugu (Pet ile ayni sozlesme) ----------
export function openModal(ctx, { title, children, className = "" }) {
  const titleId = nextId("mt");
  const dlg = h("dialog", { class: `dialog sheet ${className}`.trim(), "aria-labelledby": titleId });
  dlg.append(
    h("div", { class: "sheet-head" },
      h("h2", { id: titleId, text: title }),
      h("button", { type: "button", class: "btn btn-ghost btn-icon sheet-close", "aria-label": ctx.i18n.t("common.close"), on: { click: () => dlg.close() } }, iconSvg("x", { size: 20, sw: 2 }))),
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

/** Cocuk secici. onPick(id). allLabel verilirse "Hepsi" dugmesi de cikar (id ""). Varsayilan: segmentli secim (.seg); cards: Kids ekraninda avatarli kartlar (.kid-tiles). */
export function kidPicker(ctx, { students, selected, onPick, allLabel, id = "kid-picker", cards = false }) {
  const items = [...(allLabel ? [{ id: "", name: allLabel }] : []), ...students];
  const initial = (name) => (Array.from(String(name ?? "?"))[0] ?? "?").toUpperCase();
  return h("div", { class: `kid-picker ${cards ? "kid-tiles" : "seg"}`, id, role: "group", "aria-label": ctx.i18n.t("hs.kid.pick") },
    ...items.map((s) => h("button", {
      type: "button", class: `chip kid-chip${s.id === selected ? " is-on" : ""}${cards ? " kid-tile" : ""}`, "aria-pressed": String(s.id === selected), "data-kid": s.id || "all",
      on: { click: () => onPick(s.id) },
    }, ...(cards
      ? [h("span", { class: `kid-dot avatar kid-c${colorIndex(s.color)}`, "aria-hidden": "true", text: initial(s.name) }),
        h("span", { class: "kid-body" }, h("span", { class: "kid-title", text: s.name }), s.grade ? h("span", { class: "kid-meta", text: s.grade }) : null),
        h("span", { class: "tile-check", "aria-hidden": "true" }, iconSvg("check", { size: 14, sw: 3 }))]
      : [s.id ? kidDot(s) : null, h("span", { text: s.name })]))));
}

// Bos ekran cizimi (ÜNVERCO'ya ait ozgun SVG): acik defter, uc cocuk rengi, arti rozeti. Renkler belirteclerden ve cocuk renklerinden gelir; iki temada calisir.
const ART = [
  ["ellipse", { cx: 84, cy: 118, rx: 64, ry: 6, fill: "currentColor", opacity: ".08" }],
  ["path", { d: "M84 30c-14-9-34-11-54-8v82c20-3 40-1 54 8z", fill: "var(--surface)", stroke: "currentColor", "stroke-width": "2.5" }],
  ["path", { d: "M84 30c14-9 34-11 54-8v82c-20-3-40-1-54 8z", fill: "var(--surface)", stroke: "currentColor", "stroke-width": "2.5" }],
  ["path", { d: "M84 30v82", stroke: "currentColor", "stroke-width": "2.5" }],
  ["circle", { cx: 46, cy: 50, r: 7, fill: "var(--art-1)" }], ["path", { d: "M58 50h16", stroke: "currentColor", "stroke-width": "2.5", opacity: ".45" }],
  ["circle", { cx: 46, cy: 70, r: 7, fill: "var(--art-2)" }], ["path", { d: "M58 70h14", stroke: "currentColor", "stroke-width": "2.5", opacity: ".45" }],
  ["circle", { cx: 46, cy: 90, r: 7, fill: "var(--art-3)" }], ["path", { d: "M58 90h12", stroke: "currentColor", "stroke-width": "2.5", opacity: ".45" }],
  ["path", { d: "M96 48h30M96 60h26M96 72h30M96 84h18", stroke: "currentColor", "stroke-width": "2.5", opacity: ".3" }],
  ["circle", { cx: 136, cy: 26, r: 16, fill: "var(--accent)" }], ["path", { d: "M136 19v14M129 26h14", stroke: "var(--on-accent)", "stroke-width": "3" }],
];
function emptyArt() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 168 128", class: "art", "aria-hidden": "true", focusable: "false", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
  for (const [tag, attrs] of ART) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); svg.append(n); }
  return svg;
}

/** Bos durum: cocuk yoksa "Add your first child" baglantisi + 3 adimlik "nasil calisir". */
export function noKids(ctx) {
  const { t } = ctx.i18n;
  return h("div", { class: "empty-wrap" },
    h("div", { class: "empty card", id: "no-kids" },
      emptyArt(),
      h("h3", { text: t("hs.kids.emptyTitle") }), h("p", { text: t("hs.kids.emptyText") }),
      h("p", { class: "row center actions" },
        h("a", { class: "btn btn-primary", id: "go-add-kid", href: "#/kids/new" }, iconSvg("plus", { size: 18, sw: 2 }), h("span", { text: t("hs.kids.add") })),
        h("a", { class: "btn btn-secondary", id: "go-sample", href: "#/settings" }, iconSvg("sparkles", { size: 18, sw: 2 }), h("span", { text: t("hs.sample.where") })))),
    h("ol", { class: "steps", "aria-label": t("hs.how.label") },
      ...[1, 2, 3].map((n) => h("li", {}, h("span", {}, h("strong", { text: t(`hs.how.${n}.t`) }), t(`hs.how.${n}.d`))))));
}

/** replaceChildren null / false / undefined cocuklari "null" metni olarak basar; bu yardimci onlari atar. */
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));

/** Bos durum kutusu: konuya uygun simge (kids / book / chart) + baslik + metin. */
export const emptyBox = ({ icon, title, text, id }) => h("div", { class: "empty card", id },
  h("span", { class: "empty-ico", "aria-hidden": "true" }, iconSvg(icon, { size: 30 })), h("h3", { text: title }), text ? h("p", { text }) : null);
