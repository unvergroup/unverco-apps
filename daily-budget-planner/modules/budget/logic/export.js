// Kayitlarin CSV disa aktarimi (saf). BOM + baslik, tarih sirali, formul enjeksiyonu engelli (csvCell), ondalik virgullu yerelde ";".
import { csvCell } from "../../../core/backup.js";
import { moneyDigits } from "../../../core/money.js";

export function transactionsCsv(transactions, { headers, delimiter = ",", decimal = ".", digits = moneyDigits(), envName, typeName, sourceName }) {
  const amt = (minor) => {
    const a = Math.abs(minor);
    const unit = 10 ** digits; // kurus basamagi aktif para biriminden (core/money.js)
    const s = `${minor < 0 ? "-" : ""}${Math.floor(a / unit)}${digits ? "." + String(a % unit).padStart(digits, "0") : ""}`;
    return decimal === "," ? s.replace(".", ",") : s;
  };
  const signed = (t) => (t.type === "expense" ? -t.amountMinor : t.amountMinor);
  const cell = (v) => csvCell(v, delimiter);
  const cols = ["date", "type", "amount", "envelope", "note", "source", "billDue"];
  const lines = [cols.map((c) => cell(headers[c])).join(delimiter)];
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt ?? "") < String(b.createdAt ?? "") ? -1 : 1));
  for (const t of sorted) {
    const a = amt(signed(t));
    lines.push([cell(t.date), cell(typeName(t.type)), a.includes(delimiter) ? `"${a}"` : a, cell(t.type === "expense" ? envName(t.envelopeId) : ""), cell(t.note ?? ""), cell(sourceName(t.source ?? "manual")), cell(t.billDue ?? "")].join(delimiter));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
