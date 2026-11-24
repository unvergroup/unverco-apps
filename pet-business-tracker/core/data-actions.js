// Yedek al / geri yukle / hepsini sil / para birimi olcekleme: ayarlar ekrani ve ana kabuk ortak eylemleri (Pet Business Tracker).
// Her eylem hatayi kendisi yakalar ve kullaniciya anlasilir bildirim gosterir (ctx.fail).
// ctx: { store, config, settings, i18n, pet (createPetSettings), notify, fail, refresh, adoptSettings }
import { BackupError, BACKUP_COLLECTIONS, MAX_BACKUP_BYTES, backupFileName, byteLength, exportBackupText, prepareBackup, restoreBackup } from "./backup.js";
import { downloadText, pickTextFile } from "./files.js";
import { sanitizeBusiness, BUSINESS, BUSINESS_ID } from "./business.js";
import { currencyDigits } from "./money.js";
import { PET_COLLECTION, PET_ID, MAX_MINOR, sanitizePet } from "./settings.js";
import { RECORD_LIMITS, cleanRecord } from "../modules/petcare/logic/schema.js";
import { SEQUENCES, purgeCorruptCopies } from "./store.js";
import { confirmDialog } from "./ui.js";

// Boyut esikleri: yedek metni 8.500.000 B'ta uyari, 9.400.000 B'ta yeni kabul durur.
export const SIZE_WARN_BYTES = 8_500_000;
export const SIZE_STOP_BYTES = 9_400_000;

const nowIso = () => new Date().toISOString();
const ts = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : nowIso());

// Yedekten gelen veriyi YAZMADAN ONCE temizler: uc koleksiyon (kimliksiz / nesne olmayan kayit atilir, kimlik tekrari atilir),
// pet ayarlari, isletme profili, sayaclar. dropped YALNIZ gercekten bozuk kayit (kimliksiz / nesne degil / kimlik tekrari); sinir asimi overLimit'tedir. Bilinmeyen koleksiyon hic yazilmaz. migrate(koleksiyon, kayitlar) -> kayitlar (istege bagli, modul semasi).
// -> { data, report: { repaired, dropped, overLimit: { <koleksiyon>: { count, max, excess } } } }
export function sanitizeAppData(data, { lang = "en", migrate } = {}) {
  const out = {};
  let dropped = 0;
  let repaired = 0;
  const overLimit = {};
  for (const name of BACKUP_COLLECTIONS) {
    const src = Array.isArray(data[name]) ? data[name] : [];
    const seen = new Set();
    let list = [];
    for (const r of src) {
      if (!r || typeof r !== "object" || Array.isArray(r) || typeof r.id !== "string" || !r.id || seen.has(r.id)) { dropped++; continue; }
      seen.add(r.id);
      list.push(r);
    }
    // Giderler geri yuklemede ayni sema temizleyicisinden gecer (gecersiz tarih / kategori / tutar onarilir; kayit DUSMEZ). Eski yedekte alan yoksa liste bos kalir.
    if (name === "expenses") {
      let fixed = false;
      list = list.map((r) => { const c = cleanRecord("expenses", r); if (c.repaired) fixed = true; return c.record; });
      if (fixed) repaired++;
    }
    if (typeof migrate === "function") {
      const before = JSON.stringify(list);
      list = migrate(name, list) ?? list;
      if (JSON.stringify(list) !== before) repaired++;
    }
    // Sinir asimi KAYIT ATMAZ: yalniz raporlanir (overLimit); cagiran geri yuklemeyi acik bir uyariyla durdurur.
    if (list.length > RECORD_LIMITS[name]) overLimit[name] = { count: list.length, max: RECORD_LIMITS[name], excess: list.length - RECORD_LIMITS[name] };
    out[name] = list;
  }
  const pet = Array.isArray(data[PET_COLLECTION]) ? data[PET_COLLECTION].find((r) => r && r.id === PET_ID) : null;
  out[PET_COLLECTION] = pet ? [{ ...sanitizePet(pet, lang), id: PET_ID, createdAt: ts(pet.createdAt), updatedAt: ts(pet.updatedAt) }] : [];
  const biz = Array.isArray(data[BUSINESS]) ? data[BUSINESS].find((r) => r && r.id === BUSINESS_ID) : null;
  out[BUSINESS] = biz ? [{ ...sanitizeBusiness(biz), id: BUSINESS_ID, createdAt: ts(biz.createdAt), updatedAt: ts(biz.updatedAt) }] : [];
  out[SEQUENCES] = (Array.isArray(data[SEQUENCES]) ? data[SEQUENCES] : [])
    .filter((r) => r && typeof r.id === "string" && /^[A-Za-z]{1,6}-\d{4}$/.test(r.id) && Number.isInteger(r.last) && r.last >= 0 && r.last < 10 ** 7)
    .map((r) => ({ id: r.id, prefix: r.id.split("-")[0], year: Number(r.id.split("-")[1]), last: r.last, createdAt: ts(r.createdAt), updatedAt: ts(r.updatedAt) }));
  return { data: out, report: { repaired, dropped, overLimit } };
}

// Para birimi degisince kayitli tutarlar yeniden olceklenir (ayni gorunen deger; kurus basamagi farkliysa). Ceviri YOKTUR.
// Para alanlari: randevu `price`, gider `amount` ve adi "Minor" ile biten her alan; ic ice dizi / nesnelerde de olceklenir.
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
  return { data: { ...data, appointments: walk(data.appointments ?? []), expenses: walk(data.expenses ?? []) }, changed: true };
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
  return { appointments: (data.appointments ?? []).length, expenses: (data.expenses ?? []).length, clients: (data.clients ?? []).length, pets: (data.pets ?? []).length, bytes };
}

export async function backupNow(ctx) {
  try {
    const text = await exportBackupText(ctx.store, { appId: ctx.config.appId, currency: ctx.settings.currency, lang: ctx.settings.lang });
    downloadText(backupFileName(ctx.config.fileSlug), text);
    await ctx.pet.save({ lastBackupAt: new Date().toISOString() });
    ctx.notify(ctx.i18n.t("backup.done"), "success");
    if (byteLength(text) > 10 * 1024 * 1024) ctx.notify(ctx.i18n.t("unvercopbt.backup.tooLarge"), "warn");
    return true;
  } catch (e) {
    ctx.fail(e);
    return false;
  }
}

// Sinir asimi metni: hangi turde kac kayit, ne kadar fazla. Asim yoksa "".
export function overLimitMessage(overLimit, t) {
  const parts = BACKUP_COLLECTIONS.filter((n) => overLimit && overLimit[n]).map((n) => t(`unvercopbt.backup.over.${n}`, overLimit[n]));
  return parts.length ? t("unvercopbt.backup.overLimit", { list: parts.join("; ") }) : "";
}

export async function restoreNow(ctx) {
  const { t } = ctx.i18n;
  try {
    const file = await pickTextFile(undefined, MAX_BACKUP_BYTES); // 10 MB ustu dosya OKUNMAZ
    if (!file) return;
    if (file.tooLarge) throw new BackupError("too_large", "This backup file is too large (over 10 MB).");
    const prepare = (d) => sanitizeAppData(d, { lang: ctx.settings.lang, migrate: ctx.migrate });
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
    if (report && (report.repaired > 0 || report.dropped > 0)) ctx.notify(t("unvercopbt.repaired", { n: report.repaired + report.dropped }), "warn");
    ctx.pet.invalidate();
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
    ctx.pet.invalidate();
    ctx.notify(t("settings.deleted"), "success");
    ctx.refresh();
  } catch (e) {
    ctx.fail(e);
  }
}
