// Veri degistiren islemler. Hepsi deponun TEK kilidinde (transactMany) calisir: iki sekme ayni anda bassa da
// ayni maas iki kez onaylanmaz, ayni fatura olusumu iki kez odenmez, ayni donemin kumbara payi iki kez yazilmaz.
import { PRESET_ENVELOPES, assertBill, assertPlan, assertTransaction, isAmount, ValidationError } from "./schema.js";
import { payTimeline } from "./schedule.js";
import { balanceOf, fundSaved, fundShareAt } from "./engine.js";
import { sampleData } from "./sample.js";
import { diffDays } from "../../../core/dates.js";

const ALL = ["payPlan", "transactions", "bills", "envelopes", "funds", "fundMoves", "prefs"];
export const DEFAULT_PREFS = Object.freeze({ id: "prefs", theme: "dark", lang: "en", currency: "USD", locale: "en-US", paper: "letter", backupEveryDays: 7, lastBackupAt: "", lastImportAt: "", lastImportMap: null, recentEnvelopes: [], seeded: false });

export async function loadState(store) {
  const [payPlan, transactions, bills, envelopes, funds, fundMoves, prefs] = await Promise.all(ALL.map((n) => store.list(n)));
  return { payPlan: payPlan[0] ?? null, transactions, bills, envelopes: [...envelopes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), funds, fundMoves, prefs: { ...DEFAULT_PREFS, ...(prefs[0] ?? {}) } };
}

const setSingle = (tx, name, rec) => {
  const cur = tx.list(name)[0];
  if (cur) return tx.update(name, cur.id, rec);
  return tx.add(name, rec);
};

/** Ilk acilis: varsayilan ayarlar + 8 hazir zarf (bir kez). */
export async function ensureSeed(store, initialPrefs = {}) {
  return store.transactMany(["prefs", "envelopes"], (tx) => {
    const p = tx.list("prefs")[0];
    if (p && p.seeded) return false;
    const have = new Set(tx.list("envelopes").map((e) => e.presetId).filter(Boolean));
    PRESET_ENVELOPES.forEach((e, i) => { if (!have.has(e.id)) tx.add("envelopes", { presetId: e.id, name: "", icon: e.icon, limitPerPeriodMinor: 0, order: i, hidden: false }); });
    setSingle(tx, "prefs", { ...DEFAULT_PREFS, ...(p ?? {}), ...initialPrefs, seeded: true });
    return true;
  });
}

export async function savePrefs(store, patch) {
  return store.transactMany(["prefs"], (tx) => setSingle(tx, "prefs", { ...DEFAULT_PREFS, ...(tx.list("prefs")[0] ?? {}), ...patch }));
}

export async function savePlan(store, plan) {
  assertPlan(plan);
  return store.transactMany(["payPlan"], (tx) => setSingle(tx, "payPlan", { sample: false, ...plan })); // kurulumda kullanicinin plani ornek sayilmaz
}

export const envelopeIdOf = (e) => e.presetId || e.id;

export async function addExpense(store, { amountMinor, envelopeId = "", date, note = "" }) {
  const rec = assertTransaction({ date, type: "expense", amountMinor, envelopeId, note: String(note).slice(0, 120), source: "manual" });
  return store.transactMany(["transactions", "prefs"], (tx) => {
    const added = tx.add("transactions", rec);
    if (envelopeId) {
      const p = { ...DEFAULT_PREFS, ...(tx.list("prefs")[0] ?? {}) };
      setSingle(tx, "prefs", { ...p, recentEnvelopes: [envelopeId, ...(p.recentEnvelopes ?? []).filter((x) => x !== envelopeId)].slice(0, 6) });
    }
    return added;
  });
}

export async function updateTransaction(store, id, patch) {
  return store.transactMany(["transactions"], (tx) => {
    const cur = tx.get("transactions", id);
    if (!cur) throw new ValidationError("not_found", "Record not found.");
    const next = assertTransaction({ ...cur, ...patch });
    return tx.update("transactions", id, next);
  });
}

export async function removeTransaction(store, id) {
  return store.transactMany(["transactions", "fundMoves"], (tx) => {
    for (const m of tx.list("fundMoves").filter((m) => m.transactionId === id)) tx.remove("fundMoves", m.id); // kumbaradan harcama geri alinir
    return tx.remove("transactions", id);
  });
}

export async function markBillPaid(store, billId, due, today) {
  return store.transactMany(["transactions", "bills"], (tx) => {
    const bill = tx.get("bills", billId);
    if (!bill) throw new ValidationError("not_found", "Bill not found.");
    if (tx.list("transactions").some((t) => t.billId === billId && t.billDue === due)) return null; // ayni olusum iki kez odenmez
    return tx.add("transactions", assertTransaction({ date: today, type: "expense", amountMinor: bill.amountMinor, envelopeId: "", note: bill.name.slice(0, 120), source: "bill", billId, billDue: due }));
  });
}

export async function unmarkBillPaid(store, billId, due) {
  return store.transactMany(["transactions"], (tx) => {
    const hit = tx.list("transactions").filter((t) => t.billId === billId && t.billDue === due);
    for (const t of hit) tx.remove("transactions", t.id);
    return hit.length;
  });
}

/** Maas geldi: gelir kaydi (source pay) + yeni donemin kumbara paylari. Ayni beklenen tarih icin ikinci kez yazilmaz. */
export async function confirmPay(store, { payFor, amountMinor, today }) {
  if (!isAmount(amountMinor)) throw new ValidationError("bad_amount", "Amount must be more than 0.");
  return store.transactMany(["transactions", "fundMoves", "funds", "payPlan"], (tx) => {
    const list = tx.list("transactions");
    if (list.some((t) => t.source === "pay" && t.payFor === payFor)) return false;
    const plan = tx.list("payPlan")[0];
    // Bankadan (CSV) zaten gelmis ayni tutarli, beklenen tarihe en cok 3 gun uzak gelir varsa ikinci gelir yazilmaz; o kayit maasa baglanir.
    let csvPay = null, gapBest = 4;
    for (const t of list) {
      if (t.source !== "csv" || t.type !== "income" || t.payFor || t.amountMinor !== amountMinor) continue;
      const gap = Math.abs(diffDays(t.date, payFor));
      if (gap < gapBest) { csvPay = t; gapBest = gap; }
    }
    if (csvPay) tx.update("transactions", csvPay.id, assertTransaction({ ...csvPay, source: "pay", payFor }));
    else tx.add("transactions", assertTransaction({ date: today, type: "income", amountMinor, envelopeId: "", note: "", source: "pay", payFor }));
    const tl = payTimeline(plan, tx.list("transactions"), today);
    const moves = tx.list("fundMoves");
    for (const f of tx.list("funds").filter((f) => !f.archived)) {
      if (moves.some((m) => m.fundId === f.id && m.kind === "auto" && m.period === payFor)) continue;
      const share = fundShareAt(f, Math.max(0, fundSaved(moves, f.id)), payFor, plan, tl);
      if (share > 0) tx.add("fundMoves", { fundId: f.id, date: today, amountMinor: share, kind: "auto", period: payFor });
    }
    if (plan.nextOverride && plan.nextOverride <= payFor) tx.update("payPlan", plan.id, { nextOverride: "" }); // gecmise dusen tek seferlik tarih temizlenir
    return true;
  });
}

export async function saveBill(store, id, fields) {
  const rec = assertBill({ kind: "bill", payFrom: "auto", active: true, endDate: "", everyN: 2, ...fields, name: String(fields.name ?? "").trim() });
  return store.transactMany(["bills"], (tx) => (id ? tx.update("bills", id, rec) : tx.add("bills", rec)));
}
export const removeBill = (store, id) => store.transactMany(["bills"], (tx) => tx.remove("bills", id));

export async function saveEnvelope(store, id, { name, icon, limitPerPeriodMinor }) {
  if (!(Number.isSafeInteger(limitPerPeriodMinor) && limitPerPeriodMinor >= 0)) throw new ValidationError("bad_amount", "Limit must be 0 or more.");
  return store.transactMany(["envelopes"], (tx) => {
    if (id) return tx.update("envelopes", id, { ...(name !== undefined ? { name: String(name).slice(0, 40) } : {}), ...(icon ? { icon } : {}), limitPerPeriodMinor });
    if (!String(name ?? "").trim()) throw new ValidationError("bad_name", "Name is required.");
    const order = Math.max(0, ...tx.list("envelopes").map((e) => e.order ?? 0)) + 1;
    return tx.add("envelopes", { presetId: "", name: String(name).trim().slice(0, 40), icon: icon || "tag", limitPerPeriodMinor, order, hidden: false });
  });
}

/** Hazir zarf silinmez, gizlenir. Ozel zarf silinince harcamalari "Other"a tasinir. */
export async function deleteEnvelope(store, id) {
  return store.transactMany(["envelopes", "transactions"], (tx) => {
    const e = tx.get("envelopes", id);
    if (!e) return false;
    if (e.presetId) { tx.update("envelopes", id, { hidden: true }); return "hidden"; }
    for (const t of tx.list("transactions").filter((t) => t.envelopeId === id)) tx.update("transactions", t.id, { envelopeId: "other" });
    tx.remove("envelopes", id);
    return "deleted";
  });
}
export const showEnvelope = (store, id) => store.transactMany(["envelopes"], (tx) => tx.update("envelopes", id, { hidden: false }));

export async function saveFund(store, id, fields) {
  const rec = { name: String(fields.name ?? "").trim().slice(0, 40), targetMinor: fields.targetMinor | 0, targetDate: fields.targetDate || "", mode: fields.mode === "toDate" ? "toDate" : "fixed", perPeriodMinor: fields.perPeriodMinor | 0, archived: false };
  if (!rec.name) throw new ValidationError("bad_name", "Name is required.");
  if (rec.mode === "toDate" && !(rec.targetMinor > 0 && rec.targetDate)) throw new ValidationError("bad_target", "A goal and a date are needed.");
  if (rec.mode === "fixed" && !(rec.perPeriodMinor > 0)) throw new ValidationError("bad_amount", "Amount each payday must be more than 0.");
  return store.transactMany(["funds"], (tx) => (id ? tx.update("funds", id, rec) : tx.add("funds", rec)));
}

export async function addToFund(store, fundId, amountMinor, date) {
  if (!isAmount(amountMinor)) throw new ValidationError("bad_amount", "Amount must be more than 0.");
  return store.transactMany(["fundMoves"], (tx) => tx.add("fundMoves", { fundId, date, amountMinor, kind: "manual" }));
}

/** Kumbaradan harcama: gider + eksi hareket. Bakiye de ayrilan para da ayni tutar duser -> gunluk tutar DEGISMEZ. */
export async function spendFromFund(store, fundId, { amountMinor, date, note = "", envelopeId = "" }) {
  const rec = assertTransaction({ date, type: "expense", amountMinor, envelopeId, note: String(note).slice(0, 120), source: "fund", fundId });
  return store.transactMany(["transactions", "fundMoves", "funds"], (tx) => {
    const f = tx.get("funds", fundId);
    if (!f) throw new ValidationError("not_found", "Fund not found.");
    const saved = fundSaved(tx.list("fundMoves"), fundId);
    if (amountMinor > saved) throw new ValidationError("over_fund", "That is more than this fund holds.");
    const t = tx.add("transactions", rec);
    tx.add("fundMoves", { fundId, date, amountMinor: -amountMinor, kind: "spend", transactionId: t.id });
    return t;
  });
}

export async function archiveFund(store, fundId, date) {
  return store.transactMany(["funds", "fundMoves"], (tx) => {
    const saved = fundSaved(tx.list("fundMoves"), fundId);
    if (saved !== 0) tx.add("fundMoves", { fundId, date, amountMinor: -saved, kind: "release" });
    return tx.update("funds", fundId, { archived: true });
  });
}

/** "My bank says": fark != 0 ise TEK duzeltme kaydi. Doner: yazilan fark (0 = zaten esit). */
export async function reconcile(store, bankMinor, today) {
  if (!Number.isSafeInteger(bankMinor)) throw new ValidationError("bad_amount", "Enter the balance your bank shows.");
  return store.transactMany(["transactions", "payPlan"], (tx) => {
    const plan = tx.list("payPlan")[0];
    const diff = bankMinor - balanceOf(plan, tx.list("transactions"));
    if (diff === 0) return 0;
    tx.add("transactions", assertTransaction({ date: today < plan.startDate ? plan.startDate : today, type: "adjust", amountMinor: diff, envelopeId: "", note: "", source: "reconcile" }));
    return diff;
  });
}

export async function importTransactions(store, records, map, nowIso) {
  for (const r of records) assertTransaction(r);
  return store.transactMany(["transactions", "prefs"], (tx) => {
    for (const r of records) tx.add("transactions", r);
    setSingle(tx, "prefs", { ...DEFAULT_PREFS, ...(tx.list("prefs")[0] ?? {}), lastImportAt: nowIso, lastImportMap: map ?? null });
    return records.length;
  });
}

/** Dil degisti: kullanicinin DOKUNMADIGI ornek kayit adlari (sample: true ve eski dildeki ornek metniyle ayni) yeni dile cevrilir.
 *  from / to: { anahtar: metin } sozlukleri. Kullanicinin kendi kayitlari ve duzenledigi ornek adlari degismez. */
export async function relocalizeSample(store, from, to) {
  const keys = Object.keys(to).filter((k) => k.startsWith("sample.") && typeof from[k] === "string");
  const map = new Map(keys.map((k) => [from[k], to[k]]));
  const fields = { bills: "name", funds: "name", transactions: "note" };
  return store.transactMany(Object.keys(fields), (tx) => {
    let n = 0;
    for (const [name, f] of Object.entries(fields)) {
      for (const r of tx.list(name)) {
        if (!r.sample || !map.has(r[f]) || map.get(r[f]) === r[f]) continue;
        tx.update(name, r.id, { [f]: map.get(r[f]) }); n++;
      }
    }
    return n;
  });
}

/** Ornek veri: mevcut kayitlara dokunmaz (maas plani yoksa ornek plan kurulur). */
export async function loadSample(store, kind, today, t) {
  const s = sampleData(kind, today, t);
  return store.transactMany(ALL, (tx) => {
    const plan = tx.list("payPlan")[0];
    if (!plan || !plan.setupDone || plan.sample) setSingle(tx, "payPlan", s.payPlan);
    for (const r of s.transactions) tx.add("transactions", r);
    for (const b of s.bills) tx.add("bills", b);
    const fundIds = s.funds.map((f) => tx.add("funds", f).id);
    for (const m of s.fundMoves) tx.add("fundMoves", { fundId: fundIds[m.fund], date: m.date, amountMinor: m.amountMinor, kind: m.kind, ...(m.period ? { period: m.period } : {}), sample: true });
    for (const e of tx.list("envelopes")) {
      const lim = s.envelopeLimits[e.presetId];
      if (lim && !e.limitPerPeriodMinor) tx.update("envelopes", e.id, { limitPerPeriodMinor: lim, sampleLimit: true });
    }
    return true;
  });
}

export async function removeSample(store) {
  return store.transactMany(ALL, (tx) => {
    let n = 0;
    for (const name of ["transactions", "bills", "funds", "fundMoves"]) for (const r of tx.list(name).filter((r) => r.sample)) { tx.remove(name, r.id); n += 1; }
    const fundIds = new Set(tx.list("funds").map((f) => f.id));
    for (const m of tx.list("fundMoves").filter((m) => !fundIds.has(m.fundId))) tx.remove("fundMoves", m.id);
    for (const e of tx.list("envelopes").filter((e) => e.sampleLimit)) tx.update("envelopes", e.id, { limitPerPeriodMinor: 0, sampleLimit: false });
    const plan = tx.list("payPlan")[0];
    if (plan && plan.sample) tx.remove("payPlan", plan.id);
    return n;
  });
}

export const hasSample = (state) => ["transactions", "bills", "funds"].some((n) => state[n].some((r) => r.sample)) || Boolean(state.payPlan && state.payPlan.sample);
