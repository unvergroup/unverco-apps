// Yedek dosyasi: disa aktar / geri yukle + CSV yardimcilari.
// Dosya bicimi: { app, schemaVersion, exportedAt, currency, lang, checksum, data }  (Homeschool Planner: tek surum; sikisik JSON, girintisiz)
// currency (ISO kodu) ve lang yedegin alindigi ayarlardir: tutarlar o para biriminin en kucuk birimindedir (USD 150000 = 1.500,00;
// JPY 1500 = 1.500). Alanlar olmayan ESKI yedekler gecerlidir ama para birimi bilinmez (geri yuklemede uyarilir).
// checksum yalniz bozulmayi yakalar (guvenlik amaci tasimaz); currency / lang varsa onu da kapsar (elle degistirilirse yakalanir).

import { CURRENCIES, LANGS } from "./i18n.js";
import { validateData } from "./store.js";
import { RECORD_LIMITS, DATA_COLLECTIONS } from "../modules/homeschool/logic/schema.js";

// Homeschool Planner yedegi: uygulama kimligi ve veri koleksiyonlari (cagiranlar config.appId verir; bunlar varsayilandir).
export const APP_ID = "unvercohsp";
export const BACKUP_COLLECTIONS = DATA_COLLECTIONS;

export class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupError";
    this.code = code; // invalid_file | wrong_app | newer_schema | checksum | too_large | too_many | demo_limit
  }
}

// Geri yuklemede sinirlar (hizmet reddini onler): dosya boyutu ve koleksiyon basina kayit.
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
// Ust sinir tek kaynaktan (RECORD_LIMITS): uygulamanin alabildigi her yedek geri yuklenebilir (alma / geri yukleme simetrik).
export const MAX_RECORDS_PER_COLLECTION = Math.max(...Object.values(RECORD_LIMITS));

// Anahtar sirasindan bagimsiz, kararli metin.
function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

// FNV-1a 32 bit. Deger once JSON'a normallenir (undefined dusar, Date metne doner);
// boylece dosyaya yazilip geri okunan veriyle ayni toplam cikar.
export function checksum(data) {
  const s = stableStringify(JSON.parse(JSON.stringify(data ?? null)));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Toplam uygulama kimligini, sema surumunu ve veriyi kapsar.
export const backupChecksum = ({ app, schemaVersion, data, currency, lang }) =>
  checksum({ app, schemaVersion, data, ...(currency !== undefined ? { currency } : {}), ...(lang !== undefined ? { lang } : {}) });

export function createBackup({ appId = APP_ID, schemaVersion, data, currency, lang, now = () => new Date().toISOString() }) {
  const clean = JSON.parse(JSON.stringify(data));
  return {
    app: appId, schemaVersion, exportedAt: now(),
    ...(currency !== undefined ? { currency } : {}), ...(lang !== undefined ? { lang } : {}),
    checksum: backupChecksum({ app: appId, schemaVersion, data: clean, currency, lang }), data: clean,
  };
}

// currency / lang: yedegi alan cihazin ayarlari. Tutarlar o para birimindedir; yedekle birlikte tasinir.
export async function exportBackupText(store, { appId = APP_ID, now, currency, lang } = {}) {
  const data = await store.exportAll();
  return JSON.stringify(createBackup({ appId, schemaVersion: store.schemaVersion, data, currency, lang, now }));
}

// Dosya adi: "homeschool-planner-backup-2026-11-22.json" (uygulama kimligi appId'den).
export function backupFileName(appId = APP_ID, date = new Date(), suffix = "backup") {
  return `${appId}-${suffix}-${date.toISOString().slice(0, 10)}.json`;
}

// Metni dogrular; { data, schemaVersion, exportedAt, currency, lang } doner ya da BackupError atar (currency / lang eski yedekte null).
export function parseBackup(text, { appId, schemaVersion }) {
  // Boyut once: metin uzunlugu bayttan kucuk olamaz; sinira yakinsa gercek bayt sayilir (dosya zaten okunmadan da elenir: files.js).
  if (typeof text === "string" && (text.length > MAX_BACKUP_BYTES || (text.length * 3 > MAX_BACKUP_BYTES && new TextEncoder().encode(text).length > MAX_BACKUP_BYTES))) {
    throw new BackupError("too_large", "This backup file is too large (over 10 MB).");
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new BackupError("invalid_file", "This file is not a valid backup. It could not be read.");
  }
  const ok =
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    typeof obj.app === "string" &&
    Number.isInteger(obj.schemaVersion) &&
    obj.schemaVersion >= 1 &&
    typeof obj.checksum === "string" &&
    obj.data &&
    typeof obj.data === "object" &&
    !Array.isArray(obj.data) &&
    Object.values(obj.data).every((l) => Array.isArray(l));
  if (!ok) throw new BackupError("invalid_file", "This file is not a valid backup. Some parts are missing.");
  if (obj.app !== appId) {
    throw new BackupError("wrong_app", "This backup belongs to a different app.");
  }
  if (obj.schemaVersion > schemaVersion) {
    throw new BackupError("newer_schema", "This backup was made by a newer version of the app. Update the app and try again.");
  }
  if (obj.currency !== undefined && !CURRENCIES.includes(obj.currency)) {
    throw new BackupError("invalid_file", "This file is not a valid backup. Its currency is not known.");
  }
  if (obj.lang !== undefined && !LANGS.includes(obj.lang)) {
    throw new BackupError("invalid_file", "This file is not a valid backup. Its language is not known.");
  }
  if (backupChecksum(obj) !== obj.checksum) {
    throw new BackupError("checksum", "This backup file is damaged (checksum mismatch).");
  }
  for (const list of Object.values(obj.data)) {
    if (list.length > MAX_RECORDS_PER_COLLECTION) {
      throw new BackupError("too_many", `This backup has more records in one list than the app can hold (max ${MAX_RECORDS_PER_COLLECTION}).`);
    }
  }
  // Koleksiyon adi ve kayit bicimi onay penceresinden ONCE dogrulanir.
  try {
    validateData(obj.data);
    for (const list of Object.values(obj.data)) {
      if (!list.every((r) => typeof r.id === "string" && r.id)) throw new Error("record without id");
    }
  } catch {
    throw new BackupError("invalid_file", "This file is not a valid backup. A collection name or a record is not valid.");
  }
  return { data: obj.data, schemaVersion: obj.schemaVersion, exportedAt: obj.exportedAt, currency: obj.currency ?? null, lang: obj.lang ?? null };
}

// Dosyayi dogrular ve HICBIR sey yazmadan hazirlar: bilinen koleksiyonlar + modul semalari (prepare), demo siniri (limitFor).
//   prepare(data) -> { data, report }   (core/schema.js sanitizeAppData; verilmezse veri oldugu gibi gecer: yalniz testler icin)
//   limitFor(koleksiyon) -> en cok kayit (demo; Infinity = sinirsiz). Asilirsa BackupError("demo_limit").
// -> { data, schemaVersion, exportedAt, currency, lang, report }
export function prepareBackup(text, { appId, schemaVersion, prepare, limitFor }) {
  const parsed = parseBackup(text, { appId, schemaVersion });
  const out = typeof prepare === "function" ? prepare(parsed.data) : { data: parsed.data, report: null };
  if (limitFor) {
    for (const [name, list] of Object.entries(out.data)) {
      if (list.length > limitFor(name)) throw new BackupError("demo_limit", `Demo limit: ${list.length} records in "${name}".`);
    }
  }
  return { ...parsed, data: out.data, report: out.report ?? null };
}

// Dogrula -> hazirla -> (istenirse) mevcut verinin yedegini ver -> degistir. Ham veri hicbir zaman yazilmaz.
// beforeReplace(text): mevcut verinin yedek metni; indirme islemini cagiran yapar.
// currency: bu cihazin para birimi. switchCurrency true ise yedegin para birimine gecilir (veri oldugu gibi yazilir);
// degilse tutarlar bu cihazin kurus basamagina olceklenir (sayi ayni kalir, CEVIRI yoktur). Yedekte para birimi yoksa veri oldugu gibi yazilir.
// rescale(data, fromCurrency, toCurrency) -> data: olcekleme islevi (core/currency-change.js).
// Doner: { records, currency (yazilan), report }
export async function restoreBackup({ store, text, appId, beforeReplace, prepare, limitFor, currency, switchCurrency = false, rescale, lang }) {
  const parsed = prepareBackup(text, { appId, schemaVersion: store.schemaVersion, prepare, limitFor });
  let data = parsed.data;
  let target = currency;
  if (parsed.currency && currency) {
    if (switchCurrency) target = parsed.currency;
    else if (parsed.currency !== currency && typeof rescale === "function") data = rescale(data, parsed.currency, currency);
  }
  if (beforeReplace) await beforeReplace(await exportBackupText(store, { appId, currency, lang }));
  await store.importAll(data, { schemaVersion: parsed.schemaVersion, ...(target ? { extra: { currency: target } } : {}) });
  return { records: Object.values(data).reduce((n, l) => n + l.length, 0), currency: target ?? null, report: parsed.report };
}

// ---- CSV ------------------------------------------------------------------

// Yalniz METIN hucrelerde =, +, -, @ (ve sekme/CR) ile baslayanin onune tek tirnak
// konur (formul enjeksiyonu). Sayi tipindeki degerler dokunulmadan yazilir.
export function csvCell(value, delimiter = ",") {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(delimiter) || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// columns: [{ key, label }]; satir sonu CRLF (RFC 4180).
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(","));
  return lines.join("\r\n") + "\r\n";
}

// Yedek metninin UTF-8 bayt sayisi (sinir ve boyut esikleri icin).
export const byteLength = (text) => new TextEncoder().encode(text).length;
