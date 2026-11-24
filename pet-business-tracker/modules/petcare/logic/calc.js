// Gelir ve sure hesaplari. Saf islevler: DOM yok, ag yok. Para en kucuk birimin tamsayisidir (cent / kurus).
// Kural (varsayim): "gelir" = tamamlanmis (completed) VE odenmis (paid) randevularin fiyati; tamamlanmis ama odenmemis tutar
// "outstanding" (alacak) olarak ayri doner. Iptal ve gelmedi randevular gelire girmez.
// Gun / hafta / ay araliklari tarih metni (YYYY-MM-DD) uzerinden hesaplanir.

import { addDays, daysInMonth, toIso } from "../../../core/dates.js";
import { ACTIVE_STATUSES } from "./status.js";

export const MAX_PRICE = 999_999;
export const MIN_DURATION = 15;
export const MAX_DURATION = 480;
export const DEFAULT_DURATION = 60;

const list = (v) => (Array.isArray(v) ? v.filter((a) => a && typeof a === "object") : []);
const minorOf = (a) => (Number.isSafeInteger(a.price) && a.price > 0 ? a.price : 0);

// ---------- saat yardimcilari ----------
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isTime = (t) => typeof t === "string" && TIME.test(t);

/** "HH:MM" -> gece yarisindan beri dakika; gecersiz -> NaN. */
export function toMinutes(time) {
  const m = TIME.exec(typeof time === "string" ? time : "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
/** Dakika -> "HH:MM" (24 saati asarsa basa sarar). */
export function fromMinutes(min) {
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
/** Bitis saati = baslangic + sure; gecersiz girdi -> "". Gece yarisini asarsa ertesi gun saatine sarar. */
export function endTimeOf(time, duration) {
  const s = toMinutes(time);
  if (Number.isNaN(s) || !Number.isFinite(duration)) return "";
  return fromMinutes(s + duration);
}

// ---------- gelir ----------
/**
 * [from, to] (dahil) araligindaki ozet. Tarih disi / gecersiz randevu atlanir.
 * @param {object[]} appointments
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 * @returns {{ earnedMinor: number, outstandingMinor: number, bookedMinor: number, bookedCount: number, count: number, completed: number, cancelled: number, noShow: number }}
 *   count: araliktaki tum randevu; earned: tamamlanmis + odenmis; outstanding: tamamlanmis + odenmemis;
 *   booked: HENUZ TAMAMLANMAMIS aktif randevular (planlandi / onaylandi / devam ediyor) - tutar ve adet. Gelire (earned) ve alacaga (outstanding) KARISMAZ.
 */
export function revenueForRange(appointments, from, to) {
  const out = { earnedMinor: 0, outstandingMinor: 0, bookedMinor: 0, bookedCount: 0, count: 0, completed: 0, cancelled: 0, noShow: 0 };
  for (const a of list(appointments)) {
    if (typeof a.date !== "string" || a.date < from || a.date > to) continue;
    out.count += 1;
    if (a.status === "completed") {
      out.completed += 1;
      if (a.paid === true) out.earnedMinor += minorOf(a); else out.outstandingMinor += minorOf(a);
    } else if (ACTIVE_STATUSES.includes(a.status)) {
      out.bookedCount += 1;
      out.bookedMinor += minorOf(a);
    } else if (a.status === "cancelled") out.cancelled += 1;
    else if (a.status === "no_show") out.noShow += 1;
  }
  return out;
}

/** Gunluk gelir ozeti. */
export const dailyRevenue = (appointments, date) => revenueForRange(appointments, date, date);

/** Haftalik gelir: startDate'ten baslayan 7 gun (startDate dahil). */
export const weeklyRevenue = (appointments, startDate) => revenueForRange(appointments, startDate, addDays(startDate, 6));

/** Aylik gelir; month 1-12. */
export function monthlyRevenue(appointments, year, month) {
  return revenueForRange(appointments, toIso(year, month, 1), toIso(year, month, daysInMonth(year, month)));
}

/**
 * Hizmet bazli gelir dagilimi (yalniz tamamlanmis + odenmis randevular), gelire gore azalan.
 * @param {object[]} appointments
 * @param {{ from?: string, to?: string }} [range] verilmezse tum tarihler
 * @returns {{ service: string, count: number, revenueMinor: number, share: number }[]} share: 0-1 arasi pay (toplam gelir 0 ise 0)
 */
export function revenueByService(appointments, range) {
  const map = new Map();
  for (const a of list(appointments)) {
    if (a.status !== "completed" || a.paid !== true) continue;
    if (range?.from && a.date < range.from) continue;
    if (range?.to && a.date > range.to) continue;
    const e = map.get(a.service) ?? { service: a.service, count: 0, revenueMinor: 0, share: 0 };
    e.count += 1;
    e.revenueMinor += minorOf(a);
    map.set(a.service, e);
  }
  const rows = [...map.values()];
  const total = rows.reduce((s, r) => s + r.revenueMinor, 0);
  for (const r of rows) r.share = total > 0 ? r.revenueMinor / total : 0;
  return rows.sort((a, b) => b.revenueMinor - a.revenueMinor || String(a.service).localeCompare(String(b.service)));
}

/**
 * Musteri basina gelir (tamamlanmis randevular): toplam, odenen ve alacak. Toplam gelire gore azalan.
 * @returns {{ clientId: string, visits: number, totalMinor: number, paidMinor: number, outstandingMinor: number }[]}
 */
export function revenueByClient(appointments, range) {
  const map = new Map();
  for (const a of list(appointments)) {
    if (a.status !== "completed" || typeof a.clientId !== "string") continue;
    if (range?.from && a.date < range.from) continue;
    if (range?.to && a.date > range.to) continue;
    const e = map.get(a.clientId) ?? { clientId: a.clientId, visits: 0, totalMinor: 0, paidMinor: 0, outstandingMinor: 0 };
    const p = minorOf(a);
    e.visits += 1;
    e.totalMinor += p;
    if (a.paid === true) e.paidMinor += p; else e.outstandingMinor += p;
    map.set(a.clientId, e);
  }
  return [...map.values()].sort((a, b) => b.totalMinor - a.totalMinor || a.clientId.localeCompare(b.clientId));
}

/** Tek musterinin toplam geliri (revenueByClient satiri); hic ziyaret yoksa sifirlar. */
export function clientTotal(appointments, clientId) {
  return revenueByClient(appointments).find((r) => r.clientId === clientId)
    ?? { clientId, visits: 0, totalMinor: 0, paidMinor: 0, outstandingMinor: 0 };
}

/** Ortalama randevu suresi (dakika, en yakin tamsayi) — yalniz tamamlanmis randevular; yoksa 0. */
export function averageDuration(appointments) {
  const done = list(appointments).filter((a) => a.status === "completed" && Number.isFinite(a.duration) && a.duration > 0);
  if (done.length === 0) return 0;
  return Math.round(done.reduce((s, a) => s + a.duration, 0) / done.length);
}
