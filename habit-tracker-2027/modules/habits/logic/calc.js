// Hesap kurallari (spec §5). Hepsi saf islev: DOM yok, depo yok, saat disaridan verilir (today: "yyyy-mm-dd").
// Birim: daily/days -> gun; weekly -> hafta (weekStart'a gore); monthly -> takvim ayi.
// Birim sonucu: "success" | "neutral" (seriyi ne bozar ne artirir) | "miss" | "open" (suren birim, henuz basari yok; seriyi bozmaz).
import { addDays, daysInMonth, eachDay, isoOf, maxIso, minIso, monthEnd, monthStart, parts, weekStartOf, weekday, yearOf } from "./dates.js";

export const targetOf = (h) => (h.kind === "count" ? Math.max(1, h.target | 0) : 1);

/** entries -> Map(habitId -> Map(date -> entry)) */
export function indexEntries(entries) {
  const idx = new Map();
  for (const e of entries) {
    let m = idx.get(e.habitId);
    if (!m) idx.set(e.habitId, (m = new Map()));
    m.set(e.date, e);
  }
  return idx;
}
const EMPTY = new Map();
export const habitDays = (idx, habit) => idx.get(habit.id) ?? EMPTY;

/** Bir gunun durumu: "done" | "partial" | "rest" | "none" */
export function dayStatus(habit, e) {
  if (!e) return "none";
  if (e.rest) return "rest";
  const v = e.value | 0;
  if (v >= targetOf(habit)) return "done";
  return v > 0 ? "partial" : "none";
}

/** Baslangic: min(createdOn, ilk kayit tarihi). Geriye donuk kayit serbesttir. */
const startCache = new WeakMap();
export function startOf(habit, days) {
  let c = startCache.get(days);
  if (c && c.created === habit.createdOn && c.size === days.size) return c.s;
  let s = habit.createdOn;
  for (const d of days.keys()) if (!s || d < s) s = d;
  startCache.set(days, { created: habit.createdOn, size: days.size, s });
  return s;
}

/** daily/days: o gun planli mi */
export function isPlannedDay(habit, iso) {
  const s = habit.schedule ?? { type: "daily" };
  if (s.type === "days") return Array.isArray(s.days) && s.days.includes(weekday(iso));
  return true;
}
export const isPeriodic = (habit) => ["weekly", "monthly"].includes(habit.schedule?.type);
const timesOf = (habit) => Math.max(1, habit.schedule?.times | 0);

/** Birim sinirlari (iso tarih icin). */
export function unitOf(habit, iso, weekStart) {
  const t = habit.schedule?.type;
  if (t === "weekly") { const a = weekStartOf(iso, weekStart); return { start: a, end: addDays(a, 6) }; }
  if (t === "monthly") return { start: monthStart(iso), end: monthEnd(iso) };
  return { start: iso, end: iso };
}

/** Birimdeki tamamlanan gun ve rest gunu sayisi (yalniz [from..to] icinde). */
function countUnit(habit, days, a, b) {
  let done = 0, rest = 0;
  for (const d of eachDay(a, b)) {
    const st = dayStatus(habit, days.get(d));
    if (st === "done") done++;
    else if (st === "rest") rest++;
  }
  return { done, rest };
}

/**
 * Baslangictan asOf'a kadar birim sonuclari (kronolojik). Her oge: { start, end, outcome, done, rest, planned }.
 * daily/days: planli olmayan gun "neutral"; asOf gunu tamam degilse "open".
 * weekly/monthly: hedef tuttuysa success; tutmadi ama icinde rest var -> neutral; suren birim -> open; ilk birim baslangictan once
 * basliyorsa ve basarisizsa -> neutral (yarim birim cezalandirilmaz).
 */
export function unitOutcomes(habit, days, asOf, weekStart = 1) {
  const start = startOf(habit, days);
  const out = [];
  if (!start || start > asOf) return out;
  if (!isPeriodic(habit)) {
    for (const d of eachDay(start, asOf)) {
      const st = dayStatus(habit, days.get(d));
      const planned = isPlannedDay(habit, d);
      let outcome;
      if (!planned) outcome = "neutral";
      else if (st === "done") outcome = "success";
      else if (st === "rest") outcome = "neutral";
      else outcome = d === asOf ? "open" : "miss";
      out.push({ start: d, end: d, outcome, done: st === "done" ? 1 : 0, rest: st === "rest" ? 1 : 0, planned, progress: st === "partial" || st === "done" ? 1 : 0 });
    }
    return out;
  }
  const times = timesOf(habit);
  let u = unitOf(habit, start, weekStart);
  while (u.start <= asOf) {
    const to = minIso(u.end, asOf);
    const { done, rest } = countUnit(habit, days, maxIso(u.start, start), to);
    let outcome;
    if (done >= times) outcome = "success";
    else if (u.end > asOf) outcome = "open";
    else if (rest > 0 || u.start < start) outcome = "neutral";
    else outcome = "miss";
    out.push({ start: u.start, end: u.end, outcome, done, rest, planned: true, progress: done });
    u = unitOf(habit, addDays(u.end, 1), weekStart);
  }
  return out;
}

/** Mevcut seri: asOf'tan geriye; success +1, neutral/open atla, miss dur. */
export function currentStreak(outcomes) {
  let n = 0;
  for (let i = outcomes.length - 1; i >= 0; i--) {
    const o = outcomes[i].outcome;
    if (o === "success") n++;
    else if (o === "miss") break;
  }
  return n;
}

/** En uzun seri; filter verilirse yalniz o birimler (ornegin secili yil) sayilir. */
export function bestStreak(outcomes, filter = null) {
  let best = 0, run = 0;
  for (const u of outcomes) {
    if (filter && !filter(u)) { if (u.outcome === "miss") run = 0; continue; }
    if (u.outcome === "success") { run++; best = Math.max(best, run); }
    else if (u.outcome === "miss") run = 0;
  }
  return best;
}

/**
 * Geri donusler: bir seri durduktan (miss) sonra yeniden tamamlanan ilk birim = +1. Hic seri olmadan ilk tamamlama sayilmaz.
 * Suren birimde (open) en az bir tamamlama varsa geri donus o an sayilir ("Mart'taki ilk tamamlama Comeback #1").
 * Doner: { count, list: [birim baslangici...] }; filter yalniz sayimi sinirlar (durum makinesi hep bastan yurur).
 */
export function comebacks(outcomes, filter = null) {
  let had = false, broken = false, count = 0;
  const list = [];
  for (const u of outcomes) {
    const back = u.outcome === "success" || (u.outcome === "open" && u.done > 0);
    if (back) {
      if (had && broken && (!filter || filter(u))) { count++; list.push(u.start); }
      had = true;
      broken = false;
    } else if (u.outcome === "miss" && had) broken = true;
  }
  return { count, list };
}

/**
 * Oran (spec §5): daily/days -> tamam gun / (planli gun - rest gun); weekly/monthly -> sum(min(tamam, times)) / (times x birim).
 * Hedefi tutmamis notr birimler (rest'li, ilk yarim birim, suren birim) seriyle tutarli olarak pay ve paydadan cikar. Donem: max(baslangic, from) .. min(asOf, to). Payda 0 ise null.
 */
export function rate(habit, days, from, to, asOf, weekStart = 1) {
  const start = startOf(habit, days);
  if (!start) return { num: 0, den: 0, pct: null };
  const a = maxIso(start, from), b = minIso(asOf, to);
  if (a > b) return { num: 0, den: 0, pct: null };
  let num = 0, den = 0;
  if (!isPeriodic(habit)) {
    for (const d of eachDay(a, b)) {
      if (!isPlannedDay(habit, d)) continue;
      const st = dayStatus(habit, days.get(d));
      if (st === "rest") continue;
      den++;
      if (st === "done") num++;
    }
  } else {
    const times = timesOf(habit);
    let u = unitOf(habit, a, weekStart);
    while (u.start <= b) {
      const { done, rest } = countUnit(habit, days, maxIso(u.start, a), minIso(u.end, b));
      // Seriyle ayni kural: hedef tutmadiysa rest'li birim, baslangictan once baslayan ilk (yarim) birim ve suren birim notr (pay ve paydaya girmez).
      const neutral = done < times && (rest > 0 || u.start < start || u.end > asOf);
      if (!neutral) { num += Math.min(done, times); den += times; }
      u = unitOf(habit, addDays(u.end, 1), weekStart);
    }
  }
  return { num, den, pct: den ? (num * 100) / den : null };
}

/** Yuzde -> tam sayi metni icin yuvarlama (7/9 -> 78). */
export const roundPct = (p) => (p === null || p === undefined ? null : Math.round(p));

/** Alisikanlik o tarihte etkin mi (arsivde degil, baslangici gelmis). */
export const activeOn = (habit, days, iso) => !habit.archived && startOf(habit, days) <= iso;

/**
 * Gun puani (spec §5): o gun planli daily/days aliskanliklari (rest haric) + o gun tamamlanan weekly/monthly.
 * Doner { done, total, pct } (total 0 -> pct null).
 */
export function dayScore(habits, idx, iso) {
  let done = 0, total = 0;
  for (const h of habits) {
    const days = habitDays(idx, h);
    if (!activeOn(h, days, iso)) continue;
    const st = dayStatus(h, days.get(iso));
    if (isPeriodic(h)) {
      if (st === "done") { done++; total++; }
      continue;
    }
    if (!isPlannedDay(h, iso) || st === "rest") continue;
    total++;
    if (st === "done") done++;
  }
  return { done, total, pct: total ? (done * 100) / total : null };
}

/** Isi haritasi duzeyi: 0 -> 0; (0,25] -> 1; (25,50] -> 2; (50,75] -> 3; (75,100] -> 4. */
export function heatLevel(pct) {
  if (pct === null || pct === undefined || pct <= 0) return 0;
  if (pct <= 25) return 1;
  if (pct <= 50) return 2;
  if (pct <= 75) return 3;
  return 4;
}

/** Today satiri: { bucket: "due"|"done"|"notDue", status, value, unitDone, times, streak, unitWord, comebackNo } */
export function todayRow(habit, days, today, weekStart = 1) {
  const e = days.get(today);
  const status = dayStatus(habit, e);
  const outs = unitOutcomes(habit, days, today, weekStart);
  const streak = currentStreak(outs);
  const cb = comebacks(outs);
  const last = outs[outs.length - 1];
  const comebackNow = cb.list.length > 0 && last && cb.list[cb.list.length - 1] === last.start ? cb.count : 0;
  let bucket;
  let unitDone = 0;
  const times = isPeriodic(habit) ? timesOf(habit) : 1;
  if (isPeriodic(habit)) {
    const u = unitOf(habit, today, weekStart);
    unitDone = countUnit(habit, days, u.start, today).done;
  }
  if (status === "done" || status === "rest") bucket = "done";
  else if (isPeriodic(habit)) bucket = unitDone >= times ? "notDue" : "due";
  else bucket = isPlannedDay(habit, today) ? "due" : "notDue";
  const type = habit.schedule?.type;
  return { bucket, status, value: e && !e.rest ? e.value | 0 : 0, unitDone, times, streak, unitWord: type === "weekly" ? "week" : type === "monthly" ? "month" : "day", comebackNow };
}

/** Today "N left": Due bolumundeki satir sayisi (halka rozeti, alt satir ve DUE TODAY basligi bunu kullanir). rows: todayRow ciktilari. */
export const leftToday = (rows) => rows.filter((r) => r.bucket === "due").length;

/** Isaret sonrasi bildirim: bu degisiklik yeni bir geri donus yarattiysa numarasi, yoksa 0. */
export function comebackCreated(habit, before, after, today, weekStart = 1) {
  const a = comebacks(unitOutcomes(habit, before, today, weekStart)).count;
  const b = comebacks(unitOutcomes(habit, after, today, weekStart)).count;
  return b > a ? b : 0;
}

/** Yil istatistikleri (tek aliskanlik ya da hepsi). */
export function yearStats(habits, idx, year, today, weekStart = 1) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const asOf = minIso(today, to);
  const inYear = (u) => yearOf(u.start) === year;
  let num = 0, den = 0, cbs = 0, restDays = 0;
  let best = { n: 0, unit: "day" }, cur = { n: 0, unit: "day" };
  const rows = [];
  for (const h of habits) {
    const days = habitDays(idx, h);
    const r = rate(h, days, from, to, today, weekStart);
    const outs = asOf >= from ? unitOutcomes(h, days, asOf, weekStart) : [];
    const b = bestStreak(outs, inYear);
    const c = from <= today ? currentStreak(outs) : 0;
    const cb = comebacks(outs, inYear).count;
    let rd = 0;
    for (const [d, e] of days) if (e.rest && yearOf(d) === year) rd++;
    const unit = h.schedule?.type === "weekly" ? "week" : h.schedule?.type === "monthly" ? "month" : "day";
    rows.push({ habit: h, rate: r.pct, num: r.num, den: r.den, best: b, current: c, comebacks: cb, rest: rd, unit });
    num += r.num; den += r.den; cbs += cb; restDays += rd;
    if (b > best.n || (b === best.n && unit === "day" && best.unit !== "day")) best = { n: b, unit };
    if (c > cur.n) cur = { n: c, unit };
  }
  return { score: den ? (num * 100) / den : null, best, current: cur, comebacks: cbs, restDays, rows };
}

/** Year ekraninin varsayilan yili (spec §5): her zaman bugunun yili; kullanici sectiyse o. */
export function defaultYear(today, viewYear = null) {
  if (Number.isInteger(viewYear)) return viewYear;
  return yearOf(today);
}

/** Yil secici araligi: en eski kayit / olusturma yili .. bugunun yili + 1. */
export function yearRange(habits, entries, today) {
  let lo = yearOf(today);
  for (const h of habits) if (h.createdOn) lo = Math.min(lo, yearOf(h.createdOn));
  for (const e of entries) lo = Math.min(lo, yearOf(e.date));
  return { min: Math.min(lo, 2027), max: Math.max(yearOf(today) + 1, 2027) };
}

/** Ay ozeti satiri: { done, den, pct } ayin baslangicindan min(bugun, ay sonu)'na. */
export function monthSummary(habit, days, key, today, weekStart = 1) {
  const a = `${key}-01`;
  const p = parts(a);
  const b = isoOf(p.y, p.m, daysInMonth(p.y, p.m));
  return rate(habit, days, a, b, today, weekStart);
}
