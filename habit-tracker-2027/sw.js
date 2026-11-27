// 2027 Habit Tracker cevrimdisi onbellek. Surum numarasi config.js ile ayni olmali (tests/files.test.mjs denetler).
// Strateji: once onbellek; yoksa ag; yalniz ayni kaynak (origin) GET istekleri. Uygulama hicbir yere veri gondermez.
const PRODUCT = "unverco-habit-2027";
const VERSION = "1.0.2";
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
  "app-icon-320.webp",
  "unverco-logo-altin.png",
  "unverco-logo-mavi.png",
  "LICENSES.txt",
  "core/print.css",
  "core/backup.js",
  "core/boot-file.js",
  "core/canvas-doc.js",
  "core/click-guard.js",
  "core/files.js",
  "core/i18n.js",
  "core/icons.js",
  "core/pdf.js",
  "core/print.js",
  "core/pwa.js",
  "core/route.js",
  "core/safe.js",
  "core/sanitize.js",
  "core/store.js",
  "core/sync.js",
  "core/ui.js",
  "locales/de.js",
  "locales/en.js",
  "locales/es.js",
  "locales/fr.js",
  "locales/pt.js",
  "modules/habits/logic/calc.js",
  "modules/habits/logic/csv.js",
  "modules/habits/logic/dates.js",
  "modules/habits/logic/ics.js",
  "modules/habits/logic/nudge.js",
  "modules/habits/logic/repo.js",
  "modules/habits/logic/sample.js",
  "modules/habits/logic/schema.js",
  "modules/habits/print/docs.js",
  "modules/habits/views/common.js",
  "modules/habits/views/data-actions.js",
  "modules/habits/views/day-editor.js",
  "modules/habits/views/doc-labels.js",
  "modules/habits/views/habit-editor.js",
  "modules/habits/views/habits.js",
  "modules/habits/views/month.js",
  "modules/habits/views/more.js",
  "modules/habits/views/today.js",
  "modules/habits/views/welcome.js",
  "modules/habits/views/year.js",
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
