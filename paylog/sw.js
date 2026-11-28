// PayLog barindirma servis calisani. Onbellek adi SURUMU icerir (paylog-v<surum>): surum degisince sw.js baytlari degisir, tarayici yeni surumu kurar,
// eski surumlerin onbellegi (paylog-v2 dahil; adi 'paylog-' ile baslayan ve bu surumden farkli her onbellek) activate'te SILINIR. Ayni adreste (unvergroup.github.io) baska uygulamalarin onbellegine DOKUNULMAZ; boylece kurulu uygulamalar guncellemeyi alir.
// Strateji: once onbellek; yoksa ag (yalniz ayni kaynak). Uygulama hicbir yere veri gondermez. Liste: sayfa tek dosyadir (index.html), manifest ve simgeler.
const CACHE = "paylog-v1.0.2";
const CORE = [
  "./", "./index.html", "./manifest.json",
  "./icon-192.png", "./icon-512.png",
  "./icon-512-maskable.png", "./apple-touch-icon-180.png"
];
self.addEventListener("install", (e) => {
  // cache: "reload" -> HTTP onbellegini atla; eski dosya yeni surume girmesin.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("paylog-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("message", (e) => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === "navigate" ? caches.match("./index.html") : undefined))
    )
  );
});
