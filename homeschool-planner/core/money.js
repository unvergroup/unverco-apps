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
