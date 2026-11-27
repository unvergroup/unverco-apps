// Belge modelini ({ pages: [{ width, height, ops }] }, modules/habits/print/docs.js) canvas'a cizer; JPEG -> PDF (core/pdf.js).
// NEDEN: iPhone ana ekran uygulamasinda window.print() yok sayilir; belge PDF olarak paylasim sayfasina verilir. Masaustunde ayni sayfa
// goruntuleri yazdirma kokune konur ve window.print() acilir: iki yol AYNI cizimi basar. Kagit her zaman beyaz.
import { base64ToBytes, buildPdf } from "./pdf.js";

export const DPI = 200;

/** Komutlari 2B baglama cizer. image: altbilgi logosu (HTMLImageElement) ya da null. */
export function paintPage(c2d, page, image = null) {
  c2d.fillStyle = "#ffffff";
  c2d.fillRect(0, 0, page.width, page.height);
  c2d.textBaseline = "alphabetic";
  for (const op of page.ops) {
    if (op.t === "text") { c2d.font = op.font; c2d.fillStyle = op.color; c2d.textAlign = op.align || "left"; c2d.fillText(op.text, op.x, op.y); }
    else if (op.t === "rect") { c2d.fillStyle = op.color; c2d.fillRect(op.x, op.y, op.w, op.h); }
    else if (op.t === "strokeRect") { c2d.strokeStyle = op.color; c2d.lineWidth = op.lw || 2; c2d.strokeRect(op.x, op.y, op.w, op.h); }
    else if (op.t === "line") { c2d.strokeStyle = op.color; c2d.lineWidth = op.w || 2; c2d.beginPath(); c2d.moveTo(op.x1, op.y1); c2d.lineTo(op.x2, op.y2); c2d.stroke(); }
    else if (op.t === "hatch") {
      c2d.save(); c2d.beginPath(); c2d.rect(op.x, op.y, op.w, op.h); c2d.clip();
      c2d.strokeStyle = op.color; c2d.lineWidth = 2;
      for (let k = -op.h; k < op.w; k += 9) { c2d.beginPath(); c2d.moveTo(op.x + k, op.y + op.h); c2d.lineTo(op.x + k + op.h, op.y); c2d.stroke(); }
      c2d.restore(); c2d.strokeStyle = op.color; c2d.strokeRect(op.x, op.y, op.w, op.h);
    } else if (op.t === "check") {
      const s = op.s;
      c2d.strokeStyle = op.color; c2d.lineWidth = Math.max(3, s * 0.16); c2d.lineCap = "round"; c2d.lineJoin = "round";
      c2d.beginPath(); c2d.moveTo(op.x - s * 0.45, op.y); c2d.lineTo(op.x - s * 0.1, op.y + s * 0.35); c2d.lineTo(op.x + s * 0.5, op.y - s * 0.35); c2d.stroke();
    } else if (op.t === "image" && image) c2d.drawImage(image, op.x, op.y, op.w, op.h);
  }
}

/** Tarayicida metin olcer (yerlesim icin). */
export function canvasMeasure(d = globalThis.document) {
  const c2d = d.createElement("canvas").getContext("2d");
  return (t, fnt) => { c2d.font = fnt; return c2d.measureText(String(t)).width; };
}

/** Her sayfa -> JPEG baytlari. */
export function renderJpegs(doc, image, d = globalThis.document) {
  const canvas = d.createElement("canvas");
  const out = [];
  for (const pg of doc.pages) {
    canvas.width = pg.width; canvas.height = pg.height;
    paintPage(canvas.getContext("2d"), pg, image);
    const url = canvas.toDataURL("image/jpeg", 0.92);
    const jpeg = base64ToBytes(url);
    if (!jpeg) throw new Error("page_render_failed");
    out.push({ jpeg, url });
  }
  canvas.width = 1; canvas.height = 1;
  return out;
}

export const docToPdf = (doc, image, title = "") => buildPdf(renderJpegs(doc, image).map(({ jpeg }) => ({ jpeg })), { dpi: DPI, title });

/** PDF'i once paylasim sayfasina verir (iPhone'da "Yazdir" orada), olmazsa indirir. Doner "shared" | "cancelled" | "downloaded". */
export async function deliverFile({ bytes, filename, type = "application/pdf", title = "" }, { win = globalThis.window } = {}) {
  const nav = win.navigator;
  if (typeof win.File === "function" && typeof nav.share === "function") {
    const file = new win.File([bytes], filename, { type });
    if (typeof nav.canShare !== "function" || nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title }); return "shared"; }
      catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
    }
  }
  const url = win.URL.createObjectURL(new win.Blob([bytes], { type }));
  const a = win.document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  win.document.body.append(a); a.click(); a.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(url), 60000);
  return "downloaded";
}
