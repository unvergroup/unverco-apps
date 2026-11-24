// Gun sayaclari: hazir gunu, hatirlatma vurgusu ("Needs an update"), garanti bitisi (spec 7, 3.3, KA-66/67/69/83/84).
// Saf islevler. Zaman parametreyle gelir (Date, epoch ms ya da "YYYY-MM-DD"); gun siniri YEREL takvim gunune gore.
// Tarih hesabi core/dates.js uzerindendir (UTC gun, yaz saati kaymaz).

import { addDays, diffDays, isIsoDate, todayIso } from "../../../core/dates.js";

/** Onerilen taslak: hazir gunu bu sayiya ulasinca "Reminder (later)". */
export const UNCLAIMED_LATER_DAYS = 14;

const MAX_WARRANTY_DAYS = 3650;
const isDay = (v) => typeof v === "string" && isIsoDate(v);

/**
 * Zaman girdisini yerel takvim gunune ("YYYY-MM-DD") cevirir.
 * @param {Date | number | string | null | undefined} t Date / epoch ms / gecerli ISO gun
 * @returns {string | null} gecersizse null
 */
export function dayOf(t) {
  if (typeof t === "string") return isDay(t) ? t : null;
  const d = t instanceof Date ? t : typeof t === "number" ? new Date(t) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return todayIso(d);
}

/**
 * Hazir oldugu gunden bu yana gecen gun (bugun 0, dun 1; gelecek tarih 0).
 * @param {string | null | undefined} readyDate "YYYY-MM-DD"
 * @param {Date | number | string} now
 * @returns {number | null} tarihlerden biri gecersizse null
 */
export function daysReady(readyDate, now) {
  const today = dayOf(now);
  if (!isDay(readyDate) || !today) return null;
  return Math.max(0, diffDays(readyDate, today));
}

// 1-365 arasi tam sayilar, artan, tekrarsiz.
const cleanReminderDays = (list) =>
  Array.isArray(list)
    ? [...new Set(list.filter((n) => Number.isInteger(n) && n >= 1 && n <= 365))].sort((a, b) => a - b)
    : [];

/**
 * Hatirlatma vurgusu. d* = daysReady'nin gectigi en buyuk hatirlatma gunu; readyDate + d* gunu ve sonrasinda
 * (bugunden ileri olmayan) haber kaydi yoksa vurgu doner. Hicbir sey gonderilmez; ayri bir esik yoktur.
 * @param {number | null} days daysReady sonucu
 * @param {Array<string | null | undefined>} contactDates haber kaydi tarihleri ("YYYY-MM-DD"); gecersizler yok sayilir
 * @param {string | null} readyDate
 * @param {number[]} reminderDays ornek [3, 7, 14, 30]
 * @returns {{ day: number, label: string } | null} label "3+" gibi; sayim yoksa null
 */
export function unclaimedFlag(days, contactDates, readyDate, reminderDays) {
  if (!Number.isInteger(days) || days < 0 || !isDay(readyDate)) return null;
  const passed = cleanReminderDays(reminderDays).filter((d) => d <= days);
  if (!passed.length) return null;
  const day = passed[passed.length - 1];
  const from = addDays(readyDate, day);
  const today = addDays(readyDate, days);
  const contacted = (Array.isArray(contactDates) ? contactDates : []).some((c) => isDay(c) && c >= from && c <= today);
  return contacted ? null : { day, label: `${day}+` };
}

/**
 * Onerilen hatirlatma taslagi: 14 gunden once "reminder", sonra "reminder_later".
 * @param {number | null} days daysReady sonucu
 * @returns {"reminder" | "reminder_later"}
 */
export function suggestedReminder(days) {
  return Number.isFinite(days) && days >= UNCLAIMED_LATER_DAYS ? "reminder_later" : "reminder";
}

/**
 * Hazir gunu ve sonrasindaki haber kayitlarinin tarihleri (hatirlatma sayisi = uzunluk), artan sirada.
 * @param {Array<string | null | undefined>} contactDates
 * @param {string | null} readyDate
 * @returns {string[]}
 */
export function remindersSince(contactDates, readyDate) {
  if (!isDay(readyDate) || !Array.isArray(contactDates)) return [];
  return contactDates.filter((c) => isDay(c) && c >= readyDate).sort();
}

/**
 * "Needs an update" (KA-69): (awaiting_approval / ready / ready_unrepaired ve statusDate'ten beri kayit yok)
 * veya (hazir isin hatirlatma vurgusu var). statusDate gecersizse herhangi bir kayit "beri" sayilir.
 * @param {{ status?: string, statusDate?: string | null, readyDate?: string | null } | null} job
 * @param {Array<string | null | undefined>} contactDates
 * @param {Date | number | string} now
 * @param {number[]} reminderDays
 * @returns {{ needs: boolean, reason: "no_contact" | "unclaimed" | null, flag: { day: number, label: string } | null }}
 */
export function needsUpdate(job, contactDates, now, reminderDays) {
  const none = { needs: false, reason: null, flag: null };
  if (!job || typeof job !== "object") return none;
  const isReady = job.status === "ready" || job.status === "ready_unrepaired";
  if (!isReady && job.status !== "awaiting_approval") return none;
  const dates = (Array.isArray(contactDates) ? contactDates : []).filter(isDay);
  const since = isDay(job.statusDate) ? job.statusDate : null;
  const noContact = !dates.some((c) => since === null || c >= since);
  const flag = isReady ? unclaimedFlag(daysReady(job.readyDate, now), dates, job.readyDate, reminderDays) : null;
  if (noContact) return { needs: true, reason: "no_contact", flag };
  if (flag) return { needs: true, reason: "unclaimed", flag };
  return none;
}

/**
 * Garanti gun sayisi alani (KA-66): "" ve "0" -> garanti yok (days: null); 1-3650 tam sayi gecerli;
 * eksi, 3651+, kesirli, harfli, ondalik / ussel yazim hatadir.
 * @param {unknown} raw metin ya da sayi
 * @returns {{ ok: true, days: number | null } | { ok: false }}
 */
export function parseWarrantyDays(raw) {
  if (raw === null || raw === undefined) return { ok: true, days: null };
  let n;
  if (typeof raw === "number") n = Number.isInteger(raw) ? raw : NaN;
  else if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return { ok: true, days: null };
    n = /^[0-9]+$/.test(s) ? Number(s) : NaN;
  } else return { ok: false };
  if (!Number.isInteger(n) || n < 0 || n > MAX_WARRANTY_DAYS) return { ok: false };
  return { ok: true, days: n === 0 ? null : n };
}

/**
 * Garanti bitis tarihi = teslim gunu + gun sayisi. 0 / bos / gecersiz -> null.
 * @param {string | null | undefined} handedOverDate "YYYY-MM-DD"
 * @param {number | null | undefined} days 1-3650
 * @returns {string | null}
 */
export function warrantyEnd(handedOverDate, days) {
  if (!isDay(handedOverDate) || !Number.isInteger(days) || days < 1 || days > MAX_WARRANTY_DAYS) return null;
  return addDays(handedOverDate, days);
}

/**
 * Garanti durumu (KA-67): bitis >= bugun ise suruyor (bitis gunu dahil).
 * @param {string | null | undefined} end warrantyEnd
 * @param {Date | number | string} now
 * @returns {{ active: boolean, daysLeft: number, endedDaysAgo: number } | null}
 */
export function warrantyStatus(end, now) {
  const today = dayOf(now);
  if (!isDay(end) || !today) return null;
  const left = diffDays(today, end);
  return left >= 0 ? { active: true, daysLeft: left, endedDaysAgo: 0 } : { active: false, daysLeft: 0, endedDaysAgo: -left };
}
