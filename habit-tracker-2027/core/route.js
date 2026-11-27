// Hash yonlendirme: #/welcome, #/today, #/month/<yyyy-mm>, #/year/<yyyy>, #/habits, #/more. Bilinmeyen -> varsayilan.
export const SCREENS = Object.freeze(["welcome", "today", "month", "year", "habits", "more"]);

export function parseRoute(hash, fallback = "today") {
  const parts = String(hash ?? "").replace(/^#\/?/, "").split("/");
  const name = parts[0] ?? "";
  if (!SCREENS.includes(name)) return { name: fallback, param: undefined };
  let param = parts[1] || undefined;
  if (name === "month" && param && !/^\d{4}-(0[1-9]|1[0-2])$/.test(param)) param = undefined;
  if (name === "year" && param && !/^\d{4}$/.test(param)) param = undefined;
  if (!["month", "year"].includes(name)) param = undefined;
  return { name, param };
}
export const keyOf = (r) => `${r.name}/${r.param ?? ""}`;
