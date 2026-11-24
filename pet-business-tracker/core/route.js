// Adres cozumu. Pet Business Tracker ekranlari: today, calendar, clients, reminders, income, settings.
// "#/clients/abc" -> { name: "clients", param: "abc" } (musteri ayrintisi); "#/client/abc" -> clients/abc;
// "#/calendar/2026-11-23" -> takvim o gunde; bilinmeyen -> varsayilan ekran. settings parametre almaz.
export const SCREENS = Object.freeze(["today", "calendar", "clients", "reminders", "income", "settings"]);
const WITH_PARAM = new Set(["clients", "calendar"]);

export function parseRoute(hash, screenIds = SCREENS, fallback = "today") {
  const parts = String(hash ?? "").replace(/^#\/?/, "").split("/");
  let name = parts[0] ?? "";
  if (name === "client") name = "clients";
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
