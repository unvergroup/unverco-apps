import { notePointer, pointerQuiet } from "./safe.js";
// Kucuk arayuz yardimcilari. Kullanici verisi YALNIZ textContent / metin dugumu ile yazilir.
// Bu dosyada HTML metni olarak yorumlanan hicbir yol yoktur; h() bu tur ozellikleri reddeder.

const FORBIDDEN_PROP = /^(style|innerhtml|outerhtml|on[a-z]+)$/i; // "on" (olay tablosu) serbest; onclick="..." metni yasak
const URL_PROP = /^(href|src|formaction|action|poster|xlink:href)$/i;
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel", "blob"]);

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

export function button({ label, variant = "secondary", type = "button", onClick, ariaLabel, disabled } = {}) {
  return h("button", {
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
      if (msg) dropQuietToasts(); // a new field error is the news now: an older success / info notice must not cover it for 3.5 s
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
export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false, checkbox, infoOnly = false }) {
  return new Promise((resolve) => {
    const titleId = nextId("dt");
    // Cift tikin ikinci tiki pencereyi acip hemen onaylamasin: ayni noktaya 800 ms icinde gelen tik yutulur (core/safe.js)
    const onPointer = (e) => { if (pointerQuiet(e)) e.preventDefault(); else notePointer(e); };
    const box = checkbox
      ? h("input", { type: "checkbox", id: nextId("cb"), checked: checkbox.checked !== false })
      : null;
    const dlg = h(
      "dialog",
      { class: "dialog", "aria-labelledby": titleId },
      h(
        "form",
        { method: "dialog" },
        h("h2", { id: titleId, text: title }),
        // infoOnly: an explanation window with one button; each line of the message is its own paragraph.
        ...(infoOnly ? String(message).split("\n").map((line) => h("p", { text: line })) : [h("p", { text: message })]),
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
      dlg.remove();
      resolve({ confirmed, checked });
    });
    // Pencereyi acan tikin ikinci yarisi (cift tik) onay sayilmasin: pointer ile acildiysa onay dugmesi ilk GUARD_MS boyunca fare / dokunma
    // tikini kabul etmez; fare acan noktadan MOVE_ARM_PX kadar uzaklasirsa (kasitli hareket) hemen kabul eder. Klavye (detail 0) hep calisir.
    const origin = pointerOrigin();
    const openedAt = performance.now();
    let armed = !origin;
    const onMove = (e) => { if (origin && e.pointerType !== "touch" && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) >= MOVE_ARM_PX) armed = true; };
    document.addEventListener("pointermove", onMove, true);
    dlg.addEventListener("close", () => document.removeEventListener("pointermove", onMove, true));
    dlg.querySelector("button[value=ok]").addEventListener("click", (e) => {
      if (e.detail && !armed && performance.now() - openedAt < GUARD_MS) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    document.body.append(dlg);
    dlg.showModal();
    (dlg.querySelector("button[value=cancel]") ?? dlg.querySelector("button[value=ok]")).focus(); // guvenli varsayilan: Iptal
  });
}

// Bildirim. #toast-region (aria-live) index.html'de bulunur; ekranin sag altinda sabit durur (app.css). Orttugu icerik icin uc kural:
//  1. Bildirim varken sayfa altina --toast-space kadar bosluk eklenir ve odaktaki girdi / az once basilan dugme (ve ayni satirdaki /
//     formdaki komsulari) bildirimin ustune kaydirilir (keepClear): bildirim odaktaki alani ve dugmeyi ortmez.
//  2. 560 px altinda ayni anda TEK bildirim: yenisi eskisinin yerine gecer; ekranda hata varsa daha dusuk onemli (basari / bilgi /
//     uyari) yenisi gosterilmez, hata kapatilana kadar yerinde kalir.
//  3. Gorunum degisince basari / bilgi bildirimleri temizlenir (clearToasts); hata bildirimi kapatilana kadar kalir.
// Kalici uyarilar (demo siniri gibi) bildirim katmaninda degil, ilgili gorunumun icinde satir ici seritte durur (showNotice).
// Basari / bilgi kisa surer; uyari uzun surer; hata kendiliginden KAYBOLMAZ. Uyari ve hata kapat dugmesi tasir.
// Genis ekranda en cok MAX_TOASTS bildirim: asilirsa once en eski basari / bilgi, sonra en eski uyari, en son en eski hata duser.
// Ayni metin zaten gorunuyorsa tekrar eklenmez. Ekran okuyucu: bolge aria-live="polite", hata role="alert"; dusen bildirim
// zaten duyurulmus olur, bolgenin kendisi hic degismez.
const TOAST_MS = { success: 3500, info: 3500, warn: 10000 };
export const MAX_TOASTS = 3;
export const NARROW_PX = 560;
const DROP_ORDER = ["success", "info", "warn", "error"];
const isNarrow = () => Boolean(globalThis.matchMedia && globalThis.matchMedia(`(max-width: ${NARROW_PX}px)`).matches);

function syncToastSpace(region) {
  const root = document.documentElement;
  root.style.setProperty("--toast-space", region.children.length ? `${Math.ceil(region.getBoundingClientRect().height) + 24}px` : "0px");
}

// ---- Cift tik korumasi (belge duzeyinde, tek yer) -------------------------------------------------------------------------------
// Kazara ikinci tik "ayni YER, kisa sure, FARKLI denetim" olgusudur: ilk tik bir pencere acar / bir seridi kapatir / bir sekmeyi degistirir
// ve ayni noktaya baska bir denetim gelir (onay penceresinin Delete dugmesi, serit kalkinca kayan "Mark as printed", kayan sekme).
// Kural: bir fare / dokunma tikindan sonra GUARD_MS icinde, GUARD_PX yaricapindaki ayni noktaya gelen ve FARKLI bir denetime dusen tik
// yutulur. Denetim DOM dugumuyle degil kararli bir anahtarla (controlKey) taninir: yeniden cizimde ayni denetim yeni dugum olarak gelir.
// Hizli tekrar edilen denetimler (sayi artir / azalt) data-rapid niteligiyle muaftir. Klavye (Enter / Space, event.detail === 0),
// element.click() ve change olaylari ASLA yutulmaz. Ayni denetime cift tik burada degil, eylemin kendi "iki kez yazmasin" korumasindadir.
export const GUARD_MS = 800;
export const GUARD_PX = 30;
const MOVE_ARM_PX = 12;
const ACTUATING = "button, a[href], summary, input[type=checkbox], input[type=radio], input[type=button], input[type=submit], label, [role=tab], [role=button]";
const ACTUATING_CONTROL = ACTUATING.replace(", label", "");

// Tikin vurdugu denetimin kararli anahtari; denetim degilse (metin, bos alan, metin girdisi) null.
export function controlKey(target) {
  let c = target && target.closest ? target.closest(ACTUATING) : null;
  if (c && c.tagName === "LABEL") c = c.control && c.control.matches(ACTUATING_CONTROL) ? c.control : null; // label -> girdisi: ayni denetim
  if (!c) return null;
  const dlg = c.closest("dialog");
  const scope = dlg ? `d:${(dlg.querySelector("h2") || {}).textContent || ""}` : "p";
  const name = c.dataset.key || c.getAttribute("aria-label") || (c.tagName === "INPUT" ? `${c.name}:${c.value}` : (c.textContent || "").trim().slice(0, 80)) || c.id;
  return `${c.tagName}|${c.getAttribute("role") || ""}|${name}|${scope}`;
}

// Saf karar (birim testi icin): prev = { x, y, t, key } | null, cur = { x, y, t, key, rapid }.
export function swallowsClick(prev, cur) {
  if (!prev || !cur.key || cur.rapid || cur.key === prev.key) return false;
  return cur.t - prev.t <= GUARD_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= GUARD_PX;
}

let lastClick = null; // yutulmayan son fare / dokunma tiki: { x, y, t, key }
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    if (!e.detail) return; // klavye etkinlestirmesi ve element.click()
    const key = controlKey(e.target);
    if (!key) return;
    const cur = { x: e.clientX, y: e.clientY, t: performance.now(), key, rapid: Boolean(e.target.closest && e.target.closest("[data-rapid]")) };
    if (swallowsClick(lastClick, cur)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    lastClick = cur;
  }, true);
}
// Onay penceresi icin: pencereyi acan fare tikinin noktasi (yoksa null: klavye ile ya da bir sure once acilmis).
function pointerOrigin() {
  return lastClick && performance.now() - lastClick.t < 1500 ? { x: lastClick.x, y: lastClick.y } : null;
}

// The control the person just pressed (it may be redrawn a moment later: then its row / form neighbours are kept clear instead).
let lastPressed = null;
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => { lastPressed = e.target && e.target.closest ? e.target.closest("button, a, summary, [role=button]") : null; }, true);
}
const GROUP = "form, .row, .field, .nudge, .chip";
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

export function toast(message, { kind = "info", ms, closeLabel = "Close" } = {}) {
  const region = document.getElementById("toast-region");
  if (!region) return null;
  const drop = (el) => { el.remove(); syncToastSpace(region); };
  const narrow = isNarrow();
  if (narrow && kind !== "error" && [...region.children].some((c) => c.dataset.kind === "error")) return null; // the error stays
  for (const old of [...region.children]) if (old.dataset.msg === message) old.remove();
  const timeout = kind === "error" ? null : ms ?? TOAST_MS[kind] ?? 3500;
  const el = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : null, dataset: { msg: message, kind } }, h("span", { class: "toast-text", text: message }));
  if (kind === "error" || kind === "warn" || timeout === null || timeout > 5000) {
    el.append(h("button", { type: "button", class: "toast-close", "aria-label": closeLabel, text: "\u00d7", on: { click: () => drop(el) } }));
  }
  region.append(el);
  const max = narrow ? 1 : MAX_TOASTS; // one at a time under 560 px
  while (region.children.length > max) {
    const older = [...region.children].filter((c) => c !== el); // the new one stays; the oldest of the least important kind goes
    const victim = DROP_ORDER.map((k) => older.find((c) => c.dataset.kind === k)).find(Boolean) ?? older[0];
    victim.remove();
  }
  syncToastSpace(region);
  queueKeepClear();
  if (timeout !== null) setTimeout(() => drop(el), timeout);
  return el;
}

// A field error appeared: success and info notifications close at once (warnings and errors stay).
function dropQuietToasts() {
  const region = typeof document !== "undefined" ? document.getElementById("toast-region") : null;
  if (!region) return;
  for (const c of [...region.children]) if (c.dataset.kind === "success" || c.dataset.kind === "info") c.remove();
  syncToastSpace(region);
}

// The view changed: success / info notifications are done with; errors stay until they are closed.
export function clearToasts() {
  const region = document.getElementById("toast-region");
  if (!region) return;
  for (const c of [...region.children]) if (c.dataset.kind !== "error") c.remove();
  syncToastSpace(region);
}

// In-view strip for warnings that must stay (demo limits, "a list holds up to six meals"): the first child of the panel, in the page
// flow (never over the content), one at a time. It goes when the person closes it or changes the view (clearNotice).
export const NOTICE_ID = "notice-strip";
export function clearNotice() {
  const el = document.getElementById(NOTICE_ID);
  if (el) el.remove();
}
export function showNotice(host, message, { closeLabel = "Close" } = {}) {
  if (!host) return null;
  clearNotice();
  const el = h("div", { class: "banner banner-warn row notice-strip no-print", id: NOTICE_ID, role: "status" },
    h("span", { class: "grow", text: message }),
    button({ label: closeLabel, variant: "ghost", onClick: () => el.remove() }));
  host.prepend(el);
  if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  return el;
}
