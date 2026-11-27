// Yedek dosyasi: disa aktar / dogrula / geri yukle + CSV yardimcilari. Bicim: { app, schemaVersion, exportedAt, checksum, data }.
// checksum (FNV-1a) yalniz bozulmayi yakalar; guvenlik amaci tasimaz. Geri yuklemede once dogrulanir, sonra tek atomik yazma.
import { validateData } from "./store.js";

export class BackupError extends Error {
  constructor(code, message) { super(message); this.name = "BackupError"; this.code = code; } // invalid_file | wrong_app | newer_schema | checksum | too_large | too_many
}

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_RECORDS_PER_COLLECTION = 80000;

function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  return JSON.stringify(value);
}

export function checksum(data) {
  const s = stableStringify(JSON.parse(JSON.stringify(data ?? null)));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
export const backupChecksum = ({ app, schemaVersion, data }) => checksum({ app, schemaVersion, data });

export function createBackup({ appId, schemaVersion, data, now = () => new Date().toISOString() }) {
  const clean = JSON.parse(JSON.stringify(data));
  return { app: appId, schemaVersion, exportedAt: now(), checksum: backupChecksum({ app: appId, schemaVersion, data: clean }), data: clean };
}

export async function exportBackupText(store, { appId, now } = {}) {
  return JSON.stringify(createBackup({ appId, schemaVersion: store.schemaVersion, data: await store.exportAll(), now }));
}

const pad = (n) => String(n).padStart(2, "0");
/** "habit-tracker-backup-2027-01-06.json" (tarih YEREL gun). */
export function backupFileName(slug, date = new Date(), suffix = "backup") {
  return `${slug}-${suffix}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Metni dogrular; { data, schemaVersion, exportedAt } doner ya da BackupError atar. Hicbir sey yazmaz. */
export function parseBackup(text, { appId, schemaVersion }) {
  if (typeof text === "string" && text.length * 3 > MAX_BACKUP_BYTES && new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) {
    throw new BackupError("too_large", "This backup file is too large (over 10 MB).");
  }
  let obj;
  try { obj = JSON.parse(text); } catch { throw new BackupError("invalid_file", "This file is not a valid backup."); }
  const ok = obj && typeof obj === "object" && !Array.isArray(obj) && typeof obj.app === "string" && Number.isInteger(obj.schemaVersion) && obj.schemaVersion >= 1 &&
    typeof obj.checksum === "string" && obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) && Object.values(obj.data).every((l) => Array.isArray(l));
  if (!ok) throw new BackupError("invalid_file", "This file is not a valid backup.");
  if (obj.app !== appId) throw new BackupError("wrong_app", "This backup belongs to a different app.");
  if (obj.schemaVersion > schemaVersion) throw new BackupError("newer_schema", "This backup is from a newer version.");
  let sum;
  try { sum = backupChecksum(obj); } catch { throw new BackupError("invalid_file", "This file is not a valid backup."); } // ornegin cok derin ic ice JSON (RangeError)
  if (sum !== obj.checksum) throw new BackupError("checksum", "This backup file is damaged.");
  for (const list of Object.values(obj.data)) if (list.length > MAX_RECORDS_PER_COLLECTION) throw new BackupError("too_many", "Too many records.");
  try {
    validateData(obj.data);
    for (const list of Object.values(obj.data)) if (!list.every((r) => typeof r.id === "string" && r.id)) throw new Error("id");
  } catch { throw new BackupError("invalid_file", "This file is not a valid backup."); }
  return { data: obj.data, schemaVersion: obj.schemaVersion, exportedAt: obj.exportedAt };
}

/** Dogrula -> temizle (prepare) -> tek atomik yazma. Doner { records, report }. */
export async function restoreBackup({ store, text, appId, prepare }) {
  const parsed = parseBackup(text, { appId, schemaVersion: store.schemaVersion });
  const out = typeof prepare === "function" ? prepare(parsed.data) : { data: parsed.data, report: null };
  await store.importAll(out.data, { schemaVersion: parsed.schemaVersion });
  return { records: Object.values(out.data).reduce((n, l) => n + l.length, 0), report: out.report ?? null };
}

// ---- CSV ------------------------------------------------------------------
/** Metin hucrede =, +, -, @ (ve sekme/CR) ile baslayanin onune tek tirnak (formul enjeksiyonu). Sayilar oldugu gibi. */
export function csvCell(value, delimiter = ",") {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(delimiter) || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(","));
  return lines.join("\r\n") + "\r\n";
}
