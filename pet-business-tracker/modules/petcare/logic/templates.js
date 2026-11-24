// Ornek veri ureteci (demo modu): 3 musteri, 5 hayvan, 8 randevu. Saf islev: DOM yok, ag yok.
// Tarihler "bugun"e gore kayar (gecmis tamamlanmis, bugun onayli, gelecek planli); ayni cagri ayni sonucu verir.
// Tum kayitlar source: "sample"; referanslar tutarlidir (pets.clientId -> clients.id, appointments.clientId / petId).

import { addDays, todayIso } from "../../../core/dates.js";
import { cleanRecord } from "./schema.js";

const pad = (n) => String(n).padStart(4, "0");

/**
 * Demo verisi uretir.
 * @param {{ now?: Date }} [opts] now: "bugun" ve damga kaynagi (varsayilan simdi)
 * @returns {{ clients: object[], pets: object[], appointments: object[] }}
 */
export function createSampleData(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const today = todayIso(now);
  const year = today.slice(0, 4);
  const stamp = now.toISOString();
  const id = (letter, n) => `${letter}-${year}-${pad(n)}`;
  const clean = (collection, raw) => cleanRecord(collection, { ...raw, source: "sample", createdAt: stamp, updatedAt: stamp }, { now }).record;

  const clients = [
    { id: id("C", 1), name: "Emma Carter", phone: "+1 555 0101", email: "emma.carter@example.com", address: "12 Maple Street", note: "Prefers morning appointments." },
    { id: id("C", 2), name: "Daniel Brooks", phone: "+1 555 0102", email: "daniel.brooks@example.com", address: "48 Harbor Road", note: "" },
    { id: id("C", 3), name: "Sofia Martinez", phone: "+1 555 0103", email: "", address: "7 Cedar Lane", note: "Text before arriving." },
  ].map((c) => clean("clients", c));

  const pets = [
    { id: id("P", 1), clientId: id("C", 1), name: "Buddy", species: "dog", breed: "Golden Retriever", color: "Golden", weight: 30000, birthDate: addDays(today, -1200), gender: "male", temperament: "friendly", vaccinations: "Rabies, DHPP - up to date", allergies: "", medicalNotes: "", specialInstructions: "Loves treats." },
    { id: id("P", 2), clientId: id("C", 1), name: "Misty", species: "cat", breed: "Siamese", color: "Cream", weight: 4200, birthDate: addDays(today, -2600), gender: "female", temperament: "nervous", allergies: "Fragrance-free shampoo only", specialInstructions: "Keep the room quiet." },
    { id: id("P", 3), clientId: id("C", 2), name: "Rocky", species: "dog", breed: "French Bulldog", color: "Brindle", weight: 12500, birthDate: addDays(today, -1800), gender: "male", temperament: "calm", medicalNotes: "Sensitive skin" },
    { id: id("P", 4), clientId: id("C", 3), name: "Luna", species: "rabbit", breed: "Holland Lop", color: "Gray", weight: 1800, birthDate: addDays(today, -500), gender: "female", temperament: "calm" },
    { id: id("P", 5), clientId: id("C", 3), name: "Kiwi", species: "bird", breed: "Budgerigar", color: "Green", weight: 40, gender: "unknown", temperament: "friendly" },
  ].map((p) => clean("pets", p));

  // [no, gun farki, saat, sure, hayvan no, hizmet, durum, fiyat, odendi, yontem, tekrar]
  const rows = [
    [1, -28, "10:00", 60, 1, "grooming", "completed", 6500, true, "card", true],
    [2, 0, "10:00", 60, 1, "grooming", "confirmed", 6500, false, "", true],
    [3, 28, "10:00", 60, 1, "grooming", "scheduled", 6500, false, "", true],
    [4, -14, "14:00", 45, 3, "nail_trim", "completed", 2000, true, "cash", false],
    [5, -10, "09:30", 30, 3, "walking", "completed", 1500, false, "", false],
    [6, -3, "11:00", 30, 4, "checkup", "cancelled", 3000, false, "", false],
    [7, 0, "14:00", 45, 2, "teeth_cleaning", "scheduled", 4000, false, "", false],
    [8, 2, "10:00", 60, 3, "bath", "scheduled", 5500, false, "", false],
  ];
  const petClient = new Map(pets.map((p) => [p.id, p.clientId]));
  const appointments = rows.map(([n, off, time, duration, pn, service, status, price, paid, method, rec]) =>
    clean("appointments", {
      id: id("A", n),
      clientId: petClient.get(id("P", pn)),
      petId: id("P", pn),
      date: addDays(today, off),
      time, duration, service, status, price, paid, paymentMethod: method,
      recurrenceId: rec ? `R-${id("A", 1)}` : "",
      recurrenceRule: rec ? "every_4_weeks" : "",
      note: status === "cancelled" ? "Owner cancelled by phone." : "",
    }));

  return { clients, pets, appointments };
}
