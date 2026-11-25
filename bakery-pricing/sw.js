// Bakery Pricing & Orders cevrimdisi onbellek (scripts/sw-uret.py uretir; surum config.js ile ayni).
// Strateji: once onbellek; yoksa ag; yalniz ayni kaynak (origin) GET istekleri. Uygulama hicbir yere veri gondermez.
const PRODUCT = "unvercobpo";
const VERSION = "1.0.3";
const CACHE = PRODUCT + "-v" + VERSION;
const PRECACHE = [
  "./",
  "index.html",
  "app.css",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "apple-touch-icon-180.png",
  "favicon-32.png",
  "icon-192.png",
  "icon-512-maskable.png",
  "icon-512.png",
  "core/backup.js",
  "core/boot-file.js",
  "core/business.js",
  "core/canvas-doc.js",
  "core/click-guard.js",
  "core/data-actions.js",
  "core/dates.js",
  "core/edition.js",
  "core/files.js",
  "core/i18n.js",
  "core/icons.js",
  "core/logo.js",
  "core/money.js",
  "core/number-input.js",
  "core/pdf.js",
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
  "modules/bakery/index.js",
  "modules/bakery/logic/costing.js",
  "modules/bakery/logic/migrations.js",
  "modules/bakery/logic/orders.js",
  "modules/bakery/logic/plan.js",
  "modules/bakery/logic/sales.js",
  "modules/bakery/logic/sample.js",
  "modules/bakery/logic/schema.js",
  "modules/bakery/logic/units.js",
  "modules/bakery/print/docs.js",
  "modules/bakery/print/render.js",
  "modules/bakery/print/screens.js",
  "modules/bakery/views/common.js",
  "modules/bakery/views/ingredients.js",
  "modules/bakery/views/orders.js",
  "modules/bakery/views/plan.js",
  "modules/bakery/views/recipes.js",
  "modules/bakery/views/sales.js",
  "locales/de.js",
  "locales/en.js",
  "locales/es.js",
  "locales/fr.js",
  "locales/pt.js",
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
        .catch(() => (req.mode === "navigate" ? caches.match("index.html") : Response.error()));
    })
  );
});
