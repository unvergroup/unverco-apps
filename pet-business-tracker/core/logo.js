// Musterinin KENDI isletme logosu (alicinin markasi). Secilen dosya CIHAZDA canvas'tan gecirilip YENIDEN KODLANIR:
// boylece EXIF / renk profili / gomulu betik ya da baska gizli icerik TASINMAZ (pet fotografindaki guvenlik deseninin aynisi).
// Kabul: yalniz PNG ve JPEG. Cikti: her zaman PNG (seffaflik korunur), en uzun kenar en fazla 320 px.
// Hicbir ag istegi yoktur: dosya FileReader ile data-URL olarak okunur (blob: adres KULLANILMAZ; CSP img-src 'self' data:).
// Depoda "business" kaydinin logo alaninda data-URL metni olarak durur; yedege girer, "tum veriyi sil" ile silinir.

export const LOGO_MAX_SIDE = 320; // genislik VE yukseklik ust siniri: cok genis ya da cok dar logolar da sigar
export const LOGO_MAX_CHARS = 240_000; // data-URL metni ust siniri (~176 KB); yedek dosyasi sismesin
export const LOGO_TARGET_CHARS = 150_000; // bunu asarsa olcu kademeli dusurulur (320 px'lik fotografik bir PNG bu sinira sigar)
export const LOGO_MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const LOGO_TYPES = Object.freeze(["image/png", "image/jpeg"]);
const LOGO_MIN_SIDE = 64;

// Yalniz cihazda yeniden kodlanmis logo: `data:image/png;base64,...` ya da `data:image/jpeg;base64,...` ve boyut siniri icinde.
// svg (betik tasiyabilir), gif, webp, http(s) adres, bosluklu / kirli metin kabul EDILMEZ.
export const isLogoDataUrl = (v) =>
  typeof v === "string" && v.length <= LOGO_MAX_CHARS && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(v);

/** En uzun kenar max'i gecmeyecek bicimde oranli olcu (buyutme YOK; en-boy orani korunur). */
export function fitLogoSize(width, height, max = LOGO_MAX_SIDE) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(new Error("logo_unreadable"));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("logo_unreadable"));
    img.src = src; // data-URL: h() disinda, dogrudan ozellik atamasi (CSP img-src data: izinli)
  });
}

/**
 * Logo dosyasini yeniden kodlayip `data:image/png;base64,...` metni dondurur. Okunamazsa Error("logo_unreadable") atar.
 * @param {File} file PNG ya da JPEG
 */
export async function encodeLogo(file, { maxSide = LOGO_MAX_SIDE, targetChars = LOGO_TARGET_CHARS } = {}) {
  if (!file || typeof file.size !== "number" || file.size <= 0 || file.size > LOGO_MAX_INPUT_BYTES) throw new Error("logo_unreadable");
  if (!LOGO_TYPES.includes(String(file.type || "").toLowerCase())) throw new Error("logo_unreadable");
  const src = await readDataUrl(file);
  if (!/^data:image\/(png|jpeg);base64,/i.test(src)) throw new Error("logo_unreadable");
  const img = await loadImage(src);
  let side = maxSide;
  let out = "";
  for (let i = 0; i < 6; i++) {
    const { width, height } = fitLogoSize(img.naturalWidth || img.width, img.naturalHeight || img.height, side);
    if (!width || !height) throw new Error("logo_unreadable");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("logo_unreadable");
    g.clearRect(0, 0, width, height); // zemin BOYANMAZ: seffaflik korunur (PNG)
    g.drawImage(img, 0, 0, width, height);
    out = canvas.toDataURL("image/png");
    if (isLogoDataUrl(out) && out.length <= targetChars) return out;
    side = Math.round(side * 0.75);
    if (side < LOGO_MIN_SIDE) break;
  }
  if (isLogoDataUrl(out)) return out; // hedefin ustunde ama ust sinirin altinda
  throw new Error("logo_unreadable");
}
