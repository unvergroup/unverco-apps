// Ayarlar yukleme / kaydetme. Iki katman:
//  1) Arayuz ayarlari (dil, para birimi, bicim, tema): kucuk ve senkron, localStorage (Workbench ile ayni).
//  2) Dukkan ayarlari (ctSettings, spec 3.8): depodaki tek kayit; yedege girer. Ilk kurulum on ayari arayuz diline gore (presetLang);
//     dil sonradan degisince bu ayarlar DEGISMEZ (yalniz "Reset settings to defaults" onayla sayisal / secim alanlarini doner).
import { CURRENCIES, LANGS, LOCALES, defaultCurrencyFor, defaultLocaleFor, matchLang } from "./i18n.js";
import { validatePhone } from "../modules/repairs/logic/phone.js";

export const THEMES = ["system", "light", "dark"];

export const detectLang = (navLang) => matchLang(navLang) ?? "en";

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

// ---------- ctSettings (spec 3.8) ----------
export const CT_COLLECTION = "ctSettings";
export const CT_ID = "main";
export const TEMPLATE_KEYS = Object.freeze(["received", "approval", "part", "ready", "reminder", "reminder_later", "review"]);
export const CHANNELS_ORDER = Object.freeze(["sms", "call", "whatsapp", "email"]);
export const PAPERS = Object.freeze(["letter", "a4", "thermal80"]);
export const CT_LIMITS = Object.freeze({ termsIntake: [1200, 30], termsStorage: [600, 15], termsWarranty: [1200, 30], template: 500, reviewLink: 300, warrantyDays: 3650 });

export function defaultCt(lang = "en") {
  const tr = lang === "tr";
  return {
    presetLang: tr ? "tr" : "en",
    shopPhone: "",
    ticketPrefix: "R",
    defaultWarrantyDays: tr ? 180 : 90,
    reminderDays: [3, 7, 14, 30],
    channelOrder: tr ? ["whatsapp", "call", "sms", "email"] : ["sms", "call", "whatsapp", "email"],
    countryCode: "",
    reviewLink: "",
    templates: Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, null])),
    termsIntake: "", termsStorage: "", termsWarranty: "",
    printPasscodeLine: true,
    paper: tr ? "a4" : "letter",
    backupEveryDays: 7,
    lastBackupAt: null,
  };
}

const cp = (s) => [...s].length;
const cutCp = (s, n) => [...s].slice(0, n).join("");
const text = (v) => (typeof v === "string" ? v.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "");

// Sinir denetimi: { ok, value } | { ok: false, error }. Ayarlar ekrani ve temizleyici AYNI islevleri kullanir.
export function checkTerms(raw, key) {
  const [maxChars, maxLines] = CT_LIMITS[key];
  const v = text(raw);
  if (cp(v) > maxChars || (v ? v.split("\n").length : 0) > maxLines) return { ok: false, error: "termsLong", max: maxChars, lines: maxLines };
  return { ok: true, value: v };
}
export function checkPrefix(raw) {
  const v = text(raw).toUpperCase();
  return /^[A-Z]{1,6}$/.test(v) ? { ok: true, value: v } : { ok: false, error: "prefix" };
}
export function checkCountryCode(raw) {
  const v = text(raw);
  return v === "" || /^[1-9][0-9]{0,2}$/.test(v) ? { ok: true, value: v } : { ok: false, error: "countryCode" };
}
export function checkReviewLink(raw) {
  const v = text(raw);
  if (v === "") return { ok: true, value: "" };
  if (cp(v) > CT_LIMITS.reviewLink) return { ok: false, error: "reviewLink" };
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.includes(".") ? { ok: true, value: v } : { ok: false, error: "reviewLink" };
  } catch {
    return { ok: false, error: "reviewLink" };
  }
}
export function checkShopPhone(raw) {
  const v = text(raw);
  if (v === "") return { ok: true, value: "" };
  return validatePhone(v).ok ? { ok: true, value: v } : { ok: false, error: "phone" };
}
export function checkDays(raw, { min = 0, max = CT_LIMITS.warrantyDays } = {}) {
  const s = String(raw ?? "").trim();
  if (!/^[0-9]+$/.test(s)) return { ok: false, error: "days", max };
  const n = Number(s);
  return n >= min && n <= max ? { ok: true, value: n } : { ok: false, error: "days", max };
}
// "3, 7, 14, 30" -> [3, 7, 14, 30] (en cok 4, 1-365, artan, tekrarsiz)
export function checkReminderDays(raw) {
  const parts = String(raw ?? "").split(/[\s,;]+/).filter(Boolean);
  const nums = parts.map((p) => (/^[0-9]+$/.test(p) ? Number(p) : NaN));
  const ok = nums.length <= 4 && nums.every((n) => n >= 1 && n <= 365) && nums.every((n, i) => i === 0 || n > nums[i - 1]);
  return ok ? { ok: true, value: nums } : { ok: false, error: "reminderDays" };
}

// Depodan gelen (guvenilmeyen) kaydi gecerli ctSettings'e cevirir: gecersiz alan varsayilana doner, bilinmeyen alan atilir.
export function sanitizeCt(raw, lang = "en") {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const preset = r.presetLang === "tr" || r.presetLang === "en" ? r.presetLang : lang === "tr" ? "tr" : "en";
  const d = defaultCt(preset);
  const pick = (res, fallback) => (res.ok ? res.value : fallback);
  const tpl = r.templates && typeof r.templates === "object" ? r.templates : {};
  const order = Array.isArray(r.channelOrder) ? r.channelOrder : [];
  const okOrder = order.length === 4 && CHANNELS_ORDER.every((c) => order.includes(c));
  const days = Number.isInteger(r.defaultWarrantyDays) && r.defaultWarrantyDays >= 0 && r.defaultWarrantyDays <= CT_LIMITS.warrantyDays ? r.defaultWarrantyDays : r.defaultWarrantyDays === null ? null : d.defaultWarrantyDays;
  return {
    presetLang: preset,
    shopPhone: pick(checkShopPhone(r.shopPhone), d.shopPhone),
    ticketPrefix: pick(checkPrefix(r.ticketPrefix ?? d.ticketPrefix), d.ticketPrefix),
    defaultWarrantyDays: days,
    reminderDays: Array.isArray(r.reminderDays) ? pick(checkReminderDays(r.reminderDays.join(",")), d.reminderDays) : d.reminderDays,
    channelOrder: okOrder ? [...order] : d.channelOrder,
    countryCode: pick(checkCountryCode(r.countryCode), d.countryCode),
    reviewLink: pick(checkReviewLink(r.reviewLink), d.reviewLink),
    templates: Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, typeof tpl[k] === "string" && cp(tpl[k]) <= CT_LIMITS.template && text(tpl[k]) !== "" ? text(tpl[k]) : null])),
    termsIntake: pick(checkTerms(r.termsIntake, "termsIntake"), ""),
    termsStorage: pick(checkTerms(r.termsStorage, "termsStorage"), ""),
    termsWarranty: pick(checkTerms(r.termsWarranty, "termsWarranty"), ""),
    printPasscodeLine: r.printPasscodeLine === false ? false : true,
    paper: PAPERS.includes(r.paper) ? r.paper : d.paper,
    backupEveryDays: Number.isInteger(r.backupEveryDays) && r.backupEveryDays >= 1 && r.backupEveryDays <= 90 ? r.backupEveryDays : d.backupEveryDays,
    lastBackupAt: typeof r.lastBackupAt === "string" && !Number.isNaN(Date.parse(r.lastBackupAt)) ? r.lastBackupAt : null,
  };
}

// Depodaki tek kayit. get(): yoksa on ayari (arayuz diline gore) KAYDEDER, sonra doner; save(patch): temizleyip yazar.
export function createCtSettings(store, getLang) {
  const read = async () => (await store.list(CT_COLLECTION)).find((r) => r.id === CT_ID);
  const write = async (value) => {
    await store.transact(CT_COLLECTION, (list) => {
      const t = new Date().toISOString();
      const old = list.find((r) => r.id === CT_ID);
      const rec = { ...value, id: CT_ID, createdAt: old ? old.createdAt : t, updatedAt: t };
      return { list: [...list.filter((r) => r.id !== CT_ID), rec], result: null };
    });
  };
  return {
    async get() {
      const rec = await read();
      if (rec) return sanitizeCt(rec, getLang());
      const fresh = defaultCt(getLang());
      await write(fresh);
      return fresh;
    },
    async save(patch) {
      const cur = sanitizeCt(await read(), getLang());
      const next = sanitizeCt({ ...cur, ...patch }, getLang());
      await write(next);
      return next;
    },
    // "Reset settings to defaults for {language}": yalniz sayisal / secim alanlari; sartlar, taslaklar, dukkan bilgisi kalir.
    async resetNumeric(lang) {
      const cur = sanitizeCt(await read(), getLang());
      const d = defaultCt(lang);
      const next = { ...cur, defaultWarrantyDays: d.defaultWarrantyDays, reminderDays: d.reminderDays, channelOrder: d.channelOrder, paper: d.paper, backupEveryDays: d.backupEveryDays };
      await write(next);
      return next;
    },
  };
}
