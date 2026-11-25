// Adres cozumu. Income & Expense Tracker ekranlari: dashboard, entries, mileage, reports, settings.
// "#/reports/pl" -> { name: "reports", param: "pl" } (rapor secimi); bilinmeyen -> varsayilan ekran. settings parametre almaz.
export const SCREENS = Object.freeze(["dashboard", "entries", "mileage", "reports", "settings"]);
const WITH_PARAM = new Set(["reports"]);

export function parseRoute(hash, screenIds = SCREENS, fallback = "dashboard") {
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
