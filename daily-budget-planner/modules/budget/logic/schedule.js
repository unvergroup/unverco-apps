// Maas takvimi ve fatura olusumlari (saf; DOM, saat, Date.now() yok). Tarih = yerel ISO "YYYY-MM-DD".
// Donem = bir maas gununden (dahil) bir sonraki maas gunune (haric). Takvim ayi kullanilmaz.
import { addDays, addMonths, daysInMonth, diffDays, isIsoDate, parseIso, toIso } from "../../../core/dates.js";

const clampDay = (y, m, d) => toIso(y, m, Math.min(Math.max(1, d), daysInMonth(y, m)));
const monthDays = (plan, y, m) => {
  const days = plan.frequency === "semimonthly" ? (Array.isArray(plan.semiDays) && plan.semiDays.length === 2 ? plan.semiDays : [1, 15]) : [plan.monthDay || 1];
  return [...new Set(days.map((d) => clampDay(y, m, Number(d) || 1)))].sort(); // ayni gune dusen iki gun tek maas
};
const stepOf = (f) => (f === "weekly" ? 7 : f === "biweekly" ? 14 : 0);

/** afterIso'dan SONRAKI (haric) count tane duzenli maas gunu. irregular icin bos dizi. */
export function regularAfter(plan, afterIso, count = 1) {
  const out = [];
  const step = stepOf(plan.frequency);
  if (step) {
    if (!isIsoDate(plan.anchorDate)) return out;
    let k = Math.floor(diffDays(plan.anchorDate, afterIso) / step) + 1;
    while (out.length < count) { out.push(addDays(plan.anchorDate, k * step)); k += 1; }
    return out;
  }
  if (plan.frequency !== "semimonthly" && plan.frequency !== "monthly") return out;
  const p = parseIso(afterIso);
  let y = p.year, m = p.month;
  for (let guard = 0; out.length < count && guard < 1200; guard += 1) {
    for (const d of monthDays(plan, y, m)) if (d > afterIso && out.length < count) out.push(d);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** iso'ya esit ya da ondan onceki en yakin duzenli maas gunu (yoksa ""). */
export function regularOnOrBefore(plan, iso) {
  const step = stepOf(plan.frequency);
  if (step) {
    if (!isIsoDate(plan.anchorDate)) return "";
    return addDays(plan.anchorDate, Math.floor(diffDays(plan.anchorDate, iso) / step) * step);
  }
  if (plan.frequency !== "semimonthly" && plan.frequency !== "monthly") return "";
  const p = parseIso(iso);
  let y = p.year, m = p.month;
  for (let guard = 0; guard < 1200; guard += 1) {
    const hit = monthDays(plan, y, m).filter((d) => d <= iso);
    if (hit.length) return hit[hit.length - 1];
    m -= 1; if (m < 1) { m = 12; y -= 1; }
  }
  return "";
}

/** Duzensiz maasta donem uzunlugu: son iki gercek maas arasi gun (yoksa 14), 7-31 arasina sikistirilir. */
export function irregularInterval(payDates) {
  const s = [...payDates].sort();
  if (s.length < 2) return 14;
  return Math.min(31, Math.max(7, diffDays(s[s.length - 2], s[s.length - 1])));
}

/** Onaylanmis maaslar (source "pay") -> karsiladiklari beklenen tarih listesi (artan). */
export const confirmedPayDates = (transactions) =>
  transactions.filter((t) => t.source === "pay" && isIsoDate(t.payFor)).map((t) => t.payFor).sort();

/**
 * Donem ve ufuk. -> { periodStart, next (N), after: [N1, N2, N3], estimated, late }
 * - periodStart: son onaylanan maas (yoksa kurulum gununde ya da oncesindeki son duzenli maas; duzensizde kurulum gunu).
 * - nextOverride yalniz BIR SONRAKI tarihi degistirir; gecmise dustuyse (periodStart'tan once/esit) yok sayilir.
 * - late: bugun >= N ve N icin maas onaylanmadi (donem degismez).
 */
export function payTimeline(plan, transactions, today) {
  const pays = confirmedPayDates(transactions);
  const irregular = plan.frequency === "irregular";
  let periodStart = irregular ? plan.startDate : regularOnOrBefore(plan, plan.startDate) || plan.startDate;
  if (pays.length && pays[pays.length - 1] > periodStart) periodStart = pays[pays.length - 1];
  const override = isIsoDate(plan.nextOverride) && plan.nextOverride > periodStart ? plan.nextOverride : "";
  let next, after, estimated = false;
  if (irregular) {
    const step = irregularInterval(pays);
    next = override || addDays(periodStart, step);
    after = [1, 2, 3].map((k) => addDays(next, k * step));
    estimated = true; // ufuktaki donemler her zaman tahmin
  } else {
    const replaced = regularAfter(plan, periodStart, 1)[0];
    next = override || replaced;
    after = regularAfter(plan, next > replaced ? next : replaced, 3);
  }
  return { periodStart, next, after, estimated, nextEstimated: irregular && !override, late: today >= next };
}

/** N'den baslayarak untilIso'ya kadar (dahil) maas gunleri: [N, N1, N2, ...]. cap: guvenlik siniri. */
export function paydaysUntil(plan, timeline, untilIso, cap = 600) {
  const out = [];
  if (timeline.next > untilIso) return out;
  out.push(timeline.next);
  if (plan.frequency === "irregular") {
    const step = diffDays(timeline.next, timeline.after[0]) || 14;
    let d = addDays(timeline.next, step);
    while (d <= untilIso && out.length < cap) { out.push(d); d = addDays(d, step); }
    return out;
  }
  let last = timeline.after[0];
  while (last && last <= untilIso && out.length < cap) {
    out.push(last);
    last = regularAfter(plan, last, 1)[0];
  }
  return out;
}

// ---- Fatura olusumlari ------------------------------------------------------------------------------

/** Faturanin [fromIso, toIso) araligindaki vade tarihleri (artan). Aylik vade olmayan gunde ayin son gunune kayar. */
export function billOccurrences(bill, fromIso, toIso) {
  const out = [];
  if (!bill || bill.active === false || !isIsoDate(bill.firstDue) || fromIso >= toIso) return out;
  const end = isIsoDate(bill.endDate) ? bill.endDate : "";
  const ok = (d) => d >= fromIso && d < toIso && d >= bill.firstDue && (!end || d <= end);
  if (bill.repeat === "once") { if (ok(bill.firstDue)) out.push(bill.firstDue); return out; }
  const step = bill.repeat === "weekly" ? 7 : bill.repeat === "biweekly" ? 14 : 0;
  if (step) {
    let k = Math.max(0, Math.floor(diffDays(bill.firstDue, fromIso) / step));
    for (let d = addDays(bill.firstDue, k * step); d < toIso && (!end || d <= end); k += 1, d = addDays(bill.firstDue, k * step)) if (ok(d)) out.push(d);
    return out;
  }
  const n = bill.repeat === "everyNMonths" ? Math.min(12, Math.max(2, bill.everyN || 2)) : 1;
  const f = parseIso(bill.firstDue), s = parseIso(fromIso);
  const monthsGap = (s.year - f.year) * 12 + (s.month - f.month);
  let k = Math.max(0, Math.floor((monthsGap - 1) / n));
  for (let guard = 0; guard < 2400; guard += 1, k += 1) {
    const d = addMonths(bill.firstDue, k * n); // her zaman ilk vadenin GUNUNDEN hesaplanir (31 -> 28/29 -> 31)
    if (d >= toIso || (end && d > end)) break;
    if (ok(d)) out.push(d);
  }
  return out;
}
