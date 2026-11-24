// Demo / tam surum ayrimi. Yalniz yapilandirmaya dayanir; sunucu dogrulamasi yok.
// Demo'da disa aktarim her zaman acik kalir (veri rehin alinmaz).

export class EditionLimitError extends Error {
  constructor(collection, limit) {
    super(`Demo limit reached for "${collection}" (${limit}).`);
    this.name = "EditionLimitError";
    this.code = "limit_reached";
    this.collection = collection;
    this.limit = limit;
  }
}

export function createEdition({ mode = "demo", demoLimits = {} } = {}) {
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
    // Su an `count` kayit varken bir tane daha eklenebilir mi?
    check(collection, count) {
      const limit = limitFor(collection);
      return { ok: count < limit, limit, remaining: Math.max(0, limit - count) };
    },
    // Disa aktarim ve yedek hicbir surumde kilitlenmez.
    canExport: () => true,
    // Sinir denetimiyle ekler; asilirsa EditionLimitError atar.
    async add(store, collection, fields) {
      // Denetim deponun kilidi icinde yapilir: es zamanli ekleme siniri asamaz.
      return store.add(collection, fields, {
        check: (count) => {
          const { ok, limit } = this.check(collection, count);
          if (!ok) throw new EditionLimitError(collection, limit);
        },
      });
    },
  };
}
