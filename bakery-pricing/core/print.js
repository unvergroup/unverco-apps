import { h } from "./ui.js";
import { DEFAULT_ACCENT, businessLines } from "./business.js";
import { isLogoDataUrl } from "./logo.js";

// "Belgeyi yazdir / PDF olarak kaydet".
// printDocument({ title, node, business, paper }) belge govdesini (DOM dugumu) #print-root icine koyar, ustune dukkan basligini ekler,
// kagit turunu body[data-paper]'a yazar (letter | a4 | thermal80; core/print.css adli @page kurallari bunu izler), tarayicinin yazdirma
// penceresini acar ve bitince temizler. Kullanici verisi yalniz metin dugumu olarak gider (h() / textContent).
// Baslik icin saf veri: { name, lines, accent, logo } (test edilebilir). logo: musterinin kendi logosu (PNG / JPEG data-URL); gecersizse "".
export function printHeaderData(business) {
  const b = business ?? {};
  return {
    name: typeof b.name === "string" ? b.name : "",
    lines: (Array.isArray(b.lines) ? b.lines : businessLines(b)).filter((l) => typeof l === "string" && l),
    accent: typeof b.accent === "string" && /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : DEFAULT_ACCENT,
    logo: isLogoDataUrl(b.logo) ? b.logo : "",
  };
}

// Baslik: MUSTERININ LOGOSU (ustte, belirgin) + isletme adi (h1) + iletisim satirlari; vurgu rengi --accent ozelligiyle (CSSOM; CSP'ye uygun).
// Logo yoksa hicbir yer tutucu / bos cerceve konmaz. src dogrudan ozellik atamasiyla verilir (h() data: adresi reddeder).
export function buildPrintHeader(business) {
  const { name, lines, accent, logo } = printHeaderData(business);
  if (!name && !lines.length && !logo) return null;
  let mark = null;
  if (logo) {
    const img = h("img", { class: "doc-logo", alt: name || "" });
    img.src = logo;
    mark = h("div", { class: "doc-logo-wrap" }, img);
  }
  const head = h(
    "header",
    { class: `doc-head${logo ? " has-logo" : ""}` },
    mark,
    h(
      "div",
      { class: "doc-ident" },
      name ? h("h1", { class: "doc-business", text: name }) : null,
      lines.length ? h("div", { class: "doc-contact" }, lines.map((l) => h("p", { text: l }))) : null
    )
  );
  head.style.setProperty("--accent", accent);
  return head;
}

// Sayfa cercevesi: @page kenari 0 oldugu icin (Chrome "Headers and footers" acik olsa da PDF'e yerel dosya yolu dusmesin)
// sayfa kenari bosluklari belgenin ICINDE verilir: ust ve alt bosluk, tablonun yinelenen thead / tfoot satirlari
// (her sayfada tekrar eder); yan bosluk hucrenin padding'i (core/print.css .page-frame).
// mark: altbilgiye yazilacak TEK SATIR METIN ("Made with UNVERCO Bakery Pricing & Orders"); bos ise altbilgi yalniz bosluktur.
// Marka YALNIZ metindir: raster / gomulu gorsel yok (dosya sismez, kucuk boyutta bulaniklasmaz).
export function wrapPageFrame(content, mark = "") {
  const gap = (cls) => h("div", { class: `page-gap${cls ? " " + cls : ""}` });
  const foot = typeof mark === "string" && mark.trim()
    ? h("div", { class: "page-gap page-foot" }, h("p", { class: "doc-footmark", text: mark.trim() }))
    : gap();
  return h(
    "table",
    { class: "page-frame", role: "presentation" },
    h("thead", {}, h("tr", {}, h("td", {}, gap()))),
    h("tfoot", {}, h("tr", {}, h("td", {}, foot))),
    h("tbody", {}, h("tr", {}, h("td", { class: "page-cell" }, content)))
  );
}

let cleanupPrev = null;

export const PAPER_IDS = Object.freeze(["letter", "a4", "thermal80"]);

export function printDocument({ title, node, business, paper = "letter", mark = "", win = globalThis.window, doc = globalThis.document } = {}) {
  if (cleanupPrev) cleanupPrev();
  const old = doc.title;
  if (title) doc.title = title;
  let root = null;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    cleanupPrev = null;
    doc.title = old;
    if (root) {
      root.replaceChildren();
      doc.body.classList.remove("printing");
      delete doc.body.dataset.paper;
    }
  };
  try {
    if (node) {
      root = doc.getElementById("print-root");
      root.replaceChildren(wrapPageFrame(h("article", { class: "doc" }, buildPrintHeader(business), node), mark));
      doc.body.dataset.paper = PAPER_IDS.includes(paper) ? paper : "letter";
      doc.body.classList.add("printing");
    }
    win.print();
  } catch (e) {
    cleanup();
    throw e;
  }
  // Bazi tarayicilar print()'ten hemen doner (iOS); temizlik yazdirma bitince yapilir.
  if (root && typeof win.addEventListener === "function") {
    cleanupPrev = cleanup;
    win.addEventListener("afterprint", cleanup, { once: true });
  } else {
    cleanup();
  }
}

// TEK KAPI: uygulamadaki her yazdirma (siparis onayi, teklif, fatura, tarif karti, haftalik liste, aylik ozet) buradan gecer. Teslim yontemi (tarayici yazdirma penceresi,
// iPhone ana ekran uygulamasi icin baska bir yol vb.) ileride YALNIZ burada degisir. ctx.print (app.js) isletme basligini + markayi ekler.
// node: hazir belge govdesi; build(paper): kagit turune gore govde kuran islev (80 mm icin ayri duzen). Kagit turu Ayarlar'dan okunur.
// doc: ayni belgenin saf MODELI (print/docs.js bicimi). iPhone ana ekran uygulamasinda window.print() calismadigi icin
// kabuk (app.js ctx.print) bu modelden PDF uretip paylasim sayfasina verir (core/canvas-doc.js). doc yoksa her yerde tarayici yazdirmasi.
export async function requestPrint(ctx, { title, node, build, doc }) {
  const paper = (await ctx.prefs.get()).paper;
  await ctx.print({ title, node: typeof build === "function" ? build(paper) : node, paper, doc });
}

/** iPhone / iPad ana ekran uygulamasi mi? (navigator.standalone yalniz iOS'ta vardir.) Orada yazdirma DOSYA ile yapilir. */
export const needsFileDelivery = (win = globalThis.window) => win?.navigator?.standalone === true;
