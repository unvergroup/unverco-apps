// Urun yapilandirmasi. Her urun bu dosyayi kopyalayip kendi degerlerini yazar.
// Demo ve tam surum ayni kod, farkli config.js ("mode") ile yayinlanir.
// Tek kaynak: depo oneki "mode" ve "appId"den turetilir (elle yazilmaz). Yalniz mode degisince onek de degisir: full -> "unverco-guests",
// demo -> "unverco-guests-demo". sw.js `PRODUCT` ayni degerdir (tests/guests.tur4.test.js T4-N2 uc degerin tutarliligini sinar).
const config = {
  appId: "unverco-guests",        // yedek dosyasinda uygulama kimligi ve depo onekinin koku
  appName: "Wedding Guest List to Print",
  mode: "full",                   // "demo" | "full"
  demoLimits: Object.freeze({ guests: 12, tables: 2 }), // demo'da koleksiyon basina kayit siniri
  version: "1.0.4",
  schemaVersion: 1,               // veri semasi; degisince store.js'e goc ekle
};
// Demo and full copy may share one origin: each mode keeps its own store (IndexedDB name, keys, sync channel, seeded flag).
// The demo prefix ends in "-demo"; the full one never does.
export default Object.freeze({ ...config, storagePrefix: config.mode === "full" ? config.appId : config.appId + "-demo" });
