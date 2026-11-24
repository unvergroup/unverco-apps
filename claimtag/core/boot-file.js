// Dosyadan (file://) acilan tek dosya paketi icin baslangic yardimcilari. Ag yok; depo yok (yalniz saf islevler).
// Neden: dosyadan acilinca tarayici veriyi dosyaya degil, "bu dosya kaynagi"na yazar; ayni tarayicida acilan baska yerel
// HTML dosyalari da ayni depoyu okuyup silebilir (kodla kokten cozulmez) -> kullaniciya acik soylenir (gizlilik satiri).

export function openedFromFile(loc = globalThis.location) {
  return Boolean(loc) && loc.protocol === "file:";
}

// Metin anahtari -> altina eklenecek ek cumle anahtari (yalniz dosyadan acilinca). core/i18n.js t() kullanir.
export const FILE_NOTES = Object.freeze({ "settings.privacy": "settings.privacyFile" });
