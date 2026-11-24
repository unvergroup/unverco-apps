import { h } from "./ui.js";
// "Belgeyi yazdir / PDF olarak kaydet".
// printDocument({ title, node, business, paper }) belge govdesini (DOM dugumu) #print-root icine koyar, ustune dukkan basligini ekler,
// kagit turunu body[data-paper]'a yazar (letter | a4 | thermal80; core/print.css adli @page kurallari bunu izler), tarayicinin yazdirma
// penceresini acar ve bitince temizler. Kullanici verisi yalniz metin dugumu olarak gider (h() / textContent).
// Baslik icin saf veri: { name, lines, accent } (test edilebilir).
export function printHeaderData(business) {
  const b = business ?? {};
  return {
    name: typeof b.name === "string" ? b.name : "",
    lines: Array.isArray(b.lines) ? b.lines.filter((l) => typeof l === "string" && l) : [],
    accent: typeof b.accent === "string" && /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : DEFAULT_ACCENT,
  };
}

// Baslik: isletme adi (h1) + iletisim satirlari; vurgu rengi --accent ozelligiyle (CSSOM; CSP'ye uygun).
export function buildPrintHeader(business) {
  const { name, lines, accent } = printHeaderData(business);
  if (!name && !lines.length) return null;
  const head = h(
    "header",
    { class: "doc-head" },
    name ? h("h1", { class: "doc-business", text: name }) : null,
    lines.length ? h("div", { class: "doc-contact" }, lines.map((l) => h("p", { text: l }))) : null
  );
  head.style.setProperty("--accent", accent);
  return head;
}

// Sayfa cercevesi: @page kenari 0 oldugu icin (Chrome "Headers and footers" acik olsa da PDF'e yerel dosya yolu dusmesin)
// sayfa kenari bosluklari belgenin ICINDE verilir: ust ve alt bosluk, tablonun yinelenen thead / tfoot satirlari
// (her sayfada tekrar eder); yan bosluk hucrenin padding'i (core/print.css .page-frame).
export function wrapPageFrame(content) {
  const gap = () => h("div", { class: "page-gap" });
  return h(
    "table",
    { class: "page-frame", role: "presentation" },
    h("thead", {}, h("tr", {}, h("td", {}, gap()))),
    h("tfoot", {}, h("tr", {}, h("td", {}, gap()))),
    h("tbody", {}, h("tr", {}, h("td", { class: "page-cell" }, content)))
  );
}

let cleanupPrev = null;

// iPhone / iPad ana ekran uygulamasi: window.print() orada sessizce hicbir sey yapmaz (iOS siniri); app.js yerine aciklayici pencere gosterir.
export const isStandaloneApp = (nav = globalThis.navigator) => Boolean(nav) && nav.standalone === true;

export const PAPER_IDS = Object.freeze(["letter", "a4", "thermal80"]);

export function printDocument({ title, node, business, paper = "letter", win = globalThis.window, doc = globalThis.document } = {}) {
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
      root.replaceChildren(wrapPageFrame(h("article", { class: "doc" }, buildPrintHeader(business), node)));
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
