// Metin sozlugu (varsayilan: en) ve Intl ile sayi / para / tarih bicimi.
// Para birimi ve yerel ayar kullanici ayarindan gelir.

import es from "../locales/es.js";
import fr from "../locales/fr.js";
import de from "../locales/de.js";
import tr from "../locales/tr.js";

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "TRY", "JPY"];
export const LOCALES = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "de-DE", label: "Deutsch" },
  { id: "fr-FR", label: "Français" },
  { id: "es-ES", label: "Español" },
  { id: "tr-TR", label: "Türkçe" },
];

export const MESSAGES = {
  en: {
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.edit": "Edit",
    "common.delete": "Delete",
    "common.close": "Close",
    "nav.label": "Main",
    "nav.settings": "Settings",
    "storage.error": "Your browser blocked local storage, so the app cannot save data.",
    "storage.volatile": "This browser is not saving your list, so it will be lost when you close this page. Download a backup before you leave.",
    "storage.corrupt": "Some saved data could not be read. It was set aside and the app started without it.",
    "error.generic": "Something went wrong and the action did not finish. Please try again.",
    "error.not_found": "That item no longer exists. It may have been changed in another tab.",
    "error.quota": "There is not enough storage space on this device. Free some space and try again.",
    "error.load": "This screen could not be loaded. Please try again.",
    "demo.badge": "Demo: {count} of {limit} used",
    "demo.limit":
      "The demo allows up to {limit} entries here. You can still export your data. The full version has no limit.",
    "pwa.install": "Add to home screen",
    "pwa.installIos": "On iPhone or iPad: tap the Share button, then “Add to Home Screen”.",
    "pwa.updateAvailable": "A new version is available.",
    "pwa.refresh": "Refresh",
    "pwa.dismiss": "Dismiss",
    "settings.title": "Settings",
    "settings.currency": "Currency",
    "settings.locale": "Language and format",
    "settings.theme": "Theme",
    "settings.theme.system": "Match my device",
    "settings.theme.light": "Light",
    "settings.theme.dark": "Dark",
    "settings.data": "Your data",
    "settings.backup": "Back up data",
    "settings.restore": "Restore from backup",
    "settings.deleteAll": "Delete all data",
    "settings.deleteTitle": "Delete all data?",
    "settings.deleteText": "Everything saved in this app on this device will be erased. This cannot be undone.",
    "settings.deleted": "All data deleted.",
    "settings.version": "Version {version}",
    "settings.edition.demo": "Demo edition",
    "settings.edition.full": "Full edition",
    "settings.privacy": "Your guest list never leaves your device.",
    "backup.done": "Backup downloaded.",
    "backup.restoreTitle": "Restore this backup?",
    "backup.restoreText": "This replaces all data currently in the app.",
    "backup.autoBackup": "Download a backup of my current data first",
    "backup.restoreButton": "Restore",
    "backup.restored": "Backup restored ({records} records).",
    "backup.error.invalid_file": "This file is not a valid backup.",
    "backup.error.wrong_app": "This backup belongs to a different app.",
    "backup.error.newer_schema": "This backup was made by a newer version of the app. Update the app and try again.",
    "backup.error.checksum": "This backup file is damaged and cannot be restored.",
    "backup.error.too_large": "This backup file is too large (over 10 MB), so it was not restored. Nothing was changed.",
    "backup.error.too_many": "This backup has too many records (over 5,000 in one list), so it was not restored. Nothing was changed.",
    "backup.error.demo_limit": "This backup holds more guests or tables than the demo allows, so it was not restored. Nothing was changed.",
    "backup.error.unknown": "The backup could not be restored.",
  },
};

// Full dictionaries (shell + guests module) for the other four interface languages. English stays the base: a key missing in a
// translation falls back to English, never to the raw key. en-US and en-GB both use English text.
export const TRANSLATIONS = Object.freeze({ es, fr, de, tr });
export const langOf = (locale) => String(locale || "en").slice(0, 2).toLowerCase();

export function createI18n({ locale = "en-US", currency = "USD", extra = {} } = {}) {
  const dict = { ...MESSAGES.en, ...(extra.en ?? {}), ...(TRANSLATIONS[langOf(locale)] ?? {}) };

  const t = (key, params = {}) => {
    const s = dict[key];
    if (s === undefined) return key;
    return s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };

  const formatNumber = (n, opts = {}) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return "";
    return new Intl.NumberFormat(locale, opts).format(n);
  };

  // minor: en kucuk birimin (kurus / cent) TAMSAYISI; her para biriminde 2 ondalik gosterilir
  // (ayni sayi, saklanan 1/100 birimle birebir; satirlar ve toplam hep tutar).
  const formatCurrency = (minor, cur = currency) => {
    if (typeof minor !== "number" || !Number.isFinite(minor)) return "";
    const n = Math.round(minor) / 100;
    const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: cur, ...two }).format(n);
    } catch {
      return `${formatNumber(n, two)} ${cur}`;
    }
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
    return new Intl.DateTimeFormat(locale, opts).format(d);
  };

  return { locale, currency, t, formatNumber, formatCurrency, formatDate };
}
