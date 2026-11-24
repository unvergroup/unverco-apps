// Tekrarlayan randevular: kural listesi, seri uretimi ve grup sorgusu. Saf islevler: DOM yok, ag yok.
// Seri, ilk randevuyu (verilen) ve ardindan gelenleri ayni recurrenceId altinda toplar.

import { addDays } from "../../../core/dates.js";
import { endTimeOf } from "./calc.js";

export const RECURRENCE_RULES = Object.freeze(["every_week", "every_2_weeks", "every_3_weeks", "every_4_weeks", "every_6_weeks", "every_8_weeks"]);
export const MAX_OCCURRENCES = 52;

/** Kuralin hafta araligi ("every_4_weeks" -> 4, "every_week" -> 1); bilinmeyen kural -> 0. */
export function ruleWeeks(rule) {
  if (!RECURRENCE_RULES.includes(rule)) return 0;
  const m = /^every_(\d+)_weeks$/.exec(rule);
  return m ? Number(m[1]) : 1;
}

/**
 * Tekrarlayan randevu dizisi uretir: toplam `count` adet (1-52), ilki verilen randevudur (id'si varsa korunur).
 * Sonrakiler yeni kayittir: id / createdAt / updatedAt yok (store verir), durum "scheduled", odenmemis; hizmet, fiyat, sure ve notlar kopyalanir.
 * Hepsi ayni recurrenceId ve recurrenceRule'u tasir (recurrenceId yoksa "R-<id>" ya da "R-<petId>-<tarih>").
 * Girdi degistirilmez. Gecersiz kural / tarih RangeError firlatir.
 * @param {object} appointment
 * @param {string} rule RECURRENCE_RULES'tan biri
 * @param {number} count
 * @returns {object[]}
 */
export function generateRecurring(appointment, rule, count) {
  const weeks = ruleWeeks(rule);
  if (!weeks) throw new RangeError(`generateRecurring: unknown rule ${String(rule)}`);
  const a = appointment && typeof appointment === "object" ? appointment : null;
  if (!a || typeof a.date !== "string") throw new RangeError("generateRecurring: appointment.date required");
  const n = Math.min(MAX_OCCURRENCES, Math.max(1, Math.trunc(Number(count)) || 1));
  const recurrenceId = typeof a.recurrenceId === "string" && a.recurrenceId
    ? a.recurrenceId
    : `R-${a.id || `${a.petId ?? ""}-${a.date}`}`;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const date = addDays(a.date, i * weeks * 7); // gecersiz tarihte RangeError (core/dates)
    if (i === 0) {
      out.push({ ...a, recurrenceId, recurrenceRule: rule });
      continue;
    }
    const { id, createdAt, updatedAt, ...rest } = a;
    out.push({
      ...rest,
      date,
      endTime: endTimeOf(a.time, a.duration),
      status: "scheduled",
      paid: false,
      paymentMethod: "",
      recurrenceId,
      recurrenceRule: rule,
    });
  }
  return out;
}

/** Ayni recurrenceId'li tum randevular, tarih + saate gore artan. Bos / bilinmeyen id -> []. */
export function getRecurrenceGroup(store, recurrenceId) {
  if (typeof recurrenceId !== "string" || !recurrenceId) return [];
  const all = Array.isArray(store?.appointments) ? store.appointments : [];
  return all
    .filter((a) => a && a.recurrenceId === recurrenceId)
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : a.date + a.time > b.date + b.time ? 1 : 0));
}
