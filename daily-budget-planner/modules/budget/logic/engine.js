// Onden bakan gunluk tutar motoru (spec §5). SAF: DOM, saat, Date.now() yok; "bugun" disaridan gelir. Tum ara degerler tamsayi kurus.
//   A = Bpre − B0 − R − E ;  R = max(0, max_k Σ_{j≤k} (O_j − I_j)), k = 1, 2 ;  gunluk = floor(A / D), artan kurus havuzda kalir.
// Her ekran ve basili belge bakiye / kalan tutarlari YALNIZ buradan alir (iki ayri formul yok).
import { diffDays, isIsoDate } from "../../../core/dates.js";
import { billOccurrences, payTimeline, paydaysUntil } from "./schedule.js";

const SPEND_SOURCES = new Set(["manual", "csv"]);
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);

/** Bakiye = baslangic + gelir − gider + duzeltme (yalniz date >= startDate). */
export function balanceOf(plan, transactions) {
  let b = plan.startBalanceMinor || 0;
  for (const t of transactions) {
    if (!isIsoDate(t.date) || t.date < plan.startDate) continue;
    if (t.type === "income") b += t.amountMinor;
    else if (t.type === "expense") b -= t.amountMinor;
    else if (t.type === "adjust") b += t.amountMinor;
  }
  return b;
}

/** Serbest harcama: elle ya da CSV ile girilmis, faturaya / kumbaraya bagli olmayan gider. */
export const isFreeSpend = (t) => t.type === "expense" && SPEND_SOURCES.has(t.source ?? "manual") && !t.billId && !t.fundId;

export const fundSaved = (fundMoves, fundId) => sum(fundMoves.filter((m) => m.fundId === fundId), (m) => m.amountMinor);
export const earmarkedOf = (funds, fundMoves) => sum(funds.filter((f) => !f.archived), (f) => Math.max(0, fundSaved(fundMoves, f.id)));

export const occKey = (billId, due) => `${billId}|${due}`;
export function paidMap(transactions) {
  const m = new Map();
  for (const t of transactions) if (t.billId && t.billDue && t.type === "expense") m.set(occKey(t.billId, t.billDue), t);
  return m;
}

/** Kumbaranin bir donemdeki payi. remainingPeriods: o donem dahil hedef tarihe kadarki donem sayisi (en az 1). */
export function fundShare(fund, savedMinor, remainingPeriods) {
  if (fund.archived) return 0;
  const target = fund.targetMinor || 0;
  const left = target > 0 ? Math.max(0, target - savedMinor) : Infinity;
  if (left === 0) return 0;
  if (fund.mode === "toDate") {
    if (!(target > 0)) return 0;
    const n = Math.max(1, remainingPeriods | 0);
    return Math.ceil(left / n);
  }
  const per = fund.perPeriodMinor || 0;
  return Math.max(0, Math.min(per, left));
}

/** Donem basi startIso icin kumbara payi (hedef tarihe kadar kalan donem sayisi takvimden sayilir). */
export function fundShareAt(fund, savedMinor, startIso, plan, timeline) {
  let n = 1;
  if (fund.mode === "toDate" && isIsoDate(fund.targetDate) && startIso <= fund.targetDate) {
    n = 1 + paydaysUntil(plan, timeline, fund.targetDate).filter((d) => d > startIso).length; // bu donem + hedef tarihe kadarki donem baslari
  }
  return fundShare(fund, savedMinor, n);
}

/**
 * Donemler ve fatura olusumlari. bounds = [P0 basi, N, N1, N2, N3]; idx 0 = bu donem (vadesi gecmisler dahil), 1, 2 = ufuk, 3 = sonrasi.
 * payFrom "earlier": bir onceki donemden odenir. Kurulum gununden (startDate) onceki vadeler hesaba girmez.
 */
export function periodBills(state, timeline) {
  const { payPlan: plan, bills, transactions } = state;
  const b = [timeline.periodStart, timeline.next, ...timeline.after];
  const paid = paidMap(transactions);
  const from = plan.startDate < b[0] ? plan.startDate : b[0];
  const idxOf = (d) => (d < b[1] ? 0 : d < b[2] ? 1 : d < b[3] ? 2 : d < b[4] ? 3 : 4);
  const out = [];
  for (const bill of bills) {
    for (const due of billOccurrences(bill, from, b[4])) {
      const natural = idxOf(due);
      const idx = Math.max(0, bill.payFrom === "earlier" ? natural - 1 : natural);
      const tx = paid.get(occKey(bill.id, due));
      out.push({ bill, due, idx, natural, paid: Boolean(tx), paidTx: tx ?? null, amountMinor: bill.amountMinor, overdue: false });
    }
  }
  out.sort((x, y) => (x.due < y.due ? -1 : x.due > y.due ? 1 : x.bill.name < y.bill.name ? -1 : 1));
  return { bounds: b, occurrences: out };
}

/**
 * dailyAmount(state, todayIso) -> sonuc nesnesi (spec §5). state: { payPlan, transactions, bills, funds, fundMoves }.
 */
export function dailyAmount(state, todayIso) {
  const plan = state.payPlan;
  const tx = state.transactions ?? [];
  const funds = state.funds ?? [];
  const moves = state.fundMoves ?? [];
  const tl = payTimeline(plan, tx, todayIso);
  const late = tl.late;
  const balance = balanceOf(plan, tx);
  const spentToday = sum(tx.filter((t) => t.date === todayIso && isFreeSpend(t)), (t) => t.amountMinor);
  const bpre = balance + spentToday;

  const { bounds, occurrences } = periodBills({ ...state, transactions: tx, bills: state.bills ?? [] }, tl);
  const unpaid = occurrences.filter((o) => !o.paid && o.due >= plan.startDate);
  const now = unpaid.filter((o) => o.idx === 0);
  const b0 = sum(now, (o) => o.amountMinor);

  // Kumbara paylari (ufuk projeksiyonu: 1. donem payi birikime eklenir, 2. donem payi ona gore).
  const active = funds.filter((f) => !f.archived);
  const saved = new Map(active.map((f) => [f.id, Math.max(0, fundSaved(moves, f.id))]));
  const fundsPer = [0, 0, 0];
  for (const k of [1, 2]) {
    for (const f of active) {
      const s = fundShareAt(f, saved.get(f.id), bounds[k], plan, tl);
      fundsPer[k] += s;
      saved.set(f.id, saved.get(f.id) + s);
    }
  }
  const income = plan.amountMinor || 0;
  const O = [0, 1, 2].map((k) => (k === 0 ? 0 : sum(unpaid.filter((o) => o.idx === k), (o) => o.amountMinor) + fundsPer[k]));
  let cum = 0, R = 0, firstShortK = 0;
  for (const k of [1, 2]) {
    cum += O[k] - income;
    if (cum > 0 && !firstShortK) firstShortK = k;
    if (cum > R) R = cum;
  }
  const E = earmarkedOf(funds, moves);
  const A = bpre - b0 - R - E;
  const D = late ? 1 : Math.max(1, diffDays(todayIso, tl.next));

  let status = "ok", dailyMinor = 0, shortMinor = 0;
  if (A >= 0) dailyMinor = Math.floor(A / D);
  else { status = "short"; shortMinor = -A; }
  if (late) status = "late";
  else if (A >= 0 && R > 0) status = "reserve";

  let reason;
  const est = tl.nextEstimated || plan.frequency === "irregular";
  if (late) reason = { key: "late", params: { date: tl.next } };
  else if (A < 0) reason = { key: "short", params: { amount: shortMinor, date: tl.next } };
  else if (R > 0) {
    const inK = unpaid.filter((o) => o.idx === firstShortK).sort((x, y) => y.amountMinor - x.amountMinor || (x.due < y.due ? -1 : 1));
    const top = inK[0];
    reason = { key: "reserve", params: { amount: R, date: bounds[firstShortK], bill: top ? top.bill.name : "", due: top ? top.due : "" } };
  } else reason = { key: "ok", params: { amount: b0, count: now.length, date: tl.next } };
  reason.estimated = est;

  return {
    status, dailyMinor, leftTodayMinor: dailyMinor - spentToday, daysLeft: D, late,
    billsDueMinor: b0, billsDueCount: now.length, reserveMinor: R, earmarkedMinor: E, availableMinor: A, shortMinor,
    balanceMinor: balance, startOfDayMinor: bpre, spentTodayMinor: spentToday, poolMinor: A >= 0 ? A - dailyMinor * D : 0,
    periodStart: tl.periodStart, nextPay: tl.next, after: tl.after, estimated: est, reserveK: firstShortK,
    horizon: { O, I: income, fundsPer }, reason,
  };
}

/** Bu donemdeki zarf harcamasi (serbest + kumbara disi gider). */
export function envelopeSpent(transactions, envelopeId, fromIso, toIso) {
  return sum(transactions.filter((t) => t.type === "expense" && !t.billId && (t.envelopeId || "") === envelopeId && t.date >= fromIso && t.date < toIso), (t) => t.amountMinor);
}

/** Donem boyunca serbest harcanabilir toplam: bu sabahki kullanilabilir tutar + donem icinde bugunden once yapilan serbest harcama. */
export function spendableThisPeriod(state, result, todayIso) {
  return result.availableMinor + sum((state.transactions ?? []).filter((t) => isFreeSpend(t) && t.date >= result.periodStart && t.date < todayIso), (t) => t.amountMinor);
}

/** Bakiye mutabakati: bankanin soyledigi - uygulamadaki. 0 ise kayit yazilmaz. */
export const reconcileDiff = (plan, transactions, bankMinor) => bankMinor - balanceOf(plan, transactions);
