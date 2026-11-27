// Yedek yardimcilari (DOM yok): hatirlatma zamani ve dogrulanmis geri yukleme.
import { parseBackup } from "../../../core/backup.js";
import { sanitizeBackupData } from "./schema.js";

/** Son yedek ayardaki gunden eskiyse (ve kullanicinin kendi kaydi varsa) hatirlatma. */
export function backupDue(state, now) {
  const p = state.prefs;
  if (!p.backupEveryDays || !state.transactions.some((x) => !x.sample)) return false; // yalniz ornek veri varken hatirlatma yok
  const last = p.lastBackupAt ? Date.parse(p.lastBackupAt) : NaN;
  return Number.isNaN(last) || (now.getTime() - last) / 86400000 >= p.backupEveryDays;
}

/** Geri yukleme: dogrulama BASARISIZSA mevcut veri hic degismez (once parse + temizlik, sonra tek atomik yazma). */
export async function restoreFromText(store, text, appId) {
  const parsed = parseBackup(text, { appId, schemaVersion: store.schemaVersion });
  const data = sanitizeBackupData(parsed.data);
  await store.importAll(data, { schemaVersion: parsed.schemaVersion });
  return Object.values(data).reduce((n, l) => n + l.length, 0);
}
