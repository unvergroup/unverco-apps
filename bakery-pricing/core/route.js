// Adres cozumu. Ekranlar: orders, recipes, ingredients, plan, sales, settings.
// "#/orders/<id>" -> siparis ayrintisi acilir; "#/plan/2026-11-23" -> o haftanin plani; "#/sales/2026-11" -> o ay; bilinmeyen -> varsayilan ekran.
export const SCREENS = Object.freeze(["orders", "recipes", "ingredients", "plan", "sales", "settings"]);
const WITH_PARAM = new Set(["orders", "recipes", "plan", "sales"]);

export function parseRoute(hash, screenIds = SCREENS, fallback = "orders") {
  const parts = String(hash ?? "").replace(/^#\/?/, "").split("/");
  const name = parts[0] ?? "";
  let param;
  try {
    param = parts[1] ? decodeURIComponent(parts[1]) : undefined;
  } catch {
    param = undefined; // bozuk % dizisi uygulamayi dusurmesin
  }
  if (name === "settings") return { name, param: undefined };
  if (!screenIds.includes(name)) return { name: fallback, param: undefined };
  return { name, param: WITH_PARAM.has(name) ? param : undefined };
}
export const keyOf = (r) => `${r.name}/${r.param ?? ""}`;
export const hashFor = (name, param) => `#/${name}${param ? `/${encodeURIComponent(param)}` : ""}`;
