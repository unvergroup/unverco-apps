// Isletme profilleri (en cok 5): "businesses" koleksiyonu. Her kayit: { id, name, line1, line2 }. Her gelir / gider / yolculuk kaydi
// bir isletmeye baglidir (businessId). Etkin isletme ledgerSettings.activeBusinessId'dedir. En az bir isletme her zaman vardir.
// Yazdirilan raporlarin basliginda etkin isletmenin adi ve iki serbest satiri (adres, e-posta vb.) kullanilir (core/print.js).
import { MAX_BUSINESSES, TEXT_LIMITS, cleanRecord } from "../modules/ledger/logic/schema.js";

export const BUSINESSES = "businesses";
export const DEFAULT_ACCENT = "#0a1536"; // basili rapordaki vurgu cizgisi: lacivert
export const LIMITS_BUSINESS = Object.freeze({ name: TEXT_LIMITS.businessName, line: TEXT_LIMITS.businessLine });

export class BusinessError extends Error {
  constructor(code) { super(code); this.name = "BusinessError"; this.code = code; }
}

// Yazdirma basligi satirlari (bos olanlar atilir).
export const businessLines = (b) => [b?.line1, b?.line2].filter((l) => typeof l === "string" && l);

/** store + ayarlar (ledger) -> { list, get (etkin), activeId, add, update, remove, setActive, ensure } */
export function createBusinesses(store, ledger, { defaultName = "My business" } = {}) {
  const list = async () => (await store.list(BUSINESSES)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const api = {
    list,
    // En az bir isletme olsun ve etkin kimlik gecerli olsun. Doner: etkin isletme.
    async ensure() {
      let all = await list();
      if (!all.length) { await store.add(BUSINESSES, { name: defaultName, line1: "", line2: "" }); all = await list(); }
      const s = await ledger.get();
      let active = all.find((b) => b.id === s.activeBusinessId);
      if (!active) { active = all[0]; await ledger.save({ activeBusinessId: active.id }); }
      return active;
    },
    async get() { return api.ensure(); },
    async activeId() { return (await api.ensure()).id; },
    async add(fields) {
      const clean = cleanRecord(BUSINESSES, fields, { keepMeta: false }).record;
      if (!clean.name) throw new BusinessError("name_required");
      return store.add(BUSINESSES, clean, { check: (n) => { if (n >= MAX_BUSINESSES) throw new BusinessError("max_businesses"); } });
    },
    async update(id, fields) {
      const clean = cleanRecord(BUSINESSES, fields, { keepMeta: false }).record;
      if (!clean.name) throw new BusinessError("name_required");
      return store.update(BUSINESSES, id, clean);
    },
    async setActive(id) { await ledger.save({ activeBusinessId: id }); },
    // Isletmeyi ve ona bagli butun kayitlari / yolculuklari TEK atomik islemde siler. Son isletme silinemez.
    async remove(id) {
      await store.transactMany([BUSINESSES, "entries", "trips"], (tx) => {
        if (tx.count(BUSINESSES) <= 1) throw new BusinessError("last_business");
        for (const e of tx.list("entries").filter((r) => r.businessId === id)) tx.remove("entries", e.id);
        for (const t of tx.list("trips").filter((r) => r.businessId === id)) tx.remove("trips", t.id);
        tx.remove(BUSINESSES, id);
      });
      const s = await ledger.get();
      if (s.activeBusinessId === id) await ledger.save({ activeBusinessId: "" });
      await api.ensure();
    },
  };
  return api;
}
