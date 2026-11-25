// Yedek al / geri yukle / hepsini sil / para birimi olcekleme: ayarlar ekrani ve ana kabuk ortak eylemleri (Income & Expense Tracker).
// Her eylem hatayi kendisi yakalar ve kullaniciya anlasilir bildirim gosterir (ctx.fail).
// ctx: { store, config, settings, i18n, ledger (createLedgerSettings), notify, fail, refresh, adoptSettings }
import { BackupError, BACKUP_COLLECTIONS, MAX_BACKUP_BYTES, backupFileName, byteLength, exportBackupText, prepareBackup, restoreBackup } from "./backup.js";
import { downloadText, pickTextFile } from "./files.js";
import { currencyDigits } from "./money.js";
import { LEDGER_COLLECTION, LEDGER_ID, MAX_MINOR, sanitizeLedger } from "./settings.js";
import { OTHER_KEY, RECORD_LIMITS, cleanRecord, presetCategoryRecords } from "../modules/ledger/logic/schema.js";
import { purgeCorruptCopies } from "./store.js";
import { confirmDialog } from "./ui.js";

// Boyut esikleri: yedek metni 8.500.000 B'ta uyari, 9.400.000 B'ta yeni kabul durur.
export const SIZE_WARN_BYTES = 8_500_000;
export const SIZE_STOP_BYTES = 9_400_000;

const nowIso = () => new Date().toISOString();
const ts = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : nowIso());

// Yedekten gelen veriyi YAZMADAN ONCE temizler: dort koleksiyon (kimliksiz / nesne olmayan kayit atilir, kimlik tekrari atilir; her kayit
// sema temizleyicisinden gecer), defter ayarlari. Baglar onarilir: bilinmeyen isletmeye bagli kayit ilk isletmeye, bilinmeyen kategoriye bagli
// kayit ayni turun "Diger" kategorisine gecer. dropped YALNIZ gercekten bozuk kayit; sinir asimi overLimit'tedir. Bilinmeyen koleksiyon yazilmaz.
// -> { data, report: { repaired, dropped, overLimit: { <koleksiyon>: { count, max, excess } } } }
export function sanitizeAppData(data, { lang = "en" } = {}) {
  const out = {};
  let dropped = 0;
  let repaired = 0;
  const overLimit = {};
  for (const name of BACKUP_COLLECTIONS) {
    const src = Array.isArray(data[name]) ? data[name] : [];
    const seen = new Set();
    const list = [];
    for (const r of src) {
      if (!r || typeof r !== "object" || Array.isArray(r) || typeof r.id !== "string" || !r.id || seen.has(r.id)) { dropped++; continue; }
      seen.add(r.id);
      const c = cleanRecord(name, r);
      if (c.repaired) repaired++;
      list.push(c.record);
    }
    if (list.length > RECORD_LIMITS[name]) overLimit[name] = { count: list.length, max: RECORD_LIMITS[name], excess: list.length - RECORD_LIMITS[name] };
    out[name] = list;
  }
  // Hazir kategoriler eksikse eklenir ("Diger" kategorileri her zaman vardir).
  const catIds = new Set(out.categories.map((c) => c.id));
  for (const p of presetCategoryRecords()) if (!catIds.has(p.id)) { const t = nowIso(); out.categories.push({ ...p, hidden: false, createdAt: t, updatedAt: t }); }
  const catById = new Map(out.categories.map((c) => [c.id, c]));
  const bizIds = new Set(out.businesses.map((b) => b.id));
  const firstBiz = out.businesses[0]?.id ?? "";
  for (const col of ["entries", "trips"]) {
    out[col] = out[col].map((r) => {
      let rec = r;
      if (!bizIds.has(rec.businessId) && firstBiz) { rec = { ...rec, businessId: firstBiz }; repaired++; }
      if (col === "entries") {
        const cat = catById.get(rec.categoryId);
        if (!cat || cat.type !== rec.type) { rec = { ...rec, categoryId: `cat-${OTHER_KEY[rec.type]}` }; repaired++; }
      }
      return rec;
    }).filter((r) => (col === "entries" ? r.amount > 0 : r.miles10 > 0) || (dropped++, false));
  }
  const led = Array.isArray(data[LEDGER_COLLECTION]) ? data[LEDGER_COLLECTION].find((r) => r && r.id === LEDGER_ID) : null;
  out[LEDGER_COLLECTION] = led ? [{ ...sanitizeLedger(led, lang), seeded: true, id: LEDGER_ID, createdAt: ts(led.createdAt), updatedAt: ts(led.updatedAt) }] : [];
  return { data: out, report: { repaired, dropped, overLimit } };
}

// Para birimi degisince kayitli tutarlar yeniden olceklenir (ayni gorunen deger; kurus basamagi farkliysa). Ceviri YOKTUR.
// Para alanlari: kayit `amount` ve adi "Minor" ile biten her alan. Kilometre orani (rateMilli) para birimi biriminde oldugu icin olceklenmez.
export function rescaleDataset(data, from, to) {
  const df = currencyDigits(to) - currencyDigits(from);
  if (df === 0) return { data, changed: false };
  const f = 10 ** Math.abs(df);
  const sc = (v) => (Number.isSafeInteger(v) ? Math.min(MAX_MINOR, df > 0 ? v * f : Math.round(v / f)) : v);
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^(price|amount)$|Minor$/.test(k) ? sc(x) : walk(x)]));
    return v;
  };
  return { data: { ...data, entries: walk(data.entries ?? []) }, changed: true };
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
  const receiptChars = (data.entries ?? []).reduce((n, e) => n + (typeof e.receipt === "string" ? e.receipt.length : 0), 0);
  return { entries: (data.entries ?? []).length, trips: (data.trips ?? []).length, receipts: (data.entries ?? []).filter((e) => e.receipt).length, receiptChars, bytes };
}

export async function backupNow(ctx) {
  try {
    const text = await exportBackupText(ctx.store, { appId: ctx.config.appId, currency: ctx.settings.currency, lang: ctx.settings.lang });
    downloadText(backupFileName(ctx.config.fileSlug), text);
    await ctx.ledger.save({ lastBackupAt: new Date().toISOString() });
    ctx.notify(ctx.i18n.t("backup.done"), "success");
    if (byteLength(text) > 10 * 1024 * 1024) ctx.notify(ctx.i18n.t("iet.backup.tooLarge"), "warn");
    return true;
  } catch (e) {
    ctx.fail(e);
    return false;
  }
}

// Sinir asimi metni: hangi turde kac kayit, ne kadar fazla. Asim yoksa "".
export function overLimitMessage(overLimit, t) {
  const parts = BACKUP_COLLECTIONS.filter((n) => overLimit && overLimit[n]).map((n) => t(`iet.backup.over.${n}`, overLimit[n]));
  return parts.length ? t("iet.backup.overLimit", { list: parts.join("; ") }) : "";
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
    const over = overLimitMessage(prepared.report?.overLimit, t);
    if (over) { ctx.notify(over, "error"); return; } // hicbir sey yazilmadi, hicbir kayit silinmedi
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
      beforeReplace: checked ? (text) => downloadText(backupFileName(ctx.config.fileSlug, new Date(), "auto-backup"), text) : undefined,
    });
    ctx.notify(t("backup.restored", { records }), "success");
    if (report && (report.repaired > 0 || report.dropped > 0)) ctx.notify(t("iet.repaired", { n: report.repaired + report.dropped }), "warn");
    ctx.ledger.invalidate();
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
    ctx.ledger.invalidate();
    ctx.notify(t("settings.deleted"), "success");
    ctx.refresh();
  } catch (e) {
    ctx.fail(e);
  }
}
