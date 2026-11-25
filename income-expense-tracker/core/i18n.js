// On dilli metin altyapisi (locales/<kod>.js) ve Intl ile sayi / para / tarih bicimi.
// Arayuz dili (lang) ile bicim ayari (locale) AYRI seylerdir: lang metinleri, locale sayi ve tarih bicimini belirler.
//
// Metinler: her dil TEK dosyadir (locales/<kod>.js, `export default { anahtar: "metin" }`); cekirdek, dort modul,
// ornek veri ve belge metinleri hep orada. Yalniz secili dil ve yedek olarak Ingilizce yuklenir (dinamik import()).
// Tek dosya paketinde (scripts/tek-dosya.py) 5 dilin tamami pakete gomulur ve asagidaki TEK import() satiri gomulu tablodan okunur:
// o satirin bicimini (`await import(`../locales/${l}.js`)`) degistirme; paketleyici yalniz bu bicimi taniyor.
// Eksik anahtar Ingilizceye duser; gelistirme sirasinda (localhost) konsola dil basina TEK uyari yazilir.

import { currencyDigits } from "./money.js";
import { decimalFor } from "./number-input.js";
import { FILE_NOTES, openedFromFile } from "./boot-file.js";

// Income & Expense Tracker bes dil konusur: en, es, fr, de, pt. Metinler locales/<kod>.js dosyalarindan yuklenir.
export const LANGS = ["en", "es", "fr", "de", "pt"];
export const LANG_NAMES = { en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português" };
export const RTL_LANGS = [];
export const LANG_DEFAULTS = {
  en: { locale: "en-US", currency: "USD" },
  es: { locale: "es-ES", currency: "EUR" },
  fr: { locale: "fr-FR", currency: "EUR" },
  de: { locale: "de-DE", currency: "EUR" },
  pt: { locale: "pt-BR", currency: "BRL" },
};
export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "MXN", "TRY", "JPY", "CNY", "INR", "BRL"];
// Bicim listesi (sayi / tarih bicimi; arayuz dilinden bagimsiz secilebilir)
export const LOCALES = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "en-CA", label: "English (Canada)" },
  { id: "en-AU", label: "English (Australia)" },
  { id: "es-ES", label: "Español (España)" },
  { id: "es-MX", label: "Español (México)" },
  { id: "fr-FR", label: "Français (France)" },
  { id: "fr-CA", label: "Français (Canada)" },
  { id: "de-DE", label: "Deutsch (Deutschland)" },
  { id: "de-CH", label: "Deutsch (Schweiz)" },
  { id: "pt-BR", label: "Português (Brasil)" },
  { id: "pt-PT", label: "Português (Portugal)" },
];

export const defaultLocaleFor = (lang) => (LANG_DEFAULTS[lang] ?? LANG_DEFAULTS.en).locale;
export const defaultCurrencyFor = (lang) => (LANG_DEFAULTS[lang] ?? LANG_DEFAULTS.en).currency;
export const dirFor = (lang) => (RTL_LANGS.includes(lang) ? "rtl" : "ltr");

// Tarayici dili ("pt-BR", "zh_Hans_CN", "ar-EG") -> desteklenen dil kodu; eslesmezse null.
export function matchLang(navLang) {
  const primary = String(navLang ?? "").toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(primary) ? primary : null;
}

// Intl'e giden yerel ayar: rakamlar hep Latin (Arapca ve Hintce dahil), kullanici baska uzanti vermediyse.
export const intlLocaleFor = (locale) => (/-u-/.test(String(locale)) ? String(locale) : `${locale}-u-nu-latn`);

// ---- Metin yukleme -------------------------------------------------------------
const cache = new Map(); // dil -> { anahtar: metin }
const extraMessages = {}; // modullerin kendi metinleri: { en: {...}, tr: {...} }; locales/ dosyasinda olmayan anahtarlari tamamlar

// Modul metinlerini kaydeder (locales/ dosyasindaki anahtar ASLA ezilmez; yalniz eksik anahtar eklenir).
export function addMessages(extra) {
  for (const [lang, dict] of Object.entries(extra ?? {})) {
    extraMessages[lang] = { ...(extraMessages[lang] ?? {}), ...dict };
    if (cache.has(lang)) cache.set(lang, { ...extraMessages[lang], ...cache.get(lang) });
  }
}
const warned = new Set();

export const isDevHost = () => {
  const host = globalThis.location && globalThis.location.hostname;
  return typeof host === "string" && /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/.test(host);
};

// Dilde olmayan anahtarlar (en.js'e gore). Saf; testler kullanir.
export const missingKeys = (dict, en) => Object.keys(en).filter((k) => !(k in dict) || typeof dict[k] !== "string" || dict[k] === "");

// Eksik anahtar varsa (ve gelistirme ortamindaysa) dil basina TEK uyari yazar; eksik sayisini doner.
export function reportMissing(lang, dict, en, { warn = console.warn, dev = isDevHost() } = {}) {
  if (lang === "en" || warned.has(lang)) return 0;
  const miss = missingKeys(dict, en);
  if (miss.length && dev) {
    warned.add(lang);
    warn(`[i18n] "${lang}": ${miss.length} missing key(s) fall back to English: ${miss.slice(0, 10).join(", ")}${miss.length > 10 ? ", ..." : ""}`);
  }
  return miss.length;
}

// Secili dil + yedek Ingilizce yuklenir (zaten yukluyse tekrar ag/disk istegi olmaz).
export async function loadMessages(lang) {
  if (!LANGS.includes(lang)) lang = "en";
  for (const l of lang === "en" ? ["en"] : ["en", lang]) {
    if (!cache.has(l)) {
      const mod = await import(`../locales/${l}.js`);
      cache.set(l, { ...(extraMessages[l] ?? {}), ...mod.default });
    }
  }
  reportMissing(lang, cache.get(lang), cache.get("en"));
  return cache.get(lang);
}

export const isLoaded = (lang) => cache.has(lang);

// Yuklenmis sozluk: secili dil Ingilizcenin ustune biner (eksik anahtar Ingilizceye duser).
export function getMessages(lang) {
  const en = cache.get("en") ?? {};
  return lang === "en" ? en : { ...en, ...(cache.get(lang) ?? {}) };
}

// ---- i18n nesnesi ----------------------------------------------------------------
const LRI = "⁦"; // soldan saga yalitma (sayi / para / tarih sagdan sola metinde yerinde kalsin)
const PDI = "⁩";

// extra: { en: {...}, <dil>: {...} } (testler ve gecici anahtarlar); messages: { en, <dil> } (yuklenmis sozluk yerine)
export function createI18n({ lang = "en", locale, currency, extra = {}, messages } = {}) {
  if (!LANGS.includes(lang)) lang = "en";
  locale = locale ?? defaultLocaleFor(lang);
  currency = currency ?? defaultCurrencyFor(lang);
  const dir = dirFor(lang);
  const rtl = dir === "rtl";
  const intl = intlLocaleFor(locale);

  const en = { ...(messages?.en ?? cache.get("en") ?? {}), ...(extra.en ?? {}) };
  const own = lang === "en" ? {} : { ...(messages?.[lang] ?? cache.get(lang) ?? {}), ...(extra[lang] ?? {}) };
  const dict = { ...en, ...own }; // eksik anahtar once Ingilizceye, sonra anahtarin kendisine duser

  // Intl (ar) tarih/tutara U+200F (RLM) koyar; LRI icinde bu isaret sirayi bozar ("16/11/2026" -> "162026/11/"): atilir.
  const isolate = (s) => (rtl && s !== "" && /\d/.test(s) && !s.startsWith(LRI) ? `${LRI}${s.replace(/[\u200e\u200f\u061c]/g, "")}${PDI}` : s);

  const t = (key, params = {}) => {
    let s = dict[key];
    if (s === undefined) return key;
    // Dosyadan (file://) acilinca gizlilik satirinin altina depo uyarisi eklenir (yalniz orada dogru; core/boot-file.js).
    if (FILE_NOTES[key] && openedFromFile(globalThis.location) && dict[FILE_NOTES[key]]) s = `${s} ${dict[FILE_NOTES[key]]}`;
    return s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? isolate(String(params[name])) : m));
  };

  // Tekil / cogul: `${key}.one` varsa ve dilin cogul kurali n icin "one" diyorsa o kullanilir; yoksa duz anahtar. {n} otomatik gecer.
  const tn = (key, n, params = {}) => {
    let one = false;
    try { one = dict[`${key}.one`] !== undefined && new Intl.PluralRules(intl).select(n) === "one"; } catch { /* eski tarayici: cogul metin */ }
    return t(one ? `${key}.one` : key, { n, ...params });
  };

  const formatNumber = (n, opts = {}) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return "";
    return isolate(new Intl.NumberFormat(intl, opts).format(n));
  };

  // minor: en kucuk birimin (kurus / cent / yen) TAMSAYISI. Kusurat basamagi para birimine gore (USD 2, JPY 0).
  const formatCurrency = (minor, cur = currency) => {
    if (typeof minor !== "number" || !Number.isFinite(minor)) return "";
    const digits = currencyDigits(cur);
    const n = Math.round(minor) / 10 ** digits;
    const fr = { minimumFractionDigits: digits, maximumFractionDigits: digits };
    try {
      return isolate(new Intl.NumberFormat(intl, { style: "currency", currency: cur, ...fr }).format(n));
    } catch {
      return isolate(`${new Intl.NumberFormat(intl, fr).format(n)} ${cur}`);
    }
  };

  // Yuzde: formatPercent(30) -> tr "%30", en "30%" (n zaten yuzde birimindedir, 0.3 degil 30).
  const formatPercent = (n, opts = {}) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return "";
    return isolate(new Intl.NumberFormat(intl, { style: "percent", maximumFractionDigits: 2, ...opts }).format(n / 100));
  };

  // "YYYY-MM-DD" yerel gun olarak okunur (saat dilimi kaymasi olmaz).
  const formatDate = (value, opts = { dateStyle: "medium" }) => {
    let d;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, day] = value.split("-").map(Number);
      d = new Date(y, m - 1, day);
    } else {
      d = value instanceof Date ? value : new Date(value);
    }
    if (Number.isNaN(d.getTime())) return "";
    return isolate(new Intl.DateTimeFormat(intl, opts).format(d));
  };

  const decimal = decimalFor(locale);
  return {
    lang, locale, currency, dir, decimal,
    digits: currencyDigits(currency), // para biriminin kusurat basamagi
    csv: { delimiter: decimal === "," ? ";" : ",", decimal }, // virgullu ondaligi olan dillerde ";" (Excel)
    t, tn, formatNumber, formatCurrency, formatPercent, formatDate,
  };
}
