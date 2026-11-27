// Hash yonlendirme: #/home, #/setup, #/results[/<id>], #/history, #/settings. Bilinmeyen -> home.
export const SCREENS = Object.freeze(["home", "setup", "results", "history", "settings"]);

export function parseRoute(hash, fallback = "home") {
  const parts = String(hash ?? "").replace(/^#\/?/, "").split("/");
  const name = parts[0] ?? "";
  if (!SCREENS.includes(name)) return { name: fallback, param: undefined };
  let param = parts[1] || undefined;
  if (name !== "results" || (param && !/^[A-Za-z0-9]{1,40}$/.test(param))) param = undefined;
  return { name, param };
}
export const keyOf = (r) => `${r.name}/${r.param ?? ""}`;
