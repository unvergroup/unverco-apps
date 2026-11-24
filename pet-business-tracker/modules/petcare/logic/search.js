// Arama: musteri, hayvan, randevu (tarih araligi) ve tum koleksiyonlarda tam metin. Saf islevler: DOM yok, ag yok.
// Sorgu hicbir zaman RegExp'e cevrilmez; "<img" gibi metinler duz metin olarak aranir. Sozcukler VE ile birlesir.
// store = { clients, pets, appointments } (diziler).

/** Arama icin en az karakter sayisi (normallestirilmis sorgu). */
export const MIN_QUERY = 2;
const DEFAULT_LIMIT = 50;
const EXTRA_FOLD = { "ß": "ss", "ø": "o", "ł": "l", "đ": "d", "æ": "ae", "œ": "oe" };

/** Buyuk-kucuk harf, Turkce I / i / ı / İ, aksanlar, bicim karakterleri ve tire / bosluk normallestirilir. Metin degilse "". */
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

const digitsOf = (s) => (typeof s === "string" ? s.replace(/[^0-9]/g, "") : "");
const PHONE_LIKE = /^[0-9\s\-./()+]+$/;
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const limitOf = (o) => (Number.isInteger(o?.limit) && o.limit > 0 ? o.limit : DEFAULT_LIMIT);

function parse(query) {
  const nq = normalizeText(query);
  if (nq.length < MIN_QUERY) return null;
  const qd = typeof query === "string" && PHONE_LIKE.test(query.trim()) ? digitsOf(query) : "";
  return { tokens: nq.split(" "), qd };
}
const textHas = (text, tokens) => tokens.every((t) => text.includes(t));
const phoneHas = (phone, qd) => qd !== "" && digitsOf(phone).includes(qd);
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });

/** Musteri: ad, telefon (parca / son haneler), e-posta. En az MIN_QUERY karakter; yoksa []. */
export function searchClients(store, query, opts) {
  const q = parse(query);
  if (!q) return [];
  return arr(store?.clients)
    .filter((c) => textHas(normalizeText([c.name, c.email].join(" ")), q.tokens) || phoneHas(c.phone, q.qd))
    .sort(byName)
    .slice(0, limitOf(opts));
}

/** Hayvan: ad, tur, irk (ve mikroyonga numarasi). */
export function searchPets(store, query, opts) {
  const q = parse(query);
  if (!q) return [];
  return arr(store?.pets)
    .filter((p) => textHas(normalizeText([p.name, p.species, p.breed, p.microchip].join(" ")), q.tokens))
    .sort(byName)
    .slice(0, limitOf(opts));
}

/**
 * Randevu tarih araligi (from / to dahil, ikisi de istege bagli) ve istege bagli clientId / petId / service / status suzgeci.
 * Sonuc tarih + saate gore artan.
 * @param {object} store
 * @param {{ from?: string, to?: string, clientId?: string, petId?: string, service?: string, status?: string, limit?: number }} [f]
 */
export function searchAppointments(store, f = {}) {
  return arr(store?.appointments)
    .filter((a) => (!f.from || a.date >= f.from) && (!f.to || a.date <= f.to)
      && (!f.clientId || a.clientId === f.clientId) && (!f.petId || a.petId === f.petId)
      && (!f.service || a.service === f.service) && (!f.status || a.status === f.status))
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : a.date + a.time > b.date + b.time ? 1 : 0))
    .slice(0, limitOf(f));
}

/**
 * Tam metin arama: musteri, hayvan ve randevular birlikte. Randevu; hizmet, notlar, tarih, hayvan ve sahip adiyla da eslesir.
 * @returns {{ clients: object[], pets: object[], appointments: object[], total: number, tooShort: boolean }}
 */
export function searchAll(store, query, opts) {
  const q = parse(query);
  if (!q) return { clients: [], pets: [], appointments: [], total: 0, tooShort: typeof query === "string" && normalizeText(query) !== "" };
  const petById = new Map(arr(store?.pets).filter((p) => typeof p.id === "string").map((p) => [p.id, p]));
  const clientById = new Map(arr(store?.clients).filter((c) => typeof c.id === "string").map((c) => [c.id, c]));
  const clients = searchClients(store, query, opts);
  const pets = searchPets(store, query, opts);
  const appointments = arr(store?.appointments)
    .filter((a) => {
      const text = normalizeText([a.service, a.serviceNote, a.note, a.date, a.time, a.status, petById.get(a.petId)?.name, clientById.get(a.clientId)?.name].join(" "));
      return textHas(text, q.tokens);
    })
    .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : a.date + a.time > b.date + b.time ? -1 : 0))
    .slice(0, limitOf(opts));
  return { clients, pets, appointments, total: clients.length + pets.length + appointments.length, tooShort: false };
}
