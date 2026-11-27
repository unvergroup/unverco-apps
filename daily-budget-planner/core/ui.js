// Kucuk arayuz yardimcilari: h(), bildirim (toast), pencere (dialog), onay. Kullanici verisi YALNIZ textContent ile yazilir;
// HTML metni yorumlayan hicbir yol yok (h() on*, style, innerHTML ozelliklerini reddeder).
import { installClickGuard } from "./click-guard.js";
import { icon } from "./icons.js";

installClickGuard(); // kazara ikinci tik korumasi (core/click-guard.js)

const FORBIDDEN = /^(style|innerhtml|outerhtml|on[a-z]+)$/i;
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (FORBIDDEN.test(k) && k !== "on") throw new Error(`h(): "${k}" is not allowed`);
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const add = (list) => { for (const c of list) { if (c === null || c === undefined || c === false) continue; if (Array.isArray(c)) add(c); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); } };
  add(children);
  return el;
}

let uid = 0;
export const nextId = (p = "f") => `${p}-${++uid}`;

export function btn({ label, cls = "ghost", icon: ic, onClick, id, ariaLabel, type = "button", disabled, attrs = {} }) {
  return h("button", { type, id, class: `btn ${cls}`, "aria-label": ariaLabel, disabled, on: onClick ? { click: onClick } : undefined, ...attrs }, ic ? icon(ic) : null, label ? h("span", { text: label }) : null);
}

/** Etiketli alan. -> { el, input, setError } */
export function field({ label, id = nextId(), type = "text", value = "", hint, attrs = {}, options }) {
  const input = options
    ? h("select", { id, ...attrs }, options.map((o) => h("option", { value: o.value, text: o.label, selected: String(o.value) === String(value) })))
    : h("input", { id, type, ...attrs });
  if (!options) input.value = value ?? "";
  const err = h("p", { class: "field-error", id: `${id}-err`, role: "alert" });
  const hintEl = hint ? h("p", { class: "field-hint", id: `${id}-hint`, text: hint }) : null;
  input.setAttribute("aria-describedby", [hintEl ? hintEl.id : "", err.id].filter(Boolean).join(" "));
  return {
    el: h("div", { class: "field" }, h("label", { for: id, text: label }), input, hintEl, err),
    input,
    setError(msg) { err.textContent = msg || ""; input.setAttribute("aria-invalid", msg ? "true" : "false"); },
  };
}

// ---- Bildirim ----
const region = () => document.getElementById("toast-region");
export function toast(message, { kind = "info", action, timeout, closeLabel = "Close" } = {}) {
  const r = region();
  if (!r) return null;
  const el = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" }, h("span", { text: message }));
  let timer = 0;
  const close = () => { clearTimeout(timer); el.remove(); };
  if (action) el.append(h("button", { type: "button", class: "btn sm gold toast-act", id: action.id, on: { click: () => { close(); action.run(); } } }, action.label));
  el.append(h("button", { type: "button", class: "iconbtn toast-x", "aria-label": closeLabel, on: { click: close } }, icon("x", { size: 18 })));
  r.append(el);
  const ms = timeout ?? (kind === "error" ? 0 : 5000); // hatalar kendiliginden kaybolmaz
  if (ms) timer = setTimeout(close, ms);
  return { close, el };
}
export const clearToasts = () => region()?.replaceChildren();

// ---- Pencere ----
/** Modal pencere (dialog). sheet: true -> telefonda alttan acilan panel. -> { dialog, body, foot, close, done } */
export function openDialog({ title, id, sheet = false, closeLabel = "Close", onClose }) {
  const titleId = nextId("dlg");
  const body = h("div", { class: "dlg-body" });
  const foot = h("div", { class: "dlg-foot" });
  const dialog = h("dialog", { class: `dlg glassy${sheet ? " sheet" : ""}`, id, "aria-labelledby": titleId },
    sheet ? h("div", { class: "grab", "aria-hidden": "true" }) : null,
    h("div", { class: "dlg-head" }, h("h2", { id: titleId, text: title }), h("button", { type: "button", class: "iconbtn", id: id ? `${id}-close` : undefined, "aria-label": closeLabel, on: { click: () => close() } }, icon("x"))),
    body, foot);
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  let closed = false;
  const close = (value = null) => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (onClose) onClose(value);
    resolve(value);
  };
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); }); // arka plana tik
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, body, foot, close, done };
}

export async function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = true, closeLabel }) {
  const d = openDialog({ title, id: "confirm-dlg", closeLabel });
  d.body.append(h("p", { text: message }));
  const ok = btn({ label: confirmLabel, cls: danger ? "danger" : "primary", id: "confirm-ok", onClick: () => d.close(true) });
  d.foot.append(btn({ label: cancelLabel, id: "confirm-cancel", onClick: () => d.close(false) }), ok);
  ok.focus();
  return (await d.done) === true;
}
