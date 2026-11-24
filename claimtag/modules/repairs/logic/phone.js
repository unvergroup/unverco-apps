// Telefon normallestirme ve mesaj baglantilari (spec 3.1, 8). Saf islevler: DOM yok, ag yok.
// Bu dosya yalniz baglanti URETIR; hicbir sey acmaz, gondermez. Numara dogrulanamazsa baglanti uretilmez, neden doner.

const MAX_RAW = 30;
const WA_NUMBER = /^[1-9][0-9]{6,14}$/; // E.164: basi 0 olmayan 7-15 rakam
const COUNTRY_CODE = /^[1-9][0-9]{0,2}$/;

/**
 * Telefon alanini dogrular (spec 3.1): en cok 30 karakter; rakam, bosluk, bastaki "+", "-", "(", ")", ".", "/"; 7-15 rakam.
 * @param {unknown} raw
 * @returns {{ ok: true, digits: string } | { ok: false, reason: "empty" | "chars" | "too_short" | "too_long" }}
 */
export function validatePhone(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { ok: false, reason: "empty" };
  if (s.length > MAX_RAW) return { ok: false, reason: "too_long" };
  if (!/^\+?[0-9\s\-().\/]*$/.test(s)) return { ok: false, reason: "chars" };
  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length < 7) return { ok: false, reason: "too_short" };
  if (digits.length > 15) return { ok: false, reason: "too_long" };
  return { ok: true, digits };
}

/**
 * Numarayi uluslararasi rakam dizisine cevirir (spec 8):
 * "+" -> rakamlar; "00" -> atilir; aksi halde ulke kodu gerekir:
 * rakamlar kodla basliyor ve >= 11 haneyse oldugu gibi, degilse bastaki tek 0 atilir ("39" haric) ve kod eklenir.
 * @param {unknown} raw
 * @param {unknown} countryCode ornek "90"; bos olabilir
 * @returns {{ ok: true, number: string, to: string } | { ok: false, reason: string }}
 *   reason: empty | chars | too_short | too_long | need_country_code | bad_country_code | bad_number
 */
export function resolvePhone(raw, countryCode) {
  const v = validatePhone(raw);
  if (!v.ok) return v;
  const s = raw.trim();
  let n;
  if (s.startsWith("+")) {
    n = v.digits;
  } else if (v.digits.startsWith("00")) {
    n = v.digits.slice(2);
  } else {
    const code = typeof countryCode === "string" ? countryCode.trim() : "";
    if (!code) return { ok: false, reason: "need_country_code" };
    if (!COUNTRY_CODE.test(code)) return { ok: false, reason: "bad_country_code" };
    if (v.digits.startsWith(code) && v.digits.length >= 11) n = v.digits;
    else {
      const local = v.digits.startsWith("0") && code !== "39" ? v.digits.slice(1) : v.digits;
      n = code + local;
    }
  }
  if (n.length > 15) return { ok: false, reason: "too_long" };
  if (!WA_NUMBER.test(n)) return { ok: false, reason: "bad_number" };
  return { ok: true, number: n, to: `+${n}` };
}

/**
 * wa.me numarasi (yalniz rakam) ya da dogrulanamazsa null.
 * @param {unknown} raw
 * @param {unknown} countryCode
 * @returns {string | null}
 */
export function waNumber(raw, countryCode) {
  const r = resolvePhone(raw, countryCode);
  return r.ok ? r.number : null;
}

// encodeURIComponent eslesmeyen vekil karakterde hata atar; onlari U+FFFD ile degistiririz.
const encodeText = (text) => {
  const s = typeof text === "string" ? text : "";
  const safe = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
  return encodeURIComponent(safe);
};

/**
 * WhatsApp baglantisi: https://wa.me/<rakam>?text=<kodlanmis metin>. Numara yalniz 7-15 rakamsa uretilir, degilse null.
 * @param {unknown} number resolvePhone / waNumber ciktisi (yalniz rakam)
 * @param {unknown} text kullanici metni; tamami encodeURIComponent'ten gecer
 * @returns {string | null}
 */
export function waLink(number, text) {
  if (typeof number !== "string" || !WA_NUMBER.test(number)) return null;
  return `https://wa.me/${number}?text=${encodeText(text)}`;
}

/**
 * SMS baglantisi: sms:+<rakam>?body=<kodlanmis metin>. Numara gecerli degilse null.
 * @param {unknown} number
 * @param {unknown} text
 * @returns {string | null}
 */
export function smsLink(number, text) {
  if (typeof number !== "string" || !WA_NUMBER.test(number)) return null;
  return `sms:+${number}?body=${encodeText(text)}`;
}

/**
 * Tek cagride numara + iki baglanti. Numara cozulemezse baglanti yoktur ve neden doner (dugmeler kapali + ipucu).
 * @param {unknown} rawPhone
 * @param {unknown} countryCode
 * @param {unknown} text
 * @returns {{ ok: true, number: string, to: string, wa: string, sms: string } | { ok: false, reason: string, wa: null, sms: null }}
 */
export function messageLinks(rawPhone, countryCode, text) {
  const r = resolvePhone(rawPhone, countryCode);
  if (!r.ok) return { ok: false, reason: r.reason, wa: null, sms: null };
  return { ok: true, number: r.number, to: r.to, wa: waLink(r.number, text), sms: smsLink(r.number, text) };
}
