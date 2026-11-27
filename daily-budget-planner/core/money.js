// Para tutari: en kucuk birimin (kurus / cent / yen) TAMSAYISI olarak saklanir. Bir ana birimdeki en kucuk birim sayisi
// para birimine baglidir: USD/EUR/TRY 100 (us 2), JPY 1 (us 0), KWD 1000 (us 3). Gecerli us, uygulama para birimini
// secince app.js tarafindan setMoneyCurrency() ile bir kez ayarlanir; mantik dosyalari (logic.js) bu yuzden degismeden calisir.
// Varsayilan: 2 (ayar yapilmamissa).

// Para biriminin kusurat basamagi: Intl'nin kendi bilgisi (JPY 0, USD 2, KWD 3). Taninmayan kod -> 2.
export function currencyDigits(currency) {
  try {
    const d = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return Number.isInteger(d) && d >= 0 && d <= 3 ? d : 2;
  } catch {
    return 2;
  }
}

let digits = 2;
let activeCurrency = null;
export let MINOR_PER_UNIT = 100; // canli baglanti: setMoneyCurrency ile degisir

// Gecerli para birimini ayarlar; kusurat basamagini doner. Cagrilmazsa 2 basamak.
export function setMoneyCurrency(currency) {
  activeCurrency = typeof currency === "string" && currency ? currency : null;
  digits = activeCurrency ? currencyDigits(activeCurrency) : 2;
  MINOR_PER_UNIT = 10 ** digits;
  return digits;
}
export const moneyDigits = () => digits;
export const moneyCurrency = () => activeCurrency;

// "1.004" -> 100, "1.005" -> 101 (yariyi yukari, sifirdan uzaga; 2 basamakta). Gecersiz girdi -> NaN.
// Ondalik metin dogrudan okunur; 1.005 * 100 gibi kayan nokta hatasi olmaz. JPY'de "2.5" -> 3.
export function parseMoney(input) {
  const s = String(input ?? "").trim();
  if (!s) return NaN;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  let out;
  if (m && (m[2] || m[3])) {
    const frac = (m[3] ?? "").padEnd(digits + 1, "0");
    out = Number(m[2] || "0") * MINOR_PER_UNIT + (digits ? Number(frac.slice(0, digits)) : 0);
    if (Number(frac[digits]) >= 5) out += 1;
    if (m[1] === "-") out = -out;
  } else if (/^[+-]?(\d+\.?\d*|\.\d+)e[+-]?\d+$/i.test(s)) {
    out = Math.round(Number(s) * MINOR_PER_UNIT); // 1e2 gibi bilimsel gosterim
  } else {
    return NaN;
  }
  return Number.isSafeInteger(out) ? out : NaN;
}

// 1004 -> "10.04" (form alani degeri; yerel ayardan bagimsiz). JPY'de 1004 -> "1004".
// Eksi tutar: isaret tutarla BIRLIKTE bicimlenir (formatCurrency(-x)); Arapca'da "13.25 US$-" olmasin. Belgelerin ve duzenleme ekranlarinin
// BUTUN indirim / eksi satirlari bunu kullanir (`-${formatCurrency(x)}` kurulmaz).
export const negatedAmount = (format, minor) => format(-minor);

export function formatMinorPlain(minor) {
  if (!Number.isInteger(minor)) return "";
  const abs = Math.abs(minor);
  const sign = minor < 0 ? "-" : "";
  if (!digits) return `${sign}${abs}`;
  return `${sign}${Math.floor(abs / MINOR_PER_UNIT)}.${String(abs % MINOR_PER_UNIT).padStart(digits, "0")}`;
}

// Satirlardaki tamsayi tutarlarin toplami; tamsayi olmayan deger 0 sayilir.
export function sumMinor(rows, key) {
  return rows.reduce((n, r) => n + (Number.isInteger(r[key]) ? r[key] : 0), 0);
}

// ---- Yuvarlama kurali (TEK YER) -------------------------------------------
// Butun yuzde / carpim / bolme hesaplari buradan gecer: sonuc en kucuk birimin TAMSAYISIDIR
// ve yarim, sifirdan uzaga yuvarlanir (2.5 -> 3, -2.5 -> -3). Hesap BigInt ile yapilir; kayan nokta hatasi olmaz.
// Guvenli tamsayi disina tasarsa ya da bolen 0 ise NaN doner.

function divBig(n, d) {
  if (d === 0n) return NaN;
  if (d < 0n) { n = -n; d = -d; }
  const neg = n < 0n;
  if (neg) n = -n;
  const q = (2n * n + d) / (2n * d); // floor(n/d + 1/2)
  const out = Number(neg ? -q : q);
  return Number.isSafeInteger(out) ? out : NaN;
}

// a / b, ikisi de tamsayi; yariyi sifirdan uzaga yuvarlar.
export function roundDiv(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return NaN;
  return divBig(BigInt(a), BigInt(b));
}

// Tutarin yuzdesi: percentOf(10000, 18) -> 1800; percent en cok 2 ondalikli olabilir (7.5, 8.25).
export function percentOf(minor, percent) {
  if (!Number.isSafeInteger(minor) || typeof percent !== "number" || !Number.isFinite(percent)) return NaN;
  return divBig(BigInt(minor) * BigInt(Math.round(percent * 100)), 10000n);
}

// Birim fiyat x miktar: mulQty(1999, 1.5) -> 2999 (miktar en cok 3 ondalikli).
export function mulQty(unitMinor, qty) {
  if (!Number.isSafeInteger(unitMinor) || typeof qty !== "number" || !Number.isFinite(qty)) return NaN;
  return divBig(BigInt(unitMinor) * BigInt(Math.round(qty * 1000)), 1000n);
}

// ---- Elle yazilan / tus takimiyla girilen tutar (Daily Budget Planner) ----------------------------------
// Kullanici "12.50" de yazabilir "12,50" de: TEK ondalik isareti ve ardindan 1-2 hane varsa o isaret ondaliktir.
// Ardindan tam 3 hane gelen tek isaret ("1,250" / "1.250") binliktir. Iki farkli isaret varsa sondaki ondaliktir.
// Hicbir durumda "12,50" 125000 (1.250,00) okunmaz. Gecersiz -> NaN. Eksi isareti yalniz allowNegative ile.
export function parseMoneyLoose(input, { allowNegative = false } = {}) {
  let s = String(input ?? "").trim().replace(/[\s  '$€£]/g, "");
  if (!s) return NaN;
  let neg = false;
  if (s.startsWith("-")) { if (!allowNegative) return NaN; neg = true; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return NaN;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  let plain;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const th = dec === "." ? "," : ".";
    const [i, f, ...rest] = s.split(dec);
    if (rest.length || !/^\d{1,3}([.,]\d{3})*$/.test(i) || i.includes(dec) || !/^\d*$/.test(f)) return NaN;
    plain = `${i.split(th).join("")}.${f}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    if (parts.length === 2 && /^\d{0,2}$/.test(parts[1])) plain = `${parts[0] || "0"}.${parts[1]}`;
    else if (/^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p))) plain = parts.join("");
    else return NaN;
  } else plain = s;
  const v = parseMoney(plain);
  return Number.isNaN(v) ? NaN : neg ? -v : v;
}

// Hizli giris tus takimi: girilen metin ("1250" ya da fiziksel klavyeden "12.50" / "12,50") -> kurus.
// Ayirici yoksa rakamlar kurustan dolar (ATM gibi: 1,2,5,0 -> 12,50). Ayirici varsa parseMoneyLoose. Bos -> 0.
export function keypadToMinor(typed) {
  const s = String(typed ?? "");
  if (!s) return 0;
  if (/[.,]/.test(s)) return parseMoneyLoose(s);
  if (!/^\d+$/.test(s)) return NaN;
  const v = Number(s);
  return Number.isSafeInteger(v) ? v : NaN;
}
