/* Income & Expense Tracker ikon seti — monokrom, cizgi tabanli, SF tarzi.
   Tamamen ozgun geometri: hicbir dis ikon kutuphanesi ya da yazi tipi kullanilmaz.
   24x24 kutu, currentColor, yuvarlak uc ve birlesim. innerHTML KULLANILMAZ (CSP guvenli). */

const NS = "http://www.w3.org/2000/svg";

/* Her ikon:
   p: path "d" dizisi            l: [x1,y1,x2,y2] cizgiler
   r: [x,y,w,h,rx] yuvarlak dikdortgen    c: [cx,cy,r] daire (cizgi)
   f: [cx,cy,rx,ry] dolu elips   gear: dis sayisi */
const I = Object.freeze({
  chart: { r: [[4.5, 12.5, 3.4, 7, 1], [10.3, 8, 3.4, 11.5, 1], [16.1, 4.5, 3.4, 15, 1]], l: [[3, 20.6, 21, 20.6]] },
  list: { l: [[9, 7, 20, 7], [9, 12, 20, 12], [9, 17, 20, 17]], c: [[4.8, 7, 1.1], [4.8, 12, 1.1], [4.8, 17, 1.1]] },
  car: { p: ["M4 15.5V12l1.8-4.6A2 2 0 0 1 7.7 6h8.6a2 2 0 0 1 1.9 1.4L20 12v3.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 15.5z", "M4.3 12h15.4"], c: [[7.8, 14.6, 1.1], [16.2, 14.6, 1.1]], l: [[6.5, 17, 6.5, 19.2], [17.5, 17, 17.5, 19.2]] },
  report: { p: ["M6.5 3h7.8L18.5 7.2V20a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M14 3v4.5h4.5"], l: [[8.6, 12, 15.4, 12], [8.6, 15.2, 15.4, 15.2], [8.6, 18.2, 12.6, 18.2]] },
  today: { r: [[4.6, 4.4, 14.8, 16.2, 3.2], [8.4, 2.5, 7.2, 4, 2]], l: [[8.8, 12, 15.6, 12], [8.8, 16, 13.4, 16]] },
  calendar: {
    r: [[3.4, 5, 17.2, 15.6, 3.2]], l: [[3.4, 10.2, 20.6, 10.2], [8.2, 2.9, 8.2, 6.8], [15.8, 2.9, 15.8, 6.8]],
    f: [[8.4, 14, .95, .95], [12, 14, .95, .95], [15.6, 14, .95, .95], [8.4, 17.4, .95, .95], [12, 17.4, .95, .95]],
  },
  clients: { c: [[9.2, 8.2, 3.3]], p: ["M3.4 20.4c0-3.3 2.6-5.5 5.8-5.5s5.8 2.2 5.8 5.5", "M16.4 5.5a3.2 3.2 0 0 1 0 6", "M17.7 20.4c0-2.4-.7-4.2-2-5.4"] },
  bell: { p: ["M17.6 16.4c0-7.1.3-10.3-5.6-10.3S6.4 9.3 6.4 16.4", "M4.4 16.4h15.2", "M10.1 19.4a2.1 2.1 0 0 0 3.8 0"], c: [[12, 3.9, 1.15]] },
  income: { r: [[3, 6.4, 18, 11.2, 2.8]], c: [[12, 12, 2.7]], l: [[6.1, 12, 7.3, 12], [16.7, 12, 17.9, 12]] },
  settings: { c: [[12, 12, 3.3], [12, 12, 7.2]], gear: 8 },

  chat: { p: ["M20.4 11.5c0 3.9-3.8 7.1-8.4 7.1-1 0-2-.1-2.9-.4L4.6 19.9l1.3-3.5c-1.5-1.3-2.3-3-2.3-4.9 0-3.9 3.8-7.1 8.4-7.1s8.4 3.2 8.4 7.1z"], f: [[9, 11.5, .95, .95], [12, 11.5, .95, .95], [15, 11.5, .95, .95]] },
  sms: { r: [[3.2, 4.8, 17.6, 12.6, 3.4]], p: ["M8.6 17.4v3.3l3.8-3.3"] },
  mail: { r: [[3, 5.4, 18, 13.2, 3]], p: ["M3.7 7.3 12 13.2l8.3-5.9"] },
  phone: { p: ["M7.5 3.6 9.9 8l-2 2.1a12.2 12.2 0 0 0 6 6l2.1-2 4.4 2.4-1 3.1a1.9 1.9 0 0 1-2.2 1.3C9.9 19.6 4.4 14.1 3.1 6.8a1.9 1.9 0 0 1 1.3-2.2z"] },
  print: { r: [[6.4, 2.7, 11.2, 5.2, 1.6], [3, 7.9, 18, 8.8, 2.8], [6.4, 14.6, 11.2, 6.7, 1.6]], f: [[17.5, 11.3, .95, .95]] },
  camera: { r: [[3, 6.9, 18, 13.2, 3.2], [8.6, 4.1, 6.8, 3.4, 1.4]], c: [[12, 13.5, 3.4]] },
  shield: { p: ["M12 2.9 5.4 5.6v5.9c0 4.3 2.9 7.4 6.6 9.3 3.7-1.9 6.6-5 6.6-9.3V5.6z", "M9 12.2l2.2 2.3 4.2-4.6"] },
  download: { p: ["M12 3.8v10.5", "M8.2 10.9 12 14.6l3.8-3.7", "M4.4 17.3v1.5a2.3 2.3 0 0 0 2.3 2.3h10.6a2.3 2.3 0 0 0 2.3-2.3v-1.5"] },
  check: { p: ["M5 12.7l4.5 4.5L19 7.5"] },
  plus: { l: [[12, 5, 12, 19], [5, 12, 19, 12]] },
  close: { l: [[6.2, 6.2, 17.8, 17.8], [17.8, 6.2, 6.2, 17.8]] },
  edit: { p: ["M4.6 19.4h3.3L19.3 8a2.35 2.35 0 0 0-3.3-3.3L4.6 16.1z", "M14.6 6.1l3.3 3.3"] },
  trash: { p: ["M4.4 6.5h15.2", "M9.4 6.5V4.7a1.5 1.5 0 0 1 1.5-1.5h2.2a1.5 1.5 0 0 1 1.5 1.5v1.8", "M6.5 6.5l.9 12.6a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12.6"] },
  clock: { c: [[12, 12, 8.4]], p: ["M12 7v5.2l3.4 2"] },
  search: { c: [[10.8, 10.8, 6.4]], l: [[15.5, 15.5, 20.2, 20.2]] },
  chevron: { p: ["M9.4 5.4 16 12l-6.6 6.6"] },
  alert: { p: ["M12 4 3.1 19.6h17.8z", "M12 9.8v4.3"], f: [[12, 17.2, .95, .95]] },
  paw: { f: [[12, 15.4, 3.5, 3], [6.9, 10.2, 1.9, 2.3], [10.3, 7.9, 2, 2.5], [13.7, 7.9, 2, 2.5], [17.1, 10.2, 1.9, 2.3]] },
  user: { c: [[12, 8, 3.7]], p: ["M4.6 20.6c0-3.7 3.3-6.1 7.4-6.1s7.4 2.4 7.4 6.1"] },
  sent: { c: [[12, 12, 8.6]], p: ["M8.2 12.2l2.7 2.7 5-5.3"] },
});

function el(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}

/** Disli carki olustur: merkezden disa 8 kisa cizgi. */
function gearTeeth(svg, teeth, sw) {
  for (let i = 0; i < teeth; i++) {
    const a = (Math.PI * 2 * i) / teeth;
    const cos = Math.cos(a), sin = Math.sin(a);
    svg.append(el("line", {
      x1: (12 + 6.8 * cos).toFixed(2), y1: (12 + 6.8 * sin).toFixed(2),
      x2: (12 + 9.4 * cos).toFixed(2), y2: (12 + 9.4 * sin).toFixed(2),
      "stroke-width": (sw * 1.7).toFixed(2),
    }));
  }
}

/**
 * icon("calendar") -> <svg> ogesi. Metin degil, suslemedir: aria-hidden.
 * @param {string} name
 * @param {{size?:number, cls?:string, sw?:number}} [opt]
 */
export function icon(name, opt = {}) {
  const spec = I[name];
  const size = opt.size || 22;
  const sw = opt.sw || 1.8;
  const svg = el("svg", {
    viewBox: "0 0 24 24", width: size, height: size, fill: "none",
    stroke: "currentColor", "stroke-width": sw,
    "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true", focusable: "false", "data-ico": name,
    class: `ico${opt.cls ? " " + opt.cls : ""}`,
  });
  if (!spec) return svg;
  (spec.r || []).forEach(([x, y, w, h, rx]) => svg.append(el("rect", { x, y, width: w, height: h, rx })));
  (spec.c || []).forEach(([cx, cy, r]) => svg.append(el("circle", { cx, cy, r })));
  (spec.l || []).forEach(([x1, y1, x2, y2]) => svg.append(el("line", { x1, y1, x2, y2 })));
  (spec.p || []).forEach((d) => svg.append(el("path", { d })));
  (spec.f || []).forEach(([cx, cy, rx, ry]) => svg.append(el("ellipse", { cx, cy, rx, ry, fill: "currentColor", stroke: "none" })));
  if (spec.gear) gearTeeth(svg, spec.gear, sw);
  return svg;
}

export function hasIcon(name) { return Object.prototype.hasOwnProperty.call(I, name); }
export const ICON_NAMES = Object.freeze(Object.keys(I));
