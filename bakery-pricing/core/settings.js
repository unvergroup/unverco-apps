// Ayarlar yukleme / kaydetme. Iki katman:
//  1) Arayuz ayarlari (dil, para birimi, bicim, tema): kucuk ve senkron, localStorage.
//  2) Isletme tercihleri (bakerySettings): depodaki tek kayit; yedege girer. Saat ucreti, genel gider yuzdesi, fiyat hedefi (kar payi / marj),
//     kapora yuzdesi, teklif gecerlilik suresi, belge notu, yazdirma kagidi, yedek hatirlatma. Dil sonradan degisince bu ayarlar DEGISMEZ.
// Isletme adi / telefon / adres core/business.js'tedir. Hicbir DOM / ag bagimliligi yoktur (depo disaridan verilir).
import { RECORD_LIMITS } from "../modules/bakery/logic/schema.js";
import { CURRENCIES, LANGS, LOCALES, defaultCurrencyFor, defaultLocaleFor, matchLang } from "./i18n.js";

export const THEMES = ["system", "light", "dark"];

export const detectLang = (navLang) => matchLang(navLang) ?? "en";

// Koleksiyon basina kayit sinirlari: tek kaynak modules/bakery/logic/schema.js RECORD_LIMITS (burada kopya DEGIL) ve tutar ust siniri (en kucuk birim).
export const LIMITS = Object.freeze({ ...RECORD_LIMITS, name: 120 });
export const MAX_MINOR = 10 ** 11;

export function defaultSettings(lang = "en") {
  return { lang, currency: defaultCurrencyFor(lang), locale: defaultLocaleFor(lang), theme: "system" };
}

export function sanitizeSettings(raw, navLang) {
  const s = raw && typeof raw === "object" ? raw : {};
  const lang = LANGS.includes(s.lang) ? s.lang : detectLang(navLang);
  const d = defaultSettings(lang);
  return {
    lang,
    currency: CURRENCIES.includes(s.currency) ? s.currency : d.currency,
    locale: LOCALES.some((l) => l.id === s.locale) ? s.locale : d.locale,
    theme: THEMES.includes(s.theme) ? s.theme : d.theme,
  };
}

// Dil degisince YALNIZ dil (ve elle secilmemisse bicim) degisir. PARA BIRIMI ASLA degismez.
export function applyLanguage(settings, lang) {
  if (!LANGS.includes(lang) || lang === settings.lang) return { ...settings };
  const old = defaultSettings(settings.lang);
  const next = defaultSettings(lang);
  return { ...settings, lang, locale: settings.locale === old.locale ? next.locale : settings.locale };
}

export function loadSettings(storage, key, navLang = globalThis.navigator && globalThis.navigator.language) {
  try {
    const raw = storage && storage.getItem(key);
    return sanitizeSettings(raw ? JSON.parse(raw) : null, navLang);
  } catch {
    return sanitizeSettings(null, navLang);
  }
}

export function saveSettings(storage, key, settings) {
  const clean = sanitizeSettings(settings);
  try {
    if (storage) storage.setItem(key, JSON.stringify(clean));
  } catch {
    /* yazilamadiysa ayar oturumla sinirli kalir */
  }
  return clean;
}

// ---------- bakerySettings (isletme tercihleri) ----------
export const PREFS_COLLECTION = "bakerySettings";
export const PREFS_ID = "main";
export const PAPERS = Object.freeze(["letter", "a4", "thermal80"]);
export const PRICING_MODES = Object.freeze(["margin", "markup"]);
// Sinirlar (ayarlar ekrani ve temizleyici AYNI sinirlari kullanir).
export const PREF_LIMITS = Object.freeze({ hourlyMax: 100_000_00, overheadMax: 100, markupMax: 1000, marginMax: 95, depositMax: 100, validMin: 1, validMax: 90, docNote: 300 });
export function defaultPrefs(lang = "en") {
  return {
    hourlyRateMinor: 1500, // saat ucreti (en kucuk birim): 15,00
    overheadPct: 10, // genel gider (elektrik, gaz, yipranma): maliyetin yuzdesi
    pricingMode: "margin", // "margin": fiyatin yuzde kaci kar; "markup": maliyetin ustune yuzde
    targetPct: 40,
    depositPct: 50, // yeni sipariste onerilen kapora
    quoteValidDays: 14,
    docNote: "",
    paper: lang === "en" ? "letter" : "a4",
    brandMark: false, // "Show UNVERCO mark on printouts": VARSAYILAN KAPALI (alicinin musterisine giden kagitta baska marka olmaz)
    backupEveryDays: 7,
    lastBackupAt: null,
  };
}
const text = (v) => (typeof v === "string" ? v.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "");
const numIn = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export function checkBackupDays(raw) {
  const s = String(raw ?? "").trim();
  if (!/^[0-9]+$/.test(s)) return { ok: false, error: "days", max: 90 };
  const n = Number(s);
  return n >= 1 && n <= 90 ? { ok: true, value: n } : { ok: false, error: "days", max: 90 };
}
/** Fiyat hedefinin ust siniri moda gore: marj %95'i asamaz (fiyat sonsuza gider), kar payi %1000'e kadar. */
export const targetMax = (mode) => (mode === "markup" ? PREF_LIMITS.markupMax : PREF_LIMITS.marginMax);
// Depodan gelen (guvenilmeyen) kaydi gecerli tercihe cevirir: gecersiz alan varsayilana doner, bilinmeyen alan atilir.
export function sanitizePrefs(raw, lang = "en") {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = defaultPrefs(lang);
  const mode = PRICING_MODES.includes(r.pricingMode) ? r.pricingMode : d.pricingMode;
  return {
    hourlyRateMinor: Number.isSafeInteger(r.hourlyRateMinor) && r.hourlyRateMinor >= 0 && r.hourlyRateMinor <= PREF_LIMITS.hourlyMax ? r.hourlyRateMinor : d.hourlyRateMinor,
    overheadPct: numIn(r.overheadPct, 0, PREF_LIMITS.overheadMax) ? r.overheadPct : d.overheadPct,
    pricingMode: mode,
    targetPct: numIn(r.targetPct, 0, targetMax(mode)) ? r.targetPct : Math.min(d.targetPct, targetMax(mode)),
    depositPct: numIn(r.depositPct, 0, PREF_LIMITS.depositMax) ? r.depositPct : d.depositPct,
    quoteValidDays: Number.isInteger(r.quoteValidDays) && r.quoteValidDays >= PREF_LIMITS.validMin && r.quoteValidDays <= PREF_LIMITS.validMax ? r.quoteValidDays : d.quoteValidDays,
    docNote: [...text(r.docNote)].slice(0, PREF_LIMITS.docNote).join(""),
    paper: PAPERS.includes(r.paper) ? r.paper : d.paper,
    brandMark: r.brandMark === true, // yalniz acikca true ise acik; eksik / bozuk deger KAPALI demektir
    backupEveryDays: Number.isInteger(r.backupEveryDays) ? (checkBackupDays(String(r.backupEveryDays)).ok ? r.backupEveryDays : d.backupEveryDays) : d.backupEveryDays,
    lastBackupAt: typeof r.lastBackupAt === "string" && !Number.isNaN(Date.parse(r.lastBackupAt)) ? r.lastBackupAt : null,
  };
}
// Depodaki tek kayit. get(): yoksa varsayilani KAYDEDER, sonra doner; save(patch): temizleyip yazar.
export function createPrefs(store, getLang) {
  const read = async () => (await store.list(PREFS_COLLECTION)).find((r) => r.id === PREFS_ID);
  const write = async (value) => {
    await store.transact(PREFS_COLLECTION, (list) => {
      const t = new Date().toISOString();
      const old = list.find((r) => r.id === PREFS_ID);
      const rec = { ...value, id: PREFS_ID, createdAt: old ? old.createdAt : t, updatedAt: t };
      return { list: [...list.filter((r) => r.id !== PREFS_ID), rec], result: null };
    });
  };
  return {
    async get() {
      const rec = await read();
      if (rec) return sanitizePrefs(rec, getLang());
      const fresh = defaultPrefs(getLang());
      await write(fresh);
      return fresh;
    },
    async save(patch) {
      const cur = sanitizePrefs(await read(), getLang());
      const next = sanitizePrefs({ ...cur, ...patch }, getLang());
      await write(next);
      return next;
    },
    // "Varsayilanlara don": son yedek zamani ve belge notu kalir.
    async resetDefaults(lang) {
      const cur = sanitizePrefs(await read(), getLang());
      const next = { ...defaultPrefs(lang), lastBackupAt: cur.lastBackupAt, docNote: cur.docNote };
      await write(next);
      return next;
    },
    invalidate() {},
  };
}
