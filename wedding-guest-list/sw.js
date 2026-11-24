// Cevrimdisi onbellek. Surum numarasi config.js ile ayni olmali (test kontrol eder).
// Strateji: once onbellek; yoksa ag; yalniz ayni kaynak (origin) GET istekleri.
// Same as config.js storagePrefix (a test checks): the demo and the full copy keep separate caches on one origin.
const PRODUCT = "unverco-guests";
const VERSION = "1.0.2";
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
  "core/click-guard.js",
  "core/data-actions.js",
  "core/edition.js",
  "core/files.js",
  "core/i18n.js",
  "core/money.js",
  "core/print.css",
  "core/print.js",
  "core/pwa.js",
  "core/settings-screen.js",
  "core/safe.js",
  "core/settings.js",
  "core/store.js",
  "core/sync.js",
  "core/ui.js",
  "modules/guests/data.js",
  "modules/guests/guests.css",
  "modules/guests/import-run.js",
  "modules/guests/index.js",
  "modules/guests/licenses-text.js",
  "modules/guests/logic/cardfit.js",
  "modules/guests/logic/cardlayout.js",
  "modules/guests/logic/checks.js",
  "modules/guests/logic/counts.js",
  "modules/guests/logic/duplicates.js",
  "modules/guests/logic/mapping.js",
  "modules/guests/logic/names.js",
  "modules/guests/logic/normalize.js",
  "modules/guests/logic/parse.js",
  "modules/guests/logic/printdiff.js",
  "modules/guests/logic/sample.js",
  "modules/guests/logic/schema.js",
  "modules/guests/logic/signsort.js",
  "modules/guests/logic/tables.js",
  "modules/guests/messages.js",
  "locales/en.js",
  "locales/es.js",
  "locales/fr.js",
  "locales/de.js",
  "locales/tr.js",
  "modules/guests/parts.js",
  "modules/guests/print-align.js",
  "modules/guests/print-caterer.js",
  "modules/guests/print-cards.js",
  "modules/guests/print-diff.js",
  "modules/guests/print-legibility.js",
  "modules/guests/print-sign.js",
  "modules/guests/view-about.js",
  "modules/guests/view-check.js",
  "modules/guests/view-guests.js",
  "modules/guests/view-import.js",
  "modules/guests/view-print.js",
  "modules/guests/view-tables.js",
  "fonts/Lora-Regular.ttf",
  "fonts/Lora-Medium.ttf",
  "fonts/Lora-SemiBold.ttf",
  "fonts/Lora-Bold.ttf",
  "fonts/KAYNAK.md",
  "fonts/OFL.txt",
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
        .catch(() =>
          req.mode === "navigate" ? caches.match("index.html") : Response.error()
        );
    })
  );
});
