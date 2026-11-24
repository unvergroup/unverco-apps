// Is durumlari ve gecis kurallari (spec 3.3, KA-49..57). Saf islevler: DOM yok, ag yok; zaman parametreyle gelir.
// Gecis tablosu spec 3.3'teki 10 x 10 tablonun birebir kodlanmisidir (45 izinli gecis).

import { todayIso } from "../../../core/dates.js";
import { parseWarrantyDays, warrantyEnd } from "./aging.js";

export const STATUSES = Object.freeze([
  "received", "diagnosing", "awaiting_approval", "awaiting_part", "in_repair",
  "ready", "ready_unrepaired", "handed_over", "returned_unrepaired", "cancelled",
]);
/** Calisilan (hazir olmayan) acik durumlar: KA-50'deki "acik bes durum". */
export const WORKING_STATUSES = Object.freeze(STATUSES.slice(0, 5));
export const READY_STATUSES = Object.freeze(["ready", "ready_unrepaired"]);
export const CLOSED_STATUSES = Object.freeze(["handed_over", "returned_unrepaired", "cancelled"]);
export const HISTORY_MAX = 60;
export const CANCEL_REASON_MAX = 120;

// Satir = nereden, sutun = nereye (STATUSES sirasi). o dugme / menu · P yalniz Pickup · R Reopen (onayli) · C iptal (onayli) · - yok
const MATRIX = Object.freeze({
  received:            "-oooooo--C",
  diagnosing:          "o-ooooo--C",
  awaiting_approval:   "oo-oooo--C",
  awaiting_part:       "ooo-ooo--C",
  in_repair:           "oooo-oo--C",
  ready:               "----o-oP--",
  ready_unrepaired:    "--o-oo--P-",
  handed_over:         "-----R----",
  returned_unrepaired: "------R---",
  cancelled:           "R---------",
});
const KIND = { o: "move", P: "pickup", R: "reopen", C: "cancel" };

const LABELS = Object.freeze({
  en: { received: "Checked in", diagnosing: "Diagnosing", awaiting_approval: "Waiting for approval", awaiting_part: "Waiting for part", in_repair: "In repair", ready: "Ready for pickup", ready_unrepaired: "Ready – not repaired", handed_over: "Picked up", returned_unrepaired: "Returned unrepaired", cancelled: "Cancelled" },
  tr: { received: "Teslim alındı", diagnosing: "Arıza tespitinde", awaiting_approval: "Onay bekliyor", awaiting_part: "Parça bekliyor", in_repair: "Tamirde", ready: "Hazır", ready_unrepaired: "Hazır – tamir edilmedi", handed_over: "Teslim edildi", returned_unrepaired: "Tamirsiz iade edildi", cancelled: "İptal" },
});

export const isStatus = (s) => typeof s === "string" && STATUSES.includes(s);
export const isReady = (s) => READY_STATUSES.includes(s);
export const isClosed = (s) => CLOSED_STATUSES.includes(s);
/** Kapali olmayan her durum (hazir olanlar dahil) acik is sayilir. */
export const isOpen = (s) => isStatus(s) && !isClosed(s);

/** Locale anahtari (L0 sozlugu): repairs.status.<durum>. */
export const statusKey = (status) => `repairs.status.${status}`;

/**
 * Durum adi. lang "en" | "tr" (bilinmeyen -> en). Bilinmeyen durum -> "".
 * @param {string} status
 * @param {string} [lang]
 */
export function statusLabel(status, lang = "en") {
  if (!isStatus(status)) return "";
  return (LABELS[lang] ?? LABELS.en)[status];
}

/**
 * Gecisin turu: "move" | "pickup" | "reopen" | "cancel"; tabloda yoksa null.
 * UI "reopen" ve "cancel" icin onay ister; "pickup" yalniz Pickup ekranindadir.
 */
export function transitionKind(from, to) {
  const fi = STATUSES.indexOf(from);
  const ti = STATUSES.indexOf(to);
  if (fi < 0 || ti < 0) return null;
  return KIND[MATRIX[from][ti]] ?? null;
}

/**
 * Gecis izinli mi? "pickup" turu yalniz { via: "pickup" } ile.
 * @param {string} from
 * @param {string} to
 * @param {{ via?: string }} [opts]
 */
export function canTransition(from, to, opts) {
  const kind = transitionKind(from, to);
  if (!kind) return false;
  return kind === "pickup" ? opts?.via === "pickup" : true;
}
export const canMove = canTransition;

/**
 * Bir durumdan gidilebilecek hedefler, STATUSES sirasinda. "pickup" hedefleri yalniz { via: "pickup" } ile gelir.
 * Varsayilan: ready -> [in_repair, ready_unrepaired]; kapali durum -> yalniz Reopen hedefi.
 */
export function nextStatuses(from, opts) {
  return STATUSES.filter((to) => canTransition(from, to, opts));
}

function badTransition(from, to) {
  const e = new Error(`bad_transition: ${String(from)} -> ${String(to)}`);
  e.code = "bad_transition";
  return e;
}

const reasonText = (v) => (typeof v === "string" ? [...v.normalize("NFC").replace(/\s+/g, " ").trim()].slice(0, CANCEL_REASON_MAX).join("") : "");

/**
 * Durumu degistirir; girdiyi DEGISTIRMEZ, yeni is doner (spec 3.3 yan etkiler 1-7).
 * Izinsiz gecis -> code "bad_transition" olan Error. Gecersiz garanti -> code "bad_warranty".
 * @param {object} job
 * @param {string} to
 * @param {{ via?: "pickup", now?: Date, warrantyDays?: unknown, customerTested?: "yes" | "no" | null, cancelReason?: string }} [opts]
 * @returns {object}
 */
export function applyTransition(job, to, opts = {}) {
  const from = job?.status;
  const kind = transitionKind(from, to);
  if (!kind || !canTransition(from, to, opts)) throw badTransition(from, to);
  const now = opts.now instanceof Date ? opts.now : new Date();
  const today = todayIso(now);
  const next = { ...job, status: to, statusDate: today };

  // readyDate: acik -> ready* bugun; ready* <-> ready* ve Pickup'ta korunur; ready* -> acik null; Reopen -> ready* bugun
  if (isReady(to) && !isReady(from)) next.readyDate = today;
  else if (isReady(from) && !isReady(to) && kind !== "pickup") next.readyDate = null;

  if (kind === "pickup") {
    next.handedOverDate = today;
    next.customerTested = opts.customerTested === "yes" || opts.customerTested === "no" ? opts.customerTested : null;
    let days = null;
    if (to === "handed_over") {
      const w = parseWarrantyDays(opts.warrantyDays);
      if (!w.ok) {
        const e = new Error("bad_warranty");
        e.code = "bad_warranty";
        throw e;
      }
      days = w.days;
    }
    next.warrantyDays = days;
    next.warrantyEnd = days ? warrantyEnd(today, days) : null;
  } else if (kind === "reopen") {
    next.handedOverDate = null;
    next.warrantyDays = null;
    next.warrantyEnd = null;
    next.customerTested = null;
    if (job.tests && Array.isArray(job.tests.items)) {
      next.tests = { ...job.tests, items: job.tests.items.map((it) => ({ ...it, after: null })) };
    }
  } else if (kind === "cancel" && opts.cancelReason !== undefined) {
    next.cancelReason = reasonText(opts.cancelReason);
  }

  const entry = { at: now.toISOString(), date: today, from, to };
  next.history = [...(Array.isArray(job.history) ? job.history : []), entry].slice(-HISTORY_MAX);
  return next;
}

/**
 * "Customer takes it back unrepaired": acik -> ready_unrepaired -> returned_unrepaired, tek islem, iki gecmis kaydi (KA-65).
 * Is zaten ready_unrepaired ise yalniz ikinci adim. Kapali is -> bad_transition. Yazma islemi cagiranindir (tek atomik yazma).
 */
export function takeBackUnrepaired(job, opts = {}) {
  if (!isOpen(job?.status)) throw badTransition(job?.status, "returned_unrepaired"); // kapali is Reopen yolundan gecirilmez
  const first = job.status === "ready_unrepaired" ? job : applyTransition(job, "ready_unrepaired", { now: opts.now });
  return applyTransition(first, "returned_unrepaired", { ...opts, via: "pickup" });
}
