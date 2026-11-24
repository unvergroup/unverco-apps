// Kucuk arayuz yardimcilari. Kullanici verisi YALNIZ textContent / metin dugumu ile yazilir.
// Bu dosyada HTML metni olarak yorumlanan hicbir yol yoktur; h() bu tur ozellikleri reddeder.

import { installClickGuard } from "./click-guard.js";
import { notePointer, pointerQuiet } from "./safe.js";

installClickGuard(); // belge duzeyinde konum korumasi (bkz. core/click-guard.js)

const FORBIDDEN_PROP = /^(style|innerhtml|outerhtml|on[a-z]+)$/i; // "on" (olay tablosu) serbest; onclick="..." metni yasak
const URL_PROP = /^(href|src|formaction|action|poster|xlink:href)$/i;
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel", "sms", "blob"]);

// Goreli adresler ve guvenli semalar (http, https, mailto, tel, blob) serbest; javascript:, data: vb. degil.
// Tarayicilarin semada yok saydigi bosluk / kontrol karakterleri once atilir ("java\tscript:").
export function isSafeUrl(value) {
  const s = String(value).replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200d\u2028\u2029\ufeff]/g, "");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  return m ? SAFE_SCHEMES.has(m[1].toLowerCase()) : true;
}

// h("button", { class: "btn", on: { click: fn }, "aria-label": "x" }, "Metin", altDugum)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (FORBIDDEN_PROP.test(k) && k !== "on") throw new Error(`h(): "${k}" is not allowed`);
    if (URL_PROP.test(k) && !isSafeUrl(v)) throw new Error(`h(): unsafe URL in "${k}" is not allowed`);
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

let uid = 0;
export const nextId = (p = "id") => `${p}-${++uid}`;

// exportAction: bu dugme yazdirir ya da dosya indirir; onizleme kipinde core/preview.js bunu kapatir.
export function button({ label, variant = "secondary", type = "button", onClick, ariaLabel, disabled, id, exportAction = false, icon } = {}) {
  // icon: "back" | "prev" (metinden once) | "next" (sonra); yon simgesini CSS cizer ve RTL'de aynalar (metne ok karakteri yazilmaz)
  return h("button", {
    id,
    "data-export": exportAction ? "1" : undefined,
    "data-icon": icon,
    type,
    class: `btn btn-${variant}`,
    "aria-label": ariaLabel,
    disabled,
    on: onClick ? { click: onClick } : undefined,
    text: label,
  });
}

// Sekmeli gezinme (ARIA tablist; ok tuslari, Home/End).
export function createTabs({ items, selected, label, onSelect }) {
  const list = h("div", { role: "tablist", class: "tabs", "aria-label": label });
  const btns = new Map();
  const mark = (id) => {
    for (const [bid, b] of btns) {
      const on = bid === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const select = (id, focus = false) => {
    mark(id);
    if (focus) btns.get(id).focus();
    onSelect(id);
  };
  const ids = items.map((i) => i.id);
  for (const it of items) {
    const b = h("button", {
      type: "button",
      role: "tab",
      class: "tab",
      id: `tab-${it.id}`,
      "aria-controls": "panel",
      "aria-selected": "false",
      tabindex: "-1",
      text: it.label,
      on: {
        click: () => select(it.id),
        keydown: (e) => {
          const i = ids.indexOf(it.id);
          let n = null;
          if (e.key === "ArrowRight") n = ids[(i + 1) % ids.length];
          else if (e.key === "ArrowLeft") n = ids[(i - 1 + ids.length) % ids.length];
          else if (e.key === "Home") n = ids[0];
          else if (e.key === "End") n = ids[ids.length - 1];
          if (n) {
            e.preventDefault();
            select(n, true);
          }
        },
      },
    });
    btns.set(it.id, b);
    list.append(b);
  }
  mark(selected ?? ids[0]); // ilk isaretleme onSelect cagirmaz
  return { element: list, select };
}

// Dogrulama hatasinda ilk hatali alana odak ve gorunume kaydirma (kisa ekranda hatali alan gorunum disinda kalmasin).
export function focusFirstInvalid(root) {
  const el = root && root.querySelector ? root.querySelector('[aria-invalid="true"]') : null;
  if (!el) return false;
  if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
  return true;
}

// Penceredeki ilk dolu hata metnini gorunume getirir (yapiskan dugme seridinin altinda kalmasin; kaydirma payi .dialog scroll-padding'inden gelir).
export function revealFirstError(root) {
  const el = root && root.querySelectorAll ? [...root.querySelectorAll(".field-error")].find((e) => e.textContent.trim() !== "") : null;
  if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  return Boolean(el);
}

// Form alani: etiket + girdi (+ ipucu / hata). { element, input, setError }
export function field({ label, type = "text", value = "", required = false, hint, multiline = false, ...attrs }) {
  const id = nextId("f");
  const input = multiline
    ? h("textarea", { id, rows: 3, ...attrs })
    : h("input", { id, type, ...attrs });
  input.value = value ?? "";
  if (required) input.required = true;
  const err = h("p", { class: "field-error", id: `${id}-err`, role: "alert" });
  const hintEl = hint ? h("p", { class: "field-hint", id: `${id}-hint`, text: hint }) : null;
  const describedBy = [hintEl ? hintEl.id : null, err.id].filter(Boolean).join(" ");
  input.setAttribute("aria-describedby", describedBy);
  const element = h("div", { class: "field" }, h("label", { for: id, text: label }), input, hintEl, err);
  return {
    element,
    input,
    setError(msg) {
      err.textContent = msg || "";
      input.setAttribute("aria-invalid", msg ? "true" : "false");
    },
  };
}

// id verilirse yeniden cizimden sonra odak ayni denetime geri verilebilir.
export function select({ label, value, options, onChange, id: fixedId }) {
  const id = fixedId ?? nextId("s");
  const el = h(
    "select",
    { id, on: onChange ? { change: () => onChange(el.value) } : undefined },
    options.map((o) => h("option", { value: o.value, text: o.label, selected: o.value === value }))
  );
  return { element: h("div", { class: "field" }, h("label", { for: id, text: label }), el), input: el };
}

// columns: [{ key, label, align?: "num", narrowHide?, render?(row) -> Node|string }]
// Dar ekranda (CSS) satirlar karta donusur; her hucrede data-label bulunur.
export function table({ caption, columns, rows, footer }) {
  const head = h(
    "tr",
    {},
    columns.map((c) => h("th", { scope: "col", class: cellClass(c), text: c.label }))
  );
  const body = rows.map((row) =>
    h(
      "tr",
      {},
      columns.map((c) => {
        const content = c.render ? c.render(row) : row[c.key];
        const empty = content === undefined || content === null || content === "";
        return h("td", { class: `${cellClass(c)} ${empty ? "cell-empty" : ""}`.trim(), "data-label": c.label }, content ?? "");
      })
    )
  );
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "data-table" },
      h("caption", { text: caption }),
      h("thead", {}, head),
      h("tbody", {}, body),
      footer ? h("tfoot", {}, footer) : null
    )
  );
}
const cellClass = (c) => [c.align === "num" ? "num" : "", c.narrowHide ? "narrow-hide" : "", c.actions ? "actions-col" : "", c.nowrap ? "nowrap" : ""].filter(Boolean).join(" ");

export function emptyState({ title, text }) {
  return h("div", { class: "empty" }, h("h3", { text: title }), text ? h("p", { text }) : null);
}

// Onay penceresi (yerel <dialog>; odak kapana, Esc iptal). Doner: { confirmed, checked }.
export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false, checkbox, checkbox2, notes = [], infoOnly = false }) {
  return new Promise((resolve) => {
    const titleId = nextId("dt");
    // Cift tikin ikinci tiki pencereyi acip hemen onaylamasin / kapatmasin: ayni noktaya 800 ms icinde gelen tik yutulur (core/safe.js)
    const onPointer = (e) => { if (pointerQuiet(e)) e.preventDefault(); else notePointer(e); };
    const box = checkbox
      ? h("input", { type: "checkbox", id: nextId("cb"), checked: checkbox.checked !== false })
      : null;
    const box2 = checkbox2
      ? h("input", { type: "checkbox", id: nextId("cb"), checked: checkbox2.checked !== false })
      : null;
    const dlg = h(
      "dialog",
      { class: "dialog", "aria-labelledby": titleId },
      h(
        "form",
        { method: "dialog" },
        h("h2", { id: titleId, text: title }),
        h("p", { text: message }),
        ...notes.map((n) => h("p", { class: "muted", text: n })), // ek aciklamalar (orn. yedegin para birimi farki)
        box2 ? h("label", { class: "check", for: box2.id }, box2, " ", checkbox2.label) : null,
        box ? h("label", { class: "check", for: box.id }, box, " ", checkbox.label) : null,
        h(
          "div",
          { class: "dialog-actions" },
          infoOnly ? null : h("button", { type: "submit", value: "cancel", class: "btn btn-secondary", text: cancelLabel, on: { click: onPointer } }),
          h("button", { type: "submit", value: "ok", class: `btn ${danger ? "btn-danger" : "btn-primary"}`, text: confirmLabel, on: { click: onPointer } })
        )
      )
    );
    dlg.addEventListener("close", () => {
      const confirmed = dlg.returnValue === "ok";
      const checked = box ? box.checked : false;
      const checked2 = box2 ? box2.checked : false;
      dlg.remove();
      resolve({ confirmed, checked, checked2 });
    });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector(infoOnly ? "button[value=ok]" : "button[value=cancel]").focus(); // guvenli varsayilan: Iptal (yalniz bilgi penceresinde: Kapat)
  });
}

// Bildirim. #toast-region (aria-live) index.html'de bulunur; akisin sonunda durur ve gorunur alanin altina yapisir (app.css).
// Orttugu icerik icin: bildirim varken --toast-space (html scroll-padding-bottom) bildirim yuksekligi kadar verilir ve odaktaki girdi /
// az once basilan dugme (ve ayni satirdaki / formdaki komsulari) bildirimin ustune kaydirilir (keepClear). Ekran ya da arac degisince
// bolge bosaltilir (clearToasts). Basari / bilgi kisa surer; uyari uzun surer (ms verilirse o kadar); hata kendiliginden KAYBOLMAZ.
// Ayni metin zaten gorunuyorsa tekrar eklenmez.
const TOAST_MS = { success: 3500, info: 3500, warn: 10000 };

function syncToastSpace(region) {
  document.documentElement.style.setProperty("--toast-space", region.children.length ? `${Math.ceil(region.getBoundingClientRect().height) + 8}px` : "0px");
}

// Az once basilan denetim (yeniden cizilirse satir / form komsulari korunur).
let lastPressed = null;
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => { lastPressed = e.target && e.target.closest ? e.target.closest("button, a, summary, [role=button]") : null; }, true);
}
const GROUP = "form, .row, .field";
let clearQueued = false;
function keepClear() {
  const region = document.getElementById("toast-region");
  if (!region || !region.children.length) return;
  const g = region.getBoundingClientRect();
  let need = 0;
  for (const el of [document.activeElement, lastPressed]) {
    if (!el || el === document.body || !el.isConnected || region.contains(el)) continue;
    const box = el.closest ? el.closest(GROUP) : null;
    for (const node of box && box.getBoundingClientRect().height <= 200 ? [el, box] : [el]) {
      const r = node.getBoundingClientRect();
      if (r.right > g.left && r.left < g.right && r.bottom > g.top && r.top < g.bottom) need = Math.max(need, r.bottom - g.top + 8);
    }
  }
  if (need > 0) window.scrollBy(0, need);
}
function queueKeepClear() {
  if (clearQueued) return;
  clearQueued = true;
  requestAnimationFrame(() => { clearQueued = false; keepClear(); });
}
if (typeof document !== "undefined") document.addEventListener("focusin", queueKeepClear);

// Ekran / arac degisince: butun bildirimler kalkar (hata dahil; baska ekranin mesaji yeni ekranda anlamsizdir).
export function clearToasts() {
  const region = document.getElementById("toast-region");
  if (!region) return;
  region.replaceChildren();
  syncToastSpace(region);
}

export function toast(message, { kind = "info", ms, closeLabel = "Close" } = {}) {
  const region = document.getElementById("toast-region");
  if (!region) return null;
  const drop = (el) => { el.remove(); syncToastSpace(region); };
  for (const old of [...region.children]) if (old.dataset.msg === message) old.remove();
  const timeout = ms ?? (kind === "error" ? null : TOAST_MS[kind] ?? 3500);
  const el = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : null, dataset: { msg: message } }, h("span", { class: "toast-text", text: message }));
  if (timeout === null || timeout > 5000) {
    el.append(h("button", { type: "button", class: "toast-close", "aria-label": closeLabel, text: "×", on: { click: () => drop(el) } }));
  }
  region.append(el);
  syncToastSpace(region);
  queueKeepClear();
  if (timeout !== null) setTimeout(() => drop(el), timeout);
  return el;
}

// Ekran icinde gorunen kalici bildirim seridi (toast gecici, bu kalici). kind: "info" | "warn" | "error". Metin YALNIZ textContent.
export function showNotice(message, { kind = "info", id } = {}) {
  return h("p", { id, class: `banner banner-${kind === "info" ? "info" : kind}`, role: kind === "error" ? "alert" : "status", text: message });
}
