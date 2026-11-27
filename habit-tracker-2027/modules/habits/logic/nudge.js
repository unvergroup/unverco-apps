// Yedek hatirlatma seridi (spec F12 / A25): son yedek (yoksa kurulum) >= backupEveryDays gun once, en az 1 kayit, anahtar acik,
// erteleme (24 saat) bitmis. Saf.
export function backupNudge(prefs, entryCount, now = Date.now()) {
  if (!prefs || prefs.backupReminder === false || entryCount < 1) return { show: false, days: 0 };
  const ref = Date.parse(prefs.lastBackupAt || prefs.installedAt || "");
  if (Number.isNaN(ref)) return { show: false, days: 0 };
  const days = Math.floor((now - ref) / 86400000);
  const snoozed = prefs.backupNudgeSnoozedUntil && Date.parse(prefs.backupNudgeSnoozedUntil) > now;
  return { show: days >= (prefs.backupEveryDays || 7) && !snoozed, days, never: !prefs.lastBackupAt };
}
export const SNOOZE_MS = 24 * 3600 * 1000;
