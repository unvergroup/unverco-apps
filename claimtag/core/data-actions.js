// Yedek al / geri yukle / hepsini sil / para birimi olcekleme: ayarlar ekrani ve ana kabuk ortak eylemleri.
// Her eylem hatayi kendisi yakalar ve kullaniciya anlasilir bildirim gosterir (ctx.fail).
import { BackupError, MAX_BACKUP_BYTES, backupFileName, byteLength, exportBackupText, prepareBackup, restoreBackup } from "./backup.js";
import { downloadText, pickTextFile } from "./files.js";
import { sanitizeBusiness } from "./business.js";
import { currencyDigits } from "./money.js";
import { CT_COLLECTION, CT_ID, sanitizeCt } from "./settings.js";
import { SEQUENCES, purgeCorruptCopies } from "./store.js";
import { confirmDialog } from "./ui.js";
import { LIMITS, migrateData } from "../modules/repairs/logic/schema.js";
import { MAX_MINOR } from "../modules/repairs/logic/calc.js";

// Boyut esikleri (spec 3.9): yedek metni 8.500.000 B'ta uyari, 9.400.000 B'ta yeni kabul durur.
export const SIZE_WARN_BYTES = 8_500_000;
export const SIZE_STOP_BYTES = 9_400_000;
export const COUNT_WARN = 2700; // %90

// Yedekten gelen veriyi YAZMADAN ONCE temizler: uc koleksiyon (onarim + oksuz kayit baglama), ayarlar, dukkan profili, sayaclar.
// Bilinmeyen koleksiyon hic yazilmaz. -> { data, report: { repaired, dropped } }
export function sanitizeAppData(data, { lang = "en" } = {}) {
  const m = migrateData({ customers: data.customers, devices: data.devices, jobs: data.jobs });
  const out = { customers: m.customers, devices: m.devices, jobs: m.jobs };
  const ct = Array.isArray(data[CT_COLLECTION]) ? data[CT_COLLECTION].find((r) => r && r.id === CT_ID) : null;
  out[CT_COLLECTION] = ct ? [{ ...sanitizeCt(ct, lang), id: CT_ID, createdAt: typeof ct.createdAt === "string" ? ct.createdAt : new Date().toISOString(), updatedAt: typeof ct.updatedAt === "string" ? ct.updatedAt : new Date().toISOString() }] : [];
  const biz = Array.isArray(data.business) ? data.business.find((r) => r && r.id === "profile") : null;
  out.business = biz ? [{ ...sanitizeBusiness(biz), id: "profile", createdAt: biz.createdAt ?? new Date().toISOString(), updatedAt: biz.updatedAt ?? new Date().toISOString() }] : [];
  out[SEQUENCES] = (Array.isArray(data[SEQUENCES]) ? data[SEQUENCES] : [])
    .filter((r) => r && typeof r.id === "string" && /^[A-Za-z]{1,6}-\d{4}$/.test(r.id) && Number.isInteger(r.last) && r.last >= 0 && r.last < 10 ** 7)
    .map((r) => ({ id: r.id, prefix: r.id.split("-")[0], year: Number(r.id.split("-")[1]), last: r.last, createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(), updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString() }));
  return { data: out, report: { repaired: m.repaired, dropped: m.dropped } };
}

// Para birimi degisince kayitli tutarlar yeniden olceklenir (ayni gorunen deger; kurus basamagi farkliysa). Ceviri YOKTUR.
export function rescaleDataset(data, from, to) {
  const df = currencyDigits(to) - currencyDigits(from);
  if (df === 0) return { data, changed: false };
  const f = 10 ** Math.abs(df);
  const sc = (v) => (Number.isSafeInteger(v) ? Math.min(MAX_MINOR, df > 0 ? v * f : Math.round(v / f)) : v);
  const jobs = (data.jobs ?? []).map((j) => ({
    ...j,
    estimateMinor: sc(j.estimateMinor),
    lines: (j.lines ?? []).map((l) => ({ ...l, unitMinor: sc(l.unitMinor), costMinor: sc(l.costMinor) })),
    payments: (j.payments ?? []).map((p) => ({ ...p, amountMinor: sc(p.amountMinor) })),
  }));
  return { data: { ...data, jobs }, changed: true };
}

export async function rescaleStoreForCurrency(store, from, to) {
  await store.rewriteAll((data, extra) => {
    const r = rescaleDataset(data, from, to);
    return { data: r.data, extra: { ...extra, currency: to } };
  });
}

// Mevcut kayit sayilari ve yedek boyutu (Ayarlar > Veri satiri, kabul sinirlari).
export async function usage(store) {
  const data = await store.exportAll();
  const bytes = byteLength(JSON.stringify(data));
  return { jobs: (data.jobs ?? []).length, customers: (data.customers ?? []).length, devices: (data.devices ?? []).length, bytes };
}

export async function backupNow(ctx) {
  try {
    const text = await exportBackupText(ctx.store, { appId: ctx.config.appId, currency: ctx.settings.currency, lang: ctx.settings.lang });
    downloadText(backupFileName(ctx.config.appId), text);
    await ctx.ct.save({ lastBackupAt: new Date().toISOString() });
    ctx.notify(ctx.i18n.t("backup.done"), "success");
    if (byteLength(text) > 10 * 1024 * 1024) ctx.notify(ctx.i18n.t("repairs.backup.tooLarge"), "warn");
    return true;
  } catch (e) {
    ctx.fail(e);
    return false;
  }
}

export async function restoreNow(ctx) {
  const { t } = ctx.i18n;
  try {
    const file = await pickTextFile(undefined, MAX_BACKUP_BYTES); // 10 MB ustu dosya OKUNMAZ
    if (!file) return;
    if (file.tooLarge) throw new BackupError("too_large", "This backup file is too large (over 10 MB).");
    const prepare = (d) => sanitizeAppData(d, { lang: ctx.settings.lang });
    // Once dosyayi dogrula ve hazirla (boyut, bicim, uygulama, surum, toplam); bozuksa onay sorma. HICBIR sey yazilmaz.
    const prepared = prepareBackup(file.text, { appId: ctx.config.appId, schemaVersion: ctx.store.schemaVersion, prepare });
    for (const name of ["jobs", "customers", "devices"]) {
      if (prepared.data[name].length > LIMITS[name]) {
        ctx.notify(t("repairs.backup.tooManyRecords", { max: LIMITS[name] }), "error");
        return;
      }
    }
    const current = ctx.settings.currency;
    const bc = prepared.currency; // null: eski yedek, para birimi bilinmiyor
    const notes = [];
    if (bc === null) notes.push(t("backup.currencyUnknown", { current }));
    else if (bc !== current) notes.push(t("backup.currencyDiffers", { backup: bc, current }), t("backup.currencyKeepNote", { current }));
    const { confirmed, checked, checked2 } = await confirmDialog({
      title: t("backup.restoreTitle"),
      message: t("backup.restoreText"),
      notes,
      confirmLabel: t("backup.restoreButton"),
      cancelLabel: t("common.cancel"),
      danger: true,
      checkbox2: bc && bc !== current ? { label: t("backup.currencySwitch", { backup: bc }), checked: true } : undefined,
      checkbox: { label: t("backup.autoBackup"), checked: true },
    });
    if (!confirmed) return;
    const { records, currency, report } = await restoreBackup({
      store: ctx.store,
      text: file.text,
      appId: ctx.config.appId,
      prepare,
      currency: current,
      lang: ctx.settings.lang,
      switchCurrency: Boolean(bc && bc !== current && checked2),
      rescale: (data, from, to) => rescaleDataset(data, from, to).data,
      beforeReplace: checked ? (text) => downloadText(backupFileName(ctx.config.appId, new Date(), "auto-backup"), text) : undefined,
    });
    ctx.notify(t("backup.restored", { records }), "success");
    if (report && (report.repaired > 0 || report.dropped > 0)) ctx.notify(t("repairs.repaired", { n: report.repaired + report.dropped }), "warn");
    ctx.ct.invalidate();
    if (currency && currency !== ctx.settings.currency) await ctx.adoptSettings({ ...ctx.settings, currency }); // veri zaten bu birimde: olcekleme yok
    else await ctx.refresh();
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
    try { purgeCorruptCopies(globalThis.localStorage, ctx.store.prefix); } catch { /* erisim engelliyse kopya da yoktur */ }
    ctx.ct.invalidate();
    ctx.notify(t("settings.deleted"), "success");
    ctx.refresh();
  } catch (e) {
    ctx.fail(e);
  }
}
