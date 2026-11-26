// AutoLog servis calisani (alici paketi ve barindirma surumu). Onbellek adi SURUMU icerir (autolog-v<surum>): surum degisince sw.js baytlari degisir,
// tarayici yeni surumu kurar; 'autolog-' ile baslayan ve bu surumden farkli her eski onbellek activate'te SILINIR.
// Ayni adreste (unvergroup.github.io) baska uygulamalarin onbellegine DOKUNULMAZ.
// Strateji: once onbellek; yoksa ag (yalniz ayni kaynak). Uygulama hicbir yere veri gondermez.
// Liste: sayfa tek dosyadir (index.html), manifest ve simgeler. Dosya eklenirse CORE listesi paketle.py'den uretilir (eksik / fazla dosya olmaz).
const CACHE = "autolog-v1.0.2";
const CORE = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png", "./apple-touch-icon-180.png"];
self.addEventListener("install", (e) => {
  // cache: "reload" -> HTTP onbellegini atla; eski dosya yeni surume girmesin.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("autolog-") && k !== CACHE).map((k) => caches.delete(k))))
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
