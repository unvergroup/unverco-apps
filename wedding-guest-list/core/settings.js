// Kullanici ayarlari (para birimi, yerel ayar, tema). Kucuk ve senkron: localStorage.
import { CURRENCIES, LOCALES } from "./i18n.js";

export const THEMES = ["system", "light", "dark"];
export const DEFAULT_SETTINGS = Object.freeze({ currency: "USD", locale: "en-US", theme: "system" });

export function sanitizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    currency: CURRENCIES.includes(s.currency) ? s.currency : DEFAULT_SETTINGS.currency,
    locale: LOCALES.some((l) => l.id === s.locale) ? s.locale : DEFAULT_SETTINGS.locale,
    theme: THEMES.includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
  };
}

export function loadSettings(storage, key) {
  try {
    const raw = storage && storage.getItem(key);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeSettings(null);
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
