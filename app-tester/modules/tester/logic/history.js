// Gecmis: onceki ice aktarimlar, yalniz bu cihazin localStorage'inda (en cok 50). Ag yok. Bozuk kayit uygulamayi kilitlemez:
// okunamayan metin "corrupt:<zaman>:<anahtar>" altina tasinir; gecersiz girdiler atilir (depo elle bozulmus olabilir).
import { validateResults } from "./validate.js";

export const MAX_HISTORY = 50;

export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, volatile: true };
}

export function pickStorage(g = globalThis) {
  try {
    const ls = g.localStorage;
    if (!ls) return memoryStorage();
    const k = "__unverco_probe__";
    ls.setItem(k, "1"); ls.removeItem(k);
    return ls;
  } catch { return memoryStorage(); }
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function createHistory({ storage = pickStorage(), prefix = "unverco-app-tester", max = MAX_HISTORY, now = () => new Date() } = {}) {
  const key = `${prefix}:history`;
  let corrupted = false;

  function read() {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined) return [];
    let arr;
    try { arr = JSON.parse(raw); if (!Array.isArray(arr)) throw new Error("not array"); } catch {
      try { storage.setItem(`corrupt:${now().getTime()}:${key}`, raw); storage.removeItem(key); } catch { /* kota */ }
      corrupted = true;
      return [];
    }
    const out = [];
    for (const e of arr) {
      if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.importedAt !== "string") continue;
      const v = validateResults(e.data);
      if (!v.ok) continue;
      out.push({ id: e.id, importedAt: e.importedAt, name: typeof e.name === "string" ? e.name.slice(0, 200) : "", source: ["file", "paste", "sample"].includes(e.source) ? e.source : "file", data: v.data });
    }
    return out;
  }
  const write = (list) => storage.setItem(key, JSON.stringify(list));

  return {
    key,
    get volatile() { return storage.volatile === true; },
    takeCorrupted() { const c = corrupted; corrupted = false; return c; },
    /** En yeni basta. */
    list: () => read(),
    get: (id) => read().find((e) => e.id === id) ?? null,
    latest: () => read()[0] ?? null,
    /** data: validateResults'tan gecmis nesne. Kota dolarsa en eski kayitlar atilarak yeniden denenir; yine olmazsa hata firlatir. */
    add(data, { name = "", source = "file" } = {}) {
      const entry = { id: newId(), importedAt: now().toISOString(), name, source, data };
      let list = [entry, ...read()].slice(0, max);
      for (;;) {
        try { write(list); return entry; } catch (e) {
          if (list.length <= 1) throw e;
          list = list.slice(0, -1);
        }
      }
    },
    remove(id) { write(read().filter((e) => e.id !== id)); },
    clear() { storage.removeItem(key); },
    exportAll() { return { app: "unverco-app-tester", exported_at: now().toISOString(), entries: read() }; },
  };
}
