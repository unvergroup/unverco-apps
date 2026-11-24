// Hatirlatmalar: yaklasan randevulari listeler, "gonderildi" durumunu okur, e-posta baglantisi kurar. Saf islevler: DOM yok, ag yok.
// Durum randevu kaydinda (reminderSentAt: ISO zaman ya da "") cihazda saklanir; yedege girer. Sunucu, abonelik, otomatik gonderim YOKTUR:
// mesaj yalniz kullanici dugmeye dokununca cihazin kendi WhatsApp / SMS / e-posta uygulamasinda acilir.
import { addDays, todayIso } from "../../../core/dates.js";

/** Hatirlatma listesi kac gun ilerisini gosterir (bugun dahil). */
export const REMINDER_DAYS = 14;
/** Hatirlatma gerektiren durumlar (baslamis / kapanmis randevuya hatirlatma gitmez). */
export const REMINDER_STATUSES = Object.freeze(["scheduled", "confirmed"]);

const list = (v) => (Array.isArray(v) ? v.filter((a) => a && typeof a === "object") : []);
const byTime = (a, b) => (a.date + a.time < b.date + b.time ? -1 : a.date + a.time > b.date + b.time ? 1 : String(a.id).localeCompare(String(b.id)));

/** Hatirlatma gonderildi olarak isaretli mi. */
export const isReminderSent = (a) => Boolean(a) && typeof a.reminderSentAt === "string" && a.reminderSentAt !== "";

/**
 * [bugun, bugun + days] araligindaki hatirlatilacak randevular (scheduled / confirmed), en yakin once.
 * @param {{ appointments: object[] }} store
 * @param {{ today?: string, days?: number }} [opts]
 */
export function getReminders(store, opts = {}) {
  const today = opts.today ?? todayIso();
  const days = Number.isInteger(opts.days) && opts.days >= 0 ? opts.days : REMINDER_DAYS;
  const last = addDays(today, days);
  return list(store?.appointments).filter((a) => REMINDER_STATUSES.includes(a.status) && a.date >= today && a.date <= last).sort(byTime);
}

/** { pending, sent, total } sayilari. */
export function reminderCounts(appointments) {
  const l = list(appointments);
  const sent = l.filter(isReminderSent).length;
  return { pending: l.length - sent, sent, total: l.length };
}

/** "pending" | "sent" | "all" suzgeci. */
export function filterReminders(appointments, filter) {
  const l = list(appointments);
  if (filter === "pending") return l.filter((a) => !isReminderSent(a));
  if (filter === "sent") return l.filter(isReminderSent);
  return l;
}

const SAFE_MAIL = /^[^\s@,;?&=%<>"\\()[\]]+@[^\s@,;?&=%<>"\\()[\]]+\.[^\s@,;?&=%<>"\\()[\]]+$/;

/** mailto: baglantisi (konu + metin kodlanir). Gecersiz adres -> "". */
export function mailtoUrl(email, subject, body) {
  const to = String(email ?? "").trim();
  // mailto basligi / ikinci alici enjeksiyonu: ? & = % , ; < > " \ ve bosluk / satir sonu iceren adres baglanti URETMEZ.
  if (!SAFE_MAIL.test(to)) return "";
  const q = [subject ? `subject=${encodeURIComponent(subject)}` : "", body ? `body=${encodeURIComponent(body)}` : ""].filter(Boolean).join("&");
  return `mailto:${to}${q ? `?${q}` : ""}`;
}
