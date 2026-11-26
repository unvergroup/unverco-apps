// Belge modelini (modules/repairs/print/docs.js: { id, title, period, sections[], notes[] }) SAYFA GORUNTULERINE cevirir; core/pdf.js bunlari PDF yapar.
// Claimtag: pet-care'in ayni yontemi (canvas -> JPEG -> PDF -> navigator.share); kabul formu icin ek bolum turleri (top, checks, fields, writelines, grid, list, text, sign, strip, terms, pagebreak).
// NEDEN: iPhone ana ekran uygulamasinda window.print() calismaz; belge dosya olarak uretilip paylasim sayfasina verilir (core/print.js).
// Iki katman:
//   layoutDoc(...)  SAF: DOM yok. Metin olcumu disaridan verilir (measure). Cikti: sayfa basina cizim komutlari. Node'da test edilir.
//   paintPage(...)  komutlari 2B canvas baglamina cizer (tarayicida).
// Olcu birimi piksel, 200 dpi: Letter 1700x2200, A4 1654x2339, 80 mm rulo 630 x icerik kadar.
import { base64ToBytes, buildPdf } from "./pdf.js";

export const DPI = 200;
const FAMILY = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const PAPERS = Object.freeze({
  letter: { w: 1700, h: 2200, m: 63 },  // 8 mm kenar (core/print.css .page-frame ile ayni)
  a4: { w: 1654, h: 2339, m: 63 },
  thermal80: { w: 630, h: 0, m: 24 }, // 80 mm = 630 px @200 dpi; 3 mm kenar; h: 0 = icerik kadar (her nusha ayri sayfa; ust sinir MAX_ROLL)
});
const MM = DPI / 25.4; // 1 mm = 7,874 px
const MAX_ROLL = 9000; // iOS canvas alan siniri icinde kalir (630 x 9000 = 5,7 milyon piksel)
const INK = "#111111";
const MUTED = "#555555";
const RULE = "#bbbbbb";
const BAND = "#eeeeee";

const font = (size, bold = false) => `${bold ? "700" : "400"} ${size}px ${FAMILY}`;
const str = (v) => (v === null || v === undefined ? "" : String(v));

/** Metni en cok maxW genisliginde satirlara boler. Sigmayan tek sozcuk harf harf bolunur. "\n" korunur. */
export function wrapText(text, fnt, maxW, measure) {
  const out = [];
  for (const para of str(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (measure(tryLine, fnt) <= maxW) { line = tryLine; continue; }
      if (line) out.push(line);
      line = "";
      let rest = word;
      while (measure(rest, fnt) > maxW && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n), fnt) > maxW) n -= 1;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

/**
 * Saf yerlesim. header: { name, lines[], accent, logo?: { w, h } } (logo: dogal olcu; cizim paintPage'e verilen goruntuyle yapilir).
 * Donus: { width, pages: [{ height, ops: [...] }] }
 * op: { t:"text", x, y, text, font, color, align } | { t:"line", x1, y1, x2, y2, color, w } | { t:"rect", x, y, w, h, color } | { t:"image", x, y, w, h }
 */
export function layoutDoc({ doc, header = {}, mark = "", paper = "letter" }, measure) {
  const P = PAPERS[paper] ?? PAPERS.letter;
  const roll = P.h === 0;
  const S = roll
    ? { body: 23, small: 20, h3: 25, title: 34, biz: 30, lh: 1.28, pad: 5 }
    : { body: 25, small: 21, h3: 28, title: 44, biz: 36, lh: 1.28, pad: 7 }; // ~9 pt govde: kabul formunun dukkan nushasi (etiket seridi dahil) 1. sayfaya sigsin
  const W = P.w;
  const left = P.m;
  const right = W - P.m;
  const cw = right - left;
  const footH = mark ? Math.round(S.small * 2.4) : 0;
  const limit = (roll ? MAX_ROLL : P.h) - P.m - footH - S.pad * 3; // pay: satir arasi bosluklar sayfa kontrolu yapmaz

  const pages = [];
  let ops;
  let y;
  const newPage = () => { ops = []; pages.push({ height: 0, ops }); y = P.m; };
  const closePage = () => {
    const page = pages[pages.length - 1];
    const h = roll ? Math.ceil(y + footH + P.m) : P.h;
    if (mark) ops.push({ t: "text", x: W / 2, y: h - P.m + (roll ? 0 : Math.round(S.small * 0.2)), text: mark, font: font(S.small), color: MUTED, align: "center" });
    page.height = h;
  };
  const ensure = (need, onBreak) => {
    if (y + need <= limit) return false;
    closePage(); newPage();
    if (onBreak) onBreak();
    return true;
  };
  const text = (x, yy, t, fnt, { color = INK, align = "left" } = {}) => ops.push({ t: "text", x, y: yy, text: t, font: fnt, color, align });
  const rule = (yy, color = RULE, w = 2) => ops.push({ t: "line", x1: left, y1: yy, x2: right, y2: yy, color, w });
  /** Sarilan paragraf; her satir kendi sayfa kontrolunu yapar. */
  const para = (t, size, { bold = false, color = INK, x = left, maxW = cw, align = "left", gapAfter = 0 } = {}) => {
    const fnt = font(size, bold);
    const lh = Math.round(size * S.lh);
    for (const ln of wrapText(t, fnt, maxW, measure)) {
      ensure(lh);
      text(align === "right" ? x + maxW : align === "center" ? x + maxW / 2 : x, y + size, ln, fnt, { color, align });
      y += lh;
    }
    y += gapAfter;
  };

  newPage();

  // ---- Isletme basligi ----
  const hName = str(header.name);
  const hLines = (Array.isArray(header.lines) ? header.lines : []).map(str).filter(Boolean);
  const accent = /^#[0-9a-f]{6}$/i.test(str(header.accent)) ? header.accent : INK;
  if (header.logo && header.logo.w > 0 && header.logo.h > 0) {
    const maxH = roll ? 120 : 170;
    const maxW = roll ? cw : 520;
    const k = Math.min(maxH / header.logo.h, maxW / header.logo.w, 1.5);
    const lw = Math.round(header.logo.w * k);
    const lh = Math.round(header.logo.h * k);
    ops.push({ t: "image", x: roll ? Math.round(left + (cw - lw) / 2) : left, y, w: lw, h: lh });
    y += lh + S.pad * 2;
  }
  if (hName) para(hName, S.biz, { bold: true, align: roll ? "center" : "left" });
  for (const l of hLines) para(l, S.small, { color: MUTED, align: roll ? "center" : "left" });
  if (hName || hLines.length || header.logo) {
    y += S.pad;
    ops.push({ t: "rect", x: left, y, w: cw, h: roll ? 4 : 6, color: accent });
    y += S.pad * 3;
  }

  // ---- Belge basligi ----
  if (doc?.title) para(str(doc.title), S.title, { bold: true });
  if (doc?.period) para(str(doc.period), S.body, { color: MUTED });
  if (doc?.title || doc?.period) y += S.pad * 2;

  const heading = (t) => {
    if (!t) return;
    ensure(Math.round(S.h3 * S.lh) * 2 + S.pad * 4); // baslik sayfa sonunda tek kalmasin
    y += S.pad;
    para(t, S.h3, { bold: true, gapAfter: S.pad });
  };

  const kvRows = (rows) => {
    const labelW = Math.round(cw * (roll ? 0.46 : 0.42));
    const valW = cw - labelW - S.pad * 2;
    for (const [k, v, strong] of rows) {
      const fl = font(S.body, !!strong);
      const kl = wrapText(k, fl, labelW, measure);
      const vl = wrapText(v, fl, valW, measure);
      const lh = Math.round(S.body * S.lh);
      const h = Math.max(kl.length, vl.length) * lh + S.pad;
      ensure(h + (strong ? S.pad : 0));
      if (strong) { rule(y, INK, 2); y += S.pad; }
      kl.forEach((ln, i) => text(left, y + S.body + i * lh, ln, fl));
      vl.forEach((ln, i) => text(right, y + S.body + i * lh, ln, fl, { align: "right" }));
      y += h;
    }
  };

  const tableWide = (sec) => {
    const cols = sec.columns;
    const cp = S.pad * 1.6;
    const fb = font(S.small, true);
    const fc = font(S.body);
    const lh = Math.round(S.body * S.lh);
    // Dogal genislik: baslik ve hucrelerin en genisi (ust sinirli), sonra sayfa genisligine oranla.
    const nat = cols.map((c) => Math.min(cw * 0.5, Math.max(measure(str(c.label), fb), ...sec.rows.map((r) => measure(str(r[c.key]), fc)), 40) + cp * 2));
    const sum = nat.reduce((a, b) => a + b, 0);
    let widths;
    if (sum <= cw) {
      const any = cols.some((c) => !c.num);
      const flexes = cols.map((c) => (any ? !c.num : true));
      const fs = nat.reduce((a, n, i) => a + (flexes[i] ? n : 0), 0) || 1;
      widths = nat.map((n, i) => n + (flexes[i] ? ((cw - sum) * n) / fs : 0));
    } else {
      const fixed = cols.reduce((a, c, i) => a + (c.num ? nat[i] : 0), 0);
      const flexSum = sum - fixed;
      const room = Math.max(cw - fixed, cw * 0.4);
      const k = room / (flexSum || 1);
      widths = nat.map((n, i) => (cols[i].num ? n : Math.max(90, n * k)));
      const s2 = widths.reduce((a, b) => a + b, 0);
      widths = widths.map((w) => (w * cw) / s2);
    }
    const xs = [];
    widths.reduce((x, w) => { xs.push(x); return x + w; }, left);

    const headRow = () => {
      const lines = cols.map((c, i) => wrapText(c.label, fb, widths[i] - cp * 2, measure));
      const hlh = Math.round(S.small * S.lh);
      const h = Math.max(...lines.map((l) => l.length)) * hlh + S.pad * 2;
      ops.push({ t: "rect", x: left, y, w: cw, h, color: BAND });
      lines.forEach((ls, i) => ls.forEach((ln, j) => text(cols[i].num ? xs[i] + widths[i] - cp : xs[i] + cp, y + S.pad + S.small + j * hlh, ln, fb, { align: cols[i].num ? "right" : "left" })));
      y += h;
      rule(y, INK, 2);
    };
    ensure(lh * 3 + S.pad * 6);
    headRow();
    for (const r of sec.rows) {
      const lines = cols.map((c, i) => wrapText(r[c.key], fc, widths[i] - cp * 2, measure));
      const h = Math.max(...lines.map((l) => l.length)) * lh + S.pad * 2;
      ensure(h, headRow);
      lines.forEach((ls, i) => ls.forEach((ln, j) => text(cols[i].num ? xs[i] + widths[i] - cp : xs[i] + cp, y + S.pad + S.body + j * lh, ln, fc, { align: cols[i].num ? "right" : "left" })));
      y += h;
      rule(y, RULE, 1);
    }
    if (sec.total) {
      const ft = font(S.body, true);
      const vW = Math.max(measure(str(sec.total.value), ft) + cp * 2, widths[widths.length - 1]);
      const ll = wrapText(sec.total.label, ft, cw - vW - cp * 2, measure);
      const h = ll.length * lh + S.pad * 2;
      ensure(h);
      rule(y, INK, 2);
      ll.forEach((ln, j) => text(left + cp, y + S.pad + S.body + j * lh, ln, ft));
      text(right - cp, y + S.pad + S.body, str(sec.total.value), ft, { align: "right" });
      y += h;
    }
  };

  const tableRoll = (sec) => {
    const cols = sec.columns;
    const amt = cols.find((c) => c.amount);
    const fh = font(S.body, true);
    const lh = Math.round(S.body * S.lh);
    for (const r of sec.rows) {
      const head = cols.filter((c) => c.primary).map((c) => str(r[c.key])).filter(Boolean).join(" · ") || (amt ? "" : str(r[cols[0].key]));
      const a = amt ? str(r[amt.key]) : "";
      const aW = a ? measure(a, fh) + S.pad * 2 : 0;
      const hl = wrapText(head, fh, cw - aW, measure);
      ensure(hl.length * lh + S.pad);
      hl.forEach((ln, j) => text(left, y + S.body + j * lh, ln, fh));
      if (a) text(right, y + S.body, a, fh, { align: "right" });
      y += hl.length * lh;
      for (const c of cols.filter((c) => !c.primary && !c.amount && r[c.key])) para(`${c.label}: ${str(r[c.key])}`, S.small, { color: MUTED });
      y += S.pad;
      rule(y, RULE, 1);
      y += S.pad;
    }
    if (sec.total) para([sec.total.label, sec.total.value].filter(Boolean).join(": "), S.body, { bold: true, align: "right", gapAfter: S.pad });
  };



  // Iki sutunlu etiket / deger (durum satirlari): satir basina iki cift.
  const kvTwo = (rows) => {
    const f = font(S.body);
    const colW = Math.floor((cw - S.pad * 4) / 2);
    const labelW = Math.round(colW * 0.5);
    const lh = lhB();
    for (let i = 0; i < rows.length; i += 2) {
      const pair = rows.slice(i, i + 2).map(([k, v]) => ({ kl: wrapText(k, f, labelW - S.pad, measure), vl: wrapText(v, f, colW - labelW, measure) }));
      const h = Math.max(...pair.map((p) => Math.max(p.kl.length, p.vl.length))) * lh + Math.round(S.pad / 2);
      ensure(h);
      pair.forEach((p, c) => {
        const x = left + c * (colW + S.pad * 4);
        p.kl.forEach((ln, j) => text(x, y + S.body + j * lh, ln, f, { color: MUTED }));
        p.vl.forEach((ln, j) => text(x + labelW, y + S.body + j * lh, ln, f));
      });
      y += h;
    }
    y += S.pad;
  };

  // ---- Claimtag bolumleri ----
  const lhB = () => Math.round(S.body * S.lh);
  const stroke = (x, yy, w, hh, color = INK, lw = 2) => ops.push({ t: "box", x, y: yy, w, h: hh, color, lw });
  const hline = (x1, x2, yy, lw = 2, dash = false, color = INK) => ops.push({ t: "line", x1, y1: yy, x2, y2: yy, color, w: lw, dash });
  const boxSize = Math.round(S.body * 0.8);

  // Fis ustu: sol baslik + buyuk bilet no; sag nusha kutusu + tarih(ler). Sigmazsa alt alta.
  const top = (sec) => {
    const tf = font(Math.round(S.title * 0.72), true);
    const kf = font(roll ? 44 : 56, true);
    const bf = font(S.small, true);
    const df = font(S.small);
    const dates = (Array.isArray(sec.dates) ? sec.dates : [sec.date]).map(str).filter(Boolean);
    const leftW = Math.max(measure(str(sec.title), tf), measure(str(sec.ticket), kf));
    const rightW = Math.max(sec.badge ? measure(str(sec.badge), bf) + S.pad * 3 : 0, ...dates.map((d) => measure(d, df)));
    const side = leftW + rightW + S.pad * 4 <= cw;
    const tl = Math.round(S.title * 0.72 * S.lh);
    const kl = Math.round((roll ? 44 : 56) * 1.15);
    const dl = Math.round(S.small * S.lh);
    const badgeH = sec.badge ? dl + S.pad : 0;
    const rightH = badgeH + dates.length * dl + (sec.badge ? S.pad : 0);
    ensure((side ? Math.max(tl + kl, rightH) : tl + kl + rightH) + S.pad * 2);
    text(left, y + Math.round(S.title * 0.72), str(sec.title), tf);
    text(left, y + tl + Math.round((roll ? 44 : 56) * 0.9), str(sec.ticket), kf);
    let ry = y;
    let rx = side ? right : left;
    const al = side ? "right" : "left";
    if (sec.badge) {
      const bw = measure(str(sec.badge), bf) + S.pad * 3;
      const bx = side ? right - bw : left;
      stroke(bx, side ? ry : y + tl + kl, bw, dl + S.pad, INK, 2);
      text(bx + S.pad * 1.5, (side ? ry : y + tl + kl) + S.pad / 2 + S.small, str(sec.badge), bf);
      ry = (side ? ry : y + tl + kl) + dl + S.pad + S.pad;
    } else if (!side) ry = y + tl + kl;
    for (const d of dates) { text(rx, ry + S.small, d, df, { align: al, color: INK }); ry += dl; }
    y = side ? Math.max(y + tl + kl, ry) : ry;
    y += S.pad * 2;
  };

  // Secenek kutulari: her secenek bir onay kutusu + etiket, satir dolunca sarilir. cols: 2 -> Letter/A4'te iki sutun (kucuk punto).
  const checkRows = (sec) => {
    const rows = sec.rows ?? [];
    const two = sec.cols === 2 && !roll;
    const sz = two ? S.small + 1 : S.body;
    const f = font(sz);
    const lh = Math.round(sz * S.lh);
    const bs = Math.round(sz * 0.8);
    const gap = S.pad * 3;
    const colGap = S.pad * 6;
    const colW = two ? Math.floor((cw - colGap) / 2) : cw;
    // Tek satiri (x0..x1) cizer; kullandigi yuksekligi dondurur. dry: yalniz olc.
    const rowAt = (r, x0, x1, y0, dry) => {
      const lead = str(r.label) ? `${str(r.label)}: ` : "";
      let x = x0;
      let yy = y0;
      if (lead) { if (!dry) text(x, yy + sz, lead, f); x += measure(lead, f) + S.pad; }
      for (const o of r.options) {
        const wopt = bs + S.pad + measure(str(o), f);
        if (x + wopt > x1 && x > x0) { yy += lh; x = x0; }
        if (!dry) { stroke(x, yy + sz - bs + 2, bs, bs, INK, 2); text(x + bs + S.pad, yy + sz, str(o), f); }
        x += wopt + gap;
      }
      return yy - y0 + lh + Math.round(S.pad * 0.6);
    };
    const step = two ? 2 : 1;
    for (let i = 0; i < rows.length; i += step) {
      const group = rows.slice(i, i + step);
      const hs = group.map((r, c) => rowAt(r, left + c * (colW + colGap), left + c * (colW + colGap) + colW, y, true));
      const hh = Math.max(...hs);
      ensure(hh);
      group.forEach((r, c) => rowAt(r, left + c * (colW + colGap), left + c * (colW + colGap) + colW, y, false));
      y += hh;
    }
  };

  // Etiket + bos cizgi ("Ad: ________").
  const fieldRows = (rows) => {
    const f = font(S.body);
    const labelW = Math.round(cw * (roll ? 0.4 : 0.22));
    for (const k of rows) {
      const ll = wrapText(str(k), f, labelW - S.pad, measure);
      const h = ll.length * lhB() + S.pad;
      ensure(h);
      ll.forEach((ln, i) => text(left, y + S.body + i * lhB(), ln, f));
      hline(left + labelW, right, y + S.body + 4, 2);
      y += h;
    }
  };

  const writeLines = (n) => { for (let i = 0; i < n; i += 1) { ensure(Math.round(S.body * 1.9)); y += Math.round(S.body * 1.9); hline(left, right, y - 6, 2); } };

  const listItems = (items) => {
    const f = font(S.body);
    const ind = S.body;
    for (const it of items) {
      const ls = wrapText(it, f, cw - ind, measure);
      ensure(ls.length * lhB() + S.pad);
      ops.push({ t: "rect", x: left + 6, y: y + Math.round(S.body * 0.55), w: 8, h: 8, color: INK });
      ls.forEach((ln, i) => text(left + ind, y + S.body + i * lhB(), ln, f));
      y += ls.length * lhB() + Math.round(S.pad / 2);
    }
    y += S.pad;
  };

  // Izgara: kisa "etiket: deger" ogeleri sutunlara dizilir (rulo: tek sutun).
  const grid = (sec) => {
    const n = roll ? 1 : Math.max(1, Math.min(3, sec.cols | 0 || 2));
    const f = font(sec.small ? S.small + 2 : S.body);
    const colW = Math.floor((cw - S.pad * 4 * (n - 1)) / n);
    const lh = Math.round((sec.small ? S.small + 2 : S.body) * S.lh);
    const items = (sec.items ?? []).map((i) => wrapText(i, f, colW, measure));
    for (let i = 0; i < items.length; i += n) {
      const row = items.slice(i, i + n);
      const h = Math.max(...row.map((l) => l.length)) * lh + Math.round(S.pad / 2);
      ensure(h);
      row.forEach((ls, c) => ls.forEach((ln, j) => text(left + c * (colW + S.pad * 4), y + (sec.small ? S.small + 2 : S.body) + j * lh, ln, f)));
      y += h;
    }
    y += S.pad;
  };

  // Imza cizgileri: Letter/A4'te yan yana, rulo'da alt alta.
  const sign = (sec) => {
    const labels = (sec.labels ?? []).map(str);
    const f = font(S.small);
    const lh = Math.round(S.small * S.lh);
    if (roll) {
      for (const l of labels) { ensure(lh + 80); y += 60; hline(left, right, y, 2); text(left, y + S.small + 6, l, f); y += lh + S.pad * 2; }
      return;
    }
    const gapX = S.pad * 4;
    const colW = Math.floor((cw - gapX * (labels.length - 1)) / labels.length);
    const lines = labels.map((l) => wrapText(l, f, colW, measure));
    const h = 76 + Math.max(...lines.map((l) => l.length)) * lh + S.pad;
    ensure(h);
    lines.forEach((ls, c) => {
      const x = left + c * (colW + gapX);
      hline(x, x + colW, y + 66, 2);
      ls.forEach((ln, j) => text(x, y + 66 + S.small + 6 + j * lh, ln, f));
    });
    y += h;
  };

  // Etiket seridi: kesik cizgi + cihaza yapistirilacak etiket (en az 24 mm / rulo 30 mm).
  const strip = (sec) => {
    const minH = Math.round((roll ? 30 : 24) * MM);
    const kf = font(roll ? 44 : 56, true);
    const lines = (sec.lines ?? []).filter(Boolean);
    const tkW = measure(str(sec.ticket), kf);
    const stacked = roll;
    const colX = stacked ? left : left + tkW + S.pad * 6;
    const colW = right - colX;
    const f = font(S.body);
    const wrapped = lines.map((l, i) => wrapText(l, font(S.body, i === 0), colW, measure)).map((ls, i) => (i === 0 ? ls.slice(0, 2) : ls));
    const textH = wrapped.reduce((a, ls) => a + ls.length * lhB(), 0);
    const cutH = Math.round(S.small * S.lh);
    const kl = Math.round((roll ? 44 : 56) * 1.15);
    const need = cutH + S.pad * 2 + (stacked ? kl + textH : Math.max(kl, textH)) + S.pad * 2;
    const hh = Math.max(minH, need);
    ensure(hh + S.pad * 2);
    y += S.pad * 2;
    hline(left, right, y, 3, true);
    text(left, y + S.pad + S.small, str(sec.cut), font(S.small), { color: MUTED });
    const by = y + cutH + S.pad * 2;
    const inner = hh - cutH - S.pad * 2;
    text(left, by + Math.round((roll ? 44 : 56) * 0.9), str(sec.ticket), kf);
    let ty = stacked ? by + kl : by + Math.max(0, Math.round((inner - textH) / 2));
    wrapped.forEach((ls, i) => ls.forEach((ln) => { text(colX, ty + S.body, ln, font(S.body, i === 0)); ty += lhB(); }));
    y += hh;
  };

  // Kosullar: kucuk yazi; Letter/A4'te iki sutun.
  const terms = (sec) => {
    const sz = S.small - (roll ? 0 : 2);
    const f = font(sz);
    const lh = Math.round(sz * 1.25);
    const cols = roll ? 1 : 2;
    const colGap = S.pad * 4;
    const colW = Math.floor((cw - colGap * (cols - 1)) / cols);
    const ls = wrapText(sec.text, f, colW, measure);
    const per = Math.ceil(ls.length / cols);
    if (per * lh + S.pad > (roll ? MAX_ROLL : P.h) - P.m * 2 - footH - 120) { para(str(sec.text), sz, { color: MUTED }); return; }
    ensure(per * lh + S.pad);
    ls.forEach((ln, i) => text(left + Math.floor(i / per) * (colW + colGap), y + sz + (i % per) * lh, ln, f));
    y += per * lh + S.pad;
  };

  for (const sec of Array.isArray(doc?.sections) ? doc.sections : []) {
    if (sec.kind === "pagebreak") { if (y > P.m + 1) { closePage(); newPage(); } continue; }
    if (sec.kind === "top") { top(sec); continue; }
    if (sec.kind === "strip") { strip(sec); continue; }
    if (sec.kind === "sign") { sign(sec); continue; }
    heading(sec.heading);
    if (sec.kind === "table") (roll ? tableRoll : tableWide)(sec);
    else if (sec.kind === "kv") (sec.cols === 2 && !roll ? kvTwo : kvRows)(sec.rows ?? []);
    else if (sec.kind === "checks") checkRows(sec);
    else if (sec.kind === "fields") fieldRows(sec.rows ?? []);
    else if (sec.kind === "writelines") writeLines(sec.n | 0);
    else if (sec.kind === "list") listItems(sec.items ?? []);
    else if (sec.kind === "grid") grid(sec);
    else if (sec.kind === "terms") terms(sec);
    else if (sec.kind === "small") para(str(sec.text), S.small + 2, { color: MUTED, gapAfter: S.pad });
    else para(str(sec.text), S.body, { color: sec.kind === "empty" ? MUTED : INK, bold: sec.bold === true, align: sec.align === "right" ? "right" : "left" });
    y += sec.tight ? S.pad : S.pad * 2;
  }
  for (const n of Array.isArray(doc?.notes) ? doc.notes : []) para(str(n), S.small, { color: MUTED });
  closePage();
  return { width: W, pages };
}

/** Komutlari 2B baglama cizer. image: baslik logosu (HTMLImageElement / ImageBitmap) ya da null. */
export function paintPage(c2d, page, width, image = null) {
  c2d.fillStyle = "#ffffff";
  c2d.fillRect(0, 0, width, page.height);
  c2d.textBaseline = "alphabetic";
  for (const op of page.ops) {
    if (op.t === "text") { c2d.font = op.font; c2d.fillStyle = op.color; c2d.textAlign = op.align; c2d.fillText(op.text, op.x, op.y); }
    else if (op.t === "rect") { c2d.fillStyle = op.color; c2d.fillRect(op.x, op.y, op.w, op.h); }
    else if (op.t === "line") { c2d.strokeStyle = op.color; c2d.lineWidth = op.w; c2d.setLineDash(op.dash ? [14, 10] : []); c2d.beginPath(); c2d.moveTo(op.x1, op.y1); c2d.lineTo(op.x2, op.y2); c2d.stroke(); c2d.setLineDash([]); }
    else if (op.t === "box") { c2d.strokeStyle = op.color; c2d.lineWidth = op.lw; c2d.strokeRect(op.x, op.y, op.w, op.h); }
    else if (op.t === "image" && image) c2d.drawImage(image, op.x, op.y, op.w, op.h);
  }
}

function loadImage(src, doc) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = doc.createElement("img");
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Tarayicida: belge modeli -> PDF baytlari (Uint8Array). header.logo: data-URL ya da "". */
export async function docToPdf({ doc, header = {}, mark = "", paper = "letter", title = "" }, { document: d = globalThis.document } = {}) {
  const img = await loadImage(header.logo, d);
  const canvas = d.createElement("canvas");
  const c2d = canvas.getContext("2d");
  const measure = (t, fnt) => { c2d.font = fnt; return c2d.measureText(t).width; };
  const lay = layoutDoc({ doc, header: { ...header, logo: img ? { w: img.naturalWidth, h: img.naturalHeight } : null }, mark, paper }, measure);
  const pages = [];
  for (const page of lay.pages) {
    canvas.width = lay.width;
    canvas.height = page.height;
    paintPage(canvas.getContext("2d"), page, lay.width, img);
    const jpeg = base64ToBytes(canvas.toDataURL("image/jpeg", 0.9));
    if (!jpeg) throw new Error("page_render_failed");
    pages.push({ jpeg });
  }
  canvas.width = 1; canvas.height = 1; // bellegi birak
  return buildPdf(pages, { dpi: DPI, title });
}

/**
 * PDF'i kullaniciya teslim eder: once paylasim sayfasi (iPhone'da "Yazdir" buradadir), olmazsa indirme.
 * Donus: "shared" | "cancelled" | "downloaded".
 */
export async function deliverPdf({ bytes, filename, title = "" }, { win = globalThis.window } = {}) {
  const name = /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`;
  const nav = win.navigator;
  if (typeof win.File === "function" && typeof nav.share === "function") {
    const file = new win.File([bytes], name, { type: "application/pdf" });
    if (typeof nav.canShare !== "function" || nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title }); return "shared"; }
      catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
    }
  }
  const url = win.URL.createObjectURL(new win.Blob([bytes], { type: "application/pdf" }));
  const a = win.document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  win.document.body.append(a); a.click(); a.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(url), 60000);
  return "downloaded";
}
