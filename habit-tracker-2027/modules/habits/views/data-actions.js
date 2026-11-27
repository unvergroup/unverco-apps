// Veri eylemleri: yedek al / geri yukle / CSV / .ics / hepsini sil / ornek yil. Hatalar kullaniciya anlasilir bildirimle gosterilir.
import { BackupError, MAX_BACKUP_BYTES, backupFileName, exportBackupText, restoreBackup } from "../../../core/backup.js";
import { downloadText, pickTextFile } from "../../../core/files.js";
import { purgeCorruptCopies } from "../../../core/store.js";
import { deliverFile } from "../../../core/canvas-doc.js";
import { needsFileDelivery } from "../../../core/print.js";
import { ENTRIES, HABITS, sanitizeData } from "../logic/schema.js";
import { habitsCsv } from "../logic/csv.js";
import { ICS_FILENAME, buildIcs } from "../logic/ics.js";
import { sampleYear } from "../logic/sample.js";

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export async function backupNow(ctx) {
  try {
    const text = await exportBackupText(ctx.store, { appId: ctx.config.appId });
    downloadText(backupFileName(ctx.config.fileSlug), text);
    await ctx.repo.savePrefs({ lastBackupAt: new Date().toISOString(), backupNudgeSnoozedUntil: null });
    ctx.notify(ctx.t("backup.done"), "success");
    ctx.paintChrome();
    return true;
  } catch (e) { ctx.fail(e); return false; }
}

export async function restoreNow(ctx) {
  const { t } = ctx;
  try {
    const file = await pickTextFile(".json,application/json", MAX_BACKUP_BYTES);
    if (!file) return false;
    if (file.tooLarge) throw new BackupError("too_large", "too large");
    const ok = await ctx.confirm({ title: t("backup.restoreTitle"), message: t("backup.restoreText"), confirmLabel: t("backup.restoreBtn") });
    if (!ok) return false;
    const prefs = await ctx.repo.getPrefs();
    const { records } = await restoreBackup({ store: ctx.store, text: file.text, appId: ctx.config.appId, prepare: (d) => sanitizeData(d, prefs.weekStart) });
    ctx.repo.clearUndo();
    ctx.notify(t("backup.restored", { n: records }), "success");
    await ctx.refresh();
    return true;
  } catch (e) { ctx.fail(e); return false; }
}

export async function exportCsv(ctx) {
  try {
    const { habits, entries } = await ctx.data();
    downloadText(`${ctx.config.fileSlug}-${stamp()}.csv`, habitsCsv(habits, entries), "text/csv");
    ctx.notify(ctx.t("csv.done"), "success");
  } catch (e) { ctx.fail(e); }
}

export async function exportIcs(ctx) {
  try {
    const { active } = await ctx.data();
    const withTime = active.filter((x) => x.reminder);
    if (!withTime.length) { ctx.notify(ctx.t("rem.none"), "warn"); return; }
    const text = buildIcs(withTime, { today: ctx.today(), alarmText: ctx.t("app.name") });
    if (needsFileDelivery()) await deliverFile({ bytes: new TextEncoder().encode(text), filename: ICS_FILENAME, type: "text/calendar", title: ctx.t("rem.h") });
    else downloadText(ICS_FILENAME, text, "text/calendar");
    ctx.notify(ctx.i18n.tn("rem.done", withTime.length), "success");
  } catch (e) { ctx.fail(e); }
}

export async function deleteAll(ctx) {
  const { t } = ctx;
  try {
    if (!(await ctx.confirm({ title: t("data.deleteTitle"), message: t("data.deleteText") }))) return;
    await ctx.store.clearAll();
    try { purgeCorruptCopies(globalThis.localStorage, ctx.store.prefix); } catch { /* erisim yok */ }
    ctx.repo.clearUndo();
    ctx.notify(t("data.deleted"), "success");
    ctx.navigate("welcome");
    await ctx.refresh();
  } catch (e) { ctx.fail(e); }
}

/** Ornek yil: mevcut veri yerine (yalniz bos uygulamada Welcome'dan cagrilir). */
export async function loadSample(ctx, weekStart) {
  const today = ctx.today();
  const s = sampleYear(ctx.t, today, { weekStart });
  const habits = await ctx.repo.addHabits(s.habits, s.start);
  await ctx.store.transactMany([ENTRIES, HABITS], (tx) => {
    for (const e of s.entries) tx.add(ENTRIES, { habitId: habits[e.key].id, date: e.date, value: e.value, rest: e.rest });
  });
  await ctx.repo.savePrefs({ onboarded: true, weekStart });
}
