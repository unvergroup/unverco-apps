// Yedek dosyasi: disa aktar / geri yukle + CSV yardimcilari.
// Dosya bicimi: { app, schemaVersion, exportedAt, checksum, data }
// checksum yalniz bozulmayi yakalar (guvenlik amaci tasimaz).

import { validateData } from "./store.js";

export class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupError";
    this.code = code; // invalid_file | wrong_app | newer_schema | checksum | too_large | too_many | demo_limit (set by a preparer)
  }
}

// Geri yuklemede sinirlar (hizmet reddini onler): dosya boyutu ve koleksiyon basina kayit.
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_RECORDS_PER_COLLECTION = 5000;

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
export const backupChecksum = ({ app, schemaVersion, data }) => checksum({ app, schemaVersion, data });

export function createBackup({ appId, schemaVersion, data, now = () => new Date().toISOString() }) {
  const clean = JSON.parse(JSON.stringify(data));
  return { app: appId, schemaVersion, exportedAt: now(), checksum: backupChecksum({ app: appId, schemaVersion, data: clean }), data: clean };
}

export async function exportBackupText(store, { appId, now } = {}) {
  const data = await store.exportAll();
  return JSON.stringify(createBackup({ appId, schemaVersion: store.schemaVersion, data, now }), null, 2);
}

export function backupFileName(appId, date = new Date(), suffix = "backup") {
  return `${appId}-${suffix}-${date.toISOString().slice(0, 10)}.json`;
}

// Metni dogrular; { data, schemaVersion, exportedAt } doner ya da BackupError atar.
export function parseBackup(text, { appId, schemaVersion }) {
  // Boyut once: metin uzunlugu bayttan kucuk olamaz (UTF-16 birimi >= 1 bayt degil, en cok 3 bayt); sinira yakinsa gercek bayt sayilir.
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
  if (backupChecksum(obj) !== obj.checksum) {
    throw new BackupError("checksum", "This backup file is damaged (checksum mismatch).");
  }
  for (const list of Object.values(obj.data)) {
    if (list.length > MAX_RECORDS_PER_COLLECTION) {
      throw new BackupError("too_many", `This backup has too many records (over ${MAX_RECORDS_PER_COLLECTION} in one list).`);
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
  return { data: obj.data, schemaVersion: obj.schemaVersion, exportedAt: obj.exportedAt };
}

// Urun modulu, geri yuklenecek veriyi YAZMADAN ONCE temizleyen / sinirlayan bir islev kaydeder:
//   fn(data) -> { data, report? }  ya da hata atar (BackupError benzeri, `code` ile). report, yazma basarili olunca doner.
// Kayitli islev yoksa veri oldugu gibi gecer.
// done(report): yazma basarili olunca cagrilir (ornegin "N kayit onarildi" bildirimi icin).
let preparer = null;
let preparerDone = null;
export function setRestorePreparer(fn, done = null) {
  preparer = typeof fn === "function" ? fn : null;
  preparerDone = preparer && typeof done === "function" ? done : null;
}

// Dosyayi dogrular ve (varsa) hazirlayiciyi calistirir; HICBIR sey yazmaz. Onay penceresinden once cagrilabilir.
// -> { data, schemaVersion, exportedAt, report }
export function prepareBackup(text, { appId, schemaVersion }) {
  const parsed = parseBackup(text, { appId, schemaVersion });
  if (!preparer) return { ...parsed, report: null };
  const out = preparer(parsed.data);
  return { ...parsed, data: out.data, report: out.report ?? null };
}

// Dogrula -> hazirla (sanitize, sinirlar) -> (istenirse) mevcut verinin yedegini ver -> degistir. Ham veri hicbir zaman yazilmaz.
// beforeReplace(text): mevcut verinin yedek metni; indirme islemini cagiran yapar.
export async function restoreBackup({ store, text, appId, beforeReplace }) {
  const parsed = prepareBackup(text, { appId, schemaVersion: store.schemaVersion });
  if (beforeReplace) await beforeReplace(await exportBackupText(store, { appId }));
  await store.importAll(parsed.data, { schemaVersion: parsed.schemaVersion });
  if (parsed.report && preparerDone) preparerDone(parsed.report);
  return { records: Object.values(parsed.data).reduce((n, l) => n + l.length, 0), report: parsed.report };
}

// ---- CSV ------------------------------------------------------------------

// Yalniz METIN hucrelerde =, +, -, @ (ve sekme/CR) ile baslayanin onune tek tirnak
// konur (formul enjeksiyonu). Sayi tipindeki degerler dokunulmadan yazilir.
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// columns: [{ key, label }]; satir sonu CRLF (RFC 4180).
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(","));
  return lines.join("\r\n") + "\r\n";
}
