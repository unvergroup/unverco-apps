// Fiyat, vergi, odeme ve kar hesabi (spec 3.5, 3.6, 4; H1..H14, B1..B8). Saf islevler: DOM yok, ag yok.
// Yuvarlama kurali core/money.js'tedir (satir basina; yariyi sifirdan uzaga). Para her yerde en kucuk birimin tamsayisidir.
// Tutar metni cozumu para biriminin kusurat basamagina (setMoneyCurrency) baglidir.

import { mulQty, parseMoney } from "../../../core/money.js";
import { calcTotals, lineNetMinor } from "../../../core/line-items.js";
import { normalizeNumber } from "../../../core/number-input.js";
import { isIsoDate, todayIso } from "../../../core/dates.js";

export const MAX_MINOR = 999_999_999;
export const QTY_MIN = 0.001;
export const QTY_MAX = 999;
export const LINE_LIMITS = Object.freeze({ lines: 30, payments: 20, id: 12, name: 80, supplier: 60, paymentNote: 100 });
export const LINE_KINDS = Object.freeze(["part", "labor", "diagnosis", "other"]);
export const PART_TYPES = Object.freeze(["original", "aftermarket", "used", "unspecified"]);
export const PAYMENT_KINDS = Object.freeze(["diagnosis", "deposit", "payment", "refund"]);
export const PAYMENT_METHODS = Object.freeze(["cash", "card", "transfer", "other"]);

const cpLen = (s) => [...s].length;
const oneLine = (v) => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : "");
const isInt = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

// Yazilan sayiyi duz sayi metnine cevirir: { text } | { error: "empty" | "invalid" }. decimal: "," ya da "."
function plainNumber(input, decimal) {
  const raw = typeof input === "number" ? String(input) : String(input ?? "");
  if (raw.trim() === "") return { error: "empty" };
  const s = normalizeNumber(raw, decimal);
  return s === null ? { error: "invalid" } : { text: s };
}
const fracLength = (text) => (text.split(".")[1] ?? "").replace(/0+$/, "").length;

/**
 * Tutar metni -> en kucuk birim (0-999.999.999; 0 gecerli, bos gecersiz). B1-B6.
 * @param {unknown} input
 * @param {{ decimal?: string }} [opts]
 * @returns {{ ok: true, minor: number } | { ok: false, error: "empty" | "invalid" | "negative" | "too_large" }}
 */
export function parseAmount(input, opts) {
  const p = plainNumber(input, opts?.decimal);
  if (p.error) return { ok: false, error: p.error };
  if (p.text.startsWith("-")) return { ok: false, error: "negative" };
  const minor = parseMoney(p.text);
  if (Number.isNaN(minor)) return { ok: false, error: "invalid" };
  if (minor > MAX_MINOR) return { ok: false, error: "too_large" };
  return { ok: true, minor };
}

/**
 * Miktar metni -> sayi (0,001-999, en cok 3 ondalik; fazlasi yuvarlanmaz, reddedilir). B7.
 * @returns {{ ok: true, qty: number } | { ok: false, error: "empty" | "invalid" | "range" | "decimals" }}
 */
export function parseQuantity(input, opts) {
  const p = plainNumber(input, opts?.decimal);
  if (p.error) return { ok: false, error: p.error };
  if (fracLength(p.text) > 3) return { ok: false, error: "decimals" };
  const n = Number(p.text);
  if (!Number.isFinite(n) || n < QTY_MIN || n > QTY_MAX) return { ok: false, error: "range" };
  return { ok: true, qty: n };
}

/**
 * Vergi orani metni -> null (bos = vergisiz) | 0-100 (en cok 2 ondalik; fazlasi reddedilir). B8.
 * @returns {{ ok: true, rate: number | null } | { ok: false, error: "invalid" | "range" | "decimals" }}
 */
export function parseTax(input, opts) {
  if (input === null || input === undefined || String(input).trim() === "") return { ok: true, rate: null };
  const p = plainNumber(input, opts?.decimal);
  if (p.error) return { ok: false, error: "invalid" };
  if (fracLength(p.text) > 2) return { ok: false, error: "decimals" };
  const n = Number(p.text);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: "range" };
  return { ok: true, rate: n };
}

/**
 * Satir duzenleyicinin metin alanlarindan satir okur (spec 3.5); aralik denetimi burada.
 * Maliyet ve tedarikci yalniz part / other (tedarikci yalniz part); parca turu yalniz part. Hatali alan -> errors[alan] = kod.
 * @param {{ id?: string, kind?: string, name?: string, qty?: unknown, price?: unknown, tax?: unknown, cost?: unknown, supplier?: string, partType?: string, toldCustomer?: unknown }} f
 * @param {{ decimal?: string }} [opts]
 * @returns {{ item: object, errors: Record<string, string>, ok: boolean }}
 */
export function readLine(f, opts) {
  const r = f && typeof f === "object" ? f : {};
  const errors = {};
  const kind = r.kind === undefined || r.kind === null || r.kind === "" ? "other" : r.kind;
  if (!LINE_KINDS.includes(kind)) errors.kind = "enum";
  const name = oneLine(r.name);
  if (!name) errors.name = "required";
  else if (cpLen(name) > LINE_LIMITS.name) errors.name = "too_long";
  const q = parseQuantity(r.qty, opts);
  if (!q.ok) errors.qty = q.error;
  const price = parseAmount(r.price, opts);
  if (!price.ok) errors.price = price.error;
  const t = parseTax(r.tax, opts);
  if (!t.ok) errors.tax = t.error;

  const isPart = kind === "part";
  let costMinor = null;
  if ((isPart || kind === "other") && String(r.cost ?? "").trim() !== "") {
    const c = parseAmount(r.cost, opts);
    if (c.ok) costMinor = c.minor;
    else errors.cost = c.error;
  }
  const supplier = isPart ? oneLine(r.supplier) : "";
  if (cpLen(supplier) > LINE_LIMITS.supplier) errors.supplier = "too_long";
  let partType = "unspecified";
  if (isPart && r.partType !== undefined && r.partType !== null && r.partType !== "") {
    if (PART_TYPES.includes(r.partType)) partType = r.partType;
    else errors.partType = "enum";
  }
  const id = typeof r.id === "string" ? r.id : "";
  if (cpLen(id) > LINE_LIMITS.id) errors.id = "too_long";
  const item = {
    id, kind, name,
    qty: q.ok ? q.qty : NaN,
    unitMinor: price.ok ? price.minor : NaN,
    taxRate: t.ok ? t.rate : NaN,
    costMinor, supplier, partType,
    toldCustomer: r.toldCustomer === true || r.toldCustomer === "true",
  };
  return { item, errors, ok: Object.keys(errors).length === 0 };
}

/**
 * Kayitli (sayisal) satiri dogrular; readLine ile ayni araliklar. Hata yoksa {}.
 * @param {object} line
 * @returns {Record<string, string>}
 */
export function validateLine(line) {
  const l = line && typeof line === "object" ? line : {};
  const e = {};
  if (!LINE_KINDS.includes(l.kind)) e.kind = "enum";
  if (typeof l.name !== "string" || !oneLine(l.name)) e.name = "required";
  else if (cpLen(l.name) > LINE_LIMITS.name) e.name = "too_long";
  if (!(typeof l.qty === "number" && l.qty >= QTY_MIN && l.qty <= QTY_MAX && Math.round(l.qty * 1000) / 1000 === l.qty)) e.qty = "range";
  if (!isInt(l.unitMinor, 0, MAX_MINOR)) e.price = "range";
  if (l.taxRate !== null && !(typeof l.taxRate === "number" && l.taxRate >= 0 && l.taxRate <= 100 && Math.round(l.taxRate * 100) / 100 === l.taxRate)) e.tax = "range";
  if (l.costMinor !== null && l.costMinor !== undefined && !isInt(l.costMinor, 0, MAX_MINOR)) e.cost = "range";
  if (!PART_TYPES.includes(l.partType)) e.partType = "enum";
  return e;
}

/**
 * Is hesabi (spec 4): satir tutari, vergi, toplam, odenen, kalan, kar. Girdi degistirilmez.
 * paid = Sigma(diagnosis, deposit, payment) - Sigma(refund), en az 0. profit = subtotal - Sigma maliyet (part, other);
 * maliyeti bos bir part satiri varsa profit null (partsWithoutCost sayar).
 * display: lines bos ve paid > 0 -> "deposit"; lines var ve balance < 0 -> "overpaid"; aksi "balance".
 * @param {{ lines?: object[], payments?: object[] }} job
 * @returns {{ subtotalMinor: number, taxMinor: number, totalMinor: number, paidMinor: number, balanceMinor: number, balanceDueMinor: number,
 *   costMinor: number, profitMinor: number | null, partsWithoutCost: number, display: { kind: "balance" | "overpaid" | "deposit", amountMinor: number } }}
 */
export function calcJob(job) {
  const lines = Array.isArray(job?.lines) ? job.lines.filter((l) => l && typeof l === "object") : [];
  const payments = Array.isArray(job?.payments) ? job.payments : [];
  const { subtotalMinor, taxMinor, totalMinor } = calcTotals(lines);

  let paid = 0;
  for (const p of payments) {
    if (!p || !Number.isSafeInteger(p.amountMinor)) continue;
    if (p.kind === "refund") paid -= p.amountMinor;
    else if (p.kind === "diagnosis" || p.kind === "deposit" || p.kind === "payment") paid += p.amountMinor;
  }
  const paidMinor = Math.max(0, paid);
  const balanceMinor = totalMinor - paidMinor;

  let costMinor = 0;
  let partsWithoutCost = 0;
  for (const l of lines) {
    if (l.kind !== "part" && l.kind !== "other") continue;
    if (l.costMinor === null || l.costMinor === undefined) {
      if (l.kind === "part") partsWithoutCost += 1;
      continue;
    }
    const c = mulQty(l.costMinor, l.qty);
    if (!Number.isNaN(c)) costMinor += c;
  }
  const profitMinor = partsWithoutCost > 0 ? null : subtotalMinor - costMinor;

  const display = lines.length === 0 && paidMinor > 0 ? { kind: "deposit", amountMinor: paidMinor }
    : lines.length > 0 && balanceMinor < 0 ? { kind: "overpaid", amountMinor: -balanceMinor }
      : { kind: "balance", amountMinor: Math.max(0, balanceMinor) };
  return { subtotalMinor, taxMinor, totalMinor, paidMinor, balanceMinor, balanceDueMinor: Math.max(0, balanceMinor), costMinor, profitMinor, partsWithoutCost, display };
}

/** Tek satirin tutari (vergisiz); calcJob ile ayni kural. */
export const lineAmountMinor = lineNetMinor;

/**
 * Yeni odemeyi dogrular (spec 3.6): tur / yontem listede, tutar 1-999.999.999 tamsayi, tarih gecerli ve ileri gun degil,
 * not <= 100, odeme sayisi < 20, iade o ana kadar odenenden fazla degil (H12).
 * @param {object[]} existing mevcut odemeler
 * @param {{ kind?: string, amountMinor?: number, date?: string, method?: string, note?: string }} cand
 * @param {{ today?: string }} [opts] today "YYYY-MM-DD"; verilmezse yerel bugun
 * @returns {{ ok: boolean, errors: Record<string, string> }}
 */
export function validatePayment(existing, cand, opts) {
  const list = Array.isArray(existing) ? existing : [];
  const c = cand && typeof cand === "object" ? cand : {};
  const today = opts?.today ?? todayIso();
  const errors = {};
  if (list.length >= LINE_LIMITS.payments) errors.limit = "limit";
  if (!PAYMENT_KINDS.includes(c.kind)) errors.kind = "enum";
  if (!PAYMENT_METHODS.includes(c.method)) errors.method = "enum";
  if (!isInt(c.amountMinor, 1, MAX_MINOR)) errors.amount = "range";
  else if (c.kind === "refund" && c.amountMinor > calcJob({ payments: list }).paidMinor) errors.amount = "refund_exceeds_paid";
  if (typeof c.date !== "string" || !isIsoDate(c.date)) errors.date = "invalid";
  else if (c.date > today) errors.date = "future";
  if (c.note !== undefined && c.note !== null && (typeof c.note !== "string" || cpLen(c.note) > LINE_LIMITS.paymentNote)) errors.note = "too_long";
  return { ok: Object.keys(errors).length === 0, errors };
}
