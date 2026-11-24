// Print > Place cards (U7): the printed sheets, the test sheet and the name fitting (spec 5, design baski-ciktilari.md sections 3 and 4).
// Geometry comes from logic/cardlayout.js (layout(): pt from the top-left of the paper, nudge included); the sheet only places it.
// Names: logic/cardfit.js gives the first size, the DOM correction below shrinks by 0.5 pt (at most 10 times) while the name does not fit.
import { h } from "../../core/ui.js";
import { fitName, FIT } from "./logic/cardfit.js";
import { layout } from "./logic/cardlayout.js";
import { mealSvg, nudgeWords, svgNode } from "./parts.js";

export const PAPER_PAGE = Object.freeze({ letter: "cards-letter", a4: "cards-a4" });
const MM = 25.4 / 72; // mm per pt
const mm = (pt) => (pt * MM).toFixed(5);
const PAD_X = 12, PAD_Y = 10, TABLE_ROW = 6.5; // mm: design section 3 (face padding 6 + 6 side, 5 + 5 top and bottom, 6.5 table line)
const MAX_FIX_ROUNDS = 10;

// The text box of a name (mm), from the face of the card: a tent card prints on its lower half.
export function nameBox(card) {
  const face = card.content;
  const faceH = face.h * MM;
  const w = face.w * MM - PAD_X;
  const hh = Math.max(faceH - PAD_Y - TABLE_ROW, faceH * 0.4); // very small cards: never a box of zero height
  return { wMm: Math.max(w, 5), hMm: hh, faceMm: faceH };
}

// The one name box (pt) of a card layout: Print fits names to it and Check (7) estimates with it (spec 5, O19). `spec` is a card spec
// (cardlayout.resolveCard) or a preset id.
export function nameFitBox(spec) {
  const b = nameBox(layout(spec).cards[0]);
  return { w: b.wMm / MM, h: b.hMm / MM };
}

function markSvg(slot) {
  const svg = mealSvg(slot);
  svg.setAttribute("class", "mark");
  return svg;
}

// entry: { name, tableNumber, slot | null }; one card.
function buildCard(card, tent, entry, showMeal, tableLabel, unnamed) {
  const box = nameBox(card);
  const face = h("div", { class: "pcard-face" },
    h("div", { class: "pcard-namebox" }, h("div", { class: "pcard-name" }, h("bdi", { text: entry.name || unnamed }))),
    h("div", { class: "pcard-table" }, showMeal && entry.slot !== null && entry.slot !== undefined ? markSvg(entry.slot) : null, tableLabel(entry.tableNumber)));
  const el = h("div", { class: `pcard place-card${tent ? " is-tent" : ""}` }, tent ? h("div", { class: "pcard-fold" }) : null, face);
  el.style.setProperty("--x", mm(card.x));
  el.style.setProperty("--y", mm(card.y));
  el.style.setProperty("--w", mm(card.w));
  el.style.setProperty("--h", mm(card.h));
  el.style.setProperty("--fh", box.faceMm.toFixed(5));
  el.style.setProperty("--nh", box.hMm.toFixed(5));
  return el;
}

function cutMark(seg) {
  const horizontal = Math.abs(seg.y1 - seg.y2) < 1e-9;
  const el = h("div", { class: `cut ${horizontal ? "cut-h" : "cut-v"}` });
  el.style.setProperty("--x", mm(Math.min(seg.x1, seg.x2)));
  el.style.setProperty("--y", mm(Math.min(seg.y1, seg.y2)));
  el.style.setProperty("--l", mm(horizontal ? Math.abs(seg.x2 - seg.x1) : Math.abs(seg.y2 - seg.y1)));
  return el;
}

const sheetEl = (l, extra = "") => {
  const el = h("section", { class: `out sheet${extra}`, "data-paper": l.paper.key });
  el.style.setProperty("--pw", l.paper.w.toFixed(5));
  return el;
};

// spec: a card spec (cardlayout.js); off: { x, y } mm x 100; entries: [{ name, tableNumber, slot }] in card order.
// opts: { showMeal, tableLabel(n), unnamed, demoText | null, sizes (optional array of pt, one per entry) }
// -> { sheets: [section.out.sheet], layout, perSheet }
export function buildSheets(spec, off, entries, opts) {
  const l = layout(spec, off);
  const tent = Boolean(spec.tent);
  const per = l.cards.length;
  const sheets = [];
  for (let i = 0; i < entries.length; i += per) {
    const sheet = sheetEl(l);
    for (const seg of l.cutMarks) sheet.append(cutMark(seg));
    entries.slice(i, i + per).forEach((entry, k) => {
      const c = buildCard(l.cards[k], tent, entry, opts.showMeal, opts.tableLabel, opts.unnamed);
      if (opts.sizes && opts.sizes[i + k] !== undefined) c.style.setProperty("--name", `${opts.sizes[i + k]}pt`);
      sheet.append(c);
    });
    if (opts.demoText) sheet.append(h("p", { class: "demo-foot", text: opts.demoText }));
    sheets.push(sheet);
  }
  return { sheets, layout: l, perSheet: per };
}

// Fits every name of the sheets (they must be laid out: the print root in measuring mode).
// -> { sizes: [pt per card, in order], tooLong: [index], estimate: [index] } where tooLong is measured (the name needed less than 12 pt
// or still did not fit after the correction) and estimate is what logic/cardfit.js said for the same box.
export function fitSheets(sheets, spec) {
  const cards = [];
  for (const s of sheets) cards.push(...s.querySelectorAll(".pcard"));
  const box = nameFitBox(spec); // the one name box (pt): Check (7) measures with this same function (measureTooLong)
  const state = cards.map((c) => {
    const name = c.querySelector(".pcard-name");
    const fit = fitName(name.textContent, box.w, box.h);
    return { c, name, maxPx: (box.h * MM * 96) / 25.4, size: fit.size, est: fit.tooLong };
  });
  const apply = (s) => s.c.style.setProperty("--name", `${s.size}pt`);
  state.forEach(apply);
  const over = (s) => {
    const px = s.size * (96 / 72);
    return s.name.offsetHeight > s.maxPx + 0.5 || s.name.scrollWidth > s.name.clientWidth + 0.5
      || Math.round(s.name.offsetHeight / (px * 1.15)) > 2;
  };
  for (let round = 0; round < MAX_FIX_ROUNDS; round++) {
    const bad = state.filter(over); // reads first, writes after: one layout per round
    if (!bad.length) break;
    for (const s of bad) { s.size = Math.max(s.size - FIT.stepPt, 1); apply(s); }
  }
  const stillBad = new Set(state.filter(over));
  return {
    sizes: state.map((s) => s.size),
    tooLong: state.flatMap((s, i) => (s.size < FIT.minPt - 1e-9 || stillBad.has(s) ? [i] : [])),
    estimate: state.flatMap((s, i) => (s.est ? [i] : [])),
  };
}

// Waits for the Lora font (names are measured with it); resolves even if the font cannot load (the measurement uses the fallback).
export async function fontsReady() {
  try {
    await Promise.all(["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 16px Lora`)));
    await document.fonts.ready;
  } catch { /* the measurement still runs with the fallback font */ }
}

// Indexes of `entries` whose name does not fit its card: the decision Print shows (fitSheets), made on a hidden copy of the sheets so
// that Check (7) cannot disagree with Print. Needs the page fonts (await fontsReady() first). entries: [{ name, tableNumber, slot }].
export function measureTooLong(spec, off, entries, opts) {
  const root = h("div", { class: "print-target is-measuring" });
  document.body.append(root);
  try {
    const built = buildSheets(spec, off, entries, opts);
    root.replaceChildren(...built.sheets);
    return fitSheets(built.sheets, spec).tooLong;
  } finally {
    root.remove();
  }
}

// ---- Test sheet (G31) ----

const BAND_H = 13, LEG_H = 9, BAR_H = 5.2, EDGE = 6.35, GAP = 2, BAR_GAP = 0.6, CUT_EXT = 5.08, STEP = 0.5; // mm
const BAR_LENGTHS = [100, 50];

function scaleBar(mm) {
  const hgt = BAR_H, base = 2.9;
  const svg = svgNode("svg", { class: "scalebar", viewBox: `0 0 ${mm} ${hgt}`, width: `${mm}mm`, height: `${hgt}mm`, "aria-hidden": "true", focusable: "false" });
  const line = (x1, y1, x2, y2, sw) => svgNode("line", { x1, y1, x2, y2, stroke: "#1a1a1a", "stroke-width": sw });
  const pt = 25.4 / 72;
  svg.append(line(0, base, mm, base, 0.5 * pt));
  const step = mm / 10;
  for (let i = 0; i <= 10; i++) svg.append(line(i * step, base, i * step, base - (i % 5 === 0 ? 2.6 : 1.8), 0.5 * pt));
  const label = (x, anchor, text) => {
    const t = svgNode("text", { x, y: hgt - 0.1, "text-anchor": anchor, "font-size": 7 * pt, fill: "#1a1a1a" });
    t.textContent = text;
    return t;
  };
  svg.append(label(0, "start", "0"), label(mm / 2, "middle", String(mm / 2)), label(mm, "end", `${mm} mm`));
  return svg;
}

function place(el, x, y, w) {
  el.style.setProperty("left", `${x.toFixed(3)}mm`);
  el.style.setProperty("top", `${y.toFixed(3)}mm`);
  if (w) el.style.setProperty("width", `${w.toFixed(3)}mm`);
  return el;
}

const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// Where the scale bar, the title block and the legend go on the test sheet (design section 4). Pure geometry (mm), no DOM:
// the length of the bar (100 mm, else 50 mm) is known before anything is drawn, so the alignment steps can quote it.
// The bar never sits on a card or a cut mark: it goes in the paper margin above / below the grid, else beside it (a margin that
// is too narrow or cut by cut marks takes the 50 mm bar), else on a second sheet. Text goes above / below the grid, in the upper
// halves of tent cards (blank on a real card), else on the second sheet.
// -> { bar: { mm, where, x, y }, band: { where, x, y, w }, legend: {...} }, where = top | bottom | side | half | second
export function planTestSheet(l, tent) {
  const W = l.paper.w * MM, H = l.paper.h * MM;
  const box = l.cards.reduce((b, c) => ({ x0: Math.min(b.x0, c.x * MM), y0: Math.min(b.y0, c.y * MM), x1: Math.max(b.x1, (c.x + c.w) * MM), y1: Math.max(b.y1, (c.y + c.h) * MM) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const ext = l.cutMarks.length ? CUT_EXT : 0;
  const pad = (r, d) => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });
  const obstacles = [
    ...l.cards.map((c) => ({ x0: c.x * MM, y0: c.y * MM, x1: (c.x + c.w) * MM, y1: (c.y + c.h) * MM })),
    ...l.cutMarks.map((m) => pad({ x0: Math.min(m.x1, m.x2) * MM, y0: Math.min(m.y1, m.y2) * MM, x1: Math.max(m.x1, m.x2) * MM, y1: Math.max(m.y1, m.y2) * MM }, 0)),
    { x0: W - 12.7 - 16, y0: 6.5, x1: W - 12.7 + 0.5, y1: 11.5 }, // the TOP mark
  ];
  const free = (r) => r.x0 >= EDGE - 1e-9 && r.y0 >= EDGE - 1e-9 && r.x1 <= W - EDGE + 1e-9 && r.y1 <= H - EDGE + 1e-9 && !obstacles.some((o) => hit(pad(r, BAR_GAP), o));
  const zones = [
    ["top", { x0: 12.7, y0: EDGE, x1: W - 12.7, y1: box.y0 - BAR_GAP }], // above the grid first (K3 tur 3 B14: the bar is the first thing to measure)
    ["bottom", { x0: 12.7, y0: box.y1 + BAR_GAP, x1: W - 12.7, y1: H - EDGE }],
    ["side", { x0: box.x1 + BAR_GAP, y0: EDGE, x1: W - EDGE, y1: H - EDGE }],
    ["side", { x0: EDGE, y0: EDGE, x1: box.x0 - BAR_GAP, y1: H - EDGE }],
  ];
  let bar = null;
  for (const mm of BAR_LENGTHS) {
    for (const [where, z] of zones) {
      for (let y = z.y0; !bar && y + BAR_H <= z.y1 + 1e-9; y += STEP) {
        for (let x = z.x0; x + mm <= z.x1 + 1e-9; x += STEP) {
          if (free({ x0: x, y0: y, x1: x + mm, y1: y + BAR_H })) { bar = { mm, where, x, y }; break; }
        }
      }
      if (bar) break;
    }
    if (bar) break;
  }
  const secondAt = { y: 10.5 };
  const onSecond = (h) => { const y = secondAt.y; secondAt.y += h + 1; return { where: "second", x: 12.7, y, w: W - 25.4 }; };
  if (!bar) bar = { mm: 100, ...onSecond(BAR_H) };

  // Text: above the grid first, then below it, then (tent) the upper halves of the first two cards, then the second sheet.
  let top = { y: EDGE + (bar.where === "top" ? BAR_H + 1 : 0), limit: box.y0 - ext - GAP };
  let bottom = { y: Math.max(box.y1 + ext + GAP, bar.where === "bottom" ? bar.y + BAR_H + 1 : 0), limit: H - EDGE };
  const halves = tent ? l.cards.slice(0, 2).map((c) => ({ x: c.x * MM + 3, y: c.y * MM + 3, w: c.w * MM - 6, used: false })) : [];
  const text = (h) => {
    if (top.y + h <= top.limit) { const o = { where: "top", x: 12.7, y: top.y, w: W - 25.4 }; top = { ...top, y: top.y + h + 1 }; return o; }
    if (bottom.y + h <= bottom.limit) { const o = { where: "bottom", x: 12.7, y: bottom.y, w: W - 25.4 }; bottom = { ...bottom, y: bottom.y + h + 1 }; return o; }
    const hf = halves.find((x) => !x.used);
    if (hf) { hf.used = true; return { where: "half", x: hf.x, y: hf.y, w: hf.w }; }
    return onSecond(h);
  };
  const band = text(BAND_H);
  const legend = text(LEG_H);
  return { bar, band, legend };
}

// The length (mm) of the scale bar of a card layout: what the alignment steps ask the user to measure.
export const barMmFor = (spec, off) => planTestSheet(layout(spec, off), Boolean(spec.tent)).bar.mm;

// opts: { layoutName, meals: [{ label, slot }], t, nudge: { x, y } (mm x 100), demoText }
// -> { sheets: [section.out.sheet.test] }: one sheet, or two when the scale bar, the texts or the legend have no room on the first.
export function buildTestSheets(spec, off, opts) {
  const { t } = opts;
  const l = layout(spec, off);
  const tent = Boolean(spec.tent);
  const plan = planTestSheet(l, tent);
  const entry = { name: t("guests.card.test.sampleName"), tableNumber: 12, slot: opts.meals.length ? opts.meals[0].slot : null };
  const sheet = sheetEl(l, " test");
  for (const seg of l.cutMarks) sheet.append(cutMark(seg));
  l.cards.forEach((c) => sheet.append(buildCard(c, tent, entry, opts.meals.length > 0, () => t("guests.card.test.sampleTable"), "")));
  sheet.append(h("p", { class: "test-top", text: t("guests.print.topEdge") }));

  const mm = plan.bar.mm;
  const band = h("div", { class: "test-band" },
    h("div", { class: "test-title", text: t("guests.print.test.title", { layout: opts.layoutName, paper: l.paper.name }) }),
    h("p", { text: mm === 100 ? t("guests.card.test.scaleNote") : t("guests.card.test.scaleNoteMm", { mm }) }));
  const [nx, ny] = nudgeWords(t, opts.nudge.x, opts.nudge.y);
  const nudge = h("p", { class: "test-nudge", text: opts.nudge.x === 0 && opts.nudge.y === 0 ? t("guests.print.test.none") : t("guests.print.test.nudge", { x: nx, y: ny }) });
  const legend = h("div", { class: "test-legend" },
    opts.meals.length ? h("div", { class: "legend" }, opts.meals.map((m) => h("span", {}, markSvg(m.slot), h("bdi", { text: m.label })))) : null, nudge);
  const bar = scaleBar(mm);

  let second = null;
  const at = (where) => (where === "second" ? (second ??= sheetEl(l, " test")) : sheet);
  for (const [node, p] of [[band, plan.band], [bar, plan.bar], [legend, plan.legend]]) {
    place(node, p.x, p.y, node === bar ? 0 : p.w);
    at(p.where).append(node);
    if (node !== bar) node.classList.add("is-placed");
  }
  if (opts.demoText) sheet.append(h("p", { class: "demo-foot", text: opts.demoText }));
  const sheets = [sheet];
  if (second) {
    sheet.append(place(h("p", { class: "test-page2", text: t("guests.print.test.page2") }), 12.7, H_MM(l) - EDGE - 6, 0));
    if (opts.demoText) second.append(h("p", { class: "demo-foot", text: opts.demoText }));
    sheets.push(second);
  }
  return { sheets, layout: l, plan };
}

const H_MM = (l) => l.paper.h * MM;
