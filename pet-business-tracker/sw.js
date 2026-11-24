// Pet Business Tracker cevrimdisi onbellek. Surum numarasi config.js ile ayni olmali.
// Strateji: once onbellek; yoksa ag; yalniz ayni kaynak (origin) GET istekleri. Uygulama hicbir yere veri gondermez.
// Onbellege tum JS / CSS dosyalari, 5 dil dosyasi, manifest VE simge dosyalari girer (asagidaki PRECACHE listesi).
const PRODUCT = "unvercopbt";
const VERSION = "1.3.1";
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
  "core/click-guard.js",
  "core/data-actions.js",
  "core/dates.js",
  "core/edition.js",
  "core/files.js",
  "core/i18n.js",
  "core/logo.js",
  "core/money.js",
  "core/number-input.js",
  "core/pdf.js",
  "core/canvas-doc.js",
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
  "core/icons.js",
  "modules/petcare/index.js",
  "modules/petcare/logic/appointments.js",
  "modules/petcare/logic/calc.js",
  "modules/petcare/logic/expenses.js",
  "modules/petcare/logic/migrations.js",
  "modules/petcare/logic/pets.js",
  "modules/petcare/logic/recurrence.js",
  "modules/petcare/logic/reminders.js",
  "modules/petcare/logic/report.js",
  "modules/petcare/logic/schema.js",
  "modules/petcare/logic/search.js",
  "modules/petcare/logic/status.js",
  "modules/petcare/logic/templates.js",
  "modules/petcare/print/client-card.js",
  "modules/petcare/print/receipt.js",
  "modules/petcare/print/docs.js",
  "modules/petcare/print/render.js",
  "modules/petcare/print/screens.js",
  "modules/petcare/views/calendar.js",
  "modules/petcare/views/clients.js",
  "modules/petcare/views/common.js",
  "modules/petcare/views/expenses.js",
  "modules/petcare/views/income.js",
  "modules/petcare/views/photo.js",
  "modules/petcare/views/reminders.js",
  "modules/petcare/views/today.js",
  "locales/en.js",
  "locales/es.js",
  "locales/fr.js",
  "locales/de.js",
  "locales/tr.js",
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
