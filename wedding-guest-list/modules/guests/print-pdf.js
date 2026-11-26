// iPhone / iPad Home Screen app: window.print() does nothing there (WebKit ignores it), so every printout is also laid out as PAGE
// OPS here and handed to core/canvas-doc.js (canvas -> JPEG -> PDF -> share sheet -> "Print"). Pure code: no DOM, no canvas. Text width
// comes in from outside (measure(text, font) in pt), so Node tests the same layout that the phone draws.
//
// Units: pt from the top-left of the page (1 mm = 72 / 25.4 pt), the unit logic/cardlayout.js already uses. The place card geometry
// (card positions, cut marks, fold lines) is NOT recomputed here: it is logic/cardlayout.js `layout(spec, nudge)`, so the nudge is
// applied exactly as the print dialog applies it. Sign and caterer sheet follow the CSS of guests.css (same sizes, margins, columns).
// op: { t: "text", x, y (baseline), text, size, weight, style, color, align, spacing }
//     { t: "line", x1, y1, x2, y2, w, color, dash } | { t: "rect", x, y, w, h, fill, stroke, sw } | { t: "mark", x, y, size, shape, fill, stroke }
// page: { w, h, dpi, ops } (w, h in pt; dpi = the resolution the canvas is drawn at: big signs use a lower one, iOS canvas limit)
import { layout } from "./logic/cardlayout.js";
import { fitName } from "./logic/cardfit.js";
import { mealMark } from "./logic/tables.js";
import { nameBox, planTestSheet } from "./print-cards.js";
import { signDate } from "./print-sign.js";
import { nudgeWords } from "./parts.js";

export const PT = 72 / 25.4; // pt per mm
const INK = "#1a1a1a";
const MUTED = "#666666";
const FONT = { size: 10, weight: 400, style: "normal" };

// Paper sizes in pt: Letter 8.5 x 11 in, A4 210 x 297 mm.
export const PAPER_PT = Object.freeze({ letter: { w: 612, h: 792 }, a4: { w: 595.276, h: 841.89 } });

const SIGN = Object.freeze({
  "18x24": { W: 1296, H: 1728, m: 72, t: 96, c: 40, d: 28, dpi: 150 },
  "24x36": { W: 1728, H: 2592, m: 108, t: 144, c: 60, d: 40, dpi: 100 },
});

const str = (v) => (v === null || v === undefined ? "" : String(v));
const font = (size, weight = 400, style = "normal", spacing = 0) => ({ size, weight, style, ...(spacing ? { spacing } : {}) });
// Baseline of a line box of height lh whose top is `top` (serif text, ascent about 1.0 em and descent about 0.27 em).
const base = (top, lh, size) => top + lh / 2 + 0.36 * size;

const textOp = (x, y, text, f, { color = INK, align = "left" } = {}) => ({ t: "text", x, y, text, size: f.size, weight: f.weight, style: f.style, spacing: f.spacing ?? 0, color, align });
const lineOp = (x1, y1, x2, y2, w, color = INK, dash = null) => ({ t: "line", x1, y1, x2, y2, w, color, dash });

/** Wraps text into lines of at most maxW pt. A word that is wider than a line is split by letters (overflow-wrap: anywhere). */
export function wrapText(text, f, maxW, measure) {
  const out = [];
  for (const para of str(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (measure(tryLine, f) <= maxW) { line = tryLine; continue; }
      if (line) out.push(line);
      line = "";
      let rest = Array.from(word);
      while (rest.length > 1 && measure(rest.join(""), f) > maxW) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n).join(""), f) > maxW) n -= 1;
        out.push(rest.slice(0, n).join(""));
        rest = rest.slice(n);
      }
      line = rest.join("");
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

// ---------------------------------------------------------------------------------------------------------------- sign
// o: { size, title, couple, date, groups (signsort.signGroups), tableLabel(n), unnamed, demoText, body (pt), cols }
// -> { pages: [page], fits, body, cols }. fits = every row sits inside the page in `cols` columns (the same test as the screen).
export function layoutSign(o, measure) {
  const g = SIGN[o.size] ?? SIGN["18x24"];
  const body = o.body ?? 18;
  const cols = Math.max(1, Math.round(o.cols ?? 3));
  const ops = [];
  const inner = g.W - 2 * g.m;
  let y = g.m;

  const ft = font(g.t, 600);
  const tLines = wrapText(o.title, ft, inner, measure);
  const tLh = g.t * 1.1;
  tLines.forEach((ln, i) => ops.push(textOp(g.W / 2, base(y + i * tLh, tLh, g.t), ln, ft, { align: "center" })));
  y += tLines.length * tLh;
  if (o.couple) {
    const fc = font(g.c, 400);
    y += g.c * 0.35;
    const lh = g.c * 1.2;
    wrapText(o.couple, fc, inner, measure).forEach((ln) => { ops.push(textOp(g.W / 2, base(y, lh, g.c), ln, fc, { align: "center" })); y += lh; });
  }
  const dateText = signDate(o.date);
  if (dateText) {
    const fd = font(g.d, 400, "normal", g.d * 0.08);
    y += g.d * 0.3;
    const lh = g.d * 1.2;
    ops.push(textOp(g.W / 2, base(y, lh, g.d), dateText.toUpperCase(), fd, { align: "center" }));
    y += lh;
  }
  y += g.t * 0.35;
  ops.push(lineOp(g.m, y + 0.75, g.W - g.m, y + 0.75, 1.5));
  y += 1.5 + g.t * 0.35;

  // body: columns fill one after the other (column-fill: auto); a letter heading stays with the first row under it; a row is never split
  const top = y;
  const bodyH = g.H - g.m - top;
  const gap = Math.max(18, body * 2);
  const colW = (inner - (cols - 1) * gap) / cols;
  const fb = font(body, 400);
  const lh = body * 1.3;
  const lf = body * 1.5;
  const letterLh = lf * 1.2;
  const letterPad = lf * 0.1;
  const letterH = letterLh + letterPad + 0.75;
  const letterTop = lf * 0.5;
  const letterBottom = lf * 0.15;
  const unnamed = str(o.unnamed);

  const rowOf = (e) => {
    const label = str(o.tableLabel(e.tableNumber));
    const tw = measure(label, fb);
    const avail = Math.max(colW - tw - 0.8 * body - body, body);
    const lines = wrapText(e.name || unnamed, fb, avail, measure);
    const nameW = lines.length > 1 ? avail : Math.max(...lines.map((s) => measure(s, fb)));
    return { label, tw, lines, nameW, h: lines.length * lh };
  };
  const units = [];
  for (const grp of o.groups) {
    const rows = grp.entries.map(rowOf);
    units.push({ letter: grp.letter, rows: rows.slice(0, 1) });
    for (const r of rows.slice(1)) units.push({ rows: [r] });
  }

  let fits = true;
  let col = 0;
  let cy = 0;
  let first = true;
  for (const u of units) {
    const heads = u.letter !== undefined;
    const h = (r0) => (heads ? (r0 ? 0 : letterTop) + letterH + letterBottom : 0) + u.rows.reduce((a, r) => a + r.h, 0);
    let need = h(cy === 0);
    if (cy > 0 && cy + need > bodyH + 1e-6) { col += 1; cy = 0; need = h(true); }
    if (need > bodyH + 1e-6) fits = false;
    const x0 = g.m + col * (colW + gap);
    let yy = top + cy;
    if (col >= cols) fits = false;
    if (heads) {
      if (cy > 0 && !first) yy += letterTop;
      if (col < cols) {
        ops.push(textOp(x0, base(yy, letterLh, lf), u.letter, font(lf, 700)));
        ops.push(lineOp(x0, yy + letterLh + letterPad + 0.375, x0 + colW, yy + letterLh + letterPad + 0.375, 0.75));
      }
      yy += letterH + letterBottom;
    }
    for (const r of u.rows) {
      if (col < cols) {
        const b0 = base(yy, lh, body);
        r.lines.forEach((ln, i) => ops.push(textOp(x0, base(yy + i * lh, lh, body), ln, fb)));
        ops.push(textOp(x0 + colW, b0, r.label, fb, { align: "right" }));
        const lx0 = x0 + r.nameW + 0.4 * body, lx1 = x0 + colW - r.tw - 0.4 * body;
        if (lx1 - lx0 > 1) ops.push(lineOp(lx0, b0 - 0.25 * body, lx1, b0 - 0.25 * body, 0.75, INK, [0.75, 1.5]));
      }
      yy += r.h;
    }
    cy = yy - top;
    first = false;
  }
  if (o.demoText) ops.push(textOp(g.W / 2, g.H - 4 * PT - 2, str(o.demoText), font(7), { color: MUTED, align: "center" }));
  return { pages: [{ w: g.W, h: g.H, dpi: g.dpi, ops }], fits, body, cols };
}

/** The screen decides the size by measuring the DOM; the phone draws with canvas fonts. If the screen's size does not fit in the
 *  drawing, step down by 0.5 pt (never below 6 pt) until it does, so the PDF is never cut off. */
export function fitSign(o, measure) {
  let body = o.body ?? 18;
  let r = layoutSign({ ...o, body }, measure);
  while (!r.fits && body > 6) { body = Math.max(6, body - 0.5); r = layoutSign({ ...o, body }, measure); }
  return r;
}

// ------------------------------------------------------------------------------------------------------------ place cards
const CARD_DPI = 300; // cards and the test sheet: thin cut / fold lines and small text stay sharp (2550 x 3300 px, inside the iOS canvas limit)
const MARK_MM = 4.5, MARK_GAP_MM = 2, TABLE_MARGIN_MM = 2.5, TABLE_PT = 11;
const upper = (s, locale) => { try { return s.toLocaleUpperCase(locale); } catch { return s.toUpperCase(); } };

// One card: the fold line of a tent card and the name + table line centered on its face (the lower half of a tent card).
function drawCard(ops, c, tent, entry, o, size0, measure, { frame = false } = {}) {
  const box = nameBox(c);
  const faceH = box.faceMm * PT, boxW = box.wMm * PT, boxH = box.hMm * PT;
  if (frame) ops.push({ t: "rect", x: c.x, y: c.y, w: c.w, h: c.h, fill: null, stroke: INK, sw: 0.5 }); // 0.5 pt: a 0.25 pt hairline turns pale in the raster
  if (tent) ops.push(lineOp(c.x, c.y + c.h / 2, c.x + c.w, c.y + c.h / 2, 0.5, frame ? INK : "#8a8a8a", [3, 2]));
  const text = (str(entry.name).replace(/\s+/gu, " ").trim()) || str(o.unnamed);
  let size = size0 ?? fitName(text, boxW, boxH).size;
  let lines = wrapText(text, font(size, 500), boxW, measure);
  while ((lines.length > 2 || lines.length * 1.15 * size > boxH + 0.5) && size > 1) {
    size = Math.max(1, size - 0.5);
    lines = wrapText(text, font(size, 500), boxW, measure);
  }
  const nameH = lines.length * 1.15 * size;
  const mark = o.showMeal && entry.slot !== null && entry.slot !== undefined ? mealMark(entry.slot) : null;
  const tf = font(TABLE_PT, 400, "normal", TABLE_PT * 0.1);
  const label = upper(str(o.tableLabel(entry.tableNumber)), o.locale);
  const markW = MARK_MM * PT, markGap = MARK_GAP_MM * PT;
  const lineH = mark ? Math.max(markW, TABLE_PT * 1.28) : TABLE_PT * 1.28;
  const stackH = nameH + TABLE_MARGIN_MM * PT + lineH;
  const faceTop = c.y + c.h - faceH;
  const top = faceTop + (faceH - stackH) / 2;
  const cx = c.x + c.w / 2;
  lines.forEach((ln, i) => ops.push(textOp(cx, base(top + i * 1.15 * size, 1.15 * size, size), ln, font(size, 500), { align: "center" })));
  const ty = top + nameH + TABLE_MARGIN_MM * PT;
  const total = (mark ? markW + markGap : 0) + measure(label, tf);
  let x = cx - total / 2;
  if (mark) { ops.push({ t: "mark", x, y: ty + (lineH - markW) / 2, size: markW, shape: mark.shape, fill: mark.fill, stroke: mark.stroke.color }); x += markW + markGap; }
  ops.push(textOp(x, base(ty, lineH, TABLE_PT), label, tf));
}

const cutOps = (l) => l.cutMarks.map((m) => lineOp(m.x1, m.y1, m.x2, m.y2, 0.5));

// o: { spec, off: { x, y } (mm x 100), entries: [{ name, tableNumber, slot }], sizes (optional pt per entry), showMeal, tableLabel(n), unnamed, demoText, locale }
// -> { pages }. Paper (Letter or A4), card grid, cut marks and the nudge come from layout(spec, off).
export function layoutCards(o, measure) {
  const l = layout(o.spec, o.off);
  const tent = Boolean(o.spec.tent);
  const per = l.cards.length;
  const pages = [];
  for (let i = 0; i < o.entries.length; i += per) {
    const ops = cutOps(l);
    o.entries.slice(i, i + per).forEach((e, k) => drawCard(ops, l.cards[k], tent, e, o, o.sizes ? o.sizes[i + k] : undefined, measure));
    if (o.demoText) ops.push(textOp(l.paper.w / 2, l.paper.h - 3 * PT - 2, str(o.demoText), font(7), { color: MUTED, align: "center" }));
    pages.push({ w: l.paper.w, h: l.paper.h, dpi: CARD_DPI, ops });
  }
  return { pages };
}

// ------------------------------------------------------------------------------------------------------------- test sheet
const pdfMark = (x, y, size, slot) => { const m = mealMark(slot); return m ? { t: "mark", x, y, size, shape: m.shape, fill: m.fill, stroke: m.stroke.color } : null; };

function scaleBar(ops, x, y, mm) {
  const X = x * PT, Y = y * PT;
  const base0 = Y + 2.9 * PT;
  ops.push(lineOp(X, base0, X + mm * PT, base0, 0.5));
  for (let i = 0; i <= 10; i++) ops.push(lineOp(X + i * mm * PT / 10, base0, X + i * mm * PT / 10, base0 - (i % 5 === 0 ? 2.6 : 1.8) * PT, 0.5));
  const f = font(7, 400);
  const by = Y + 5.1 * PT;
  ops.push(textOp(X, by, "0", f), textOp(X + mm * PT / 2, by, String(mm / 2), f, { align: "center" }), textOp(X + mm * PT, by, `${mm} mm`, f, { align: "right" }));
}

// o: { spec, off, t, layoutName, meals: [{ label, slot }], nudge: { x, y }, demoText, locale }
// The test sheet: frames at the card edges, a scale bar of exactly 100 mm (or 50 mm), the title block and the nudge in words.
export function layoutTestSheet(o, measure) {
  const { t } = o;
  const l = layout(o.spec, o.off);
  const tent = Boolean(o.spec.tent);
  const plan = planTestSheet(l, tent);
  const W = l.paper.w, H = l.paper.h;
  const first = { w: W, h: H, dpi: CARD_DPI, ops: cutOps(l) };
  const pages = [first];
  let second = null;
  const at = (where) => (where === "second" ? (second ??= { w: W, h: H, dpi: CARD_DPI, ops: cutOps(l) }) : first);
  const entry = { name: t("guests.card.test.sampleName"), tableNumber: 12, slot: o.meals.length ? o.meals[0].slot : null };
  const cardOpts = { showMeal: o.meals.length > 0, tableLabel: () => t("guests.card.test.sampleTable"), unnamed: "", locale: o.locale };
  for (const c of l.cards) drawCard(first.ops, c, tent, entry, cardOpts, undefined, measure, { frame: true });
  first.ops.push(textOp(W - 12.7 * PT, base(7 * PT, 8 * 1.3, 8), t("guests.print.topEdge"), font(8, 700, "normal", 0.8), { align: "right" }));

  // title block
  const bw = plan.band.w * PT;
  const mm = plan.bar.mm;
  let by = plan.band.y * PT;
  const bp = at(plan.band.where).ops;
  const bx = plan.band.x * PT;
  const f11 = font(11, 700), f85 = font(8.5, 400);
  wrapText(t("guests.print.test.title", { layout: o.layoutName, paper: l.paper.name }), f11, bw, measure).forEach((ln) => { bp.push(textOp(bx, base(by, 11 * 1.25, 11), ln, f11)); by += 11 * 1.25; });
  by += PT;
  wrapText(mm === 100 ? t("guests.card.test.scaleNote") : t("guests.card.test.scaleNoteMm", { mm }), f85, bw, measure).forEach((ln) => { bp.push(textOp(bx, base(by, 8.5 * 1.3, 8.5), ln, f85)); by += 8.5 * 1.3; });

  scaleBar(at(plan.bar.where).ops, plan.bar.x, plan.bar.y, mm);

  // legend (meal marks) + the nudge in words
  const lp = at(plan.legend.where).ops;
  const lx = plan.legend.x * PT, lw = plan.legend.w * PT;
  let ly = plan.legend.y * PT;
  if (o.meals.length) {
    const mk = 3.5 * PT, mg = 1.5 * PT, ig = 5 * PT, rowH = 8.5 * 1.3;
    let x = lx;
    for (const m of o.meals) {
      const w = mk + mg + measure(str(m.label), f85);
      if (x > lx && x + w > lx + lw) { x = lx; ly += rowH + 1.5 * PT; }
      const mo = pdfMark(x, ly + (rowH - mk) / 2, mk, m.slot);
      if (mo) lp.push(mo);
      lp.push(textOp(x + mk + mg, base(ly, rowH, 8.5), str(m.label), f85));
      x += w + ig;
    }
    ly += rowH + 1.5 * PT;
  }
  const [nx, ny] = nudgeWords(t, o.nudge.x, o.nudge.y);
  const nudgeText = o.nudge.x === 0 && o.nudge.y === 0 ? t("guests.print.test.none") : t("guests.print.test.nudge", { x: nx, y: ny });
  wrapText(nudgeText, f85, lw, measure).forEach((ln) => { lp.push(textOp(lx, base(ly, 8.5 * 1.3, 8.5), ln, f85)); ly += 8.5 * 1.3; });

  if (second) {
    first.ops.push(textOp(12.7 * PT, base(H - 6.35 * PT - 6 * PT, 7 * 1.3, 7), t("guests.print.test.page2"), font(7)));
    pages.push(second);
  }
  if (o.demoText) for (const p of pages) p.ops.push(textOp(W / 2, H - 3 * PT - 2, str(o.demoText), font(7), { color: MUTED, align: "center" }));
  return { pages };
}

// ----------------------------------------------------------------------------------------------------------- caterer sheet
const CELL_X = 1.6 * PT, CELL_Y = 1.4 * PT;

// o: { paper: "letter" | "a4", couple, date, printed, sheet (counts.catererSheet), t, tableLabel(n), demoText }
// Page: 12.7 mm margin, title block, counts table whose header repeats on every page, footnote box on every page.
export function layoutCaterer(o, measure) {
  const { t, sheet } = o;
  const P = PAPER_PT[o.paper] ?? PAPER_PT.letter;
  const W = P.w, H = P.h, m = 12.7 * PT;
  const cw = W - 2 * m;
  const limit = H - 27 * PT; // 27 mm at the bottom: bottom margin + footnote box (print.css tfoot)
  const meals = sheet.meals;
  const lhBody = 10 * 1.35;
  const fBody = font(10, 400), fBold = font(10, 700), fItal = font(10, 400, "italic"), fHead = font(9, 700);
  const pages = [];
  let ops, y;
  const footer = (pg) => {
    let fy = H - m - 12.5 * PT;
    if (o.demoText) { pg.push(textOp(m, base(fy, 7 * 1.3, 7), str(o.demoText), font(7), { color: MUTED })); fy += 7 * 1.3; }
    const ff = font(7.5, 400);
    for (const ln of wrapText(t("guests.print.caterer.foot"), ff, cw, measure)) { pg.push(textOp(m, base(fy, 7.5 * 1.3, 7.5), ln, ff, { color: "#444444" })); fy += 7.5 * 1.3; }
  };
  const newPage = (y0) => { ops = []; pages.push({ w: W, h: H, dpi: 200, ops }); y = y0; };
  newPage(m);

  const para = (text, f, lh, after, align = "left", color = INK) => {
    for (const ln of wrapText(text, f, cw, measure)) { ops.push(textOp(align === "center" ? m + cw / 2 : m, base(y, lh, f.size), ln, f, { color, align })); y += lh; }
    y += after;
  };
  para(t("guests.print.caterer.title"), font(18, 700), 18 * 1.25, 1 * PT);
  const meta = [str(o.couple), signDate(o.date), str(o.printed)].filter(Boolean).join(" · ");
  if (meta) para(meta, fBody, lhBody, 4 * PT);
  para(t("guests.print.caterer.attending", { n: sheet.attending, a: sheet.total.adults, c: sheet.total.children }), font(13, 700), 13 * 1.35, 3 * PT);
  if (meals.length) {
    const mk = 3.5 * PT, mg = 1.5 * PT, ig = 5 * PT;
    const items = [...meals.map((mm, i) => ({ slot: mm.slot, label: `${str(mm.label)} ${sheet.total.byMeal[i]}` })), { slot: null, label: `${t("guests.print.caterer.legendNoMeal")} ${sheet.total.noMeal}` }];
    let x = m;
    for (const it of items) {
      const w = (it.slot !== null ? mk + mg : 0) + measure(it.label, fBody);
      if (x > m && x + w > m + cw) { x = m; y += lhBody + 1.5 * PT; }
      if (it.slot !== null) { const mo = pdfMark(x, y + (lhBody - mk) / 2, mk, it.slot); if (mo) ops.push(mo); }
      ops.push(textOp(x + (it.slot !== null ? mk + mg : 0), base(y, lhBody, 10), it.label, fBody));
      x += w + ig;
    }
    y += lhBody;
  }
  y += 12.7 * PT;

  // columns
  const heads = [t("guests.print.caterer.col.table"), t("guests.print.caterer.col.guests"), t("guests.print.caterer.col.adults"), t("guests.print.caterer.col.children"), ...meals.map((x) => str(x.label)), ...(meals.length ? [t("guests.print.caterer.col.noMeal")] : [])];
  const nums = (r) => [r.guests, r.adults, r.children].map(String);
  const cellsOf = (r) => [...nums(r), ...(meals.length ? [...r.byMeal.map(String), String(r.noMeal)] : [])];
  const body = sheet.rows.map((r) => ({ label: str(o.tableLabel(r.number)), cells: cellsOf(r) }));
  const tail = [];
  if (sheet.notSeated.guests > 0) tail.push({ label: t("guests.print.caterer.row.notSeated"), cells: cellsOf(sheet.notSeated), italic: true });
  tail.push({ label: t("guests.print.caterer.row.total"), cells: cellsOf(sheet.total), total: true });
  const pending = sheet.seatedPending > 0 ? t("guests.print.caterer.pending", { n: sheet.seatedPending }) : null;
  const n = heads.length;
  const words = (s) => str(s).split(/\s+/).filter(Boolean);
  const maxW = [], minW = [];
  for (let i = 0; i < n; i++) {
    const cellTexts = [...body, ...tail].map((r) => (i === 0 ? r.label : r.cells[i - 1]));
    const hw = words(heads[i]);
    const mx = Math.max(measure(heads[i], fHead), ...cellTexts.map((s) => measure(str(s), fBold)));
    const mn = Math.max(...hw.map((w) => measure(w, fHead)), ...cellTexts.flatMap((s) => words(s).map((w) => measure(w, fBold))));
    maxW.push(mx + 2 * CELL_X); minW.push(Math.min(mn, mx) + 2 * CELL_X);
  }
  const sumMax = maxW.reduce((a, b) => a + b, 0), sumMin = minW.reduce((a, b) => a + b, 0);
  let widths;
  if (sumMax <= cw) widths = maxW.map((w) => (w * cw) / sumMax);
  else if (sumMin <= cw) widths = maxW.map((w, i) => minW[i] + ((w - minW[i]) * (cw - sumMin)) / (sumMax - sumMin));
  else widths = minW.map((w) => (w * cw) / sumMin);
  const xs = []; let acc = m;
  for (const w of widths) { xs.push(acc); acc += w; }

  const markH = meals.length ? 3.5 * PT + 0.8 * PT : 0;
  const headLines = heads.map((h, i) => wrapText(h, fHead, Math.max(widths[i] - 2 * CELL_X, 4), measure));
  const headH = Math.max(...headLines.map((l, i) => l.length * 9 * 1.35 + (i >= 4 && i < 4 + meals.length ? markH : 0))) + 2 * CELL_Y + 1.5;
  const drawHead = () => {
    const top = y;
    heads.forEach((_, i) => {
      const lines = headLines[i];
      const isMeal = i >= 4 && i < 4 + meals.length;
      let ty = top + CELL_Y;
      if (isMeal) { const mo = pdfMark(xs[i] + widths[i] - CELL_X - 3.5 * PT, ty, 3.5 * PT, meals[i - 4].slot); if (mo) ops.push(mo); ty += markH; }
      lines.forEach((ln, k) => ops.push(textOp(i === 0 ? xs[i] + CELL_X : xs[i] + widths[i] - CELL_X, base(ty + k * 9 * 1.35, 9 * 1.35, 9), ln, fHead, { align: i === 0 ? "left" : "right" })));
    });
    y += headH;
    ops.push(lineOp(m, y - 0.75, m + cw, y - 0.75, 1.5));
  };
  drawHead();

  const rowLines = (r) => wrapText(r.label, r.total ? fBold : fBody, Math.max(widths[0] - 2 * CELL_X, 4), measure);
  const rowH = (r) => rowLines(r).length * lhBody + 2 * CELL_Y + (r.total ? 3 : 0.5);
  const drawRow = (r) => {
    const f = r.total ? fBold : r.italic ? fItal : fBody;
    const lines = rowLines(r);
    const top = y;
    const ty = top + CELL_Y + (r.total ? 1.5 : 0);
    lines.forEach((ln, k) => ops.push(textOp(xs[0] + CELL_X, base(ty + k * lhBody, lhBody, 10), ln, f)));
    // numbers sit on the last line of a wrapped label (cells are bottom aligned)
    const nb = base(ty + (lines.length - 1) * lhBody, lhBody, 10);
    r.cells.forEach((c, i) => ops.push(textOp(xs[i + 1] + widths[i + 1] - CELL_X, nb, c, f, { align: "right" })));
    y += rowH(r);
    if (r.total) { ops.push(lineOp(m, top + 0.75, m + cw, top + 0.75, 1.5), lineOp(m, y - 0.75, m + cw, y - 0.75, 1.5)); }
    else ops.push(lineOp(m, y - 0.25, m + cw, y - 0.25, 0.5));
  };
  const pendLines = pending ? wrapText(pending, fBody, cw - 2 * CELL_X, measure) : [];
  const pendH = pending ? pendLines.length * lhBody + CELL_Y + 3 * PT : 0;
  const brk = () => { footer(ops); newPage(m); drawHead(); };

  for (const r of body) { if (y + rowH(r) > limit) brk(); drawRow(r); }
  // the not-seated row, the total and the pending line stay together on one page
  const tailH = tail.reduce((a, r) => a + rowH(r), 0) + pendH;
  if (y + tailH > limit) brk();
  for (const r of tail) drawRow(r);
  if (pending) {
    const ty = y + 3 * PT;
    pendLines.forEach((ln, k) => ops.push(textOp(m + CELL_X, base(ty + k * lhBody, lhBody, 10), ln, fBody)));
    y += pendH;
  }
  footer(ops);
  return { pages };
}
