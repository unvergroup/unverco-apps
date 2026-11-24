// Hayvan / sahip iliskileri ve gosterim yardimcilari (agirlik, yas). Saf islevler: DOM yok, ag yok.
// store = { clients, pets, appointments } (diziler).

import { diffDays, parseIso, todayIso } from "../../../core/dates.js";

const LB_GRAMS = 453.59237;
const arr = (v) => (Array.isArray(v) ? v : []);

/** Bir musterinin hayvanlari (adina gore, harf buyuklugu gozetmeden). */
export function getPetsForClient(store, clientId) {
  return arr(store?.pets)
    .filter((p) => p && p.clientId === clientId)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
}

/** Hayvanin sahibi; hayvan ya da sahip yoksa null. */
export function getClientForPet(store, petId) {
  const pet = arr(store?.pets).find((p) => p && p.id === petId);
  if (!pet) return null;
  return arr(store?.clients).find((c) => c && c.id === pet.clientId) ?? null;
}

const trim1 = (n) => String(Math.round(n * 10) / 10);

/**
 * Gram -> okunur agirlik. unit "kg" (varsayilan) ya da "lb" / "lbs"; bir ondalik, ".0" atilir.
 * formatWeight(4500) -> "4.5 kg"; formatWeight(4535.9, "lbs") -> "10 lbs". Gecersiz / 0 -> "".
 */
export function formatWeight(grams, unit = "kg") {
  if (!Number.isFinite(grams) || grams <= 0) return "";
  if (unit === "lb" || unit === "lbs") return `${trim1(grams / LB_GRAMS)} lbs`;
  return `${trim1(grams / 1000)} kg`;
}

/**
 * Dogum tarihinden yas metni: "2 years 3 months", "1 year", "5 months". Bir aydan kucuk -> "0 months".
 * Bos, gecersiz ya da gelecekteki tarih -> "". today (YYYY-MM-DD) test icin verilebilir.
 */
export function calculateAge(birthDate, today = todayIso()) {
  const b = parseIso(birthDate);
  const t = parseIso(today);
  if (!b || !t) return "";
  let months = (t.year - b.year) * 12 + (t.month - b.month);
  if (t.day < b.day) months -= 1;
  if (months < 0) return "";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (rest > 0 || years === 0) parts.push(`${rest} ${rest === 1 ? "month" : "months"}`);
  return parts.join(" ");
}

/** Asi son tarihi bu kadar gun icindeyse (ya da gectiyse) uyari verilir. */
export const VACCINE_SOON_DAYS = 30;

/**
 * Hayvanin asi durumu: vaccineDue (YYYY-MM-DD) bugune gore.
 * state: "none" (tarih yok / gecersiz) | "ok" (30 gunden uzak) | "soon" (bugun dahil 0..30 gun) | "overdue" (gecti).
 * days: son tarihe kalan gun (gectiyse negatif); state "none" ise null.
 */
export function vaccineStatus(pet, today = todayIso(), soonDays = VACCINE_SOON_DAYS) {
  const due = pet && typeof pet.vaccineDue === "string" ? pet.vaccineDue : "";
  if (!parseIso(due) || !parseIso(today)) return { state: "none", days: null };
  const days = diffDays(today, due);
  if (days < 0) return { state: "overdue", days };
  return { state: days <= soonDays ? "soon" : "ok", days };
}

/**
 * Asisi yaklasan ya da gecmis hayvanlar (gecikenler once, sonra en yakin tarih): [{ pet, client, state, days }].
 * store = { clients, pets }.
 */
export function vaccinesDue(store, today = todayIso(), soonDays = VACCINE_SOON_DAYS) {
  const out = [];
  for (const pet of arr(store?.pets)) {
    if (!pet) continue;
    const v = vaccineStatus(pet, today, soonDays);
    if (v.state === "soon" || v.state === "overdue") out.push({ pet, client: getClientForPet(store, pet.id), state: v.state, days: v.days });
  }
  return out.sort((a, b) => a.days - b.days || String(a.pet.name).localeCompare(String(b.pet.name), undefined, { sensitivity: "base" }));
}
