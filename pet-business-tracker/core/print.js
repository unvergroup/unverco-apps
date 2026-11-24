import { h } from "./ui.js";
import { DEFAULT_ACCENT, businessLines } from "./business.js";
import { isLogoDataUrl } from "./logo.js";

// "Belgeyi yazdir / PDF olarak kaydet".
// printDocument({ title, node, business, paper }) belge govdesini (DOM dugumu) #print-root icine koyar, ustune dukkan basligini ekler,
// kagit turunu body[data-paper]'a yazar (letter | a4 | thermal80; core/print.css adli @page kurallari bunu izler), tarayicinin yazdirma
// penceresini acar ve bitince temizler. Kullanici verisi yalniz metin dugumu olarak gider (h() / textContent).
// Pet Business Tracker: randevu fisi (buildAppointmentReceipt) ve musteri karti (buildClientCard) belge govdeleri de burada; ikisi de printDocument'a verilir.
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
// mark: altbilgiye yazilacak TEK SATIR METIN ("Made with UNVERCO Pet Business Tracker"); bos ise altbilgi yalniz bosluktur.
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

// ---- Belge govdeleri (kullanici verisi yalniz metin dugumu) ----------------------------------------------------------
// Saf veri: bos alanlar atilir; testler DOM'suz bunu dener. appointment: { serial, date, time, durationMin, services[], priceMinor, paidMinor, notes }
export function receiptData({ appointment, client, pet } = {}) {
  const a = appointment ?? {};
  const price = Number.isSafeInteger(a.priceMinor) ? a.priceMinor : null;
  const paid = Number.isSafeInteger(a.paidMinor) ? a.paidMinor : 0;
  return {
    serial: typeof a.serial === "string" ? a.serial : "",
    date: typeof a.date === "string" ? a.date : "",
    time: typeof a.time === "string" ? a.time : "",
    durationMin: Number.isInteger(a.durationMin) ? a.durationMin : null,
    services: (Array.isArray(a.services) ? a.services : []).map((x) => (typeof x === "string" ? x : x && typeof x.name === "string" ? x.name : "")).filter(Boolean),
    clientName: typeof client?.name === "string" ? client.name : "",
    clientPhone: typeof client?.phone === "string" ? client.phone : "",
    petName: typeof pet?.name === "string" ? pet.name : "",
    petKind: [pet?.species, pet?.breed].filter((x) => typeof x === "string" && x).join(" / "),
    priceMinor: price,
    paidMinor: paid,
    dueMinor: price === null ? null : Math.max(0, price - paid),
    notes: typeof a.notes === "string" ? a.notes : "",
  };
}

const kv = (rows) => h("dl", { class: "rc-kv" }, rows.filter(([, v]) => v !== "" && v !== null && v !== undefined).flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: String(v) })]));

// Randevu fisi. t / formatDate / formatCurrency i18n nesnesinden gelir. Anahtarlar: unvercopbt.print.*
export function buildAppointmentReceipt({ appointment, client, pet, t, formatDate, formatCurrency }) {
  const d = receiptData({ appointment, client, pet });
  const money = (v) => (v === null ? "" : formatCurrency(v));
  return h(
    "section",
    { class: "rc-copy" },
    h("div", { class: "rc-top" }, h("h2", { class: "rc-title", text: t("unvercopbt.print.receipt") }), d.serial ? h("p", { class: "rc-ticket", text: d.serial }) : null),
    h("p", { class: "rc-date", text: [d.date ? formatDate(d.date) : "", d.time].filter(Boolean).join(" ") }),
    h("div", { class: "rc-sec" }, h("h3", { text: t("unvercopbt.print.client") }), kv([[t("unvercopbt.print.name"), d.clientName], [t("unvercopbt.print.phone"), d.clientPhone]])),
    h("div", { class: "rc-sec" }, h("h3", { text: t("unvercopbt.print.pet") }), kv([[t("unvercopbt.print.name"), d.petName], [t("unvercopbt.print.kind"), d.petKind]])),
    h("div", { class: "rc-sec" }, h("h3", { text: t("unvercopbt.print.services") }),
      d.services.length ? h("ul", { class: "rc-list" }, d.services.map((s) => h("li", { text: s }))) : null,
      d.durationMin !== null ? h("p", { class: "rc-note", text: t("unvercopbt.print.duration", { min: d.durationMin }) }) : null),
    d.priceMinor !== null
      ? h("div", { class: "rc-sec" }, h("table", { class: "rc-totals" }, h("tbody", {},
          h("tr", {}, h("td", { text: t("unvercopbt.print.price") }), h("td", { class: "num", text: money(d.priceMinor) })),
          h("tr", {}, h("td", { text: t("unvercopbt.print.paid") }), h("td", { class: "num", text: money(d.paidMinor) })),
          h("tr", { class: "is-total" }, h("td", { text: t("unvercopbt.print.due") }), h("td", { class: "num", text: money(d.dueMinor) }))))) : null,
    d.notes ? h("div", { class: "rc-sec" }, h("h3", { text: t("unvercopbt.print.notes") }), h("p", { class: "rc-text", text: d.notes })) : null
  );
}

// Musteri karti: musteri bilgisi + evcil hayvanlari. pets: [{ name, species, breed, birthDate?, notes? }]
export function clientCardData({ client, pets } = {}) {
  const c = client ?? {};
  return {
    name: typeof c.name === "string" ? c.name : "",
    phone: typeof c.phone === "string" ? c.phone : "",
    email: typeof c.email === "string" ? c.email : "",
    address: typeof c.address === "string" ? c.address : "",
    notes: typeof c.notes === "string" ? c.notes : "",
    pets: (Array.isArray(pets) ? pets : []).filter((p) => p && typeof p.name === "string" && p.name).map((p) => ({
      name: p.name,
      kind: [p.species, p.breed].filter((x) => typeof x === "string" && x).join(" / "),
      notes: typeof p.notes === "string" ? p.notes : "",
    })),
  };
}

export function buildClientCard({ client, pets, t }) {
  const d = clientCardData({ client, pets });
  return h(
    "section",
    { class: "rc-copy cc-card" },
    h("div", { class: "rc-top" }, h("h2", { class: "rc-title", text: t("unvercopbt.print.clientCard") })),
    h("div", { class: "rc-sec" }, kv([[t("unvercopbt.print.name"), d.name], [t("unvercopbt.print.phone"), d.phone], [t("unvercopbt.print.email"), d.email], [t("unvercopbt.print.address"), d.address]])),
    d.pets.length
      ? h("div", { class: "rc-sec" }, h("h3", { text: t("unvercopbt.print.pets") }),
          h("ul", { class: "rc-list" }, d.pets.map((p) => h("li", { text: [p.name, p.kind, p.notes].filter(Boolean).join(" - ") })))) : null,
    d.notes ? h("div", { class: "rc-sec" }, h("h3", { text: t("unvercopbt.print.notes") }), h("p", { class: "rc-text", text: d.notes })) : null
  );
}
