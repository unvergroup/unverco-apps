// "Load sample year": ornek veri (uydurmadir; gercek kisi / marka yok). Bugunden geriye ~10 ay, belirlenimci (tohumlu) rastgele.
import { addDays, eachDay, weekday } from "./dates.js";
import { templateHabit, TEMPLATES } from "./schema.js";

const plannedOn = (h, d) => (h.schedule.type === "days" ? h.schedule.days.includes(weekday(d)) : true);

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Doner { habits: [alanlar], entries: [{ key, date, value, rest }] } (key: habits dizisindeki sira). */
export function sampleYear(t, today, { days = 300, seed = 2027, weekStart = 1 } = {}) {
  const pick = ["water", "read", "stretch", "meditate", "journal", "phone"];
  const habits = pick.map((id) => templateHabit(TEMPLATES.find((x) => x.id === id), t));
  const start = addDays(today, -days);
  const r = rng(seed);
  const entries = [];
  // Gercekci ama sakin bir yil: aliskanliklar cogunlukla tutulur; birkac aliskanlikta birer "ara" (6-19 gun) olur, ardindan geri donus gelir
  // (toplam ~5 comeback; onayli maketle ayni olcek). Ara gunlerinde sayacli aliskanlik yarim kalabilir. %1 dinlenme gunu.
  const gaps = [1, 1, 0, 1, 1, 1];
  const total = days + 1;
  habits.forEach((h, key) => {
    const off = new Set();
    for (let g = 0; g < gaps[key]; g++) {
      const at = 20 + Math.floor(r() * (total - 60)), len = 6 + Math.floor(r() * 14);
      for (let i = 0; i < len; i++) off.add(addDays(start, at + i));
    }
    let week = [];
    for (const d of eachDay(start, today)) {
      const x = r();
      if (d === today && key % 3 === 2) continue;
      if (h.schedule.type === "weekly") {
        week.push(d);
        if (weekday(addDays(d, 1)) === weekStart || d === today) { // her hafta (secili hafta baslangicina gore) tam hedef kadar gun
          const pick = [...week].sort(() => r() - 0.5).slice(0, h.schedule.times);
          for (const p of pick) if (!off.has(p)) entries.push({ key, date: p, value: 1, rest: false });
          week = [];
        }
        continue;
      }
      if (!plannedOn(h, d)) continue;
      if (x < 0.01) { entries.push({ key, date: d, value: 0, rest: true }); continue; }
      if (off.has(d)) { if (h.kind === "count" && x < 0.5) entries.push({ key, date: d, value: Math.max(1, Math.floor(h.target / 2)), rest: false }); continue; }
      entries.push({ key, date: d, value: h.kind === "count" ? h.target : 1, rest: false });
    }
  });
  return { habits, entries, start };
}

