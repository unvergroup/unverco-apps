// Adres cozumu. Homeschool Planner ekranlari: today, plan, records, library, kids, settings.
// "#/today/2026-11-23" -> Bugun ekrani o gunde (gecmis gune kayit); "#/kids/<id>" -> o cocuk secili; bilinmeyen -> varsayilan ekran.
export const SCREENS = Object.freeze(["today", "plan", "records", "library", "kids", "settings"]);
const WITH_PARAM = new Set(["today", "kids", "plan", "records"]);

export function parseRoute(hash, screenIds = SCREENS, fallback = "today") {
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
