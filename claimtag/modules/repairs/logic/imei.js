// IMEI / seri no yardimcilari. Saf islevler: DOM yok, ag yok.
// Gecersiz IMEI yalniz UYARIDIR (kayit engellenmez); seri no serbesttir (spec 3.2, KA-20).

/**
 * Seri / IMEI karsilastirma anahtari: buyuk harf; bosluk, "-", "." ve "/" atilir.
 * @param {unknown} raw
 * @returns {string} metin degilse ""
 */
export function serialKey(raw) {
  if (typeof raw !== "string") return "";
  return raw.toUpperCase().replace(/[\s\-./]+/g, "");
}

/**
 * Luhn sinamasi. Yalniz ASCII rakamlardan olusan, en az 2 haneli metin gecerli olabilir.
 * @param {unknown} digits
 * @returns {boolean}
 */
export function luhnValid(digits) {
  if (typeof digits !== "string" || !/^[0-9]{2,}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Cihaz numarasini denetler. Yalniz anahtari 15 ASCII rakam olan deger IMEI sayilir ve Luhn'a girer;
 * 14 / 16 hane, harfli degerler ve bos deger denetlenmez (warn: false).
 * @param {unknown} raw
 * @returns {{ key: string, isImei: boolean, valid: boolean | null, warn: boolean }}
 *   warn yalniz "15 hane ve Luhn tutmuyor" iken true; kaydi engellemek icin kullanilmaz.
 */
export function imeiCheck(raw) {
  const key = serialKey(raw);
  if (!/^[0-9]{15}$/.test(key)) return { key, isImei: false, valid: null, warn: false };
  const valid = luhnValid(key);
  return { key, isImei: true, valid, warn: !valid };
}
