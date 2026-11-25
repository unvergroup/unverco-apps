// Demo / tam surum ayrimi (ayni mekanizma tum urunlerde). Yalniz yapilandirmaya dayanir; sunucu dogrulamasi yok.
// Demo'da disa aktarim her zaman acik kalir (veri rehin alinmaz). Homeschool Planner tek urun: surum tablosunda tek kayit.

export class EditionLimitError extends Error {
  constructor(collection, limit) {
    super(`Demo limit reached for "${collection}" (${limit}).`);
    this.name = "EditionLimitError";
    this.code = "limit_reached";
    this.collection = collection;
    this.limit = limit;
  }
}

export function createEdition({ mode = "full", demoLimits = {} } = {}) {
  if (mode !== "demo" && mode !== "full") {
    throw new Error(`Unknown edition mode: ${mode}`);
  }
  const isDemo = mode === "demo";
  const limitFor = (collection) => {
    const l = demoLimits[collection];
    return isDemo && Number.isInteger(l) && l >= 0 ? l : Infinity;
  };
  return {
    mode,
    isDemo,
    limitFor,
    check(collection, count) {
      const limit = limitFor(collection);
      return { ok: count < limit, limit, remaining: Math.max(0, limit - count) };
    },
    canExport: () => true,
  };
}

// Paketleyici (scripts/tek-dosya.py) yalniz ad ve onek ekler; tek urun, tek surum.
export const EDITION_MODULES = Object.freeze({
  hs: Object.freeze(["homeschool"]),
});

// Depo adlari moda gore ayrilir (demo "-demo", onizleme "-preview"); tam surum storagePrefix'in kendisidir.
export function storageNamespace({ storagePrefix, mode, preview } = {}) {
  const suffix = preview === true ? "-preview" : mode === "demo" ? "-demo" : "";
  return suffix && !String(storagePrefix).endsWith(suffix) ? `${storagePrefix}${suffix}` : String(storagePrefix);
}
