// Ayarlar yukleme / kaydetme. Iki katman:
//  1) Arayuz ayarlari (dil, para birimi, bicim, tema): kucuk ve senkron, localStorage.
//  2) Defter ayarlari (ledgerSettings): depodaki tek kayit; yedege girer. Etkin isletme, yazdirma kagidi, yedek hatirlatma,
//     kilometre orani (KULLANICI girer; uygulama onermez) ve mesafe birimi. Isletme profilleri core/business.js'tedir. Hicbir DOM / ag bagimliligi yoktur (depo disaridan verilir).
import { RECORD_LIMITS } from "../modules/ledger/logic/schema.js";
import { CURRENCIES, LANGS, LOCALES, defaultCurrencyFor, defaultLocaleFor, matchLang } from "./i18n.js";

export const THEMES = ["system", "light", "dark"];

export const detectLang = (navLang) => matchLang(navLang) ?? "en";

// Koleksiyon basina kayit sinirlari: tek kaynak modules/ledger/logic/schema.js RECORD_LIMITS (burada kopya DEGIL) ve tutar ust siniri (en kucuk birim).
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

// ---------- ledgerSettings ----------
export const LEDGER_COLLECTION = "ledgerSettings";
export const LEDGER_ID = "main";
export const PAPERS = Object.freeze(["letter", "a4"]);
export const UNITS = Object.freeze(["mi", "km"]);

export function defaultLedgerSettings(lang = "en") {
  return {
    activeBusinessId: "",
    paper: lang === "en" ? "letter" : "a4",
    brandMark: false, // "Show UNVERCO mark on printouts": VARSAYILAN KAPALI
    backupEveryDays: 7,
    lastBackupAt: null,
    rateMilli: null, // kilometre orani (binde bir para birimi); null = oran girilmedi, tutar gosterilmez
    distanceUnit: "mi",
    seeded: false, // hazir kategoriler bir kez yazildi mi
  };
}

export function checkBackupDays(raw) {
  const s = String(raw ?? "").trim();
  if (!/^[0-9]+$/.test(s)) return { ok: false, error: "days", max: 90 };
  const n = Number(s);
  return n >= 1 && n <= 90 ? { ok: true, value: n } : { ok: false, error: "days", max: 90 };
}

// Depodan gelen (guvenilmeyen) kaydi gecerli ayara cevirir: gecersiz alan varsayilana doner, bilinmeyen alan atilir.
export function sanitizeLedger(raw, lang = "en") {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = defaultLedgerSettings(lang);
  return {
    activeBusinessId: typeof r.activeBusinessId === "string" ? r.activeBusinessId : "",
    paper: PAPERS.includes(r.paper) ? r.paper : d.paper,
    brandMark: r.brandMark === true,
    backupEveryDays: Number.isInteger(r.backupEveryDays) && r.backupEveryDays >= 1 && r.backupEveryDays <= 90 ? r.backupEveryDays : d.backupEveryDays,
    lastBackupAt: typeof r.lastBackupAt === "string" && !Number.isNaN(Date.parse(r.lastBackupAt)) ? r.lastBackupAt : null,
    rateMilli: Number.isSafeInteger(r.rateMilli) && r.rateMilli > 0 && r.rateMilli <= 100000 ? r.rateMilli : null,
    distanceUnit: UNITS.includes(r.distanceUnit) ? r.distanceUnit : d.distanceUnit,
    seeded: r.seeded === true,
  };
}

// Depodaki tek kayit. get(): yoksa varsayilani KAYDEDER, sonra doner; save(patch): temizleyip yazar.
export function createLedgerSettings(store, getLang) {
  const read = async () => (await store.list(LEDGER_COLLECTION)).find((r) => r.id === LEDGER_ID);
  const write = async (value) => {
    await store.transact(LEDGER_COLLECTION, (list) => {
      const t = new Date().toISOString();
      const old = list.find((r) => r.id === LEDGER_ID);
      const rec = { ...value, id: LEDGER_ID, createdAt: old ? old.createdAt : t, updatedAt: t };
      return { list: [...list.filter((r) => r.id !== LEDGER_ID), rec], result: null };
    });
  };
  return {
    async get() {
      const rec = await read();
      if (rec) return sanitizeLedger(rec, getLang());
      const fresh = defaultLedgerSettings(getLang());
      await write(fresh);
      return fresh;
    },
    async save(patch) {
      const cur = sanitizeLedger(await read(), getLang());
      const next = sanitizeLedger({ ...cur, ...patch }, getLang());
      await write(next);
      return next;
    },
    invalidate() {},
  };
}
