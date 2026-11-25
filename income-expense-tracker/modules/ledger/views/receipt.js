// Fis fotografi: secilen resmi cihazda kucultur (en uzun kenar ~1000 px, JPEG kalite ~0.7, hedef ~110 KB metin) ve data-URL metni olarak doner.
// Hicbir ag istegi yoktur: dosya FileReader ile data-URL olarak okunur, canvas ile yeniden cizilir.
// NOT: blob: adres KULLANILMAZ. Uygulamanin CSP'si "img-src 'self' data:"; barindirilan surumde (dist-web) blob: adres
// engellenir ve fotograf hic yuklenmezdi. data-URL her iki surumde (tek dosya ve web) calisir.
import { MAX_RECEIPT_CHARS as MAX_PHOTO_CHARS } from "../logic/schema.js";

export const PHOTO_MAX_SIDE = 1000;
export const PHOTO_QUALITY = 0.7;
export const PHOTO_TARGET_CHARS = 110000; // bunu asarsa kalite / boyut kademeli dusurulur (yedek dosyasi sismesin)
export const PHOTO_MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MIN_SIDE = 320;

/** En uzun kenar max'i gecmeyecek bicimde oranli boyut (buyutme yok). */
export function fitSize(width, height, max = PHOTO_MAX_SIDE) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(new Error("photo_unreadable"));
    r.readAsDataURL(file);
  });
}

async function loadImage(file) {
  const src = await readDataUrl(file);
  if (!/^data:image\//i.test(src)) throw new Error("photo_unreadable");
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("photo_unreadable"));
    img.src = src;
  });
}

/**
 * Resim dosyasini kucultup "data:image/jpeg;base64,..." metni dondurur. Okunamazsa Error("photo_unreadable") atar.
 * @param {File} file
 */
export async function resizePhoto(file, { maxSide = PHOTO_MAX_SIDE, quality = PHOTO_QUALITY, targetChars = PHOTO_TARGET_CHARS } = {}) {
  if (!file || typeof file.size !== "number" || file.size <= 0 || file.size > PHOTO_MAX_INPUT_BYTES || (file.type && !/^image\//i.test(file.type))) throw new Error("photo_unreadable");
  const img = await loadImage(file);
  let side = maxSide;
  for (;;) {
    const { width, height } = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, side);
    if (!width) throw new Error("photo_unreadable");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("photo_unreadable");
    g.fillStyle = "#fff"; // JPEG seffaflik tasimaz: seffaf PNG beyaz zemine oturur
    g.fillRect(0, 0, width, height);
    g.drawImage(img, 0, 0, width, height);
    let q = quality;
    let out = canvas.toDataURL("image/jpeg", q);
    while (out.length > targetChars && q > 0.45) { q = Math.max(0.45, q - 0.1); out = canvas.toDataURL("image/jpeg", q); }
    if (out.length <= MAX_PHOTO_CHARS && out.startsWith("data:image/jpeg;base64,")) return out;
    side = Math.round(side * 0.8);
    if (side < MIN_SIDE) throw new Error("photo_unreadable");
  }
}
