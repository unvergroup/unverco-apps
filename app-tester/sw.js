// App Tester cevrimdisi onbellek. Surum numarasi config.js ile ayni olmali (tests/files.test.mjs denetler).
// Strateji: once onbellek; yoksa ag; yalniz ayni kaynak (origin) GET istekleri. Uygulama hicbir yere veri gondermez.
const PRODUCT = "unverco-app-tester";
const VERSION = "1.0.0";
const CACHE = PRODUCT + "-v" + VERSION;
const PRECACHE = [
  "./",
  "index.html",
  "app.css",
  "app.js",
  "boot-guard.js",
  "config.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon-180.png",
  "favicon-32.png",
  "app-icon-128.png",
  "unverco-logo-altin.png",
  "unverco-logo-mavi.png",
  "LICENSES.txt",
  "core/click-guard.js",
  "core/files.js",
  "core/i18n.js",
  "core/icons.js",
  "core/print.css",
  "core/print.js",
  "core/pwa.js",
  "core/route.js",
  "core/safe.js",
  "core/sanitize.js",
  "core/ui.js",
  "locales/de.js",
  "locales/en.js",
  "locales/es.js",
  "locales/fr.js",
  "locales/pt.js",
  "modules/tester/logic/clipboard.js",
  "modules/tester/logic/history.js",
  "modules/tester/logic/sample.js",
  "modules/tester/logic/validate.js",
  "modules/tester/logic/verdict.js",
  "modules/tester/views/common.js",
  "modules/tester/views/history.js",
  "modules/tester/views/home.js",
  "modules/tester/views/print-report.js",
  "modules/tester/views/results.js",
  "modules/tester/views/settings.js",
  "modules/tester/views/setup.js",
];

const SCOPE = new Set(PRECACHE);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PRODUCT + "-v") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          // Calisma aninda yalniz uygulamanin kendi dosyalari (PRECACHE listesi) onbellege yazilir; baska istek saklanmaz.
          const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length) || "./";
          if (res && res.ok && SCOPE.has(rel)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => (req.mode === "navigate" ? caches.match("index.html") : Response.error()));
    })
  );
});
