// Isletme profili: isletme adi, telefon, adres, LOGO, logo notu, vurgu rengi. Cihazdaki depoda ("business" koleksiyonu,
// tek kayit) durur; yedege girer. Yazdirilan belgelerin (randevu fisi, musteri karti, gelir raporu) basliginda ve uygulama
// basliginin sag ust kosesinde kullanilir (core/print.js, app.js).
// logo: alicinin KENDI isletme logosu; cihazda yeniden kodlanmis PNG data-URL metni (core/logo.js). Bos ise HICBIR yer tutucu gosterilmez.

import { isLogoDataUrl } from "./logo.js";

export const BUSINESS = "business";
export const BUSINESS_ID = "profile";
export const DEFAULT_ACCENT = "#d4af37"; // Homeschool Planner birincil rengi (altin)
export const LIMITS_BUSINESS = Object.freeze({ name: 120, phone: 40, address: 200, logoNote: 200 });

export const DEFAULT_BUSINESS = Object.freeze({ name: "", phone: "", address: "", logo: "", logoNote: "", accent: DEFAULT_ACCENT });

// Telefon: en az 6, en cok 15 rakam; rakam disinda yalniz bosluk, + ( ) - . izinli. Bos deger gecerli degildir (cagiran bos kontrol eder).
export function validatePhone(raw) {
  const v = String(raw ?? "").trim();
  if (!/^\+?[0-9 ()\-.]+$/.test(v)) return { ok: false };
  const digits = v.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15 ? { ok: true, value: v } : { ok: false };
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function sanitizeBusiness(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const phone = str(s.phone, LIMITS_BUSINESS.phone);
  return {
    name: str(s.name, LIMITS_BUSINESS.name),
    phone: phone === "" || validatePhone(phone).ok ? phone : "",
    address: str(s.address, LIMITS_BUSINESS.address),
    logo: isLogoDataUrl(s.logo) ? s.logo : "", // gecersiz / cok buyuk / svg logo sessizce dusurulur
    logoNote: str(s.logoNote, LIMITS_BUSINESS.logoNote),
    accent: typeof s.accent === "string" && /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent.toLowerCase() : DEFAULT_ACCENT.toLowerCase(),
  };
}

// Yazdirma basligi satirlari: telefon + adres (bos olanlar atilir).
export const businessLines = (b) => [b?.phone, b?.address].filter((l) => typeof l === "string" && l);

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
