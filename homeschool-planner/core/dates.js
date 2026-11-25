// Tarih yardimcilari. Tarih = "YYYY-MM-DD" metni (saat dilimi yok); hesap UTC uzerinden yapilir, yaz saati kaymaz.
// Gosterim icin i18n.formatDate kullanilir; burada yalniz hesap vardir.

const pad = (n, w = 2) => String(n).padStart(w, "0");
const DAY = 86400000;

export function daysInMonth(year, month) { // month: 1-12
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toIso(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

// Gecerli takvim gunuyse { year, month, day }, degilse null ("2026-02-30" gecersizdir).
export function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === "string" ? iso : "");
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export const isIsoDate = (iso) => parseIso(iso) !== null;

const toUtc = (iso) => {
  const p = parseIso(iso);
  if (!p) throw new RangeError(`Invalid date: ${iso}`);
  return Date.UTC(p.year, p.month - 1, p.day);
};
const fromUtc = (ms) => {
  const d = new Date(ms);
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

// Yerel bugun (cihazin takvimi).
export function todayIso(now = new Date()) {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export const addDays = (iso, n) => fromUtc(toUtc(iso) + n * DAY);

// Ay ekler; hedef ayda o gun yoksa ayin son gunune iner (31 Ocak + 1 ay = 28/29 Subat).
export function addMonths(iso, n) {
  const p = parseIso(iso);
  if (!p) throw new RangeError(`Invalid date: ${iso}`);
  const idx = p.year * 12 + (p.month - 1) + n;
  const year = Math.floor(idx / 12);
  const month = (idx % 12 + 12) % 12 + 1;
  return toIso(year, month, Math.min(p.day, daysInMonth(year, month)));
}

// b - a, gun sayisi.
export const diffDays = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY);

export const compareIso = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // gecerli ISO metinlerde sozluk sirasi = tarih sirasi

// Haftanin gunu: 0 = Pazartesi ... 6 = Pazar.
export const weekday = (iso) => (new Date(toUtc(iso)).getUTCDay() + 6) % 7;

// Haftanin ilk gunu (varsayilan Pazartesi; weekStartsOn: 0 = Pazartesi ... 6 = Pazar).
export function startOfWeek(iso, weekStartsOn = 0) {
  return addDays(iso, -((weekday(iso) - weekStartsOn + 7) % 7));
}

// Verilen gunun haftasi: 7 gunluk dizi.
export const weekDates = (iso, weekStartsOn = 0) => {
  const s = startOfWeek(iso, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
};

export const isWeekend = (iso) => weekday(iso) >= 5;
