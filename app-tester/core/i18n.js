// Bes dil (en kaynak, es, fr, de, pt). Metinler locales/<kod>.js; tarih ve sayilar Intl ile secili dile gore.
// Tek dosya paketinde (scripts/tek-dosya.py) 5 dil gomulur ve asagidaki TEK import() satiri gomulu tablodan okunur:
// o satirin bicimini (`await import(`../locales/${l}.js`)`) degistirme.
export const LANGS = ["en", "es", "fr", "de", "pt"];
export const LANG_NAMES = { en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português" };
const LOCALE = { en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", pt: "pt-BR" };

export function matchLang(navLang) {
  const p = String(navLang ?? "").toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(p) ? p : null;
}

const cache = new Map();
export async function loadMessages(lang) {
  if (!LANGS.includes(lang)) lang = "en";
  for (const l of lang === "en" ? ["en"] : ["en", lang]) {
    if (!cache.has(l)) {
      const mod = await import(`../locales/${l}.js`);
      cache.set(l, mod.default);
    }
  }
  return cache.get(lang);
}
export function getMessages(lang) {
  const en = cache.get("en") ?? {};
  return lang === "en" ? en : { ...en, ...(cache.get(lang) ?? {}) };
}

/** messages: { en, <lang> } verilirse yuklenmis sozluk yerine kullanilir (testler). */
export function createI18n({ lang = "en", messages } = {}) {
  if (!LANGS.includes(lang)) lang = "en";
  const locale = LOCALE[lang];
  const intl = `${locale}-u-nu-latn`;
  const en = messages?.en ?? cache.get("en") ?? {};
  const own = lang === "en" ? {} : messages?.[lang] ?? cache.get(lang) ?? {};
  const dict = { ...en, ...own };
  const t = (key, params = {}) => {
    const s = dict[key];
    if (s === undefined) return key;
    return s.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m));
  };
  const plural = new Intl.PluralRules(intl);
  /** `${key}.one` varsa ve dil kurali n icin "one" diyorsa o; yoksa duz anahtar. {n} otomatik. */
  const tn = (key, n, params = {}) => t(dict[`${key}.one`] !== undefined && plural.select(n) === "one" ? `${key}.one` : key, { n, ...params });
  /** ISO zaman metni -> yerel tarih + saat (kullanicinin saat dilimi). Gecersizse metni oldugu gibi verir. */
  const formatDateTime = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeStyle: "short" }).format(d);
  };
  const formatNumber = (n) => new Intl.NumberFormat(intl).format(n);
  /** Saniye -> "14 min 2 s" benzeri kisa sure (dile bagli olmayan kisaltmalar: m / s). */
  const formatDuration = (sec) => {
    const s = Math.max(0, Math.round(sec));
    return s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s} s`;
  };
  return { lang, locale, t, tn, formatDateTime, formatNumber, formatDuration };
}
