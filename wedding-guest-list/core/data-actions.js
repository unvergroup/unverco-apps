// Yedek al / geri yukle / hepsini sil: ayarlar ekrani ve modullerin ortak eylemleri.
// Her eylem hatayi kendisi yakalar ve kullaniciya anlasilir bildirim gosterir (ctx.fail).
import { BackupError, MAX_BACKUP_BYTES, backupFileName, exportBackupText, prepareBackup, restoreBackup } from "./backup.js";
import { downloadText, pickTextFile } from "./files.js";
import { confirmDialog } from "./ui.js";

export async function backupNow(ctx) {
  try {
    const text = await exportBackupText(ctx.store, { appId: ctx.config.appId });
    downloadText(backupFileName(ctx.config.appId), text);
    ctx.notify(ctx.i18n.t("backup.done"), "success");
  } catch (e) {
    ctx.fail(e);
  }
}

export async function restoreNow(ctx) {
  const { t } = ctx.i18n;
  try {
    const file = await pickTextFile(undefined, MAX_BACKUP_BYTES);
    if (!file) return;
    if (file.tooLarge) throw new BackupError("too_large", "This backup file is too large (over 10 MB).");
    // Once dosyayi dogrula (boyut, bicim, uygulama, surum, toplam, koleksiyon adi, kayitlar, urun sinirlari); bozuksa onay sorma.
    prepareBackup(file.text, { appId: ctx.config.appId, schemaVersion: ctx.store.schemaVersion });
    const { confirmed, checked } = await confirmDialog({
      title: t("backup.restoreTitle"),
      message: t("backup.restoreText"),
      confirmLabel: t("backup.restoreButton"),
      cancelLabel: t("common.cancel"),
      danger: true,
      checkbox: { label: t("backup.autoBackup"), checked: true },
    });
    if (!confirmed) return;
    const { records } = await restoreBackup({
      store: ctx.store,
      text: file.text,
      appId: ctx.config.appId,
      beforeReplace: checked
        ? (text) => downloadText(backupFileName(ctx.config.appId, new Date(), "auto-backup"), text)
        : undefined,
    });
    ctx.notify(t("backup.restored", { records }), "success");
    ctx.refresh();
  } catch (e) {
    ctx.fail(e);
  }
}

export async function deleteAllNow(ctx) {
  const { t } = ctx.i18n;
  try {
    const { confirmed } = await confirmDialog({
      title: t("settings.deleteTitle"),
      message: t("settings.deleteText"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (!confirmed) return;
    await ctx.store.clearAll();
    ctx.notify(t("settings.deleted"), "success");
    ctx.refresh();
  } catch (e) {
    ctx.fail(e);
  }
}
