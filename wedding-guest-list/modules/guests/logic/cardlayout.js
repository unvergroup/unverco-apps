// Place card geometry, custom size and nudge validation, cut marks, test sheet items (spec 5: G30, G31; audit O25).
// Pure logic: no DOM, no store, no imports. No sentence for the user is written here (audit T-O1): validation returns codes and
// numbers, the texts are the dictionary keys guests.card.* in messages.js (the rule for the keys is written there).
//
// Units: the plan stores millimetres x 100 as integers, so all arithmetic and every comparison is done on those integers
// (exact; 6.35 mm is 635, a fit of 215.90 mm is 21590). Points (1 mm = 72 / 25.4 pt) appear only in the output, unrounded.
// Offsets are { x, y } in mm x 100: positive x moves right, positive y moves down (plan.offX100 / offY100).

export const PAPERS = Object.freeze({
  letter: Object.freeze({ name: "Letter", w100: 21590, h100: 27940 }),
  a4: Object.freeze({ name: "A4", w100: 21000, h100: 29700 }),
});

const preset = (o) => Object.freeze({ gapX100: 0, gapY100: 0, ...o });

// Ready layouts: spec 5, [assumption] until checked with a real blank card pack. A layout is a card grid on a sheet.
export const PRESETS = Object.freeze({
  "tent-3.5x2-letter4": preset({
    id: "tent-3.5x2-letter4",
    paper: "letter", w100: 8890, h100: 10160, cols: 2, rows: 2, left100: 1905, top100: 3810, tent: true, cut: false,
  }),
  "diy-tent-letter4": preset({
    id: "diy-tent-letter4",
    paper: "letter", w100: 9525, h100: 12700, cols: 2, rows: 2, left100: 1270, top100: 1270, tent: true, cut: true,
  }),
});
export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));

export const LIMITS = Object.freeze({
  size100: Object.freeze({ min: 2000, max: 20000 }),
  grid: Object.freeze({ min: 1, max: 10 }),
  origin100: Object.freeze({ min: 0, max: 5000 }),
  gap100: Object.freeze({ min: 0, max: 2000 }),
  nudge: Object.freeze({ max100: 1000, step100: 50 }),
  edge100: 635, // 6.35 mm: closer than this to the paper edge is a warning
});

export const CUT_MARK = Object.freeze({ length100: 508, widthPt: 0.5 }); // 5.08 mm extension of the grid lines, 0.5 pt
const SCALE_BAR_100 = 10000; // 100 mm
const FRAME_WIDTH_PT = 0.25;

export const mmToPt = (mm100) => (mm100 * 72) / 2540;

const isInt = (v) => typeof v === "number" && Number.isInteger(v);

// A spec is { id, paper, w100, h100, cols, rows, left100, top100, gapX100, gapY100, tent, cut }.
// Presets by id; custom cards come from plan.customCard. Custom cards carry cut marks when they are flat paper (not tent).
// Returns null for an unknown id or a missing custom card. No validation here (see validateCustom).
export function resolveCard(cardPreset, customCard) {
  if (cardPreset === "custom") {
    if (!customCard || typeof customCard !== "object") return null;
    return { ...customCard, id: "custom", cut: customCard.tent !== true };
  }
  return Object.hasOwn(PRESETS, cardPreset) ? PRESETS[cardPreset] : null;
}

function toSpec(card) {
  if (typeof card === "string") {
    const s = Object.hasOwn(PRESETS, card) ? PRESETS[card] : null;
    if (!s) throw new RangeError(`Unknown card layout: ${card}`);
    return s;
  }
  if (!card || typeof card !== "object") throw new TypeError("Card layout must be a preset id or a spec object");
  return { gapX100: 0, gapY100: 0, ...card, cut: card.cut ?? card.tent !== true };
}

function toOffset(off) {
  const o = off ?? {};
  const pick = (v) => {
    if (v === undefined) return 0;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError("Offset must be a finite number (mm x 100)");
    return v;
  };
  return { x: pick(o.x), y: pick(o.y) };
}

// Grid extent in mm x 100 on the sheet, nudge included.
function extent(s, o) {
  const x0 = s.left100 + o.x, y0 = s.top100 + o.y;
  return {
    x0, y0,
    x1: x0 + s.cols * s.w100 + (s.cols - 1) * s.gapX100,
    y1: y0 + s.rows * s.h100 + (s.rows - 1) * s.gapY100,
  };
}

const seg = (x1, y1, x2, y2) => ({ x1: mmToPt(x1), y1: mmToPt(y1), x2: mmToPt(x2), y2: mmToPt(y2) });

function cutMarks(s, e, paper) {
  const xs = new Set(), ys = new Set();
  for (let c = 0; c < s.cols; c++) {
    xs.add(e.x0 + c * (s.w100 + s.gapX100));
    xs.add(e.x0 + c * (s.w100 + s.gapX100) + s.w100);
  }
  for (let r = 0; r < s.rows; r++) {
    ys.add(e.y0 + r * (s.h100 + s.gapY100));
    ys.add(e.y0 + r * (s.h100 + s.gapY100) + s.h100);
  }
  const L = CUT_MARK.length100;
  const marks = [];
  const sorted = (set) => [...set].sort((a, b) => a - b);
  for (const x of sorted(xs)) {
    if (x < 0 || x > paper.w100) continue;
    if (Math.max(0, e.y0 - L) < e.y0) marks.push(seg(x, Math.max(0, e.y0 - L), x, e.y0));
    if (e.y1 < Math.min(paper.h100, e.y1 + L)) marks.push(seg(x, e.y1, x, Math.min(paper.h100, e.y1 + L)));
  }
  for (const y of sorted(ys)) {
    if (y < 0 || y > paper.h100) continue;
    if (Math.max(0, e.x0 - L) < e.x0) marks.push(seg(Math.max(0, e.x0 - L), y, e.x0, y));
    if (e.x1 < Math.min(paper.w100, e.x1 + L)) marks.push(seg(e.x1, y, Math.min(paper.w100, e.x1 + L), y));
  }
  return marks;
}

// Everything needed to draw the sheet, in pt from the top-left of the paper:
// { paper: { key, name, w, h }, offset, cards: [{ index, col, row, x, y, w, h, content }], foldLines, cutMarks }
// `cards` are row-major. `content` is the text box: the lower half of a tent card, the whole of a flat card.
// `card` is a preset id or a spec; `off` is { x, y } in mm x 100 (missing = 0).
export function layout(card, off) {
  const s = toSpec(card);
  const paper = PAPERS[s.paper];
  if (!paper) throw new RangeError(`Unknown paper: ${s.paper}`);
  const o = toOffset(off);
  const e = extent(s, o);
  const cards = [], foldLines = [];
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      const x = e.x0 + c * (s.w100 + s.gapX100), y = e.y0 + r * (s.h100 + s.gapY100);
      const pt = { x: mmToPt(x), y: mmToPt(y), w: mmToPt(s.w100), h: mmToPt(s.h100) };
      const content = s.tent ? { x: pt.x, y: pt.y + pt.h / 2, w: pt.w, h: pt.h / 2 } : { ...pt };
      cards.push({ index: r * s.cols + c, col: c, row: r, ...pt, content });
      if (s.tent) foldLines.push({ x1: pt.x, y1: pt.y + pt.h / 2, x2: pt.x + pt.w, y2: pt.y + pt.h / 2 });
    }
  }
  return {
    paper: { key: s.paper, name: paper.name, w: mmToPt(paper.w100), h: mmToPt(paper.h100) },
    offset: o,
    cards,
    foldLines,
    cutMarks: s.cut ? cutMarks(s, e, paper) : [],
  };
}

// 4.1 for 410 hundredths of a millimetre; rounds up so a real overflow never shows as 0.0. The view shows it with toFixed(1).
const mmUp = (h) => Math.ceil(h / 10) / 10;
// An error is { code, field?, ...numbers }; a warning is { code }. No text.
const err = (code, field, extra) => ({ code, ...(field ? { field } : {}), ...extra });
const overflow = (code, h) => err(code, null, { mm100: h, byMm: mmUp(h) });

const FIELD_RULES = [
  ["w100", LIMITS.size100, "mm"], ["h100", LIMITS.size100, "mm"],
  ["cols", LIMITS.grid, ""], ["rows", LIMITS.grid, ""],
  ["left100", LIMITS.origin100, "mm"], ["top100", LIMITS.origin100, "mm"],
  ["gapX100", LIMITS.gap100, "mm"], ["gapY100", LIMITS.gap100, "mm"],
];

// range: { field, code: "range", min, max, unit } with min / max in mm when unit is "mm" (else plain counts).
const rangeErr = (field, lo, hi, unit) => err("range", field, unit ? { min: lo / 100, max: hi / 100, unit } : { min: lo, max: hi, unit });

function cardFieldErrors(c) {
  if (!c || typeof c !== "object") return [err("invalid", "card")];
  const out = [];
  if (!Object.hasOwn(PAPERS, c.paper)) out.push(err("invalid", "paper"));
  for (const [field, range, unit] of FIELD_RULES) {
    const v = c[field];
    if (!isInt(v)) { out.push(err("invalid", field)); continue; }
    if (v < range.min || v > range.max) out.push(rangeErr(field, range.min, range.max, unit));
  }
  if (typeof c.tent !== "boolean") out.push(err("invalid", "tent"));
  return out;
}

function offsetErrors(off) {
  const o = off && typeof off === "object" ? off : {};
  const out = [];
  for (const field of ["x", "y"]) {
    const v = o[field];
    if (!isInt(v)) out.push(err("invalid", field));
    else if (Math.abs(v) > LIMITS.nudge.max100) out.push(rangeErr(field, -LIMITS.nudge.max100, LIMITS.nudge.max100, "mm"));
    else if (v % LIMITS.nudge.step100 !== 0) out.push(err("step", field, { stepMm: LIMITS.nudge.step100 / 100 }));
  }
  return out;
}

// Hard errors when the grid (nudge included) leaves the sheet; the edge warning when any content, cut marks included,
// is closer than 6.35 mm to the paper edge. Expects valid fields and a spec with `cut` set.
function fitReport(s, o) {
  const paper = PAPERS[s.paper];
  const e = extent(s, o);
  const errors = [], warnings = [];
  if (e.x1 > paper.w100) errors.push(overflow("tooWide", e.x1 - paper.w100));
  if (e.y1 > paper.h100) errors.push(overflow("tooTall", e.y1 - paper.h100));
  if (e.x0 < 0) errors.push(overflow("pastLeft", -e.x0));
  if (e.y0 < 0) errors.push(overflow("pastTop", -e.y0));
  if (errors.length === 0) {
    const pad = s.cut ? CUT_MARK.length100 : 0;
    const near = Math.min(e.x0 - pad, e.y0 - pad, paper.w100 - (e.x1 + pad), paper.h100 - (e.y1 + pad));
    if (near < LIMITS.edge100) warnings.push(err("edge"));
  }
  return { errors, warnings };
}

const result = (errors, warnings = []) => ({ ok: errors.length === 0, errors, warnings });

// Validation of the custom size form (spec 5, O25). `custom` is plan.customCard; `off` is the nudge (default none).
// -> { ok, errors: [{ code, field?, ... }], warnings: [{ code }] }   (codes and numbers only; see the dictionary rule in messages.js)
// Errors block saving: field errors (invalid | range) or the cards leaving the sheet (tooWide | tooTall | pastLeft | pastTop).
export function validateCustom(custom, off) {
  const fields = cardFieldErrors(custom);
  if (fields.length) return result(fields);
  const fit = fitReport(resolveCard("custom", custom), toOffset(off));
  return result(fit.errors, fit.warnings);
}

// Validation of the nudge fields (-10..+10 mm, 0.5 mm steps) and of what the nudge does to the sheet.
// `card` is a preset id or a spec. A preset id that does not exist throws RangeError.
export function validateOffset(card, off) {
  const s = toSpec(card);
  const fields = typeof card === "string" ? [] : cardFieldErrors(s);
  const nudge = offsetErrors(off);
  if (fields.length || nudge.length) return result([...fields, ...nudge]);
  const fit = fitReport(s, toOffset(off));
  return result(fit.errors, fit.warnings);
}

// Items of the test sheet (G31) besides the layout itself: frames are `layout.cards` drawn with a 0.25 pt line, tent fold lines
// are `layout.foldLines`. The nudge applies to the test sheet exactly as to the real cards. Where the bar, legend and sentence
// sit on the sheet is a design decision of the view; the bar is 100 mm of unscaled print. The texts (paper line "Load {paper}
// paper", sample name and table, scale note) are dictionary keys guests.card.test.*; `layout.paper.name` fills {paper}.
export function testSheet(card, off) {
  const s = toSpec(card);
  const l = layout(s, off);
  return {
    layout: l,
    frameWidthPt: FRAME_WIDTH_PT,
    scaleBar: { length: mmToPt(SCALE_BAR_100) },
  };
}
