// Dosya indirme / secme (yalniz tarayici). Hicbir ag istegi yapmaz; Blob adresi yereldir.
export function downloadText(filename, text, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      resolve(f ? { name: f.name, text: await f.text() } : null);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
