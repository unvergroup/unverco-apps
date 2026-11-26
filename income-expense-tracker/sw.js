// Income & Expense Tracker cevrimdisi onbellek. Surum numarasi config.js ile ayni olmali.
// Strateji: once onbellek; yoksa ag; yalniz ayni kaynak (origin) GET istekleri. Uygulama hicbir yere veri gondermez.
// Onbellege tum JS / CSS dosyalari, 5 dil dosyasi, manifest VE simge dosyalari girer (asagidaki PRECACHE listesi).
const PRODUCT = "unvercoiet";
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
  "modules/ledger/logic/calc.js",
  "modules/ledger/logic/csv.js",
  "modules/ledger/logic/migrations.js",
  "modules/ledger/logic/mileage.js",
  "modules/ledger/logic/sample.js",
  "modules/ledger/logic/schema.js",
  "modules/ledger/print/docs.js",
  "modules/ledger/print/render.js",
  "modules/ledger/views/common.js",
  "modules/ledger/views/dashboard.js",
  "modules/ledger/views/entries.js",
  "modules/ledger/views/import.js",
  "modules/ledger/views/manage.js",
  "modules/ledger/views/mileage.js",
  "modules/ledger/views/receipt.js",
  "modules/ledger/views/reports.js",
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
