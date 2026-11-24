// Arama dizini ve eslesme (spec 2.3, KA-15 / KA-35 / KA-36 / KA-37). Saf islevler: DOM yok, ag yok.
// Dizin bir kez kurulur (kayitlar degisince yeniden), her tus vurusunda yalniz searchJobs / searchCustomers calisir.
// Sorgu hicbir zaman RegExp'e cevrilmez; "<img" gibi metinler duz metin olarak aranir.

/** Arama icin en az karakter sayisi (normallestirilmis sorgu). */
export const MIN_QUERY = 2;
const DEFAULT_LIMIT = 50;
const EMPTY_LIMIT = 20;
const CUSTOMER_LIMIT = 8;

const EXTRA_FOLD = { "ß": "ss", "ø": "o", "ł": "l", "đ": "d", "æ": "ae", "œ": "oe" };

/**
 * Arama icin metni normallestirir: buyuk-kucuk harf, Turkce I / i / ı / İ hepsi "i", aksanlar (NFD) atilir,
 * yon / sifir genislik gibi bicim karakterleri atilir, tire ve bosluk tek bosluk olur.
 * @param {unknown} s
 * @returns {string} metin degilse ""
 */
export function normalizeText(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/[\p{Cf}]/gu, "")
    .replace(/[İIı]/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[ßøłđæœ]/g, (c) => EXTRA_FOLD[c])
    .replace(/[-‐-―−]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const alnum = (s) => s.replace(/[^a-z0-9]/g, "");
const digitsOf = (s) => (typeof s === "string" ? s.replace(/[^0-9]/g, "") : "");
const own = (o) => (o && typeof o === "object" ? o : {});
const dateKey = (job) => (typeof job.receivedAt === "string" ? job.receivedAt : typeof job.receivedDate === "string" ? job.receivedDate : "");
const byRecent = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.number < b.number ? 1 : a.number > b.number ? -1 : 0);

// Telefon ya da seri / fis gibi "ayrac iceren" sorgular: yalniz harf, rakam ve ayraclar.
const SEPARATED = /^[\p{L}\p{N}\s\-./()+]+$/u;
// Telefon gibi sorgular: yalniz rakam ve telefon ayraclari (harf varsa rakamlar telefonla karistirilmaz).
const PHONE_LIKE = /^[0-9\s\-./()+]+$/;

function parseQuery(query) {
  const nq = normalizeText(query);
  if (!nq) return { kind: "empty" };
  if (nq.length < MIN_QUERY) return { kind: "short" };
  const separated = SEPARATED.test(query.trim());
  const qc = separated ? alnum(nq) : "";
  return { kind: "query", nq, tokens: nq.split(" "), qc, qd: PHONE_LIKE.test(query.trim()) ? digitsOf(query) : "" };
}

// Telefon: sorgu telefonun bir parcasi mi, ya da telefon sorgunun sonu mu (ulke kodu eklenmis yazim).
const phoneMatches = (phoneDigits, qd) =>
  qd !== "" && phoneDigits !== "" && (phoneDigits.includes(qd) || (phoneDigits.length >= 7 && qd.endsWith(phoneDigits)));

/**
 * Arama dizinini kurar. Girdi degistirilmez; eksik / bozuk kayitlar atlanmaz, bos alan sayilir.
 * @param {{ jobs?: object[], customers?: object[], devices?: object[] }} [data]
 * @returns {object} searchJobs / searchCustomers icin dizin
 */
export function buildIndex(data) {
  const { jobs, customers, devices } = own(data);
  const custById = new Map();
  const customerEntries = [];
  for (const c of Array.isArray(customers) ? customers : []) {
    if (!c || typeof c !== "object") continue;
    const phoneDigits = typeof c.phoneDigits === "string" && c.phoneDigits ? c.phoneDigits : digitsOf(c.phone);
    const nameText = normalizeText(c.name);
    const entry = { customer: c, nameText, phoneDigits };
    customerEntries.push(entry);
    if (typeof c.id === "string") custById.set(c.id, entry);
  }
  const devById = new Map();
  for (const d of Array.isArray(devices) ? devices : []) {
    if (d && typeof d === "object" && typeof d.id === "string") devById.set(d.id, d);
  }
  const entries = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job !== "object") continue;
    const c = custById.get(job.customerId);
    const d = own(devById.get(job.deviceId));
    const number = typeof job.number === "string" ? job.number : "";
    const numberText = normalizeText(number);
    const serialText = normalizeText(typeof d.serialKey === "string" && d.serialKey ? d.serialKey : d.serial);
    const serialRaw = normalizeText(d.serial);
    const modelText = normalizeText(d.model);
    const nameText = c ? c.nameText : "";
    const phoneDigits = c ? c.phoneDigits : "";
    const numberCompact = alnum(numberText);
    entries.push({
      job,
      date: dateKey(job),
      number,
      numberCompact,
      phoneDigits,
      text: [nameText, modelText, numberText, serialRaw, serialText, phoneDigits].join("\n"),
      compact: [numberCompact, alnum(serialText), alnum(serialRaw), phoneDigits].join("|"),
    });
  }
  const recent = entries.slice().sort(byRecent);
  return { entries, recent, customers: customerEntries };
}

/**
 * Is arar: ad, telefon (son haneler dahil), IMEI / seri (parca), fis no, cihaz modeli. Sozcukler VE ile birlesir.
 * Siralama: tam fis no, sonu eslesen fis no, digerleri; her grupta yeniden eskiye.
 * Bos sorguda son 20 is; normallestirilmis sorgu MIN_QUERY'den kisaysa tooShort.
 * @param {object} index buildIndex ciktisi
 * @param {unknown} query
 * @param {{ limit?: number }} [opts] limit varsayilan 50
 * @returns {{ jobs: object[], total: number, tooShort: boolean }} total: eslesen toplam ("Showing 50 of n")
 */
export function searchJobs(index, query, opts) {
  const ix = own(index);
  const entries = Array.isArray(ix.entries) ? ix.entries : [];
  const q = parseQuery(query);
  if (q.kind === "short") return { jobs: [], total: 0, tooShort: true };
  if (q.kind === "empty") {
    const recent = Array.isArray(ix.recent) ? ix.recent : [];
    return { jobs: recent.slice(0, EMPTY_LIMIT).map((e) => e.job), total: recent.length, tooShort: false };
  }
  const limit = Number.isInteger(own(opts).limit) && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT;
  const hits = [];
  for (const e of entries) {
    const tokensOk = q.tokens.every((t) => e.text.includes(t) || (/^[a-z0-9]+$/.test(t) && e.compact.includes(t)));
    const wholeOk = !tokensOk && ((q.qc.length >= MIN_QUERY && e.compact.includes(q.qc)) || phoneMatches(e.phoneDigits, q.qd));
    if (!tokensOk && !wholeOk) continue;
    const rank = q.qc && e.numberCompact === q.qc ? 0 : q.qc.length >= MIN_QUERY && e.numberCompact.endsWith(q.qc) ? 1 : 2;
    hits.push({ e, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || byRecent(a.e, b.e));
  return { jobs: hits.slice(0, limit).map((h) => h.e.job), total: hits.length, tooShort: false };
}

/**
 * Musteri arar (kabul ekraninda telefonun son haneleri ya da ad). En az MIN_QUERY karakter; yoksa [].
 * @param {object} index buildIndex ciktisi
 * @param {unknown} query
 * @param {number} [limit] varsayilan 8
 * @returns {object[]} musteri kayitlari (dizindeki sirayla)
 */
export function searchCustomers(index, query, limit) {
  const ix = own(index);
  const list = Array.isArray(ix.customers) ? ix.customers : [];
  const q = parseQuery(query);
  if (q.kind !== "query") return [];
  const max = Number.isInteger(limit) && limit > 0 ? limit : CUSTOMER_LIMIT;
  const out = [];
  for (const c of list) {
    if (q.tokens.every((t) => c.nameText.includes(t)) || phoneMatches(c.phoneDigits, q.qd)) {
      out.push(c.customer);
      if (out.length >= max) break;
    }
  }
  return out;
}
