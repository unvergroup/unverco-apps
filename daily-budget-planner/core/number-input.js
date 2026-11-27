// Ortak sayi girisi ayristiricisi (saf; DOM yok). Para, ucret, miktar ve yuzde alanlarinin HEPSI buradan okunur.
//
// Kural (decimal = arayuz yerel ayarinin ondalik ayraci: es pt fr de tr ","; en zh hi ja ar "."):
//  - Iki ayrac birden varsa SONUNCUSU ondalik, oncekiler binliktir: "1.500,00" ve "1,500.00" = 1500.
//  - Tek ayrac yerel ondalik ayraciysa ondalik: tr "1,500" = 1,5; en "1.500" = 1,5.
//  - Tek ayrac OTEKI ayracsa ve ardindan TAM 3 hane geliyorsa (ilk grup 1-3 hane, sifirla baslamaz) binliktir:
//    tr "1.500" = 1500; en "1,500" = 1500. Baska her durumda ondalik sayilir ("180.00" tr'de 180).
//  - Ayni ayrac birden cok kez gecerse binliktir ve gruplar 3'erli olmalidir; yerel ondalik ayraci tekrar edemez.
//  - Bosluk binlik ayracidir ("1 500", "1 500,50"; Fransizcada dar bosluk U+202F, NBSP, ince bosluk da olur);
//    yalniz tam kisimda, 3'erli gruplarla gecerlidir.
//  - Gecersiz girdi (bos, harf, bozuk grup) NaN / null doner; sessizce 0 olmaz.
import { parseMoney } from "./money.js";

// Ondalik ayraci Intl'den okunur (Latin rakam: Arapca "ar" varsayilan olarak Arap rakami ve "٫" verirdi).
// Intl yoksa ya da yerel ayar taninmazsa: es pt fr de tr virgul, digerleri nokta.
const COMMA_FALLBACK = /^(tr|de|fr|es|it|pt|nl|ru|pl)(\b|-|_|$)/i;
const decimalCache = new Map();
export function decimalFor(localeOrLang) {
  const key = String(localeOrLang ?? "");
  if (!key) return ".";
  if (decimalCache.has(key)) return decimalCache.get(key);
  let d;
  try {
    const tag = /-u-/.test(key) ? key : `${key}-u-nu-latn`;
    d = new Intl.NumberFormat(tag).formatToParts(1.5).find((p) => p.type === "decimal")?.value;
  } catch {
    d = undefined;
  }
  if (d !== "," && d !== ".") d = COMMA_FALLBACK.test(key) ? "," : ".";
  decimalCache.set(key, d);
  return d;
}

const groupsOk = (parts) => /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p));

// Metin -> duz sayi metni ("-1500.25") ya da gecersizse null. decimal: "," ya da ".".
export function normalizeNumber(text, decimal = ".") {
  const dec = decimal === "," ? "," : ".";
  const other = dec === "," ? "." : ",";
  let s = String(text ?? "").trim();
  if (/\s/.test(s)) {
    // bosluklar binlik ayracidir: tam kisimda 3'erli gruplar; bosluklar atilir, kalan metin asagidaki kurala girer
    const g = /^([+-]?)(\d{1,3}(?:\s\d{3})+)(?:([.,])(\d*))?$/u.exec(s); // \s: bosluk, NBSP, dar bosluk (U+202F), ince bosluk
    if (!g) return null;
    s = `${g[1]}${g[2].replace(/\s/g, "")}${g[3] ? g[3] + g[4] : ""}`;
  }
  const m = /^([+-]?)([\d.,]*)$/.exec(s);
  if (!m || !/\d/.test(m[2])) return null;
  const sign = m[1] === "-" ? "-" : "";
  const body = m[2];
  const count = (c) => body.split(c).length - 1;
  let int;
  let frac = "";
  if (count(".") && count(",")) {
    const d = body.lastIndexOf(",") > body.lastIndexOf(".") ? "," : ".";
    const g = d === "," ? "." : ",";
    if (count(d) !== 1) return null;
    const [intPart, fracPart] = body.split(d);
    const parts = intPart.split(g);
    if (!groupsOk(parts) || !/^\d*$/.test(fracPart)) return null;
    int = parts.join("");
    frac = fracPart;
  } else if (count(".") + count(",") === 0) {
    int = body;
  } else {
    const x = count(".") ? "." : ",";
    const parts = body.split(x);
    if (parts.length > 2) {
      if (x === dec || !groupsOk(parts)) return null; // tekrarlanan ondalik ayraci gecersiz; binlik gruplar 3'erli olmali
      int = parts.join("");
    } else {
      const [a, b] = parts;
      const asGroup = x === other && b.length === 3 && /^[1-9]\d{0,2}$/.test(a);
      if (asGroup) int = a + b;
      else { int = a; frac = b; }
    }
  }
  if (int === "" && frac === "") return null;
  return `${sign}${int === "" ? "0" : int}${frac ? `.${frac}` : ""}`;
}

// Metin -> sayi (kayan nokta); gecersizse NaN.
export function parseNumberText(text, { decimal = "." } = {}) {
  const n = normalizeNumber(text, decimal);
  return n === null ? NaN : Number(n);
}

// Metin -> en kucuk para birimi (tamsayi; yarim sifirdan uzaga); gecersizse NaN.
export function parseMoneyText(text, { decimal = "." } = {}) {
  const n = normalizeNumber(text, decimal);
  return n === null ? NaN : parseMoney(n);
}

// Duz sayi (ya da duz sayi metni "2.125") -> yerel ayraclı metin; form alanina yazilirken kullanilir
// (aksi halde tr alaninda "2.125" 2125 diye okunurdu).
export const localizeNumber = (plain, decimal = ".") => {
  const s = String(plain ?? "");
  return decimal === "," ? s.replace(".", ",") : s;
};
