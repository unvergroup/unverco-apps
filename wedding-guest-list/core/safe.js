// Hata -> kullaniciya gosterilecek sozluk anahtari; cift gonderim korumasi.

const BY_CODE = {
  not_found: "error.not_found",
  no_storage: "storage.error",
  newer_schema: "backup.error.newer_schema",
  invalid_file: "backup.error.invalid_file",
  wrong_app: "backup.error.wrong_app",
  checksum: "backup.error.checksum",
  too_large: "backup.error.too_large",
  too_many: "backup.error.too_many",
  demo_limit: "backup.error.demo_limit",
  bad_data: "backup.error.invalid_file",
  bad_name: "backup.error.invalid_file",
};

export function errorKey(e) {
  if (e && (e.name === "QuotaExceededError" || e.code === 22 || e.name === "NS_ERROR_DOM_QUOTA_REACHED")) return "error.quota";
  if (e && typeof e.code === "string" && BY_CODE[e.code]) return BY_CODE[e.code];
  return "error.generic";
}

// --- Cift tik korumasi: onay penceresi icin ---
// QUIET_MS icinde NEAR_PX yaricapina gelen ikinci tik yutulur.
export const QUIET_MS = 800;
export const NEAR_PX = 24;
let lastPt = null;
let lastClick = null;
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("click", (e) => { lastClick = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target, pointer: e.detail > 0 }; }, true);
}
const finite = (n) => typeof n === "number" && Number.isFinite(n);
function pointOf(ev) {
  if (!ev || typeof ev !== "object") return null;
  if (ev.type === "submit") {
    const c = lastClick;
    const same = c && ev.submitter && (c.target === ev.submitter || (typeof ev.submitter.contains === "function" && ev.submitter.contains(c.target)));
    return c && c.pointer && same && Date.now() - c.t < 100 && finite(c.x) && finite(c.y) ? { x: c.x, y: c.y } : null;
  }
  return ev.detail > 0 && finite(ev.clientX) && finite(ev.clientY) ? { x: ev.clientX, y: ev.clientY } : null;
}
const nearLast = (p) => Boolean(p && lastPt && Date.now() - lastPt.t < QUIET_MS && Math.hypot(p.x - lastPt.x, p.y - lastPt.y) <= NEAR_PX);
export const pointerQuiet = (ev) => nearLast(pointOf(ev));
export function notePointer(ev) { const p = pointOf(ev); if (p) lastPt = { x: p.x, y: p.y, t: Date.now() }; }

// Onceki cagri bitmeden gelen cagrilari yok sayar (cift tikla gonder).
export function singleFlight(fn) {
  let busy = false;
  return async (...args) => {
    if (busy) return undefined;
    busy = true;
    try {
      return await fn(...args);
    } finally {
      busy = false;
    }
  };
}
