// Belge modelini (modules/*/print/docs.js: { title, period, sections[], notes[] }) SAYFA GORUNTULERINE cevirir; core/pdf.js bunlari PDF yapar.
// NEDEN: iPhone ana ekran uygulamasinda window.print() calismaz; belge dosya olarak uretilip paylasim sayfasina verilir (core/print.js).
// Iki katman:
//   layoutDoc(...)  SAF: DOM yok. Metin olcumu disaridan verilir (measure). Cikti: sayfa basina cizim komutlari. Node'da test edilir.
//   paintPage(...)  komutlari 2B canvas baglamina cizer (tarayicida).
// Olcu birimi piksel, 200 dpi: Letter 1700x2200, A4 1654x2339, 80 mm rulo 630 x icerik kadar.
import { base64ToBytes, buildPdf } from "./pdf.js";

export const DPI = 200;
const FAMILY = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const PAPERS = Object.freeze({
  letter: { w: 1700, h: 2200, m: 130 },
  a4: { w: 1654, h: 2339, m: 130 },
  thermal80: { w: 630, h: 0, m: 28 }, // h: 0 = icerik kadar (tek uzun sayfa; ust sinir MAX_ROLL)
});
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
    ? { body: 23, small: 20, h3: 26, title: 34, biz: 30, lh: 1.32, pad: 6 }
    : { body: 27, small: 23, h3: 32, title: 46, biz: 40, lh: 1.34, pad: 9 };
  const W = P.w;
  const left = P.m;
  const right = W - P.m;
  const cw = right - left;
  const footH = mark ? Math.round(S.small * 2.4) : 0;
  const limit = (roll ? MAX_ROLL : P.h) - P.m - footH - S.pad * 8; // pay: satir arasi bosluklar sayfa kontrolu yapmaz

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
  para(str(doc?.title), S.title, { bold: true });
  if (doc?.period) para(str(doc.period), S.body, { color: MUTED });
  y += S.pad * 2;

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

  for (const sec of Array.isArray(doc?.sections) ? doc.sections : []) {
    heading(sec.heading);
    if (sec.kind === "table") (roll ? tableRoll : tableWide)(sec);
    else if (sec.kind === "kv") kvRows(sec.rows ?? []);
    else para(str(sec.text), S.body, { color: sec.kind === "empty" ? MUTED : INK });
    y += S.pad * 3;
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
    else if (op.t === "line") { c2d.strokeStyle = op.color; c2d.lineWidth = op.w; c2d.beginPath(); c2d.moveTo(op.x1, op.y1); c2d.lineTo(op.x2, op.y2); c2d.stroke(); }
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
