// Ornek veri (uydurma ama gercekci; gercek kisi / marka adi YOK): serbest calisan bir tasarimcinin son 12 ayi.
// Saf ve belirlenimci (rastgele yok): ayni "bugun" ile hep ayni kayitlar uretilir. Kayitlar source: "sample" tasir; tek dugmeyle silinir.
import { addMonths, daysInMonth, toIso } from "../../../core/dates.js";

// [gun, tur, kategori anahtari, karsi taraf (sozluk anahtari), tutar cent, odeme, not anahtari, kapsam]
const MONTHLY = [
  [3, "income", "services", "sample.party.bakery", 145000, "bank", "sample.note.logo", "business"],
  [5, "expense", "software", "sample.party.designApp", 5499, "card", "", "business"],
  [6, "expense", "phone_internet", "sample.party.phone", 8500, "card", "", "business"],
  [9, "income", "services", "sample.party.dental", 98000, "online", "sample.note.website", "business"],
  [11, "expense", "supplies", "sample.party.office", 3725, "card", "sample.note.printer", "business"],
  [14, "expense", "meals", "sample.party.cafe", 4260, "card", "sample.note.clientLunch", "business"],
  [17, "income", "sales", "sample.party.market", 32000, "cash", "sample.note.prints", "business"],
  [1, "expense", "rent", "sample.party.cowork", 27500, "bank", "sample.note.desk", "business"],
  [19, "expense", "home_office", "sample.party.utility", 6200, "bank", "", "business"],
  [21, "expense", "advertising", "sample.party.ads", 7500, "card", "", "business"],
  [24, "expense", "bank_fees", "sample.party.processor", 1890, "online", "", "business"],
  [26, "expense", "meals", "sample.party.grocery", 11240, "card", "sample.note.personal", "personal"],
];
const SOMETIMES = [
  [0, 12, "expense", "equipment", "sample.party.electronics", 129900, "card", "sample.note.monitor"],
  [2, 8, "expense", "travel", "sample.party.airline", 38450, "card", "sample.note.conference"],
  [4, 15, "income", "services", "sample.party.agency", 240000, "bank", "sample.note.brand"],
  [6, 20, "expense", "contractors", "sample.party.copywriter", 60000, "bank", "sample.note.copy"],
  [7, 10, "expense", "education", "sample.party.course", 19900, "card", "sample.note.course"],
  [9, 4, "expense", "insurance", "sample.party.insurer", 42000, "bank", "sample.note.liability"],
  [10, 22, "income", "tips", "sample.party.bakery", 5000, "cash", ""],
];
const TRIPS = [[4, "sample.trip.client", 184], [12, "sample.trip.supplies", 96], [18, "sample.trip.meeting", 263], [25, "sample.trip.post", 52]];

/** today: "YYYY-MM-DD". t: ceviri islevi. -> { entries: [...], trips: [...] } (kimlik / zaman damgasi yok; depo ekler). */
export function buildSample(today, t, businessId) {
  const entries = [];
  const trips = [];
  const first = addMonths(`${today.slice(0, 7)}-01`, -11);
  for (let m = 0; m < 12; m++) {
    const ym = addMonths(first, m);
    const y = Number(ym.slice(0, 4));
    const mo = Number(ym.slice(5, 7));
    const dim = daysInMonth(y, mo);
    const dateOf = (d) => toIso(y, mo, Math.min(d, dim));
    const push = (d, type, key, party, amount, method, note, scope = "business") => {
      const date = dateOf(d);
      if (date > today) return;
      entries.push({ businessId, type, date, amount: amount + ((m * 37) % 11) * (type === "income" ? 500 : 100) * (amount > 20000 ? 1 : 0), categoryId: `cat-${key}`,
        party: t(party), method, note: note ? t(note) : "", scope, receipt: "", source: "sample" });
    };
    for (const [d, type, key, party, amount, method, note, scope] of MONTHLY) push(d, type, key, party, amount, method, note, scope);
    for (const [mi, d, type, key, party, amount, method, note] of SOMETIMES) if (m % 12 === mi || (mi === 4 && m === 10)) push(d, type, key, party, amount, method, note);
    for (const [d, purpose, miles10] of TRIPS) {
      const date = dateOf(d);
      if (date <= today) trips.push({ businessId, date, purpose: t(purpose), miles10: miles10 + (m % 3) * 10, note: "", source: "sample" });
    }
  }
  return { entries, trips };
}
