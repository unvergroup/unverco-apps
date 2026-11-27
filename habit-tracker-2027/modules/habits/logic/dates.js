// Tarih yardimcilari (saf). Tarih metni "yyyy-mm-dd" YEREL takvim gunudur; toISOString() tarih icin KULLANILMAZ (UTC kaymasi).
// Gun aritmetigi UTC ogleye sabitlenmis Date uzerinden yapilir: yaz saati gecisinde gun atlanmaz / yinelenmez.

const pad = (n) => String(n).padStart(2, "0");
export const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Yerel saatten "yyyy-mm-dd" (getFullYear / getMonth / getDate). */
export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isIso(s) {
  const m = ISO_RE.exec(String(s ?? ""));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo - 1);
}

/** "yyyy-mm-dd" -> { y, m (0-11), d } */
export function parts(iso) {
  const m = ISO_RE.exec(iso);
  return { y: +m[1], m: +m[2] - 1, d: +m[3] };
}

export const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const utcNoon = (iso) => { const p = parts(iso); return Date.UTC(p.y, p.m, p.d, 12); };
const fromUtc = (t) => { const d = new Date(t); return isoOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

export const addDays = (iso, n) => fromUtc(utcNoon(iso) + n * 86400000);
/** b - a gun olarak (tamsayi). */
export const diffDays = (a, b) => Math.round((utcNoon(b) - utcNoon(a)) / 86400000);
/** 0 = Pazar ... 6 = Cumartesi */
export const weekday = (iso) => new Date(utcNoon(iso)).getUTCDay();
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
export const daysInYear = (y) => (isLeap(y) ? 366 : 365);
export const yearOf = (iso) => +iso.slice(0, 4);
export const monthKey = (iso) => iso.slice(0, 7);
export const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
export const monthEnd = (iso) => { const p = parts(iso); return isoOf(p.y, p.m, daysInMonth(p.y, p.m)); };

/** Haftanin ilk gunu (weekStart 0 = Pazar, 1 = Pazartesi). */
export function weekStartOf(iso, weekStart = 1) {
  const back = (weekday(iso) - weekStart + 7) % 7;
  return addDays(iso, -back);
}

/** a..b (dahil) gunleri, sirayla (dizi). */
export function eachDay(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

export const minIso = (a, b) => (a <= b ? a : b);
export const maxIso = (a, b) => (a >= b ? a : b);

/** "2027-01" -> bir onceki / sonraki ay anahtari */
export function shiftMonth(key, n) {
  const y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}`;
}
