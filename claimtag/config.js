// Urun yapilandirmasi. Demo ve tam surum ayni kod, farkli config.js ("mode") ile yayinlanir.
// Bu surum "full": demo siniri kapali, ama mekanizma (core/edition.js) yerinde duruyor.
export default Object.freeze({
  appId: "claimtag",              // yedek dosyasinda uygulama kimligi ve dosya adi onegi
  appName: "Claimtag",            // calisma adi; arayuzdeki gorunen ad i18n "app.title" anahtarindadir (en: Claimtag, tr: Claimtag · Tamir Defteri)
  mode: "full",                   // "demo" | "full"
  demoLimits: Object.freeze({}),  // demo'da koleksiyon basina kayit siniri (full'de kullanilmaz)
  storagePrefix: "claimtag",
  version: "1.0.1",
  schemaVersion: 1,               // veri semasi; degisince store.js'e goc ekle
  preview: false,
});
