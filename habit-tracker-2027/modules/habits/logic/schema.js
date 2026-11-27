// Veri semasi (schemaVersion 1), sinirlar, hazir sablonlar, temizleyiciler. Saf.
import { isIso } from "./dates.js";

export const HABITS = "habits";
export const ENTRIES = "entries";
export const PREFS = "prefs";
export const PREFS_ID = "prefs";
export const DATA_COLLECTIONS = Object.freeze([HABITS, ENTRIES, PREFS]);
export const LIMITS = Object.freeze({ habits: 200, entries: 80000, prefs: 1 });
export const MAX_VALUE = 999;
export const MAX_TARGET = 99;
export const NAME_MAX = 60;
export const UNIT_MAX = 12;

// 24 simge anahtari (core/icons.js HABIT_ICONS ile ayni sira).
export const ICONS = Object.freeze(["water", "book", "walk", "stretch", "journal", "lotus", "phoneoff", "users", "clipboard", "sparkle", "dumbbell", "bike",
  "apple", "bed", "sun", "moon", "music", "pen", "leaf", "coffee", "piggy", "code", "smile", "star"]);
// 10 renk (app.css .hc-<renk>).
export const COLORS = Object.freeze(["cyan", "violet", "emerald", "gold", "rose", "blue", "orange", "lime", "teal", "silver"]);
export const KINDS = Object.freeze(["check", "count"]);
export const SCHEDULES = Object.freeze(["daily", "days", "weekly", "monthly"]);

// Hazir sablonlar (spec F02). name/unit sozluk anahtaridir; kaydedilirken secili dile cevrilir.
export const TEMPLATES = Object.freeze([
  { id: "water", nameKey: "tpl.water", icon: "water", color: "cyan", kind: "count", target: 8, unitKey: "tpl.unit.glasses", schedule: { type: "daily" } },
  { id: "read", nameKey: "tpl.read", icon: "book", color: "violet", kind: "count", target: 10, unitKey: "tpl.unit.pages", schedule: { type: "daily" } },
  { id: "walk", nameKey: "tpl.walk", icon: "walk", color: "emerald", kind: "check", schedule: { type: "daily" } },
  { id: "stretch", nameKey: "tpl.stretch", icon: "stretch", color: "teal", kind: "check", schedule: { type: "weekly", times: 3 } },
  { id: "journal", nameKey: "tpl.journal", icon: "journal", color: "gold", kind: "check", schedule: { type: "days", days: [1, 2, 3, 4, 5] } },
  { id: "meditate", nameKey: "tpl.meditate", icon: "lotus", color: "violet", kind: "check", schedule: { type: "daily" } },
  { id: "phone", nameKey: "tpl.phone", icon: "phoneoff", color: "blue", kind: "check", schedule: { type: "daily" } },
  { id: "family", nameKey: "tpl.family", icon: "users", color: "rose", kind: "check", schedule: { type: "weekly", times: 1 } },
  { id: "plan", nameKey: "tpl.plan", icon: "clipboard", color: "orange", kind: "check", schedule: { type: "days", days: [0] } },
  { id: "tidy", nameKey: "tpl.tidy", icon: "sparkle", color: "lime", kind: "check", schedule: { type: "weekly", times: 2 } },
]);
// Welcome ekraninda hazir secili gelen 3 sablon (onayli tasarim; spec A02 guncellendi).
export const DEFAULT_PICKS = Object.freeze(["water", "read", "meditate"]);

export function templateHabit(tpl, t) {
  return {
    name: t(tpl.nameKey),
    icon: tpl.icon,
    color: tpl.color,
    kind: tpl.kind,
    target: tpl.kind === "count" ? tpl.target : 1,
    unit: tpl.unitKey ? t(tpl.unitKey) : "",
    schedule: { ...tpl.schedule },
    reminder: "",
  };
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v, lo, hi, def) => (Number.isInteger(v) && v >= lo && v <= hi ? v : def);

/** Formdan / yedekten gelen aliskanlik alanlarini dogrular. Doner { ok, value, errors: { alan: anahtar } } */
export function validateHabit(input) {
  const errors = {};
  const name = str(input?.name, 200);
  if (!name) errors.name = "habit.err.name";
  else if (name.length > NAME_MAX) errors.name = "habit.err.nameLong";
  const kind = KINDS.includes(input?.kind) ? input.kind : "check";
  let target = 1;
  if (kind === "count") {
    const n = Number(input?.target);
    if (!Number.isInteger(n) || n < 1 || n > MAX_TARGET) errors.target = "habit.err.target";
    else target = n;
  }
  const unit = kind === "count" ? str(input?.unit, 200) : "";
  if (unit.length > UNIT_MAX) errors.unit = "habit.err.unit";
  const s = input?.schedule ?? {};
  const type = SCHEDULES.includes(s.type) ? s.type : "daily";
  const schedule = { type };
  if (type === "days") {
    const days = [...new Set((Array.isArray(s.days) ? s.days : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!days.length) errors.days = "habit.err.days";
    schedule.days = days;
  } else if (type === "weekly" || type === "monthly") {
    const max = type === "weekly" ? 7 : 31;
    const n = Number(s.times);
    if (!Number.isInteger(n) || n < 1 || n > max) errors.times = type === "weekly" ? "habit.err.timesWeek" : "habit.err.timesMonth";
    schedule.times = Number.isInteger(n) ? Math.min(Math.max(n, 1), max) : 1;
  }
  const reminder = typeof input?.reminder === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.reminder) ? input.reminder : "";
  const value = {
    name: name.slice(0, NAME_MAX),
    icon: ICONS.includes(input?.icon) ? input.icon : "star",
    color: COLORS.includes(input?.color) ? input.color : "cyan",
    kind,
    target,
    unit: unit.slice(0, UNIT_MAX),
    schedule,
    reminder,
  };
  return { ok: Object.keys(errors).length === 0, value, errors };
}

export const clampValue = (v) => Math.max(0, Math.min(MAX_VALUE, Math.round(Number(v) || 0)));

export function defaultPrefs(weekStart = 1, now = new Date().toISOString()) {
  return {
    weekStart, paper: "letter", viewYear: null, onboarded: false, backupReminder: true, backupEveryDays: 7,
    lastBackupAt: null, backupNudgeSnoozedUntil: null, installedAt: now,
  };
}

const isTime = (v) => typeof v === "string" && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(v) && !Number.isNaN(Date.parse(v));
export function sanitizePrefs(p, weekStart = 1) {
  const d = defaultPrefs(weekStart);
  return {
    weekStart: p?.weekStart === 0 || p?.weekStart === 1 ? p.weekStart : d.weekStart,
    paper: p?.paper === "a4" ? "a4" : "letter",
    viewYear: Number.isInteger(p?.viewYear) && p.viewYear >= 2000 && p.viewYear <= 2100 ? p.viewYear : null,
    onboarded: p?.onboarded === true,
    backupReminder: p?.backupReminder !== false,
    backupEveryDays: int(p?.backupEveryDays, 1, 365, 7),
    lastBackupAt: isTime(p?.lastBackupAt) ? p.lastBackupAt : null,
    backupNudgeSnoozedUntil: isTime(p?.backupNudgeSnoozedUntil) ? p.backupNudgeSnoozedUntil : null,
    installedAt: isTime(p?.installedAt) ? p.installedAt : d.installedAt,
  };
}

/** Kimlik bicimi: yedekten gelen her id buna uymali; uymayan kayit REDDEDILIR (yeniden kimliklenmez: baglantilar kopmasin diye tutarli kural). */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Yedekten gelen veriyi temizler (yazmadan once). Gecersiz kayit atilir, sayisi raporlanir. */
export function sanitizeData(data, weekStart = 1) {
  let dropped = 0;
  const seen = new Set();
  const habits = [];
  for (const r of Array.isArray(data?.[HABITS]) ? data[HABITS] : []) {
    if (!r || typeof r.id !== "string" || !ID_RE.test(r.id) || seen.has(r.id)) { dropped++; continue; }
    const v = validateHabit(r);
    if (!v.value.name) { dropped++; continue; }
    seen.add(r.id);
    habits.push({
      ...v.value, id: r.id,
      order: Number.isInteger(r.order) ? r.order : habits.length,
      archived: r.archived === true,
      createdOn: isIso(r.createdOn) ? r.createdOn : "2027-01-01",
      createdAt: isTime(r.createdAt) ? r.createdAt : new Date().toISOString(),
      updatedAt: isTime(r.updatedAt) ? r.updatedAt : new Date().toISOString(),
    });
  }
  const ids = new Set(habits.map((h) => h.id));
  const pairs = new Set();
  const entries = [];
  for (const e of Array.isArray(data?.[ENTRIES]) ? data[ENTRIES] : []) {
    const key = e && `${e.habitId}|${e.date}`;
    if (!e || typeof e.id !== "string" || !ID_RE.test(e.id) || !ids.has(e.habitId) || !isIso(e.date) || pairs.has(key)) { dropped++; continue; }
    const rest = e.rest === true;
    const value = rest ? 0 : clampValue(e.value);
    if (!rest && value === 0) { dropped++; continue; }
    pairs.add(key);
    const t = new Date().toISOString();
    entries.push({ id: e.id, habitId: e.habitId, date: e.date, value, rest, createdAt: isTime(e.createdAt) ? e.createdAt : t, updatedAt: isTime(e.updatedAt) ? e.updatedAt : t });
  }
  const pr = (Array.isArray(data?.[PREFS]) ? data[PREFS] : []).find((r) => r && r.id === PREFS_ID);
  const prefs = pr ? [{ ...sanitizePrefs(pr, weekStart), id: PREFS_ID }] : [];
  return { data: { [HABITS]: habits, [ENTRIES]: entries, [PREFS]: prefs }, report: { dropped } };
}
