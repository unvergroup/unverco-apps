// Satir kalemi hesabi (saf; DOM yok). Kalem: { name, qty, unitMinor, taxRate }
//   qty: miktar (en cok 3 ondalik), unitMinor: birim fiyat (en kucuk birim, tamsayi),
//   taxRate: yuzde (0-100, en cok 2 ondalik) ya da null (vergisiz).
// Yuvarlama KURALI core/money.js'tedir: satir tutari = mulQty, satir vergisi = percentOf(satir tutari), her SATIR
// icin ayri yuvarlanir; toplamlar satirlarin tamsayi toplamidir (ekranda satirlar toplamla her zaman tutar).
import { mulQty, percentOf } from "./money.js";
import { normalizeNumber, parseMoneyText } from "./number-input.js";

// opts.decimal: arayuz yerel ayarinin ondalik ayraci ("," ya da "."); bkz. core/number-input.js
const plain = (input, opts) => normalizeNumber(String(input ?? ""), opts?.decimal);

// Miktar metni -> sayi (0'dan buyuk, en cok 3 ondalik). Gecersiz -> NaN.
export function parseQty(input, opts) {
  const s = plain(input, opts);
  if (s === null || !/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  const n = Math.round(Number(s) * 1000) / 1000;
  return n > 0 && Number.isFinite(n) ? n : NaN;
}

// Vergi orani metni -> sayi (0-100, en cok 2 ondalik); bos metin -> null (vergisiz). Gecersiz -> NaN.
export function parseTaxRate(input, opts) {
  if (String(input ?? "").trim() === "") return null;
  const s = plain(input, opts);
  if (s === null || !/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  const n = Math.round(Number(s) * 100) / 100;
  return n >= 0 && n <= 100 ? n : NaN;
}

export function lineNetMinor(item) {
  const v = mulQty(item.unitMinor, item.qty);
  return Number.isNaN(v) ? 0 : v;
}

export function lineTaxMinor(item) {
  if (item.taxRate === null || item.taxRate === undefined) return 0;
  const v = percentOf(lineNetMinor(item), item.taxRate);
  return Number.isNaN(v) ? 0 : v;
}

// { subtotalMinor, taxMinor, totalMinor, byRate: [{ rate, baseMinor, taxMinor }] }  (byRate: orana gore, kucukten buyuge)
export function calcTotals(items) {
  let subtotalMinor = 0;
  let taxMinor = 0;
  const groups = new Map();
  for (const it of items) {
    const net = lineNetMinor(it);
    const tax = lineTaxMinor(it);
    subtotalMinor += net;
    taxMinor += tax;
    if (it.taxRate !== null && it.taxRate !== undefined) {
      const g = groups.get(it.taxRate) ?? { rate: it.taxRate, baseMinor: 0, taxMinor: 0 };
      g.baseMinor += net;
      g.taxMinor += tax;
      groups.set(it.taxRate, g);
    }
  }
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor, byRate: [...groups.values()].sort((a, b) => a.rate - b.rate) };
}

// Metin alanlarindan kalem okur; hatali alanlari { name, qty, price, tax } bayraklariyla bildirir.
export function readLine({ name, qty, price, tax }, opts) {
  const item = { name: String(name ?? "").trim(), qty: parseQty(qty, opts), unitMinor: parseMoneyText(price, opts), taxRate: parseTaxRate(tax, opts) };
  const errors = {
    name: item.name === "",
    qty: Number.isNaN(item.qty),
    price: Number.isNaN(item.unitMinor),
    tax: item.taxRate !== null && Number.isNaN(item.taxRate),
  };
  return { item, errors, ok: !Object.values(errors).some(Boolean) };
}

// Bos satir: ad, miktar ve fiyat bos.
export const isBlankLine = ({ name, qty, price }) => [name, qty, price].every((v) => String(v ?? "").trim() === "");
