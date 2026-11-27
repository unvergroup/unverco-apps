// JPEG sayfa goruntulerinden PDF uretir. Saf islev: DOM yok, ag yok, dis kutuphane yok.
// NEDEN: iPhone ana ekran uygulamasinda window.print() WebKit tarafindan yok sayilir (sessizce hicbir sey yapmaz).
// Cozum belgeyi DOSYA olarak uretip iOS paylasim sayfasina vermektir (navigator.share({files})); oradan "Yazdir" AirPrint'e gider.
// NEDEN JPEG: PDF, JPEG baytlarini /DCTDecode ile OLDUGU GIBI gomer. PNG icin zlib + predictor gerekirdi;
// cevrimdisi ve CSP kisitli bir uygulamada dis kutuphane yok. Metin canvas'a 2-3 kat buyuk cizilip kuculdugu icin baski keskin kalir.
// NEDEN METIN DEGIL: standart PDF yazi tiplerinde Turkce i/g/s/I yok; yazi tipi gommek dosyayi buyutur.
// Sayfa goruntusu 5 dilin tamamini cihazin kendi yazi tipiyle dogru basar.

const enc = new TextEncoder();
const bytesOf = (s) => enc.encode(s);

/** "data:image/jpeg;base64,XXX" ya da ham base64 -> Uint8Array. Gecersiz girdi -> null. */
export function base64ToBytes(input) {
  if (typeof input !== "string" || input === "") return null;
  const b64 = input.startsWith("data:") ? input.slice(input.indexOf(",") + 1) : input;
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(b64)) return null;
  const clean = b64.replace(/[\r\n]/g, "");
  let bin;
  try {
    bin = typeof atob === "function" ? atob(clean) : Buffer.from(clean, "base64").toString("binary");
  } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/**
 * JPEG baytlarindan genislik / yukseklik okur (SOF bolumunden). Boylece sayfa olcusu goruntuye uyar.
 * JPEG degilse ya da SOF bulunamazsa null.
 */
export function jpegSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // SOI yok -> JPEG degil
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }        // dolgu baytlarini atla
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    // SOF0..SOF15, DHT (c4) / JPG (c8) / DAC (cc) HARIC
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = (bytes[i + 5] << 8) | bytes[i + 6];
      const w = (bytes[i + 7] << 8) | bytes[i + 8];
      return w > 0 && h > 0 ? { width: w, height: h } : null;
    }
    i += 2 + len;
  }
  return null;
}

// PDF metin dizgilerinde ( ) \ kacislanir.
const pdfText = (s) => String(s ?? "").replace(/([\\()])/g, "\\$1").replace(/[\r\n]+/g, " ");

/**
 * Sayfalari PDF'e cevirir.
 * @param {Array<{jpeg: Uint8Array}>} pages her sayfa icin JPEG baytlari
 * @param {{ dpi?: number, title?: string }} [opts] dpi: goruntunun basim yogunlugu (varsayilan 200)
 * @returns {Uint8Array} PDF baytlari
 *
 * Goruntu olcusu JPEG'in KENDISINDEN okunur (jpegSize). Cagirandan olcu ALINMAZ.
 * NEDEN: olcu ayri verilirse ve JPEG ile uyusmazsa PDF okuyucu goruntuyu hic cizmez ve
 * sayfa SESSIZCE BOS cikar. Gercek bir PDF rasterize testinde bu hata yasandi; olcuyu
 * tek kaynaktan okumak bu hata sinifini tamamen kaldirir. Okunamayan JPEG hata verir.
 *
 * Sayfa olcusu punto cinsindendir: punto = piksel / dpi * 72.
 * Boylece 200 dpi'da cizilen 1700x2200 piksel sayfa 612x792 punto (Letter) olur.
 */
export function buildPdf(pages, { dpi = 200, title = "" } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("buildPdf: sayfa yok");
  const sized = pages.map((p, i) => {
    if (!(p?.jpeg instanceof Uint8Array) || p.jpeg.length === 0) throw new Error(`buildPdf: sayfa ${i + 1} jpeg baytlari gecersiz`);
    const size = jpegSize(p.jpeg);
    if (!size) throw new Error(`buildPdf: sayfa ${i + 1} JPEG olcusu okunamadi (bozuk ya da JPEG degil)`);
    return { jpeg: p.jpeg, ...size };
  });
  const d = dpi > 0 ? dpi : 200;
  const pt = (px) => Math.round((px / d) * 72 * 1000) / 1000;

  // Nesne numaralari: 1 = Catalog, 2 = Pages, 3 = Info, sonra sayfa basina 3 nesne (Page, Contents, Image).
  const chunks = [];
  let len = 0;
  const push = (u8) => { chunks.push(u8); len += u8.length; };
  const offsets = []; // offsets[n] = n numarali nesnenin bayt konumu
  const obj = (n, body, stream) => {
    offsets[n] = len;
    push(bytesOf(`${n} 0 obj\n${body}\n`));
    if (stream) { push(bytesOf("stream\n")); push(stream); push(bytesOf("\nendstream\n")); }
    push(bytesOf("endobj\n"));
  };

  push(bytesOf("%PDF-1.4\n"));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // ikili dosya isareti: ham bayt (UTF-8 kacisi 4 yerine 8 bayt yazardi)

  const firstPageObj = 4;
  const pageIds = sized.map((_, i) => firstPageObj + i * 3);
  obj(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(" ")}] /Count ${sized.length} >>`);
  obj(3, `<< /Producer (UNVERCO 2027 Habit Tracker)${title ? ` /Title (${pdfText(title)})` : ""} >>`);

  sized.forEach((p, i) => {
    const pageN = pageIds[i], contN = pageN + 1, imgN = pageN + 2;
    const w = pt(p.width), h = pt(p.height);
    obj(pageN, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>`);
    const content = bytesOf(`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`);
    obj(contN, `<< /Length ${content.length} >>`, content);
    obj(imgN, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
  });

  const total = 3 + sized.length * 3;
  const xrefAt = len;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n += 1) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(bytesOf(xref));
  push(bytesOf(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));

  const out = new Uint8Array(len);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
