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
  stale_currency: "error.staleCurrency",
  bad_data: "backup.error.invalid_file",
  bad_name: "backup.error.invalid_file",
  limit_reached: "error.limit",
  max_businesses: "biz.max",
  last_business: "biz.last",
  name_required: "msg.required",
};

export function errorKey(e) {
  if (e && (e.name === "QuotaExceededError" || e.code === 22 || e.name === "NS_ERROR_DOM_QUOTA_REACHED")) return "error.quota";
  if (e && typeof e.code === "string" && BY_CODE[e.code]) return BY_CODE[e.code];
  return "error.generic";
}

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

// Kazara ikinci tik "ayni EYLEM" degil "ayni YER, kisa sure" olgusudur: yeniden cizimden sonra imlecin altina BASKA bir dugme gelebilir.
// Bu yuzden sessizlik KONUMA baglidir: korumali bir isaretci (fare / dokunma) tiklamasi islendikten sonra QUIET_MS icinde, ilk tiktan
// NEAR_PX (CSS px) yaricapindaki sonraki isaretci tiklamasi, hangi dugme olursa olsun yutulur (guardWrite sarmalayicilari ve onay
// penceresi dugmeleri ortak sayac kullanir). Baska noktaya tik, klavye ile etkinlestirme (event.detail === 0) ve `change` denetimleri
// ASLA yutulmaz. Dugmeler yutulan tik icin kapatilmaz; islem surerken dugme disabled + aria-busy, hatada da biter.
export const QUIET_MS = 800;
export const NEAR_PX = 24;
let lastPt = null; // son ISLENEN korumali isaretci tiklamasi: { x, y, t }
let lastClick = null; // belgedeki son tiklama (form gonderiminin hangi tiktan geldigini bilmek icin)
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("click", (e) => { lastClick = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target, pointer: e.detail > 0 }; }, true);
}
const finite = (n) => typeof n === "number" && Number.isFinite(n);
function pointOf(ev) {
  if (!ev || typeof ev !== "object") return null;
  if (ev.type === "submit") { // gonder dugmesine fare ile basildiysa konum, hemen onceki tiklamadan gelir (Enter ile gonderimde yok)
    const c = lastClick;
    const same = c && ev.submitter && (c.target === ev.submitter || (typeof ev.submitter.contains === "function" && ev.submitter.contains(c.target)));
    return c && c.pointer && same && Date.now() - c.t < 100 && finite(c.x) && finite(c.y) ? { x: c.x, y: c.y } : null;
  }
  return ev.detail > 0 && finite(ev.clientX) && finite(ev.clientY) ? { x: ev.clientX, y: ev.clientY } : null;
}
const nearLast = (p) => Boolean(p && lastPt && Date.now() - lastPt.t < QUIET_MS && Math.hypot(p.x - lastPt.x, p.y - lastPt.y) <= NEAR_PX);
// Onay penceresi dugmeleri: true ise bu tik ayni noktaya gelen ikinci tiktir (yutulmali).
export const pointerQuiet = (ev) => nearLast(pointOf(ev));
// Onay penceresi dugmesine yapilan (yutulmayan) tik de konumu kaydeder: pencere kapaninca ayni noktaya gelen ikinci tik yutulur.
export function notePointer(ev) { const p = pointOf(ev); if (p) lastPt = { x: p.x, y: p.y, t: Date.now() }; }

// Yazma islemi sarmalayicisi (cift tikla / cift Enter ikinci kayit uretmez).
// Ayni anahtar islem SURERKEN yeniden girilemez (anahtar: dizgi ya da (...args) => dizgi; verilmezse sarmalayiciya ozeldir).
// Islem surerken tetikleyen dugme disabled + aria-busy; islem bitince (hatada da) acilir. Hata onError'a gider.
// Form gonderiminde sayfa yenilenmesin diye preventDefault cagrilir.
export function guardWrite(onError) {
  const busy = new Set();
  let anon = 0;
  const guard = (fn, key) => {
    const own = `anon:${++anon}`;
    return async (...args) => {
      const ev = args[0];
      if (ev && typeof ev === "object" && typeof ev.preventDefault === "function" && ev.type === "submit") ev.preventDefault();
      const k = typeof key === "function" ? key(...args) : key ?? own;
      if (busy.has(k)) return undefined;
      const pt = pointOf(ev);
      if (nearLast(pt)) return undefined; // ayni noktaya ikinci tik
      if (pt) lastPt = { x: pt.x, y: pt.y, t: Date.now() };
      const btns = [];
      if (ev && typeof ev === "object") {
        for (const b of [ev.submitter, ev.currentTarget]) {
          if (b && b.tagName === "BUTTON" && !b.disabled && !btns.includes(b)) btns.push(b);
        }
      }
      busy.add(k);
      for (const b of btns) { b.disabled = true; b.setAttribute?.("aria-busy", "true"); }
      try {
        return await fn(...args);
      } catch (e) {
        if (onError) onError(e);
        else throw e;
        return undefined;
      } finally {
        busy.delete(k);
        for (const b of btns) { b.disabled = false; b.removeAttribute?.("aria-busy"); }
      }
    };
  };
  return guard;
}

// `change` denetimleri (onay kutusu, secici) HIC yutulmaz: yazmalar siraya girer, hepsi sirayla yazilir (son deger kazanir) ve
// sira bosalinca settle() cagrilir (ekrani depodaki degerle esitler; hatada da). Deger olay aninda okunup args ile verilir.
export function serialWrite(onError) {
  let chain = Promise.resolve();
  let pending = 0;
  return (fn, settle) => (...args) => {
    pending++;
    chain = chain
      .then(() => fn(...args))
      .catch((e) => { if (onError) onError(e); })
      .then(async () => {
        pending--;
        if (pending === 0 && settle) { try { await settle(); } catch (e) { if (onError) onError(e); } }
      });
    return chain;
  };
}
