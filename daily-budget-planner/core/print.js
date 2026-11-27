// TEK YAZDIRMA GECIDI (yol plani A7). Uygulamadaki her "Print" dugmesi requestPrint'ten gecer; moduller window.print() ya da
// navigator.share() cagirmaz (tests/files.test.mjs bunu yasaklar).
// Belge tek kaynaktan cizilir (modules/budget/print/plan.js layoutPlan): ayni cizim
//   - iPhone / iPad ana ekran uygulamasinda (window.print() orada sessizce yok sayilir) -> PDF -> paylasim sayfasi (Yazdir / Dosyalar),
//   - bilgisayar, Android, Safari sekmesi -> #print-root icine beyaz sayfa goruntusu + window.print() (@page Letter / A4, kenar 0).
// Paylasim yoksa PDF indirilir. Kagit her temada beyazdir.
import { base64ToBytes, buildPdf } from "./pdf.js";
import { layoutPlan, paintPlan } from "../modules/budget/print/plan.js";

export const DPI = 200;
export const needsFileDelivery = (win = globalThis.window) => win?.navigator?.standalone === true;

function loadImage(src, doc) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = doc.createElement("img");
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Model -> cizilmis canvas (tarayici). */
export async function renderPlanCanvas(model, paper, { document: d = globalThis.document, logoSrc = "" } = {}) {
  const img = await loadImage(logoSrc, d);
  const canvas = d.createElement("canvas");
  const c2d = canvas.getContext("2d");
  const measure = (t, f) => { c2d.font = f; return c2d.measureText(t).width; };
  const lay = layoutPlan(model, paper, measure, img ? { w: img.naturalWidth, h: img.naturalHeight } : null);
  canvas.width = lay.width;
  canvas.height = lay.height;
  paintPlan(canvas.getContext("2d"), lay, img);
  return canvas;
}

export function canvasToPdf(canvas, title = "") {
  const jpeg = base64ToBytes(canvas.toDataURL("image/jpeg", 0.92));
  if (!jpeg) throw new Error("page_render_failed");
  return buildPdf([{ jpeg }], { dpi: DPI, title });
}

/** PDF'i paylasim sayfasina verir; olmazsa indirir. -> "shared" | "cancelled" | "downloaded" */
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

let cleanupPrev = null;
/** Bilgisayarda tarayicinin yazdirma penceresi: sayfa goruntusu #print-root'a konur, body[data-paper] @page'i secer. */
export function printCanvas(canvas, { paper = "letter", title = "", win = globalThis.window, doc = globalThis.document } = {}) {
  if (cleanupPrev) cleanupPrev();
  const root = doc.getElementById("print-root");
  const img = doc.createElement("img");
  img.className = "print-page";
  img.alt = title;
  img.src = canvas.toDataURL("image/png");
  root.replaceChildren(img);
  const old = doc.title;
  if (title) doc.title = title;
  doc.body.dataset.paper = paper === "a4" ? "a4" : "letter";
  doc.body.classList.add("printing");
  let done = false;
  const cleanup = () => { if (done) return; done = true; cleanupPrev = null; doc.title = old; root.replaceChildren(); doc.body.classList.remove("printing"); delete doc.body.dataset.paper; };
  cleanupPrev = cleanup;
  win.addEventListener("afterprint", cleanup, { once: true });
  win.print();
}

/** Uygulamanin tek yazdirma kapisi. */
export async function requestPrint({ model, paper, title, filename, logoSrc }, { win = globalThis.window, doc = globalThis.document } = {}) {
  const canvas = await renderPlanCanvas(model, paper, { document: doc, logoSrc });
  try {
    if (needsFileDelivery(win)) return await deliverPdf({ bytes: canvasToPdf(canvas, title), filename, title }, { win });
    printCanvas(canvas, { paper, title, win, doc });
    return "printed";
  } finally {
    if (needsFileDelivery(win)) { canvas.width = 1; canvas.height = 1; }
  }
}
