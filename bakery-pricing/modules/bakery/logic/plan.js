// Haftalik uretim plani ve alisveris listesi (saf). Hafta: yerel takvime gore Pazar (en-US, en-CA, pt-BR) ya da Pazartesi baslar.
import { addDays, startOfWeek } from "../../../core/dates.js";
import { ACTIVE, byWhen, requirements } from "./orders.js";

const SUNDAY_LOCALES = /^(en-US|en-CA|pt-BR|es-MX)\b/;
/** core/dates.js weekStartsOn: 0 = Pazartesi ... 6 = Pazar. */
export const weekStartFor = (locale) => (SUNDAY_LOCALES.test(String(locale)) ? 6 : 0);
export function weekRange(iso, locale) {
  const from = startOfWeek(iso, weekStartFor(locale));
  return { from, to: addDays(from, 6) };
}
export const inRange = (o, r) => o.date >= r.from && o.date <= r.to;

/**
 * Haftanin plani. Uretime yalniz onayli ve hazirlanan siparisler girer (sorgu henuz kesin degil; ayri sayilir).
 * Donus: { range, orders (sirali), byRecipe: [{ name, qty, batches, yieldQty }], shopping (requirements), inquiries }
 */
export function weekPlan({ orders, recipes, ingredients }, range) {
  const list = orders.filter((o) => ACTIVE.includes(o.status) && inRange(o, range)).sort(byWhen);
  const inquiries = orders.filter((o) => o.status === "inquiry" && inRange(o, range)).length;
  const rById = new Map(recipes.map((r) => [r.id, r]));
  const agg = new Map();
  for (const o of list) {
    for (const it of o.items ?? []) {
      const r = it.recipeId ? rById.get(it.recipeId) : null;
      const key = r ? r.id : `name:${it.name}`;
      const cur = agg.get(key) ?? { name: r ? r.name : it.name, qty: 0, yieldQty: r ? r.yieldQty : null, yieldUnit: r ? r.yieldUnit : "" };
      cur.qty += it.qty;
      agg.set(key, cur);
    }
  }
  const byRecipe = [...agg.values()].map((x) => ({ ...x, qty: Math.round(x.qty * 1000) / 1000, batches: x.yieldQty ? Math.round((x.qty / x.yieldQty) * 100) / 100 : null }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { range, orders: list, byRecipe, shopping: requirements(list, recipes, ingredients), inquiries };
}
