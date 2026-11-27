// Dosya indirme / secme (yalniz tarayici). Hicbir ag istegi yapmaz; Blob adresi yereldir.
// Onizleme kipinde indirme kapatilir (app.js setDownloadsEnabled(false) cagirir); dosya hic olusmaz.
let downloadsEnabled = true;
export const setDownloadsEnabled = (on) => { downloadsEnabled = Boolean(on); };
export const downloadsAreEnabled = () => downloadsEnabled;

export function downloadText(filename, text, mime = "application/json") {
  if (!downloadsEnabled) return false;
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// Bayt -> metin. Once UTF-8; bozuk bayt (U+FFFD) cikarsa dosya Windows-1252 sayilir (ABD bankalarinin eski CSV'leri, Excel).
export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = new TextDecoder("utf-8").decode(u8);
  return text.includes("\uFFFD") ? new TextDecoder("windows-1252").decode(u8) : text;
}

// Kullaniciya dosya sectirir; { name, text } ya da vazgecilirse null doner.
// maxBytes verilirse ve dosya ondan buyukse DOSYA OKUNMAZ: { name, size, tooLarge: true, text: "" } doner (bellek korumasi).
export function pickTextFile(accept = ".json,application/json", maxBytes = Infinity) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      if (f && f.size > maxBytes) { resolve({ name: f.name, size: f.size, tooLarge: true, text: "" }); return; }
      resolve(f ? { name: f.name, text: decodeText(await f.arrayBuffer()) } : null);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
