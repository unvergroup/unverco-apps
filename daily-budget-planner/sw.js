// Daily Budget Planner cevrimdisi onbellek. Surum config.js ile ayni olmali (tests/files.test.mjs denetler).
// Strateji: once onbellek; yoksa ag; yalniz ayni kaynak GET istekleri. Uygulama hicbir yere veri gondermez.
const PRODUCT = "unverco-daily-budget";
const VERSION = "1.0.0";
const CACHE = PRODUCT + "-v" + VERSION;
const PRECACHE = [
  "./",
  "LICENSES.txt",
  "app.css",
  "app.js",
  "apple-touch-icon-180.png",
  "config.js",
  "core/backup.js",
  "core/boot-file.js",
  "core/click-guard.js",
  "core/dates.js",
  "core/files.js",
  "core/i18n.js",
  "core/icons.js",
  "core/money.js",
  "core/number-input.js",
  "core/pdf.js",
  "core/print.js",
  "core/pwa.js",
  "core/sanitize.js",
  "core/store.js",
  "core/sync.js",
  "core/ui.js",
  "favicon-32.png",
  "icon-192.png",
  "icon-512-maskable.png",
  "icon-512.png",
  "icons/app-icon-96.png",
  "icons/unverco-logo-altin.png",
  "icons/unverco-logo-mavi.png",
  "index.html",
  "locales/de.js",
  "locales/en.js",
  "locales/es.js",
  "locales/fr.js",
  "locales/pt.js",
  "manifest.webmanifest",
  "modules/budget/logic/actions.js",
  "modules/budget/logic/csv.js",
  "modules/budget/logic/data.js",
  "modules/budget/logic/engine.js",
  "modules/budget/logic/export.js",
  "modules/budget/logic/importer.js",
  "modules/budget/logic/sample.js",
  "modules/budget/logic/schedule.js",
  "modules/budget/logic/schema.js",
  "modules/budget/print/plan.js",
  "modules/budget/views/activity.js",
  "modules/budget/views/bills.js",
  "modules/budget/views/budget.js",
  "modules/budget/views/common.js",
  "modules/budget/views/print.js",
  "modules/budget/views/quickadd.js",
  "modules/budget/views/settings.js",
  "modules/budget/views/setup.js",
  "modules/budget/views/today.js",
  "modules/budget/views/txedit.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PRODUCT + "-v") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Calisma aninda onbellege YALNIZ PRECACHE listesindeki ve kapsam (scope) icindeki dosyalar yazilir; baska hicbir yanit saklanmaz.
const SCOPE = new URL(self.registration.scope);
const ALLOWED = new Set(PRECACHE.map((u) => new URL(u, SCOPE).href));
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE.href)) return;
  const key = url.origin + url.pathname;
  event.respondWith(
    caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && ALLOWED.has(key)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => (req.mode === "navigate" ? caches.match("index.html") : Response.error()));
    })
  );
});
