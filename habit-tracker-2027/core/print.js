// TEK YAZDIRMA KAPISI: uygulamadaki her yazdirma requestPrint'ten gecer (modullerde window.print / navigator.share dogrudan cagrilmaz;
// tests/print-gate.test.mjs denetler). iPhone/iPad ana ekran uygulamasinda (navigator.standalone) PDF + paylasim sayfasi; baska her yerde
// ayni sayfa goruntuleri #print-root'a konur ve tarayicinin yazdirma penceresi acilir.
import { docToPdf, deliverFile, renderJpegs } from "./canvas-doc.js";

export const needsFileDelivery = (win = globalThis.window) => win?.navigator?.standalone === true;

function logoImage(d) {
  const src = d.getElementById("brand-logo-blue-src"); // baski ve PDF altbilgisi: mavi, ®'siz logo (beyaz kagit)
  return src && src.complete && src.naturalWidth > 0 ? src : null;
}

/** build(paper, logo: { w, h } | null) -> belge modeli. Doner "shared" | "downloaded" | "cancelled" | "printed". */
export async function requestPrint({ build, paper = "letter", filename, title = "" }, { win = globalThis.window } = {}) {
  const d = win.document;
  const img = logoImage(d);
  const doc = build(paper, img ? { w: img.naturalWidth, h: img.naturalHeight } : null);
  if (needsFileDelivery(win)) {
    const bytes = docToPdf(doc, img, title);
    return deliverFile({ bytes, filename: `${filename}.pdf`, title }, { win });
  }
  const pages = renderJpegs(doc, img, d);
  const root = d.getElementById("print-root");
  root.replaceChildren(...pages.map(({ url }) => {
    const im = d.createElement("img");
    im.className = "print-page";
    im.alt = "";
    im.src = url;
    return im;
  }));
  d.body.dataset.paper = paper === "a4" ? "a4" : "letter";
  d.body.classList.add("printing");
  const old = d.title;
  if (title) d.title = title;
  const cleanup = () => { root.replaceChildren(); d.body.classList.remove("printing"); d.title = old; };
  await Promise.all([...root.querySelectorAll("img")].map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
  win.addEventListener("afterprint", cleanup, { once: true });
  win.print();
  return "printed";
}
