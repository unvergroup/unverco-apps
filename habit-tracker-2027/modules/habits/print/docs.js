// Yazdirilabilir belgeler D1 My year, D2 My month, D3 Blank year, D4 Blank months: SAF yerlesim (DOM yok).
// Cikti: { id, pages: [{ width, height, ops }] }. op: text | rect | strokeRect | line | hatch | image | check.
// Ayni model hem PDF'e (iPhone ana ekran) hem tarayici yazdirmasina (sayfa goruntuleri) gider: core/canvas-doc.js ciziyor.
// Kagit her zaman beyaz; duzeyler renk + ic kare boyutuyla ayrilir (gri tonda da okunur).
import { daysInMonth, isoOf, weekday } from "../logic/dates.js";

export const PAPERS = Object.freeze({ letter: { w: 1700, h: 2200 }, a4: { w: 1654, h: 2339 } });
const M = 120;
const FAMILY = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const font = (size, bold = false) => `${bold ? "700" : "400"} ${size}px ${FAMILY}`;
const INK = "#14163A", MUTED = "#555A88", RULE = "#C9CBDD", FAINT = "#ECEDF5";
export const LEVEL_FILL = ["#FFFFFF", "#7B5CE0", "#8A5BFF", "#1FA8DB", "#14A877"];
const LEVEL_INSET = [0.5, 0.32, 0.2, 0.08, 0];

/** Metni maxW'ye sigacak sekilde kisaltir (sonuna "…"). */
export function fit(text, fnt, maxW, measure) {
  let s = String(text ?? "");
  if (measure(s, fnt) <= maxW) return s;
  while (s.length > 1 && measure(s + "…", fnt) > maxW) s = s.slice(0, -1);
  return s + "…";
}

function page(paper) { const P = PAPERS[paper] ?? PAPERS.letter; return { width: P.w, height: P.h, ops: [] }; }

/** Altbilgi: ÜNVERCO logosu (oran korunur) + "ÜNVERCO 2027 Habit Tracker" satiri, sayfa altinda ortali. */
function footer(pg, L, measure) {
  const y = pg.height - M + 30;
  const fnt = font(24);
  const tw = measure(L.footer, fnt);
  const lh = 52, lw = L.logo && L.logo.w > 0 ? Math.round((L.logo.w / L.logo.h) * lh) : 0;
  const total = (lw ? lw + 22 : 0) + tw;
  let x = (pg.width - total) / 2;
  if (lw) { pg.ops.push({ t: "image", x, y: y - lh + 12, w: lw, h: lh }); x += lw + 22; }
  pg.ops.push({ t: "text", x, y, text: L.footer, font: fnt, color: MUTED, align: "left" });
}

function title(pg, text, sub, y = M + 60) {
  pg.ops.push({ t: "text", x: M, y, text, font: font(64, true), color: INK, align: "left" });
  if (sub) pg.ops.push({ t: "text", x: M, y: y + 56, text: sub, font: font(30), color: MUTED, align: "left" });
  return y + (sub ? 100 : 50);
}

/** Duzey hucresi: beyaz kare + gri cerceve + duzey rengiyle ic kare (boyut duzeye gore). */
function levelCell(pg, x, y, s, level, { future = false, today = false } = {}) {
  pg.ops.push({ t: "strokeRect", x, y, w: s, h: s, color: future ? FAINT : RULE, lw: 2 });
  if (!future && level > 0) {
    const k = LEVEL_INSET[level] * s;
    pg.ops.push({ t: "rect", x: x + k, y: y + k, w: s - 2 * k, h: s - 2 * k, color: LEVEL_FILL[level] });
  }
  if (today) pg.ops.push({ t: "strokeRect", x: x - 3, y: y - 3, w: s + 6, h: s + 6, color: "#A87C26", lw: 4 });
}

/** 12 x 31 izgara; cellFn(m, d, x, y, s) her gecerli gun icin; gecersiz gun (30 Subat) taranir. Doner alt y. */
function yearGrid(pg, year, y0, L, cellFn) {
  const labelW = 110, cw = pg.width - 2 * M - labelW;
  const gap = 6, s = Math.floor((cw - gap * 30) / 31);
  for (let d = 1; d <= 31; d++) {
    if (d === 1 || d % 5 === 0) pg.ops.push({ t: "text", x: M + labelW + (d - 1) * (s + gap) + s / 2, y: y0 + 22, text: String(d), font: font(20, true), color: MUTED, align: "center" });
  }
  let y = y0 + 40;
  for (let m = 0; m < 12; m++) {
    pg.ops.push({ t: "text", x: M, y: y + s * 0.7, text: L.monthsShort[m], font: font(24, true), color: INK, align: "left" });
    const dim = daysInMonth(year, m);
    for (let d = 1; d <= 31; d++) {
      const x = M + labelW + (d - 1) * (s + gap);
      if (d > dim) pg.ops.push({ t: "hatch", x, y, w: s, h: s, color: RULE });
      else cellFn(m, d, x, y, s);
    }
    y += s + gap;
  }
  return y;
}

function legend(pg, y, L) {
  let x = M;
  const fnt = font(22);
  pg.ops.push({ t: "text", x, y: y + 26, text: L.less, font: fnt, color: MUTED, align: "left" });
  x += 80;
  for (let l = 0; l <= 4; l++) { levelCell(pg, x, y + 4, 28, l); x += 40; }
  pg.ops.push({ t: "text", x: x + 4, y: y + 26, text: L.more, font: fnt, color: MUTED, align: "left" });
  x += 110;
  pg.ops.push({ t: "hatch", x, y: y + 4, w: 28, h: 28, color: RULE });
  pg.ops.push({ t: "text", x: x + 40, y: y + 26, text: L.noSuchDay, font: fnt, color: MUTED, align: "left" });
  return y + 60;
}

/** Basit tablo (sutun: { label, w, align }). Satirlar sayfaya sigmazsa yeni sayfa (onNewPage). */
function table(pages, paper, y, cols, rows, L, measure) {
  let pg = pages[pages.length - 1];
  const rh = 56, fb = font(22, true), fc = font(26);
  const head = () => {
    let x = M;
    pg.ops.push({ t: "rect", x: M, y, w: pg.width - 2 * M, h: rh, color: "#F1F0FA" });
    for (const c of cols) { pg.ops.push({ t: "text", x: c.align === "right" ? x + c.w - 14 : x + 14, y: y + 36, text: c.label.toUpperCase(), font: fb, color: MUTED, align: c.align || "left" }); x += c.w; }
    y += rh;
  };
  head();
  for (const r of rows) {
    if (y + rh > pg.height - M - 70) { footer(pg, L, measure); pg = page(paper); pages.push(pg); y = M; head(); }
    let x = M;
    cols.forEach((c, i) => {
      const t = fit(r[i], fc, c.w - 28, measure);
      pg.ops.push({ t: "text", x: c.align === "right" ? x + c.w - 14 : x + 14, y: y + 38, text: t, font: fc, color: INK, align: c.align || "left" });
      x += c.w;
    });
    y += rh;
    pg.ops.push({ t: "line", x1: M, y1: y, x2: pg.width - M, y2: y, color: RULE, w: 2 });
  }
  return y;
}

const FIRST_PAGE_ROWS = 12;

/**
 * D1 My year. data: { year, subtitle, levels: Map(iso -> 0..4), today, stats: [[etiket, deger]...], rows: [[ad, oran, enIyi, comebacks]...] }
 * <=12 aliskanlik: 1 sayfa; 13+ : tablo 2. sayfaya gecer.
 */
export function myYearDoc(data, L, measure, paper = "letter") {
  const pages = [page(paper)];
  const pg = pages[0];
  let y = title(pg, L.myYearTitle, data.subtitle);
  y = yearGrid(pg, data.year, y + 10, L, (m, d, x, yy, s) => {
    const iso = isoOf(data.year, m, d);
    levelCell(pg, x, yy, s, data.levels.get(iso) ?? 0, { future: iso > data.today, today: iso === data.today });
  });
  y = legend(pg, y + 16, L);
  // istatistik satiri
  const sw = (pg.width - 2 * M) / Math.max(1, data.stats.length);
  data.stats.forEach(([k, v], i) => {
    pg.ops.push({ t: "text", x: M + i * sw, y: y + 30, text: k, font: font(22), color: MUTED, align: "left" });
    pg.ops.push({ t: "text", x: M + i * sw, y: y + 76, text: v, font: font(40, true), color: INK, align: "left" });
  });
  y += 120;
  const cw = pg.width - 2 * M;
  const cols = [{ label: L.colHabit, w: cw * 0.46 }, { label: L.colRate, w: cw * 0.16, align: "right" }, { label: L.colBest, w: cw * 0.22, align: "right" }, { label: L.colComebacks, w: cw * 0.16, align: "right" }];
  if (data.rows.length > FIRST_PAGE_ROWS) { footer(pg, L, measure); pages.push(page(paper)); y = M; }
  table(pages, paper, y, cols, data.rows, L, measure);
  footer(pages[pages.length - 1], L, measure);
  return { id: "my-year", pages };
}

/** Hafta gunu harfi (gercek tarihe gore; Intl dar bicim L.weekdayNarrow[0..6], 0 = Pazar). */
const wdLetter = (L, y, m, d) => L.weekdayNarrow[weekday(isoOf(y, m, d))];

/** Ay izgarasi (D2 ve D4 ortak): satir basliklari + gun sutunlari. cellFn(rowIndex, d, x, y, w, h). */
function monthGrid(pg, year, month, y0, rowLabels, L, measure, cellFn, extraCol = null) {
  const nameW = 330, extraW = extraCol ? 120 : 0;
  const dim = daysInMonth(year, month);
  const cw = pg.width - 2 * M - nameW - extraW;
  const w = cw / dim;
  // Satir yuksekligi sayfayi doldurur (elle yazmaya yer): 54..120 px.
  const rh = Math.max(54, Math.min(120, Math.floor((pg.height - M - 110 - (y0 + 70)) / Math.max(1, rowLabels.length))));
  const ty = Math.round(rh / 2 + 9);
  for (let d = 1; d <= dim; d++) {
    const x = M + nameW + (d - 1) * w + w / 2;
    pg.ops.push({ t: "text", x, y: y0 + 24, text: wdLetter(L, year, month, d), font: font(20, true), color: MUTED, align: "center" });
    pg.ops.push({ t: "text", x, y: y0 + 54, text: String(d), font: font(20), color: INK, align: "center" });
  }
  if (extraCol) pg.ops.push({ t: "text", x: pg.width - M - 12, y: y0 + 54, text: extraCol.label, font: font(20, true), color: MUTED, align: "right" });
  let y = y0 + 70;
  rowLabels.forEach((lab, r) => {
    pg.ops.push({ t: "line", x1: M, y1: y, x2: pg.width - M, y2: y, color: RULE, w: 2 });
    if (lab) pg.ops.push({ t: "text", x: M + 8, y: y + ty, text: fit(lab, font(26), nameW - 20, measure), font: font(26), color: INK, align: "left" });
    for (let d = 1; d <= dim; d++) {
      const x = M + nameW + (d - 1) * w;
      pg.ops.push({ t: "line", x1: x, y1: y, x2: x, y2: y + rh, color: FAINT, w: 2 });
      cellFn(r, d, x, y, w, rh);
    }
    if (extraCol) pg.ops.push({ t: "text", x: pg.width - M - 12, y: y + ty, text: extraCol.values[r] ?? "", font: font(26, true), color: INK, align: "right" });
    y += rh;
  });
  pg.ops.push({ t: "line", x1: M, y1: y, x2: pg.width - M, y2: y, color: RULE, w: 2 });
  return { y, days: dim };
}

/**
 * D2 My month. data: { year, month, title, rows: [{ name, cells: Map(d -> "done"|"partial:N"|"rest"), rate }] }
 * Satirlar sayfaya sigmazsa sonraki sayfaya gecer.
 */
export function myMonthDoc(data, L, measure, paper = "letter") {
  const pages = [];
  const per = 30;
  for (let i = 0; i < Math.max(1, data.rows.length); i += per) {
    const pg = page(paper);
    pages.push(pg);
    const y = title(pg, data.title, L.myMonthSub);
    const chunk = data.rows.slice(i, i + per);
    monthGrid(pg, data.year, data.month, y + 10, chunk.map((r) => r.name), L, measure, (r, d, x, yy, w, h) => {
      const c = chunk[r].cells.get(d);
      if (!c) return;
      if (c === "done") pg.ops.push({ t: "check", x: x + w / 2, y: yy + h / 2, s: Math.min(w, h) * 0.5, color: "#14A877" });
      else if (c === "rest") pg.ops.push({ t: "text", x: x + w / 2, y: yy + h / 2 + 8, text: L.restLetter, font: font(22, true), color: MUTED, align: "center" });
      else if (c.startsWith("partial:")) pg.ops.push({ t: "text", x: x + w / 2, y: yy + h / 2 + 7, text: c.slice(8), font: font(20, true), color: "#1F7FA8", align: "center" });
    }, { label: L.colRate, values: chunk.map((r) => r.rate) });
    footer(pg, L, measure);
  }
  return { id: "my-month", pages };
}

/** D3 Blank year: 12 x 31 bos izgara, gecersiz gunler taranmis, "Habit:" yazi cizgisi; 1 sayfa. */
export function blankYearDoc(year, L, measure, paper = "letter") {
  const pg = page(paper);
  let y = title(pg, String(year), null);
  pg.ops.push({ t: "text", x: M, y: y + 40, text: L.habitLine, font: font(30, true), color: INK, align: "left" });
  const lx = M + measure(L.habitLine, font(30, true)) + 16;
  pg.ops.push({ t: "line", x1: lx, y1: y + 46, x2: pg.width - M, y2: y + 46, color: INK, w: 2 });
  y += 90;
  y = yearGrid(pg, year, y, L, (m, d, x, yy, s) => pg.ops.push({ t: "strokeRect", x, y: yy, w: s, h: s, color: RULE, lw: 2 }));
  pg.ops.push({ t: "hatch", x: M, y: y + 20, w: 28, h: 28, color: RULE });
  pg.ops.push({ t: "text", x: M + 40, y: y + 42, text: L.noSuchDay, font: font(22), color: MUTED, align: "left" });
  footer(pg, L, measure);
  return { id: "blank-year", pages: [pg] };
}

/** D4 Blank months: 12 sayfa; her sayfa 10 bos aliskanlik satiri x ayin gunleri; hafta gunu harfi gercek tarihe gore. */
export function blankMonthsDoc(year, L, measure, paper = "letter") {
  const pages = [];
  for (let m = 0; m < 12; m++) {
    const pg = page(paper);
    const y = title(pg, `${L.monthsLong[m]} ${year}`, L.blankMonthSub);
    monthGrid(pg, year, m, y + 10, Array(10).fill(""), L, measure, () => {});
    footer(pg, L, measure);
    pages.push(pg);
  }
  return { id: "blank-months", pages };
}
