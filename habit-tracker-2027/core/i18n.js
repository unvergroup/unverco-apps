// Bes dil (en kaynak, es, fr, de, pt). Metinler locales/<kod>.js; tarih, ay ve gun adlari Intl ile secili dile gore.
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
  const dateOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const fmt = (opts) => new Intl.DateTimeFormat(intl, opts);
  const formatDate = (iso, opts = { dateStyle: "medium" }) => fmt(opts).format(typeof iso === "string" ? dateOf(iso) : iso);
  const formatNumber = (n, opts) => new Intl.NumberFormat(intl, opts).format(n);
  /** Yuzde metni: 78 -> "78%" / "78 %" (dile gore); null -> "—". */
  const pct = (p) => (p === null || p === undefined ? "—" : new Intl.NumberFormat(intl, { style: "percent", maximumFractionDigits: 0 }).format(Math.round(p) / 100));
  const monthsLong = Array.from({ length: 12 }, (_, m) => fmt({ month: "long" }).format(new Date(2027, m, 1, 12)));
  const monthsShort = Array.from({ length: 12 }, (_, m) => fmt({ month: "short" }).format(new Date(2027, m, 1, 12)).replace(/\.$/, ""));
  // 0 = Pazar. 2027-01-03 Pazar.
  const weekdayLong = Array.from({ length: 7 }, (_, i) => fmt({ weekday: "long" }).format(new Date(2027, 0, 3 + i, 12)));
  const weekdayShort = Array.from({ length: 7 }, (_, i) => fmt({ weekday: "short" }).format(new Date(2027, 0, 3 + i, 12)).replace(/\.$/, ""));
  const weekdayNarrow = Array.from({ length: 7 }, (_, i) => fmt({ weekday: "narrow" }).format(new Date(2027, 0, 3 + i, 12)));
  const cap = (s) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  return { lang, locale, t, tn, formatDate, formatNumber, pct, monthsLong: monthsLong.map(cap), monthsShort: monthsShort.map(cap), weekdayLong: weekdayLong.map(cap), weekdayShort: weekdayShort.map(cap), weekdayNarrow: weekdayNarrow.map((s) => s.toLocaleUpperCase(locale)), cap };
}

/** Yerel ayara gore varsayilan hafta baslangici (Intl weekInfo varsa o; yoksa ABD/Kanada/Brezilya/Meksika/Japonya Pazar, digerleri Pazartesi). */
export function defaultWeekStart(navLang = globalThis.navigator?.language ?? "en-US") {
  try {
    const loc = new Intl.Locale(navLang);
    const wi = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
    if (wi && Number.isInteger(wi.firstDay)) return wi.firstDay === 7 ? 0 : wi.firstDay === 1 ? 1 : 1;
  } catch { /* eski tarayici */ }
  const region = String(navLang).split(/[-_]/)[1]?.toUpperCase();
  return ["US", "CA", "BR", "MX", "JP", "PH", "IL"].includes(region) ? 0 : 1;
}
