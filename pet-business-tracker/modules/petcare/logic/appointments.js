// Randevu sorgulari: gun / hafta / ay, cakisma, yaklasan, hayvan gecmisi. Saf islevler: DOM yok, ag yok.
// store = { clients, pets, appointments } (diziler). Tek calisan varsayimi: takvimde yer tutan (scheduled / confirmed / in_progress)
// iki randevunun zamani cakisamaz.

import { addDays, daysInMonth, todayIso, toIso } from "../../../core/dates.js";
import { toMinutes } from "./calc.js";
import { isActive } from "./status.js";

const all = (store) => (Array.isArray(store?.appointments) ? store.appointments.filter((a) => a && typeof a === "object") : []);
const byTime = (a, b) => (a.date + a.time < b.date + b.time ? -1 : a.date + a.time > b.date + b.time ? 1 : String(a.id).localeCompare(String(b.id)));

/** Bir gunun randevulari (iptal / gelmedi dahil), saate gore artan. */
export function getAppointmentsForDate(store, date) {
  return all(store).filter((a) => a.date === date).sort(byTime);
}

/** startDate'ten baslayan 7 gunun randevulari (startDate dahil), tarih + saate gore artan. */
export function getAppointmentsForWeek(store, startDate) {
  const end = addDays(startDate, 6);
  return all(store).filter((a) => a.date >= startDate && a.date <= end).sort(byTime);
}

/** Bir ayin randevulari; month 1-12. */
export function getAppointmentsForMonth(store, year, month) {
  const from = toIso(year, month, 1);
  const to = toIso(year, month, daysInMonth(year, month));
  return all(store).filter((a) => a.date >= from && a.date <= to).sort(byTime);
}

/**
 * Cakisma var mi? Ayni gun, takvimde yer tutan randevularla [baslangic, baslangic + sure) araliklari kesisirse true.
 * Bitis ile baslangicin ust uste gelmesi (10:00-11:00 ve 11:00-12:00) cakisma degildir. excludeId duzenlenen randevuyu atlar.
 * Gecersiz saat / sure -> false.
 */
export function hasConflict(store, date, time, duration, excludeId) {
  const start = toMinutes(time);
  if (Number.isNaN(start) || !Number.isFinite(duration) || duration <= 0) return false;
  const end = start + duration;
  return all(store).some((a) => {
    if (a.date !== date || !isActive(a.status) || (excludeId && a.id === excludeId)) return false;
    const s = toMinutes(a.time);
    if (Number.isNaN(s)) return false;
    return start < s + (Number.isFinite(a.duration) ? a.duration : 0) && s < end;
  });
}

/**
 * Yaklasan randevular: takvimde yer tutan, simdiden (bugun + saat) sonra baslayanlar, en yakin once.
 * @param {object} store
 * @param {number} [limit] varsayilan 10
 * @param {{ today?: string, nowTime?: string }} [opts] test icin; varsayilan yerel simdi
 */
export function getUpcoming(store, limit = 10, opts) {
  const now = new Date();
  const today = opts?.today ?? todayIso(now);
  const nowTime = opts?.nowTime ?? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const max = Number.isInteger(limit) && limit > 0 ? limit : 10;
  return all(store)
    .filter((a) => isActive(a.status) && (a.date > today || (a.date === today && a.time >= nowTime)))
    .sort(byTime)
    .slice(0, max);
}

/** Bir hayvanin tum randevulari (her durum), en yeni once. */
export function getPetHistory(store, petId) {
  return all(store).filter((a) => a.petId === petId).sort((a, b) => byTime(b, a));
}
