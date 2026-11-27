// Banka CSV ice aktarma PLANI (saf). Satir okuma ve dosya ici tekrar kurali IET csv.js'ten DEGISTIRILMEDEN gelir (planImport):
// dosyadaki ayni gun / ayni tutar / ayni aciklamali iki satir iki gercek harcamadir, ikisi de alinir.
// Ek gruplar (spec dbp-010):
//  - "Maybe already entered": CSV DISI bir kayitla (elle, fatura, kumbara, maas) ayni tur + tutar, tarih ±3 gun, aciklama farkli.
//    Varsayilan ALINMAZ; eslesme bire bir tuketilir (dosyada 2 kahve, elle 1 kahve -> 1 supheli + 1 yeni).
//  - "Pays a bill": odenmemis bir fatura olusumuyla ayni tutar, vade ±5 gun. Baglaninca olusum odendi sayilir (iki kez dusulmez).
import { addDays, diffDays } from "../../../core/dates.js";
import { dupKey, planImport } from "./csv.js";
import { billOccurrences } from "./schedule.js";
import { occKey, paidMap } from "./engine.js";

export const MAX_IMPORT_COLS = 100;
export const MAX_IMPORT_CELL = 2000;
/** Banka dokumu degil (sekmeyi kilitleyecek genislik): baslik 100 sutundan fazla ya da bir hucre 2000 karakterden uzun. */
export const csvTooWide = (rows) => rows.some((r) => r.length > MAX_IMPORT_COLS || r.some((c) => c.length > MAX_IMPORT_CELL));
/** Son esleme hatirlatmasi icin kisa baslik imzasi: sutun sayisi + FNV-1a 32 bit karma (baslik metni ayarlara yazilmaz). */
export function headerSig(head) {
  let x = 0x811c9dc5;
  for (const c of head) {
    const s = `${c.length}:${c}`; // uzunluk onekli: "a|b","c" ile "a","b|c" ayni imzayi vermez
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  }
  return `${head.length}:${x.toString(16).padStart(8, "0")}`;
}

const asExisting = (t) => ({ date: t.date, amount: t.amountMinor, type: t.type, party: t.note ?? "" });

export function planBankImport({ items, transactions, bills }) {
  const real = transactions.filter((t) => t.type === "expense" || t.type === "income");
  const { fresh, dups } = planImport(items, real.map(asExisting));
  // Supheli havuzu: CSV disi kayitlar. Birebir eslesen (dup) satirlarin tukettigi kayit havuzdan dusulur.
  const pool = real.filter((t) => t.source !== "csv");
  for (const d of dups) {
    const k = dupKey(d.date, d.amountMinor, d.type, d.description);
    const i = pool.findIndex((t) => dupKey(t.date, t.amountMinor, t.type, t.note ?? "") === k);
    if (i >= 0) pool.splice(i, 1);
  }
  const maybe = [];
  const plain = [];
  for (const it of fresh) {
    let best = -1, bestGap = 99;
    pool.forEach((t, i) => {
      if (t.type !== it.type || t.amountMinor !== it.amountMinor) return;
      const gap = Math.abs(diffDays(t.date, it.date));
      if (gap <= 3 && gap < bestGap) { best = i; bestGap = gap; }
    });
    if (best >= 0) { maybe.push({ ...it, match: pool[best] }); pool.splice(best, 1); }
    else plain.push(it);
  }
  // Fatura eslemesi: odenmemis olusumlar, her olusum bir kez.
  const paid = paidMap(transactions);
  const taken = new Set();
  const out = plain.map((it) => {
    if (it.type !== "expense") return { ...it, bill: null };
    let pick = null, gapBest = 99;
    for (const b of bills) {
      if (b.amountMinor !== it.amountMinor) continue;
      for (const due of billOccurrences(b, addDays(it.date, -5), addDays(it.date, 6))) {
        const key = occKey(b.id, due);
        const gap = Math.abs(diffDays(due, it.date));
        if (paid.has(key) || taken.has(key) || gap > 5) continue;
        if (gap < gapBest) { pick = { billId: b.id, due, name: b.name }; gapBest = gap; }
      }
    }
    if (pick) taken.add(occKey(pick.billId, pick.due));
    return { ...it, bill: pick };
  });
  return { fresh: out, dups, maybe };
}

/**
 * Secimlere gore yazilacak kayitlar. linkBills: baglanacak fatura satirlarinin line numaralari (Set); takeMaybe: alinacak supheli satirlar.
 */
export function importRecords(plan, { linkBills = new Set(), takeMaybe = new Set() } = {}, batchId = "") {
  const rec = (it, bill) => ({
    date: it.date, type: it.type, amountMinor: it.amountMinor, envelopeId: "", note: String(it.description ?? "").slice(0, 120),
    source: "csv", importBatch: batchId, ...(bill ? { billId: bill.billId, billDue: bill.due } : {}),
  });
  const out = [];
  for (const it of plan.fresh) out.push(rec(it, it.bill && linkBills.has(it.line) ? it.bill : null));
  for (const it of plan.maybe) if (takeMaybe.has(it.line)) out.push(rec(it, null));
  return out;
}
