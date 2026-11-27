// CSV disa aktarim: date,habit,value,target,unit,status (status: done / partial / rest). Formul enjeksiyonu kacisi core/backup.js csvCell.
import { toCsv } from "../../../core/backup.js";
import { dayStatus, targetOf } from "./calc.js";

export function habitsCsv(habits, entries) {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const rows = entries
    .filter((e) => byId.has(e.habitId))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byId.get(a.habitId).order - byId.get(b.habitId).order))
    .map((e) => {
      const h = byId.get(e.habitId);
      return { date: e.date, habit: h.name, value: e.rest ? 0 : e.value, target: targetOf(h), unit: h.kind === "count" ? h.unit || "" : "", status: dayStatus(h, e) };
    });
  return toCsv(rows, ["date", "habit", "value", "target", "unit", "status"].map((k) => ({ key: k, label: k })));
}
