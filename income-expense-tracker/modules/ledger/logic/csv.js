// CSV: muhasebeci icin disa aktarim ve banka dokumu ice aktarma (saf; DOM yok).
// Ice aktarma: RFC 4180 benzeri ayristirma (tirnak, cift tirnak, satir ici yeni satir), ayirici tahmini (, ; sekme),
// sutun esleme (tarih, aciklama, tutar YA DA giren/cikan iki sutun), tarih bicimi (YYYY-MM-DD, AA/GG/YYYY, GG/AA/YYYY), tutar ayristirma.
import { csvCell } from "../../../core/backup.js";
import { toIso, isIsoDate } from "../../../core/dates.js";
import { MAX_AMOUNT } from "./schema.js";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 3000;

/** Ayirici tahmini: ilk dolu satirda tirnak disinda en cok gecen (, ; \t). */
export function detectDelimiter(text) {
  const line = String(text ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  let best = ",", n = -1;
  for (const d of [",", ";", "\t"]) {
    let c = 0, q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch === d) c++; }
    if (c > n) { n = c; best = d; }
  }
  return best;
}

/** CSV metni -> satir dizisi (her satir hucre dizisi). Bos satirlar atilir. BOM atilir. */
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const s = String(text ?? "").replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/** Tarih hucresi -> "YYYY-MM-DD" ya da "" (okunamadi). format: "ymd" | "mdy" | "dmy". Iki haneli yil 20xx sayilir. */
export function parseDateCell(raw, format = "mdy") {
  const s = String(raw ?? "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(s);
    if (!m) return "";
    y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (format === "dmy") { d = +m[1]; mo = +m[2]; } else { mo = +m[1]; d = +m[2]; }
  }
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const iso = toIso(y, mo, d);
  return isIsoDate(iso) ? iso : "";
}

/**
 * Tutar hucresi -> en kucuk birim tamsayisi (isaretli) ya da NaN. decimal: "." ya da ","; obur isaret BINLIK ayiricidir ve YALNIZ
 * ardindan tam 3 hane gelen gruplarda kabul edilir ("1,234.56" evet; "12,50" ayirici "." iken HAYIR -> NaN). Birden cok ondalik isareti
 * ("12.5.5") NaN. "(12.50)" ve "12.50-" eksidir. Para simgeleri ve bosluklar atilir. Belirsiz / hatali tutar sessizce yorumlanmaz: NaN.
 */
export function parseAmountCell(raw, { decimal = ".", digits = 2 } = {}) {
  let s = String(raw ?? "").trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  const core = s.replace(/^[^\d(+\-.,]+/, "").replace(/[^\d)\-.,]+$/, ""); // bastaki / sondaki para simgesi ve kodu (USD, R$, €) atilir
  if (!core || /[^\d.,\s\u00a0'()+\-]/.test(core)) return NaN; // ortada harf ya da baska isaret: tutar degil
  s = s.replace(/[^\d.,+\-]/g, "");
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (!s || /[+\-]/.test(s)) return NaN;
  const thousands = decimal === "." ? "," : ".";
  const parts = s.split(decimal);
  if (parts.length > 2) return NaN; // birden cok ondalik isareti
  const [intPart, frac = ""] = parts;
  if (parts.length === 2 && !/^\d+$/.test(frac)) return NaN;
  let whole;
  if (intPart.includes(thousands)) {
    if (!new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+$`).test(intPart)) return NaN; // binlik grubu tam 3 hane
    whole = intPart.split(thousands).join("");
  } else {
    if (!/^\d*$/.test(intPart) || (intPart === "" && frac === "")) return NaN;
    whole = intPart || "0";
  }
  const f = frac.padEnd(digits + 1, "0");
  let v = Number(whole) * 10 ** digits + (digits ? Number(f.slice(0, digits)) : 0);
  if (Number(f[digits]) >= 5) v += 1;
  if (!Number.isSafeInteger(v) || v > MAX_AMOUNT) return NaN;
  return neg ? -v : v;
}

/**
 * Tutar sutunundaki degerlerden ondalik ayiriciyi tahmin eder (dilden bagimsiz). Kural: iki isaret birden varsa SONDAKI ondaliktir;
 * tek isaretten sonra 1-2 hane geliyorsa o isaret ondaliktir; tam 3 hane belirsizdir (oy vermez). -> { decimal: "." | ",", sure: bool }
 */
export function detectDecimal(values) {
  let dot = 0, comma = 0;
  for (const raw of values) {
    const s = String(raw ?? "").replace(/[^\d.,]/g, "");
    const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
    if (lastDot < 0 && lastComma < 0) continue;
    if (lastDot >= 0 && lastComma >= 0) { if (lastDot > lastComma) dot++; else comma++; continue; }
    const at = Math.max(lastDot, lastComma);
    const after = s.length - at - 1;
    if (after === 1 || after === 2) { if (lastDot >= 0) dot++; else comma++; }
  }
  if (!dot && !comma) return { decimal: ".", sure: false };
  return { decimal: comma > dot ? "," : ".", sure: dot === 0 || comma === 0 };
}

/** Baslik satirindan sutun tahmini: { date, description, amount, debit, credit } (indeks ya da -1). Kelime sinirli eslesme:
 *  "Metadata" tarih, "Account name" aciklama sayilmaz; "name" yalniz baslik tam olarak "name" / "payee name" / "merchant name" ise. */
export function guessColumns(header) {
  const norm = header.map((h) => String(h ?? "").trim().toLowerCase());
  const find = (re) => norm.findIndex((h) => re.test(h));
  const debit = find(/\b(debit|debits|withdrawal|withdrawals|money out|paid out|outflow|charges?)\b/);
  const credit = find(/\b(credit|credits|deposit|deposits|money in|paid in|inflow)\b/);
  let description = find(/\b(description|descr|memo|payee|details|narrative|concepto|libell[eé]|beschreibung|verwendungszweck|descri[cç][aã]o|merchant)\b/);
  if (description < 0) description = find(/^(name|payee name|merchant name)$/);
  return {
    date: find(/\b(date|posted|posting date|transaction date|fecha|datum|data)\b/),
    description,
    amount: find(/\b(amount|importe|montant|betrag|valor|value)\b/),
    debit, credit,
  };
}

/**
 * Satirlari kayit adaylarina cevirir. map: { date, description, amount } ya da { date, description, debit, credit } (indeks; -1 = yok).
 * opts: { hasHeader, dateFormat, decimal, digits, negativeIs: "expense" | "income" }.
 * -> { items: [{ date, description, amountMinor (pozitif), type }], skipped: [{ line, reason }] }
 */
export function rowsToItems(rows, map, { hasHeader = true, dateFormat = "mdy", decimal = ".", digits = 2, negativeIs = "expense" } = {}) {
  const items = [];
  const skipped = [];
  const body = hasHeader ? rows.slice(1) : rows;
  const two = map.amount < 0 && map.debit >= 0 && map.credit >= 0;
  body.slice(0, MAX_IMPORT_ROWS).forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const date = parseDateCell(r[map.date], dateFormat);
    if (!date) { skipped.push({ line, reason: "date" }); return; }
    let signed;
    if (two) {
      const out = r[map.debit] ? parseAmountCell(r[map.debit], { decimal, digits }) : 0;
      const inn = r[map.credit] ? parseAmountCell(r[map.credit], { decimal, digits }) : 0;
      if (Number.isNaN(out) || Number.isNaN(inn)) { skipped.push({ line, reason: "amount" }); return; }
      signed = Math.abs(inn) - Math.abs(out);
    } else {
      signed = parseAmountCell(r[map.amount], { decimal, digits });
      if (Number.isNaN(signed)) { skipped.push({ line, reason: "amount" }); return; }
      if (negativeIs === "income") signed = -signed;
    }
    if (signed === 0) { skipped.push({ line, reason: "zero" }); return; }
    items.push({ line, raw: two ? [r[map.debit], r[map.credit]].filter(Boolean).join(" / ") : String(r[map.amount] ?? ""), date, description: String(r[map.description] ?? "").slice(0, 120), amountMinor: Math.abs(signed), type: signed < 0 ? "expense" : "income" });
  });
  if (body.length > MAX_IMPORT_ROWS) skipped.push({ line: MAX_IMPORT_ROWS + 1, reason: "tooMany" });
  return { items, skipped };
}

/** Yinelenen anahtari: ayni tarih + tutar + tur + aciklama (buyuk/kucuk harf duyarsiz). */
export const dupKey = (date, amountMinor, type, text) => `${date}|${amountMinor}|${type}|${String(text ?? "").trim().toLowerCase()}`;

/**
 * Ice aktarma plani. Dosya ICINDEKI tekrarlar ASLA atilmaz (ayni gun iki 4,50 kahve iki gercek harcamadir). Yalniz uygulamada zaten
 * olan kayitla eslesen satir atlanir ve eslesme SAYIYLA tuketilir: uygulamada N, dosyada M ayni satir varsa M-N tanesi alinir.
 * existing: uygulamadaki kayitlar [{ date, amount, type, party }]. force: true ise hicbir satir atlanmaz.
 * -> { fresh: [item], dups: [item] }
 */
export function planImport(items, existing, { force = false } = {}) {
  if (force) return { fresh: [...items], dups: [] };
  const left = new Map();
  for (const e of existing) { const k = dupKey(e.date, e.amount, e.type, e.party); left.set(k, (left.get(k) ?? 0) + 1); }
  const fresh = [], dups = [];
  for (const it of items) {
    const k = dupKey(it.date, it.amountMinor, it.type, it.description);
    const n = left.get(k) ?? 0;
    if (n > 0) { left.set(k, n - 1); dups.push(it); } else fresh.push(it);
  }
  return { fresh, dups };
}

// ---- Disa aktarim ----
/** Kayitlar -> CSV metni (muhasebeci). Tutar ondalik metin (isaretsiz) + tur sutunu; ayrica isaretli "Net" sutunu. */
export function entriesCsv(entries, { headers, delimiter = ",", decimal = ".", digits = 2, categoryName, methodName, typeName, scopeName, businessName }) {
  const amt = (minor) => {
    const neg = minor < 0;
    const a = Math.abs(minor);
    const s = digits ? `${Math.floor(a / 10 ** digits)}.${String(a % 10 ** digits).padStart(digits, "0")}` : String(a);
    return (neg ? "-" : "") + (decimal === "," ? s.replace(".", ",") : s);
  };
  const cols = ["date", "type", "category", "party", "amount", "signed", "method", "scope", "note", "business", "receipt"];
  const cell = (v) => csvCell(v, delimiter);
  const lines = [cols.map((c) => cell(headers[c])).join(delimiter)];
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const e of sorted) {
    const row = {
      date: e.date, type: typeName(e.type), category: categoryName(e.categoryId), party: e.party ?? "",
      amount: amt(e.amount), signed: amt(e.type === "expense" ? -e.amount : e.amount), method: e.method ? methodName(e.method) : "",
      scope: scopeName(e.scope), note: e.note ?? "", business: businessName(e.businessId), receipt: e.receipt ? headers.yes : "",
    };
    // Tutar hucreleri metin olarak yazilir ama "-" ile baslayan isaretli tutar formul sayilmasin diye csvCell'den gecmez.
    lines.push(cols.map((c) => (c === "amount" || c === "signed" ? (row[c].includes(delimiter) ? `"${row[c]}"` : row[c]) : cell(row[c]))).join(delimiter));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function tripsCsv(rows, { headers, delimiter = ",", milesText, amountText }) {
  const cell = (v) => csvCell(v, delimiter);
  const lines = [[headers.date, headers.purpose, headers.miles, headers.note, headers.amount].map(cell).join(delimiter)];
  for (const t of rows) lines.push([t.date, t.purpose, milesText(t.miles10), t.note ?? "", amountText(t)].map((v, i) => (i === 2 || i === 4 ? (String(v).includes(delimiter) ? `"${v}"` : String(v)) : cell(v))).join(delimiter));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
