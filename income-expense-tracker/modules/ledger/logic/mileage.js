// Kilometre (mil) kaydi hesaplari (saf). Oran KULLANICININ girdigi degerdir; uygulama oran onermez.
// Mesafe onda bir tamsayi (miles10), oran binde bir para birimi (rateMilli: 0,70 -> 700; 0,725 -> 725).
import { roundDiv } from "../../../core/money.js";
import { inRange } from "./calc.js";

/** "12.5" / "12,5" -> 125 (onda bir). Gecersiz -> NaN. En cok 1 ondalik. */
export function parseMiles(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d)?$/.test(s)) return NaN;
  const [a, b = "0"] = s.split(".");
  const v = Number(a) * 10 + Number(b);
  return v > 0 && v <= 1_000_000 ? v : NaN;
}
export const milesText = (miles10) => (Number.isSafeInteger(miles10) ? `${Math.floor(miles10 / 10)}${miles10 % 10 ? `.${miles10 % 10}` : ""}` : "");

/** Oran metni ("0.70", "0,725") -> binde bir tamsayi; bos -> null (oran yok); gecersiz -> NaN. En cok 3 ondalik, ust sinir 100. */
export function parseRate(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (s === "") return null;
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return NaN;
  const [a, b = ""] = s.split(".");
  const v = Number(a) * 1000 + Number(b.padEnd(3, "0"));
  return v > 0 && v <= 100_000 ? v : NaN;
}
export const rateText = (rateMilli) => {
  if (!Number.isSafeInteger(rateMilli)) return "";
  const frac = String(rateMilli % 1000).padStart(3, "0").replace(/0$/, "");
  return `${Math.floor(rateMilli / 1000)}.${frac.length < 2 ? frac.padEnd(2, "0") : frac}`;
};

/** Tutar (en kucuk birim) = mil x oran; digits: para biriminin kusurat basamagi. Oran yoksa null. */
export function tripAmount(miles10, rateMilli, digits = 2) {
  if (!Number.isSafeInteger(rateMilli) || !Number.isSafeInteger(miles10)) return null;
  return roundDiv(miles10 * rateMilli * 10 ** digits, 10_000);
}

/** Donem ozeti: { trips, miles10, amountMinor|null } ve tarih sirali satirlar (eski once). */
export function mileageSummary(trips, range, rateMilli, digits = 2) {
  const rows = trips.filter((t) => !range || inRange(t.date, range)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))));
  const miles10 = rows.reduce((n, t) => n + (Number.isSafeInteger(t.miles10) ? t.miles10 : 0), 0);
  return { rows, trips: rows.length, miles10, amountMinor: tripAmount(miles10, rateMilli, digits) };
}
