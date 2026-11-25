// Servis calisani kaydi, "ana ekrana ekle" istemi, yeni surum bildirimi.

// iPhone / iPad Safari: beforeinstallprompt yok; kisa yonerge gosterilir.
export function isIos(userAgent = "", maxTouchPoints = 0) {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function initPwa({ onUpdate, onInstallAvailable, swUrl = "sw.js", win = globalThis.window } = {}) {
  // Dosyadan (file://) acilan tek dosya paketinde servis calisani ve manifest yoktur: kurma / guncelleme bantlari cikmaz.
  if (win.location && win.location.protocol === "file:") {
    console.info("[unvercoiet] service worker not registered: a file:// page cannot register one (offline install needs the hosted web version)."); // yalniz gelistirici konsolu; kullaniciya gosterilmez
    return { standalone: false, ios: false, canPrompt: () => false, promptInstall: async () => false, applyUpdate: () => {} };
  }
  const nav = win.navigator;
  const standalone =
    (win.matchMedia && win.matchMedia("(display-mode: standalone)").matches) || nav.standalone === true;
  let deferred = null;
  let registration = null;
  let updateRequested = false;

  win.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    if (onInstallAvailable) onInstallAvailable();
  });
  win.addEventListener("appinstalled", () => {
    deferred = null;
  });

  if ("serviceWorker" in nav) {
    nav.serviceWorker.addEventListener("controllerchange", () => {
      if (updateRequested) win.location.reload();
    });
    nav.serviceWorker
      .register(swUrl)
      .then((reg) => {
        registration = reg;
        if (reg.waiting && nav.serviceWorker.controller) onUpdate && onUpdate();
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener("statechange", () => {
            if (w.state === "installed" && nav.serviceWorker.controller) onUpdate && onUpdate();
          });
        });
      })
      .catch((err) => {
        // Kayit basarisizsa uygulama cevrimici calismaya devam eder; kullaniciya hata gosterilmez, gelistirici konsoluna TEK satir bilgi yazilir.
        console.info(`[unvercoiet] service worker registration failed: ${err && err.message ? err.message : err}`);
      });
  }

  return {
    standalone,
    ios: isIos(nav.userAgent, nav.maxTouchPoints),
    canPrompt: () => deferred !== null,
    async promptInstall() {
      if (!deferred) return false;
      deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      return choice.outcome === "accepted";
    },
    applyUpdate() {
      updateRequested = true;
      if (registration && registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      else win.location.reload();
    },
  };
}
