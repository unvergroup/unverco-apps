// Adres cozumu. // "#/pickup/abc" -> { name: "pickup", param: "abc" }; "#/job/abc" -> pickup/abc; bilinmeyen -> varsayilan ekran
export function parseRoute(hash, screenIds, fallback) {
  const parts = String(hash ?? "").replace(/^#\/?/, "").split("/");
  let name = parts[0] ?? "";
  if (name === "job") name = "pickup";
  const param = parts[1] ? decodeURIComponent(parts[1]) : undefined;
  if (name === "settings") return { name, param: undefined };
  if (!screenIds.includes(name)) return { name: fallback, param: undefined };
  return { name, param: name === "pickup" ? param : undefined };
}
export const keyOf = (r) => `${r.name}/${r.param ?? ""}`;

