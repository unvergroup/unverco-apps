// Isletme profili: isletme adi, iletisim satirlari, vurgu rengi. Cihazdaki depoda ("business" koleksiyonu,
// tek kayit) durur; yedege girer. Yazdirilan belgelerin basliginda kullanilir (core/print.js).

export const BUSINESS = "business";
export const BUSINESS_ID = "profile";
export const MAX_CONTACT_LINES = 6;
export const DEFAULT_ACCENT = "#1f4e79";

export const DEFAULT_BUSINESS = Object.freeze({ name: "", lines: Object.freeze([]), accent: DEFAULT_ACCENT });

export function sanitizeBusiness(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const lines = (Array.isArray(s.lines) ? s.lines : [])
    .filter((l) => typeof l === "string")
    .map((l) => l.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, MAX_CONTACT_LINES);
  return {
    name: typeof s.name === "string" ? s.name.trim().slice(0, 120) : "",
    lines,
    accent: typeof s.accent === "string" && /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent.toLowerCase() : DEFAULT_ACCENT,
  };
}

// Metin kutusundaki satirlar <-> dizi.
export const linesFromText = (text) => sanitizeBusiness({ lines: String(text ?? "").split(/\r?\n/) }).lines;
export const linesToText = (lines) => (lines ?? []).join("\n");

export function createBusinessProfile(store) {
  return {
    async get() {
      const rec = (await store.list(BUSINESS)).find((r) => r.id === BUSINESS_ID);
      return sanitizeBusiness(rec);
    },
    async save(patch) {
      const clean = sanitizeBusiness(patch);
      await store.transact(BUSINESS, (list) => {
        const t = new Date().toISOString();
        const old = list.find((r) => r.id === BUSINESS_ID);
        const { sample, ...mine } = old ?? { createdAt: t }; // kullanici kaydedince ornek isareti kalkar
        const rec = { ...mine, ...clean, id: BUSINESS_ID, updatedAt: t };
        return { list: [...list.filter((r) => r.id !== BUSINESS_ID), rec], result: null };
      });
      return clean;
    },
  };
}
