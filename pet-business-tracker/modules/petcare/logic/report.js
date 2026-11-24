// Gelir raporu: tamamlanan randevulardan islem satirlari ve CSV metni. Saf islevler: DOM yok, ag yok.
// Rapor satiri = tamamlanmis (completed) randevu; odenmis / odenmemis ayri sutundadir (gelir = tamamlanmis + odenmis; bkz. logic/calc.js).
import { formatMinorPlain } from "../../../core/money.js";
import { csvCell } from "../../../core/backup.js";

/** CSV sutun anahtarlari (sira sabit). */
export const CSV_COLUMNS = Object.freeze(["date", "time", "client", "pet", "service", "amount", "status", "method"]);

/**
 * [from, to] (dahil) araligindaki tamamlanmis randevular, tarih + saate gore ARTAN (muhasebe sirasi).
 * @returns {{ id, date, time, client, pet, service, price, paid, method }[]}
 */
export function transactionRows(data, from, to) {
  const clients = new Map((Array.isArray(data?.clients) ? data.clients : []).map((c) => [c.id, c]));
  const pets = new Map((Array.isArray(data?.pets) ? data.pets : []).map((p) => [p.id, p]));
  return (Array.isArray(data?.appointments) ? data.appointments : [])
    .filter((a) => a && a.status === "completed" && typeof a.date === "string" && a.date >= from && a.date <= to)
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : a.date + a.time > b.date + b.time ? 1 : String(a.id).localeCompare(String(b.id))))
    .map((a) => ({
      id: a.id, date: a.date, time: a.time,
      client: clients.get(a.clientId)?.name ?? "", pet: pets.get(a.petId)?.name ?? "",
      service: a.service, price: Number.isSafeInteger(a.price) ? a.price : 0, paid: a.paid === true, method: a.paymentMethod || "",
    }));
}

/**
 * Satirlari CSV metnine cevirir (basinda UTF-8 BOM: Excel Turkce / Almanca karakterleri dogru acar; satir sonu CRLF).
 * Metin hucrelerinde formul enjeksiyonu engellenir (core/backup.js csvCell). Tutar duz ondalik metindir (para sembolu yok).
 * @param {object[]} rows transactionRows ciktisi
 * @param {{ headers: Record<string,string>, delimiter?: string, decimal?: string, yes: string, no: string, serviceLabel?: (k:string)=>string, methodLabel?: (k:string)=>string }} o
 */
export function csvText(rows, o) {
  const delimiter = o.delimiter === ";" ? ";" : ",";
  const decimal = o.decimal === "," ? "," : ".";
  const serviceLabel = o.serviceLabel ?? ((k) => k);
  const methodLabel = o.methodLabel ?? ((k) => k);
  const cell = (v) => csvCell(v, delimiter);
  const lines = [CSV_COLUMNS.map((k) => cell(o.headers[k] ?? k)).join(delimiter)];
  for (const r of rows) {
    lines.push([
      r.date, r.time, r.client, r.pet, serviceLabel(r.service),
      formatMinorPlain(r.price).replace(".", decimal),
      r.paid ? o.yes : o.no, r.method ? methodLabel(r.method) : "",
    ].map(cell).join(delimiter));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** CSV dosya adi: "unvercopbt-income-2026-11-01_2026-11-30.csv" (tum zamanlar: "unvercopbt-income-all.csv"). */
export function csvFileName(from, to, appId = "unvercopbt") {
  return from <= "0000-01-01" && to >= "9999-12-31" ? `${appId}-income-all.csv` : `${appId}-income-${from}_${to}.csv`;
}
