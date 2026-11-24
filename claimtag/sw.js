// Cevrimdisi onbellek. Surum numarasi config.js ile ayni olmali.
// Strateji: once onbellek; yoksa ag; yalniz ayni kaynak (origin) GET istekleri. Uygulama hicbir yere veri gondermez.
const PRODUCT = "claimtag";
const VERSION = "1.0.1";
const CACHE = PRODUCT + "-v" + VERSION;
const PRECACHE = [
  "./",
  "index.html",
  "app.css",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "core/backup.js",
  "core/boot-file.js",
  "core/business.js",
  "core/click-guard.js",
  "core/data-actions.js",
  "core/dates.js",
  "core/edition.js",
  "core/files.js",
  "core/i18n.js",
  "core/line-items.js",
  "core/money.js",
  "core/number-input.js",
  "core/print.css",
  "core/print.js",
  "core/pwa.js",
  "core/route.js",
  "core/safe.js",
  "core/sanitize.js",
  "core/settings-screen.js",
  "core/settings.js",
  "core/store.js",
  "core/sync.js",
  "core/ui.js",
  "modules/repairs/index.js",
  "modules/repairs/messages.js",
  "modules/repairs/repairs.css",
  "modules/repairs/logic/aging.js",
  "modules/repairs/logic/calc.js",
  "modules/repairs/logic/imei.js",
  "modules/repairs/logic/phone.js",
  "modules/repairs/logic/schema.js",
  "modules/repairs/logic/search.js",
  "modules/repairs/logic/status.js",
  "modules/repairs/logic/templates.js",
  "modules/repairs/print/pickup-receipt.js",
  "modules/repairs/print/receipt.js",
  "modules/repairs/views/board.js",
  "modules/repairs/views/checkin.js",
  "modules/repairs/views/common.js",
  "modules/repairs/views/find.js",
  "modules/repairs/views/pickup.js",
  "locales/de.js",
  "locales/en.js",
  "locales/es.js",
  "locales/fr.js",
  "locales/tr.js",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon.svg",
  "icons/maskable.svg",
];

self.addEventListener("install", (event) => {
  // skipWaiting burada YOK: yeni surum, kullanici "Refresh" deyince devreye girer.
  // cache: "reload" -> HTTP onbellegini atla; eski dosya yeni surume girmesin.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(PRODUCT + "-v") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim()) // ilk oturum da hemen denetlensin (cevrimdisi garanti)
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === "navigate" ? caches.match("index.html") : Response.error()))
    })
  );
});
