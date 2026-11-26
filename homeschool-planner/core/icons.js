/* Homeschool Planner ikon seti: Lucide (lucide-static 1.80.0), ISC Lisansi (Feather kokenli olanlar ayrica MIT).
   Telif ve izin notu: core/fonts/THIRD-PARTY-LICENSES.txt (pakete LICENSES.txt olarak girer). Her simge tek tek satir ici SVG olarak
   asagida gomulu; dis dosya, yazi tipi ya da ag istegi yok. 24x24 kutu, currentColor, yuvarlak uc ve birlesim. innerHTML KULLANILMAZ (CSP guvenli). */

const NS = "http://www.w3.org/2000/svg";

// Lucide simgeleri: ad -> [[etiket, ozellikler], ...]
const LUCIDE = Object.freeze({
  "calendar-check": [["path", {"d": "M8 2v3"}], ["path", {"d": "M16 2v3"}], ["rect", {"x": "3", "y": "3", "width": "18", "height": "18", "rx": "2"}], ["path", {"d": "M3 9h18"}], ["path", {"d": "m9 15 2 2 4-4"}]],
  "layout-grid": [["rect", {"width": "7", "height": "7", "x": "3", "y": "3", "rx": "1"}], ["rect", {"width": "7", "height": "7", "x": "14", "y": "3", "rx": "1"}], ["rect", {"width": "7", "height": "7", "x": "14", "y": "14", "rx": "1"}], ["rect", {"width": "7", "height": "7", "x": "3", "y": "14", "rx": "1"}]],
  "chart-column": [["path", {"d": "M3 3v16a2 2 0 0 0 2 2h16"}], ["path", {"d": "M18 17V9"}], ["path", {"d": "M13 17V5"}], ["path", {"d": "M8 17v-3"}]],
  "book-open": [["path", {"d": "M12 5v16"}], ["path", {"d": "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"}]],
  "users": [["path", {"d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}], ["path", {"d": "M16 3.128a4 4 0 0 1 0 7.744"}], ["path", {"d": "M22 21v-2a4 4 0 0 0-3-3.87"}], ["circle", {"cx": "9", "cy": "7", "r": "4"}]],
  "settings": [["path", {"d": "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}], ["circle", {"cx": "12", "cy": "12", "r": "3"}]],
  "plus": [["path", {"d": "M5 12h14"}], ["path", {"d": "M12 5v14"}]],
  "minus": [["path", {"d": "M5 12h14"}]],
  "pencil": [["path", {"d": "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}], ["path", {"d": "m15 5 4 4"}]],
  "x": [["path", {"d": "M18 6 6 18"}], ["path", {"d": "m6 6 12 12"}]],
  "moon": [["path", {"d": "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]],
  "sun": [["circle", {"cx": "12", "cy": "12", "r": "4"}], ["path", {"d": "M12 2v2"}], ["path", {"d": "M12 20v2"}], ["path", {"d": "m4.93 4.93 1.41 1.41"}], ["path", {"d": "m17.66 17.66 1.41 1.41"}], ["path", {"d": "M2 12h2"}], ["path", {"d": "M20 12h2"}], ["path", {"d": "m6.34 17.66-1.41 1.41"}], ["path", {"d": "m19.07 4.93-1.41 1.41"}]],
  "shield-check": [["path", {"d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}], ["path", {"d": "m9 12 2 2 4-4"}]],
  "circle-check": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "m16 9-5.5 5.5L8 12"}]],
  "circle-alert": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["line", {"x1": "12", "x2": "12", "y1": "8", "y2": "12"}], ["line", {"x1": "12", "x2": "12.01", "y1": "16", "y2": "16"}]],
  "loader-circle": [["path", {"d": "M21 12a9 9 0 1 1-6.219-8.56"}]],
  "repeat": [["path", {"d": "m17 2 4 4-4 4"}], ["path", {"d": "M3 11v-1a4 4 0 0 1 4-4h14"}], ["path", {"d": "m7 22-4-4 4-4"}], ["path", {"d": "M21 13v1a4 4 0 0 1-4 4H3"}]],
  "clock": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "M12 6v6l4 2"}]],
  "book-marked": [["path", {"d": "M10 2v7.751a.25.25 0 00.407.195l2.28-1.834a.5.5 0 01.627 0l2.28 1.834A.25.25 0 0016 9.751V2"}], ["path", {"d": "M4 19.5v-15A2.5 2.5 0 016.5 2H19a1 1 0 011 1v18a1 1 0 01-1 1H6.5a1 1 0 010-5H20"}]],
  "triangle-alert": [["path", {"d": "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}], ["path", {"d": "M12 9v4"}], ["path", {"d": "M12 17h.01"}]],
  "info": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "M12 16v-4"}], ["path", {"d": "M12 8h.01"}]],
  "check": [["path", {"d": "M20 6 9 17l-5-5"}]],
  "sparkles": [["path", {"d": "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}], ["path", {"d": "M20 2v4"}], ["path", {"d": "M22 4h-4"}], ["circle", {"cx": "4", "cy": "20", "r": "2"}]],
  "printer": [["path", {"d": "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"}], ["path", {"d": "M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"}], ["rect", {"x": "6", "y": "14", "width": "12", "height": "8", "rx": "1"}]],
  "chevron-left": [["path", {"d": "m15 18-6-6 6-6"}]],
  "chevron-right": [["path", {"d": "m9 18 6-6-6-6"}]],
  "chevron-up": [["path", {"d": "m18 15-6-6-6 6"}]],
  "chevron-down": [["path", {"d": "m6 9 6 6 6-6"}]],
  "globe": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"}], ["path", {"d": "M2 12h20"}]],
  "calendar-days": [["path", {"d": "M8 2v3"}], ["path", {"d": "M16 2v3"}], ["rect", {"x": "3", "y": "3", "width": "18", "height": "18", "rx": "2"}], ["path", {"d": "M3 9h18"}], ["path", {"d": "M8 13h.01"}], ["path", {"d": "M12 13h.01"}], ["path", {"d": "M16 13h.01"}], ["path", {"d": "M8 17h.01"}], ["path", {"d": "M12 17h.01"}], ["path", {"d": "M16 17h.01"}]],
  "circle-check-big": [["path", {"d": "M21.801 10A10 10 0 1 1 17 3.335"}], ["path", {"d": "m9 11 3 3L22 4"}]],
  "file-text": [["path", {"d": "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}], ["path", {"d": "M14 2v5a1 1 0 0 0 1 1h5"}], ["path", {"d": "M10 9H8"}], ["path", {"d": "M16 13H8"}], ["path", {"d": "M16 17H8"}]],
  "target": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["circle", {"cx": "12", "cy": "12", "r": "6"}], ["circle", {"cx": "12", "cy": "12", "r": "2"}]],
  "users-round": [["path", {"d": "M18 21a8 8 0 0 0-16 0"}], ["circle", {"cx": "10", "cy": "8", "r": "5"}], ["path", {"d": "M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}]],
  "download": [["path", {"d": "M12 15V3"}], ["path", {"d": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}], ["path", {"d": "m7 10 5 5 5-5"}]],
  "trash-2": [["path", {"d": "M10 11v6"}], ["path", {"d": "M14 11v6"}], ["path", {"d": "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}], ["path", {"d": "M3 6h18"}], ["path", {"d": "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],
});

// Uygulamanin eski simge adlari -> Lucide simgesi (cagiran kodun adlari degismez).
const ALIAS = Object.freeze({
  today: "calendar-check", grid: "layout-grid", chart: "chart-column", book: "book-open", kids: "users", edit: "pencil", print: "printer",
  up: "chevron-up", down: "chevron-down", close: "x", alert: "triangle-alert", trash: "trash-2", loop: "repeat", prev: "chevron-left", next: "chevron-right",
  back: "chevron-left", chevron: "chevron-right", calendar: "calendar-days", shield: "shield-check", sent: "circle-check",
});

const specOf = (name) => LUCIDE[ALIAS[name] ?? name];

function el(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}

/**
 * icon("today") -> <svg> ogesi. Metin degil, suslemedir: aria-hidden. Cizgi 1.75 (dugme icinde CSS 2'ye cikarir).
 * @param {string} name
 * @param {{size?:number, cls?:string, sw?:number}} [opt]
 */
export function icon(name, opt = {}) {
  const spec = specOf(name);
  const size = opt.size || 20;
  const svg = el("svg", {
    viewBox: "0 0 24 24", width: size, height: size, fill: "none",
    stroke: "currentColor", "stroke-width": opt.sw || 1.75,
    "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true", focusable: "false", "data-ico": name,
    class: `ico${opt.cls ? " " + opt.cls : ""}`,
  });
  if (!spec) return svg;
  for (const [tag, attrs] of spec) svg.append(el(tag, attrs));
  return svg;
}

export function hasIcon(name) { return specOf(name) !== undefined; }
export const ICON_NAMES = Object.freeze([...Object.keys(LUCIDE), ...Object.keys(ALIAS)]);
