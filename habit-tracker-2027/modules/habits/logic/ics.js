// .ics takvim dosyasi (RFC 5545). Satirlar CRLF; 75 oktette katlanir (UTF-8 karakteri bolunmez); metin kacisli.
// Uygulama bildirim gondermez: hatirlatmayi telefonun kendi takvimi yapar.
import { addDays, localIso, weekday } from "./dates.js";

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const enc = new TextEncoder();

/** RFC 5545 3.3.11 TEXT kacisi: \ ; , ve satir sonu. */
export const escapeText = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

/** Tek mantiksal satiri 75 oktetlik fiziksel satirlara katlar (devam satiri bir bosluk ile baslar). */
export function foldLine(line) {
  const out = [];
  let cur = "", bytes = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) { out.push(cur); cur = " "; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// "Haftada X kez": kullanici gun secmez; hatirlatma haftaya yayilmis X gune duser (her gun hatirlatma gelmez).
const SPREAD = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };

/** Hatirlatmanin dustugu hafta gunleri (0 = Pazar); gun listesi olmayan planlarda null. */
export function reminderDays(habit) {
  const s = habit.schedule ?? {};
  if (s.type === "days" && Array.isArray(s.days) && s.days.length) return [...s.days].sort();
  if (s.type === "weekly") return SPREAD[Math.min(Math.max(Number.parseInt(s.times, 10) || 1, 1), 7)];
  return null;
}

/** RRULE: belirli gunler ve haftada X kez -> FREQ=WEEKLY;BYDAY; ayda X kez -> FREQ=WEEKLY (haftada bir); gunluk -> FREQ=DAILY. */
export function rruleFor(habit) {
  const days = reminderDays(habit);
  if (days) return `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(",")}`;
  return habit.schedule?.type === "monthly" ? "FREQ=WEEKLY" : "FREQ=DAILY";
}

/**
 * habits: hatirlatma saati olan etkin aliskanliklar alinir. today: "yyyy-mm-dd" (yerel). alarmText: VALARM aciklamasi.
 * UID <habitId>@habit-tracker.unverco: ayni aliskanlik yeniden iceri alininca ayni etkinlik guncellenir.
 */
/** BYDAY'li kurallarda DTSTART ilk planli gune (bugun ya da sonrasi) hizalanir; digerlerinde bugun. */
export function firstDate(habit, today) {
  const days = reminderDays(habit);
  if (!days) return today;
  for (let i = 0; i < 7; i++) { const d = addDays(today, i); if (days.includes(weekday(d))) return d; }
  return today;
}
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function buildIcs(habits, { today = localIso(), now = new Date(), alarmText = "Habit reminder" } = {}) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UNVERCO//Habit Tracker 1.0//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const h of habits) {
    if (h.archived || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.reminder || "") || !SAFE_ID.test(String(h.id))) continue;
    const day = firstDate(h, today).replace(/-/g, "");
    L.push("BEGIN:VEVENT", `UID:${escapeText(h.id)}@habit-tracker.unverco`, `DTSTAMP:${stamp(now)}`, `DTSTART:${day}T${h.reminder.replace(":", "")}00`,
      "DURATION:PT5M", `SUMMARY:${escapeText(h.name)}`, `RRULE:${rruleFor(h)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(h.name || alarmText)}`, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(foldLine).join("\r\n") + "\r\n";
}

export const ICS_FILENAME = "UNVERCO-Habit-Reminders.ics";

/**
 * Kendi dogrulayicimiz (dis kutuphane yok): CRLF, 75 oktet, katlama acma, BEGIN/END dengesi, zorunlu alanlar.
 * Doner { ok, errors[], events: [{ UID, SUMMARY (kacis cozulmus), RRULE, DTSTART }] }
 */
export function validateIcs(text) {
  const errors = [];
  if (!text.endsWith("\r\n")) errors.push("file must end with CRLF");
  if (/[^\r]\n/.test(text) || /\r(?!\n)/.test(text)) errors.push("bare LF or CR");
  const phys = text.split("\r\n").slice(0, -1);
  phys.forEach((l, i) => { if (enc.encode(l).length > 75) errors.push(`line ${i + 1} longer than 75 octets`); });
  const logical = [];
  for (const l of phys) {
    if (l.startsWith(" ") || l.startsWith("\t")) { if (!logical.length) errors.push("continuation without line"); else logical[logical.length - 1] += l.slice(1); }
    else logical.push(l);
  }
  const stack = [];
  const events = [];
  let ev = null;
  for (const l of logical) {
    const m = /^([A-Z-]+)(;[^:]*)?:(.*)$/.exec(l);
    if (!m) { errors.push(`bad line: ${l.slice(0, 40)}`); continue; }
    const [, name, , value] = m;
    if (name === "BEGIN") { stack.push(value); if (value === "VEVENT") ev = {}; }
    else if (name === "END") { if (stack.pop() !== value) errors.push(`END:${value} does not match`); if (value === "VEVENT") { events.push(ev); ev = null; } }
    else if (ev && stack[stack.length - 1] === "VEVENT") ev[name] = name === "SUMMARY" ? value.replace(/\\([\\;,nN])/g, (x, c) => (c === "n" || c === "N" ? "\n" : c)) : value;
  }
  if (stack.length) errors.push("unclosed component");
  if (!logical.includes("VERSION:2.0") || !logical.some((l) => l.startsWith("PRODID:"))) errors.push("VERSION / PRODID missing");
  for (const e of events) for (const k of ["UID", "DTSTAMP", "DTSTART", "SUMMARY"]) if (!e[k]) errors.push(`VEVENT without ${k}`);
  return { ok: errors.length === 0, errors, events };
}
