// Mesaj taslagi doldurma (spec 8). Saf islevler: DOM yok, ag yok, eval yok.
// Cikti DUZ METINDIR; kodlama baglanti asamasinda (phone.js) yapilir. Hicbir sey gonderilmez.

/** Taslaklarda kullanilabilen 10 yer tutucu. */
export const PLACEHOLDERS = Object.freeze(["name", "ticket", "device", "estimate", "total", "balance", "shop", "shop_phone", "ready_date", "review_link"]);

/** Bos kalirsa ilgili mesaj dugmelerini kapatan yer tutucular (tahmin yok -> onay taslagi; yorum baglantisi yok -> yorum istegi). */
export const BLOCKING = Object.freeze(["estimate", "review_link"]);

const KNOWN = new Set(PLACEHOLDERS);
const TOKEN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

// Yalniz metin ve sonlu sayi kabul edilir; digeri bos dizgi (undefined / null / NaN metne girmez).
const asText = (v) => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
};

/**
 * Taslaktaki {yer_tutucu} alanlarini tek gecisle doldurur.
 * Bilinmeyen yer tutucu oldugu gibi kalir ve `unknown`'a yazilir; bos deger bos dizgi olur ve `empty`'ye yazilir;
 * `blocked`, bos kalan ve BLOCKING icindeki yer tutuculardir (UI ilgili dugmeyi kapatir).
 * Degerin icindeki {..} yeniden acilmaz; `$` ozel anlam tasimaz.
 * @param {unknown} template
 * @param {Record<string, unknown> | null | undefined} values yalniz kendi (own) alanlari okunur
 * @returns {{ text: string, unknown: string[], empty: string[], blocked: string[] }}
 */
export function fillTemplate(template, values) {
  const result = { text: "", unknown: [], empty: [], blocked: [] };
  if (typeof template !== "string") return result;
  const src = values && typeof values === "object" ? values : {};
  // Secenekli parca: [[ ... ]] icindeki yer tutuculardan biri bos ise parcanin tamami atlanir (ornek: dukkan adi bos iken "this is ." cikmaz).
  const fillPart = (part) => {
    let missing = false;
    const text = part.replace(TOKEN, (whole, name) => {
      if (!KNOWN.has(name)) {
        if (!result.unknown.includes(name)) result.unknown.push(name);
        return whole;
      }
      const value = Object.hasOwn(src, name) ? asText(src[name]) : "";
      if (value === "") {
        missing = true;
        if (!result.empty.includes(name)) result.empty.push(name);
      }
      return value;
    });
    return { text, missing };
  };
  // Tek gecis: secenekli parca ya da tek yer tutucu; doldurulan deger yeniden taranmaz.
  result.text = template.replace(/\[\[([\s\S]*?)\]\]|\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, inner) => {
    if (inner === undefined) return fillPart(whole).text;
    const r = fillPart(inner);
    return r.missing ? "" : r.text;
  });
  result.blocked = result.empty.filter((n) => BLOCKING.includes(n));
  return result;
}

/**
 * {device} adi: model -> tur adi -> yedek ("device" / "cihaz").
 * @param {{ type?: string, model?: string } | null | undefined} device
 * @param {Record<string, string> | null | undefined} typeNames tur anahtari -> yerel ad (Other icin kullanilmaz)
 * @param {string} [fallback]
 * @returns {string}
 */
export function deviceName(device, typeNames, fallback) {
  const fb = typeof fallback === "string" ? fallback : "";
  if (!device || typeof device !== "object") return fb;
  const model = typeof device.model === "string" ? device.model.trim() : "";
  if (model) return model;
  const type = device.type;
  if (type !== "other" && typeNames && typeof type === "string" && Object.hasOwn(typeNames, type)) {
    const n = asText(typeNames[type]);
    if (n) return n;
  }
  return fb;
}

const isMinor = (n) => Number.isInteger(n) && n > 0;

/**
 * {estimate} tutari (en kucuk birim): tahmin -> satir toplami -> yok (null).
 * 0, eksi, kesirli ya da sayi olmayan deger "yok" sayilir (musteriye yanlislikla "0,00" yazilmasin).
 * @param {{ estimateMinor?: unknown, linesTotalMinor?: unknown } | null | undefined} input
 * @returns {number | null}
 */
export function pickEstimate(input) {
  if (!input || typeof input !== "object") return null;
  if (isMinor(input.estimateMinor)) return input.estimateMinor;
  if (isMinor(input.linesTotalMinor)) return input.linesTotalMinor;
  return null;
}

const money = (fmt, minor) => {
  if (!Number.isFinite(minor)) return "";
  return typeof fmt === "function" ? String(fmt(minor)) : (minor / 100).toFixed(2);
};

/**
 * Bir is icin 10 yer tutucunun degerlerini uretir. Eksik deger bos dizgi olur; bu islev hata atmaz.
 * @param {object} p
 * @param {{ name?: string } | null} [p.customer]
 * @param {{ type?: string, model?: string } | null} [p.device]
 * @param {{ number?: string, estimateMinor?: number | null, readyDate?: string | null } | null} [p.job]
 * @param {string} [p.shop] dukkan adi
 * @param {{ shopPhone?: string, reviewLink?: string } | null} [p.settings]
 * @param {number} [p.totalMinor] satir toplami (vergi dahil)
 * @param {number} [p.balanceMinor] kalan; eksiyse 0 yazilir
 * @param {(minor: number) => string} [p.formatMoney] para bicimleyici (i18n); yoksa yalin ondalik
 * @param {(iso: string) => string} [p.formatDate] tarih bicimleyici; yoksa ISO
 * @param {Record<string, string>} [p.typeNames]
 * @param {string} [p.deviceFallback] "device" / "cihaz"
 * @returns {Record<string, string>} PLACEHOLDERS'in her anahtari icin metin
 */
export function templateValues(p) {
  const { customer, device, job, shop, settings, totalMinor, balanceMinor, formatMoney, formatDate, typeNames, deviceFallback } = p || {};
  const estimate = pickEstimate({ estimateMinor: job?.estimateMinor, linesTotalMinor: totalMinor });
  const ready = typeof job?.readyDate === "string" ? job.readyDate : "";
  return {
    name: asText(customer?.name),
    ticket: asText(job?.number),
    device: deviceName(device, typeNames, deviceFallback),
    estimate: estimate === null ? "" : money(formatMoney, estimate),
    total: money(formatMoney, totalMinor),
    balance: Number.isFinite(balanceMinor) ? money(formatMoney, Math.max(0, balanceMinor)) : "",
    shop: asText(shop),
    shop_phone: asText(settings?.shopPhone),
    ready_date: ready ? (typeof formatDate === "function" ? asText(formatDate(ready)) : ready) : "",
    review_link: asText(settings?.reviewLink),
  };
}
