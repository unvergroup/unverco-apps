// Depo goc adimlari (core/store.js migrations): { hedefSurum: (data) => data }. Saf islevler: DOM yok, ag yok.
// Surum 1 -> 2: gider kaydi (expenses) eklendi. Eski veride / eski yedekte koleksiyon yoktur; bos liste olarak eklenir, mevcut hicbir kayit degismez.
export const MIGRATIONS = Object.freeze({
  2: (data) => ({ ...data, expenses: Array.isArray(data?.expenses) ? data.expenses : [] }),
});
