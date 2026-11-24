// Ayarlar yukleme / kaydetme. Iki katman:
//  1) Arayuz ayarlari (dil, para birimi, bicim, tema): kucuk ve senkron, localStorage.
//  2) Pet bakim ayarlari (petSettings): depodaki tek kayit; yedege girer. Randevu suresi varsayilani (60 dk), calisma saatleri / gunleri,
//     yazdirma kagidi, yedek hatirlatma. Dil sonradan degisince bu ayarlar DEGISMEZ.
// Isletme adi / telefon / adres core/business.js'tedir. Hicbir DOM / ag bagimliligi yoktur (depo disaridan verilir).
import { RECORD_LIMITS } from "../modules/petcare/logic/schema.js";
import { CURRENCIES, LANGS, LOCALES, defaultCurrencyFor, defaultLocaleFor, matchLang } from "./i18n.js";

export const THEMES = ["system", "light", "dark"];

export const detectLang = (navLang) => matchLang(navLang) ?? "en";

// Koleksiyon basina kayit sinirlari: tek kaynak modules/petcare/logic/schema.js RECORD_LIMITS (burada kopya DEGIL) ve tutar ust siniri (en kucuk birim).
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

// ---------- petSettings ----------
export const PET_COLLECTION = "petSettings";
export const PET_ID = "main";
export const PAPERS = Object.freeze(["letter", "a4", "thermal80"]);
export const DURATION_MIN = 5;
export const DURATION_MAX = 480;
export const DEFAULT_DURATION_MIN = 60;
export const WEEK_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]); // 0 = Pazartesi ... 6 = Pazar (core/dates.js weekday ile ayni)

export function defaultPetSettings(lang = "en") {
  return {
    defaultDurationMin: DEFAULT_DURATION_MIN,
    workStart: "09:00",
    workEnd: "18:00",
    workDays: [0, 1, 2, 3, 4],
    paper: lang === "en" ? "letter" : "a4",
    brandMark: false, // "Show UNVERCO mark on printouts": VARSAYILAN KAPALI (alicinin musterisine giden kagitta baska marka olmaz)
    backupEveryDays: 7,
    lastBackupAt: null,
  };
}

const text = (v) => (typeof v === "string" ? v.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "");
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

// Sinir denetimi: { ok, value } | { ok: false, error }. Ayarlar ekrani ve temizleyici AYNI islevleri kullanir.
export function checkDuration(raw) {
  const s = String(raw ?? "").trim();
  if (!/^[0-9]+$/.test(s)) return { ok: false, error: "duration", min: DURATION_MIN, max: DURATION_MAX };
  const n = Number(s);
  return n >= DURATION_MIN && n <= DURATION_MAX ? { ok: true, value: n } : { ok: false, error: "duration", min: DURATION_MIN, max: DURATION_MAX };
}
export function checkTime(raw) {
  const v = text(raw);
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v) ? { ok: true, value: v } : { ok: false, error: "time" };
}
// Calisma saatleri: baslangic < bitis (ayni gun icinde).
export function checkWorkHours(start, end) {
  const a = checkTime(start);
  const b = checkTime(end);
  if (!a.ok || !b.ok) return { ok: false, error: "time" };
  return toMin(a.value) < toMin(b.value) ? { ok: true, value: { workStart: a.value, workEnd: b.value } } : { ok: false, error: "hoursOrder" };
}
// Gun listesi: 0-6 tamsayilar, tekrarsiz, artan; en az bir gun.
export function checkWorkDays(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const ok = arr.length > 0 && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return ok ? { ok: true, value: [...new Set(arr)].sort((x, y) => x - y) } : { ok: false, error: "workDays" };
}
export function checkBackupDays(raw) {
  const s = String(raw ?? "").trim();
  if (!/^[0-9]+$/.test(s)) return { ok: false, error: "days", max: 90 };
  const n = Number(s);
  return n >= 1 && n <= 90 ? { ok: true, value: n } : { ok: false, error: "days", max: 90 };
}

// Depodan gelen (guvenilmeyen) kaydi gecerli petSettings'e cevirir: gecersiz alan varsayilana doner, bilinmeyen alan atilir.
export function sanitizePet(raw, lang = "en") {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = defaultPetSettings(lang);
  const pick = (res, fallback) => (res.ok ? res.value : fallback);
  const hours = checkWorkHours(r.workStart, r.workEnd);
  return {
    defaultDurationMin: pick(checkDuration(r.defaultDurationMin), d.defaultDurationMin),
    workStart: hours.ok ? hours.value.workStart : d.workStart,
    workEnd: hours.ok ? hours.value.workEnd : d.workEnd,
    workDays: pick(checkWorkDays(r.workDays), d.workDays),
    paper: PAPERS.includes(r.paper) ? r.paper : d.paper,
    brandMark: r.brandMark === true, // yalniz acikca true ise acik; eksik / bozuk deger KAPALI demektir
    backupEveryDays: Number.isInteger(r.backupEveryDays) ? pick(checkBackupDays(String(r.backupEveryDays)), d.backupEveryDays) : d.backupEveryDays,
    lastBackupAt: typeof r.lastBackupAt === "string" && !Number.isNaN(Date.parse(r.lastBackupAt)) ? r.lastBackupAt : null,
  };
}

// Depodaki tek kayit. get(): yoksa varsayilani KAYDEDER, sonra doner; save(patch): temizleyip yazar.
export function createPetSettings(store, getLang) {
  const read = async () => (await store.list(PET_COLLECTION)).find((r) => r.id === PET_ID);
  const write = async (value) => {
    await store.transact(PET_COLLECTION, (list) => {
      const t = new Date().toISOString();
      const old = list.find((r) => r.id === PET_ID);
      const rec = { ...value, id: PET_ID, createdAt: old ? old.createdAt : t, updatedAt: t };
      return { list: [...list.filter((r) => r.id !== PET_ID), rec], result: null };
    });
  };
  return {
    async get() {
      const rec = await read();
      if (rec) return sanitizePet(rec, getLang());
      const fresh = defaultPetSettings(getLang());
      await write(fresh);
      return fresh;
    },
    async save(patch) {
      const cur = sanitizePet(await read(), getLang());
      const next = sanitizePet({ ...cur, ...patch }, getLang());
      await write(next);
      return next;
    },
    // "Varsayilanlara don": yalniz sayisal / secim alanlari; son yedek zamani kalir.
    async resetDefaults(lang) {
      const cur = sanitizePet(await read(), getLang());
      const next = { ...defaultPetSettings(lang), lastBackupAt: cur.lastBackupAt };
      await write(next);
      return next;
    },
    // Onbellek tutulmaz (her okuma depodan); geri yukleme / silme sonrasi cagrilan kanca, uyumluluk icin vardir.
    invalidate() {},
  };
}
