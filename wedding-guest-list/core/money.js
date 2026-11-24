// Para tutari: en kucuk birimin (kurus / cent) TAMSAYISI olarak saklanir; 1 birim = 100.
// Kayan nokta toplamlari kayar; tamsayi toplam satirlarin toplamiyla her zaman tutar.
export const MINOR_PER_UNIT = 100;

// "1.004" -> 100, "1.005" -> 101 (yariyi yukari, sifirdan uzaga). Gecersiz girdi -> NaN.
// Ondalik metin dogrudan okunur; 1.005 * 100 gibi kayan nokta hatasi olmaz.
export function parseMoney(input) {
  const s = String(input ?? "").trim();
  if (!s) return NaN;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  let out;
  if (m && (m[2] || m[3])) {
    const frac = (m[3] ?? "").padEnd(3, "0");
    out = Number(m[2] || "0") * MINOR_PER_UNIT + Number(frac.slice(0, 2));
    if (Number(frac[2]) >= 5) out += 1;
    if (m[1] === "-") out = -out;
  } else if (/^[+-]?(\d+\.?\d*|\.\d+)e[+-]?\d+$/i.test(s)) {
    out = Math.round(Number(s) * MINOR_PER_UNIT); // 1e2 gibi bilimsel gosterim
  } else {
    return NaN;
  }
  return Number.isSafeInteger(out) ? out : NaN;
}

// 1004 -> "10.04" (form alani degeri; yerel ayardan bagimsiz).
export function formatMinorPlain(minor) {
  if (!Number.isInteger(minor)) return "";
  const abs = Math.abs(minor);
  return `${minor < 0 ? "-" : ""}${Math.floor(abs / MINOR_PER_UNIT)}.${String(abs % MINOR_PER_UNIT).padStart(2, "0")}`;
}

// Satirlardaki tamsayi tutarlarin toplami; tamsayi olmayan deger 0 sayilir.
export function sumMinor(rows, key) {
  return rows.reduce((n, r) => n + (Number.isInteger(r[key]) ? r[key] : 0), 0);
}
