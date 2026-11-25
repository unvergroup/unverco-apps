// Ayarlar yukleme / kaydetme. Iki katman:
//  1) Arayuz ayarlari (dil, para birimi, bicim, tema): kucuk ve senkron, localStorage.
//  2) Okul yili ayarlari (hsPrefs): depodaki tek kayit; yedege girer. Okul yili adi / baslangic / bitis, kullanicinin KENDI hedefleri
//     (gun, saat, temel ders saati; 0 = hedef yok; uygulama eyalet kurali onermez), okul gunleri, varsayilan ders suresi, otomatik yoklama,
//     yazdirma kagidi, marka satiri, yedek hatirlatma. Dil sonradan degisince bu ayarlar DEGISMEZ.
// Isletme adi / telefon / adres core/business.js'tedir. Hicbir DOM / ag bagimliligi yoktur (depo disaridan verilir).
import { RECORD_LIMITS } from "../modules/homeschool/logic/schema.js";
import { CURRENCIES, LANGS, LOCALES, defaultCurrencyFor, defaultLocaleFor, matchLang } from "./i18n.js";

export const THEMES = ["system", "light", "dark"];

export const detectLang = (navLang) => matchLang(navLang) ?? "en";

// Koleksiyon basina kayit sinirlari: tek kaynak modules/homeschool/logic/schema.js RECORD_LIMITS (burada kopya DEGIL) ve tutar ust siniri (en kucuk birim).
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

// ---------- hsPrefs (okul yili) ----------
export const PREFS_COLLECTION = "hsPrefs";
export const PREFS_ID = "main";
export const PAPERS = Object.freeze(["letter", "a4"]);
export const WEEK_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]); // 0 = Pazartesi ... 6 = Pazar (core/dates.js weekday ile ayni)
export const TARGET_MAX = Object.freeze({ days: 366, hours: 3000 });
export const MINUTES_MIN = 5;
export const MINUTES_MAX = 480;

const text = (v, max = 40) => (typeof v === "string" ? v.normalize("NFC").replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : "");
const isoOk = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// Varsayilan okul yili: Temmuz-Aralik arasi acilista bu yilin 1 Agustos'u - gelecek yilin 30 Haziran'i; Ocak-Haziran'da bir onceki yil.
export function defaultYear(now = new Date()) {
  const y = now.getFullYear();
  const start = now.getMonth() >= 6 ? y : y - 1;
  return { yearName: `${start}–${start + 1}`, yearStart: `${start}-08-01`, yearEnd: `${start + 1}-06-30` };
}

export function defaultPrefs(lang = "en", now = new Date()) {
  return {
    ...defaultYear(now),
    targetDays: 0, // 0 = hedef yok. Hedefi kullanici girer; uygulama eyalet kurali ONERMEZ.
    targetHours: 0,
    targetCoreHours: 0,
    schoolDays: [0, 1, 2, 3, 4],
    defaultMinutes: 30,
    autoAttendance: true, // ders/etkinlik kaydi olan gun, acik yoklama kaydi yoksa okul gunu sayilir
    paper: lang === "en" ? "letter" : "a4",
    brandMark: false, // "Show UNVERCO mark on printouts": VARSAYILAN KAPALI
    backupEveryDays: 7,
    lastBackupAt: null,
  };
}

// Sinir denetimleri: { ok, value } | { ok: false, error }. Ayarlar ekrani ve temizleyici AYNI islevleri kullanir.
export function checkInt(raw, lo, hi, error = "range") {
  const s = String(raw ?? "").trim();
  if (!/^[0-9]+$/.test(s)) return { ok: false, error, min: lo, max: hi };
  const n = Number(s);
  return n >= lo && n <= hi ? { ok: true, value: n } : { ok: false, error, min: lo, max: hi };
}
export const checkMinutes = (raw) => checkInt(raw, MINUTES_MIN, MINUTES_MAX, "minutes");
export const checkBackupDays = (raw) => checkInt(raw, 1, 90, "days");
export function checkYear(start, end) {
  if (!isoOk(start) || !isoOk(end)) return { ok: false, error: "date" };
  if (start >= end) return { ok: false, error: "yearOrder" };
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  return span <= 400 ? { ok: true, value: { yearStart: start, yearEnd: end } } : { ok: false, error: "yearLong" };
}
export function checkWorkDays(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const ok = arr.length > 0 && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return ok ? { ok: true, value: [...new Set(arr)].sort((x, y) => x - y) } : { ok: false, error: "workDays" };
}

// Depodan gelen (guvenilmeyen) kaydi gecerli ayara cevirir: gecersiz alan varsayilana doner, bilinmeyen alan atilir.
export function sanitizePrefs(raw, lang = "en", now = new Date()) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = defaultPrefs(lang, now);
  const pick = (res, fallback) => (res.ok ? res.value : fallback);
  const intIn = (v, hi, fb) => (Number.isInteger(v) && v >= 0 && v <= hi ? v : fb);
  const year = checkYear(r.yearStart, r.yearEnd);
  return {
    yearName: text(r.yearName, 40) || d.yearName,
    yearStart: year.ok ? year.value.yearStart : d.yearStart,
    yearEnd: year.ok ? year.value.yearEnd : d.yearEnd,
    targetDays: intIn(r.targetDays, TARGET_MAX.days, 0),
    targetHours: intIn(r.targetHours, TARGET_MAX.hours, 0),
    targetCoreHours: intIn(r.targetCoreHours, TARGET_MAX.hours, 0),
    schoolDays: pick(checkWorkDays(r.schoolDays), d.schoolDays),
    defaultMinutes: Number.isInteger(r.defaultMinutes) ? pick(checkMinutes(String(r.defaultMinutes)), d.defaultMinutes) : d.defaultMinutes,
    autoAttendance: r.autoAttendance !== false,
    paper: PAPERS.includes(r.paper) ? r.paper : d.paper,
    brandMark: r.brandMark === true,
    backupEveryDays: Number.isInteger(r.backupEveryDays) ? pick(checkBackupDays(String(r.backupEveryDays)), d.backupEveryDays) : d.backupEveryDays,
    lastBackupAt: typeof r.lastBackupAt === "string" && !Number.isNaN(Date.parse(r.lastBackupAt)) ? r.lastBackupAt : null,
  };
}

// Depodaki tek kayit. get(): yoksa varsayilani KAYDEDER, sonra doner; save(patch): temizleyip yazar.
export function createPrefs(store, getLang) {
  const read = async () => (await store.list(PREFS_COLLECTION)).find((r) => r.id === PREFS_ID);
  const write = async (value) => {
    await store.transact(PREFS_COLLECTION, (rows) => {
      const t = new Date().toISOString();
      const old = rows.find((r) => r.id === PREFS_ID);
      const rec = { ...value, id: PREFS_ID, createdAt: old ? old.createdAt : t, updatedAt: t };
      return { list: [...rows.filter((r) => r.id !== PREFS_ID), rec], result: null };
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
    invalidate() {},
  };
}
