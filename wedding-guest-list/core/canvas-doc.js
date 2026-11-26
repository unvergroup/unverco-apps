// Sayfa komutlarini (modules/guests/print-pdf.js) canvas'a cizer, JPEG yapar, core/pdf.js ile PDF'e cevirir ve teslim eder.
// NEDEN: iPhone ana ekran uygulamasinda window.print() calismaz (WebKit sessizce yok sayar). Belge dosya olarak uretilip
// paylasim sayfasina verilir (navigator.share({ files })); oradan "Yazdir" (AirPrint) ya da "Dosyalara kaydet" secilir.
// Dis kutuphane yok, ag yok. Yazi tipi: uygulamanin kendi Lora'si (fonts/, @font-face; CSP'ye uygun).
// Birim: komutlar pt cinsindendir; canvas dpi / 72 ile olceklenir. Buyuk afisler dusuk dpi ile cizilir (iOS canvas ~16,7 milyon piksel siniri).
import { base64ToBytes, buildPdf } from "./pdf.js";

export const FAMILY = 'Lora, Georgia, "Times New Roman", serif';
const fontOf = (f) => `${f.style === "italic" ? "italic " : ""}${f.weight || 400} ${f.size}px ${FAMILY}`;

// Besin isaretleri: 24 x 24'luk kutuda (parts.js SHAPES ile ayni sekiller).
const STAR = "12,1.5 14.6,8.9 22.5,9 16.2,13.8 18.5,21.5 12,17 5.5,21.5 7.8,13.8 1.5,9 9.4,8.9";
const PLUS = "8.5,2 15.5,2 15.5,8.5 22,8.5 22,15.5 15.5,15.5 15.5,22 8.5,22 8.5,15.5 2,15.5 2,8.5 8.5,8.5";
const POLY = { triangle: "12,3 21.5,20 2.5,20", diamond: "12,1.5 22.5,12 12,22.5 1.5,12", star: STAR, plus: PLUS };

function markPath(c2d, shape) {
  c2d.beginPath();
  if (shape === "circle") c2d.arc(12, 12, 9, 0, Math.PI * 2);
  else if (shape === "square") c2d.rect(4, 4, 16, 16);
  else {
    const pts = (POLY[shape] ?? POLY.triangle).split(" ").map((p) => p.split(",").map(Number));
    pts.forEach(([x, y], i) => (i ? c2d.lineTo(x, y) : c2d.moveTo(x, y)));
    c2d.closePath();
  }
}

/** Olcu islevi (canvas): measure(text, font) -> pt cinsinden genislik; harf araligi (spacing) her harfe eklenir. */
export function makeMeasure(c2d) {
  return (text, f) => {
    c2d.font = fontOf(f);
    const s = String(text);
    return c2d.measureText(s).width + (f.spacing ? f.spacing * Array.from(s).length : 0);
  };
}

/** Bir sayfayi cizer. kx, ky: pt basina piksel. */
export function paintPage(c2d, page, kx, ky = kx) {
  c2d.setTransform(1, 0, 0, 1, 0, 0);
  c2d.fillStyle = "#ffffff";
  c2d.fillRect(0, 0, Math.ceil(page.w * kx), Math.ceil(page.h * ky));
  c2d.setTransform(kx, 0, 0, ky, 0, 0);
  c2d.textBaseline = "alphabetic";
  c2d.lineCap = "butt";
  const measure = makeMeasure(c2d);
  for (const op of page.ops) {
    if (op.t === "text") {
      c2d.font = fontOf(op);
      c2d.fillStyle = op.color;
      c2d.textAlign = "left";
      if (op.spacing) {
        const chars = Array.from(op.text);
        const total = measure(op.text, op);
        let x = op.align === "center" ? op.x - total / 2 : op.align === "right" ? op.x - total : op.x;
        for (const ch of chars) { c2d.fillText(ch, x, op.y); x += c2d.measureText(ch).width + op.spacing; }
      } else {
        c2d.textAlign = op.align;
        c2d.fillText(op.text, op.x, op.y);
      }
    } else if (op.t === "line") {
      c2d.strokeStyle = op.color; c2d.lineWidth = op.w;
      c2d.setLineDash(op.dash ?? []);
      c2d.beginPath(); c2d.moveTo(op.x1, op.y1); c2d.lineTo(op.x2, op.y2); c2d.stroke();
      c2d.setLineDash([]);
    } else if (op.t === "rect") {
      if (op.fill) { c2d.fillStyle = op.fill; c2d.fillRect(op.x, op.y, op.w, op.h); }
      if (op.stroke) { c2d.strokeStyle = op.stroke; c2d.lineWidth = op.sw; c2d.strokeRect(op.x, op.y, op.w, op.h); }
    } else if (op.t === "mark") {
      c2d.save();
      c2d.translate(op.x, op.y);
      c2d.scale(op.size / 24, op.size / 24);
      markPath(c2d, op.shape);
      c2d.fillStyle = op.fill; c2d.fill();
      c2d.strokeStyle = op.stroke; c2d.lineWidth = 1.6; c2d.lineJoin = "round"; c2d.stroke();
      c2d.restore();
    }
  }
}

/** Tarayicida: yerlesim islevi (measure verilir) -> sayfalar -> PDF baytlari. layout: (measure) => { pages }. */
export async function layoutToPdf(layout, { title = "", document: d = globalThis.document } = {}) {
  const canvas = d.createElement("canvas");
  const c2d = canvas.getContext("2d");
  const { pages } = layout(makeMeasure(c2d), c2d);
  const out = [];
  for (const page of pages) {
    const wpx = Math.max(1, Math.round((page.w * page.dpi) / 72)), hpx = Math.max(1, Math.round((page.h * page.dpi) / 72));
    canvas.width = wpx; canvas.height = hpx;
    paintPage(canvas.getContext("2d"), page, wpx / page.w, hpx / page.h);
    const jpeg = base64ToBytes(canvas.toDataURL("image/jpeg", 0.92));
    if (!jpeg) throw new Error("page_render_failed");
    out.push({ jpeg, wPt: page.w, hPt: page.h });
  }
  canvas.width = 1; canvas.height = 1; // bellegi birak
  return buildPdf(out, { title });
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
