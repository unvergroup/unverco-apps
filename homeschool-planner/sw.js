// Homeschool Planner cevrimdisi onbellek. Surum numarasi config.js ile ayni olmali.
// Strateji: once onbellek; yoksa ag; yalniz ayni kaynak (origin) GET istekleri. Uygulama hicbir yere veri gondermez.
// Onbellege tum JS / CSS dosyalari, 5 dil dosyasi, manifest VE simge dosyalari girer (asagidaki PRECACHE listesi).
const PRODUCT = "unvercohsp";
const VERSION = "1.0.1";
const CACHE = PRODUCT + "-v" + VERSION;
const PRECACHE = [
  "./",
  "index.html",
  "app.css",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon-180.png",
  "favicon-32.png",
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
  "modules/homeschool/logic/calc.js",
  "modules/homeschool/logic/csv.js",
  "modules/homeschool/logic/migrations.js",
  "modules/homeschool/logic/sample.js",
  "modules/homeschool/logic/schema.js",
  "modules/homeschool/print/docs.js",
  "modules/homeschool/print/render.js",
  "modules/homeschool/print/screens.js",
  "modules/homeschool/views/common.js",
  "modules/homeschool/views/kids.js",
  "modules/homeschool/views/library.js",
  "modules/homeschool/views/plan.js",
  "modules/homeschool/views/records.js",
  "modules/homeschool/views/today.js",
  "locales/en.js",
  "locales/es.js",
  "locales/fr.js",
  "locales/de.js",
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
