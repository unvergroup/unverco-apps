// Ayarlar ekrani (Homeschool Planner): okul yili ve KULLANICININ kendi hedefleri, okul profili + logo, yazdirma, dil ve bicim, veri, gizlilik, lisans.
// Her bolum kendi formudur: dogrular, hatayi alanin altina yazar, ctx.prefs.save ile yazar. Kullanici verisi yalniz textContent.
// Uygulama eyalet kurali / gun-saat esigi ONERMEZ; hedef alanlari bos (0) baslar ve yanlarinda yasal uyari cumlesi durur.
import { CURRENCIES, LANGS, LANG_NAMES, LOCALES } from "./i18n.js";
import { LIMITS_BUSINESS } from "./business.js";
import { LOGO_TYPES, encodeLogo, isLogoDataUrl } from "./logo.js";
import { THEMES, applyLanguage, checkBackupDays, checkInt, checkMinutes, checkWorkDays, checkYear, PAPERS, WEEK_DAYS, TARGET_MAX } from "./settings.js";
import { backupNow, deleteAllNow, restoreNow, usage, SIZE_WARN_BYTES } from "./data-actions.js";
import { downloadText } from "./files.js";
import { currencyDigits } from "./money.js";
import { guardWrite } from "./safe.js";
import { todayIso } from "./dates.js";
import { button, confirmDialog, field, focusFirstInvalid, h, nextId, select } from "./ui.js";
import { DATA_COLLECTIONS, RECORD_LIMITS } from "../modules/homeschool/logic/schema.js";
import { buildSample } from "../modules/homeschool/logic/sample.js";
import { attendanceCsv, hoursCsv } from "../modules/homeschool/logic/csv.js";
import { labels } from "../modules/homeschool/print/screens.js";

const ERR_KEY = { minutes: "hs.err.minutes", range: "hs.err.range", date: "hs.err.date", yearOrder: "hs.err.yearOrder", yearLong: "hs.err.yearLong", workDays: "hs.err.workDays", days: "hs.err.backupDays" };

export async function renderSettings(container, ctx) {
  const { t } = ctx.i18n;
  const s = ctx.settings;
  const pref = await ctx.prefs.get();
  const biz = await ctx.business.get();
  const guard = guardWrite((e) => ctx.fail(e));
  const change = (patch) => ctx.updateSettings({ ...s, ...patch });
  const errText = (r) => t(ERR_KEY[r.error] ?? "hs.err.invalid", { min: r.min, max: r.max });
  const saved = () => ctx.notify(t("hs.saved"), "success");

  const section = ({ id, title, intro, fields, extra, onSave }) => {
    const form = h("form", { class: "card stack", id, "aria-labelledby": `${id}-t`, novalidate: true });
    form.append(h("h3", { id: `${id}-t`, text: title }), ...(intro ?? []), ...fields.map((x) => x.f?.element ?? x.element), ...(extra ?? []));
    form.append(h("div", { class: "row" }, button({ id: `${id}-save`, label: t("common.save"), variant: "primary", type: "submit" })));
    form.addEventListener("submit", guard(async (e) => {
      e.preventDefault();
      const patch = {};
      let bad = false;
      for (const x of fields) {
        if (!x.check) continue;
        const r = x.check();
        x.f.setError?.(r.ok ? "" : errText(r));
        if (r.ok) Object.assign(patch, x.key ? { [x.key]: r.value } : r.value); else bad = true;
      }
      if (bad) { focusFirstInvalid(form); return; }
      if ((await onSave(patch)) !== false) { saved(); await ctx.refresh(); }
    }));
    return form;
  };

  // ---- Okul yili ve hedefler ----
  const yName = field({ id: "set-year-name", label: t("hs.year.name"), value: pref.yearName, maxlength: 40, autocomplete: "off" });
  const yStart = field({ id: "set-year-start", label: t("hs.year.start"), type: "date", value: pref.yearStart });
  const yEnd = field({ id: "set-year-end", label: t("hs.year.end"), type: "date", value: pref.yearEnd });
  const tDays = field({ id: "set-target-days", label: t("hs.year.targetDays"), value: String(pref.targetDays), inputmode: "numeric", autocomplete: "off", hint: t("hs.year.targetHint") });
  const tHours = field({ id: "set-target-hours", label: t("hs.year.targetHours"), value: String(pref.targetHours), inputmode: "numeric", autocomplete: "off" });
  const tCore = field({ id: "set-target-core", label: t("hs.year.targetCore"), value: String(pref.targetCoreHours), inputmode: "numeric", autocomplete: "off", hint: t("hs.year.coreHint") });
  const mins = field({ id: "set-minutes", label: t("hs.year.defaultMinutes"), value: String(pref.defaultMinutes), inputmode: "numeric", autocomplete: "off" });
  const dayBoxes = WEEK_DAYS.map((d) => ({ d, box: h("input", { type: "checkbox", id: `set-day-${d}`, checked: pref.schoolDays.includes(d) }) }));
  const daysErr = h("p", { class: "field-error", role: "alert" });
  const daysSet = h("fieldset", { class: "field check-group" }, h("legend", { text: t("hs.year.schoolDays") }),
    h("div", { class: "check-row" }, ...dayBoxes.map(({ d, box }) => h("label", { class: "check", for: box.id }, box, h("span", { text: t(`hs.day.${d}`) })))), daysErr);
  const autoBox = h("input", { type: "checkbox", id: "set-auto-att", checked: pref.autoAttendance });
  const year = section({
    id: "set-year", title: t("hs.year.title"),
    intro: [h("p", { class: "legal-note", id: "set-legal", role: "note", text: t("hs.legal") })],
    fields: [
      { f: yName, check: () => ({ ok: true, value: { yearName: yName.input.value } }) },
      { f: yStart, check: () => { const r = checkYear(yStart.input.value, yEnd.input.value); yEnd.setError(""); return r; } },
      { f: yEnd },
      { f: tDays, key: "targetDays", check: () => checkInt(tDays.input.value || "0", 0, TARGET_MAX.days) },
      { f: tHours, key: "targetHours", check: () => checkInt(tHours.input.value || "0", 0, TARGET_MAX.hours) },
      { f: tCore, key: "targetCoreHours", check: () => checkInt(tCore.input.value || "0", 0, TARGET_MAX.hours) },
      { f: mins, key: "defaultMinutes", check: () => checkMinutes(mins.input.value) },
      { element: daysSet, f: { element: daysSet, setError: (m) => { daysErr.textContent = m || ""; } }, key: "schoolDays", check: () => checkWorkDays(dayBoxes.filter((x) => x.box.checked).map((x) => x.d)) },
      { element: h("label", { class: "check", for: autoBox.id }, autoBox, h("span", { text: t("hs.year.autoAtt") })) },
    ],
    onSave: (p) => ctx.prefs.save({ ...p, autoAttendance: autoBox.checked }),
  });

  // ---- Okul profili ----
  const name = field({ id: "set-school-name", label: t("hs.school.name"), value: biz.name, maxlength: LIMITS_BUSINESS.name, autocomplete: "organization", hint: t("hs.school.nameHint") });
  const address = field({ id: "set-school-address", label: t("hs.school.address"), value: biz.address, multiline: true, maxlength: LIMITS_BUSINESS.address });
  address.input.rows = 2;
  const shop = section({
    id: "set-business", title: t("hs.school.title"),
    fields: [{ f: name }, { f: address }],
    onSave: async () => { await ctx.business.save({ ...biz, name: name.input.value, address: address.input.value, logo }); },
  });

  // ---- Musterinin kendi logosu ----
  // Dosya CIHAZDA canvas'tan gecirilip yeniden kodlanir (core/logo.js): metadata ve gomulu icerik temizlenir, en uzun kenar 320 px, PNG.
  // Secim / kaldirma ANINDA kaydedilir (baslik ve yazdirilan belgeler hemen guncellenir); formun geri kalani etkilenmez.
  // Logo yoksa onizleme alani HIC CIZILMEZ: bos cerceve, yer tutucu ya da "logo ekle" kutusu yoktur.
  let logo = isLogoDataUrl(biz.logo) ? biz.logo : "";
  const logoPreview = h("div", { class: "logo-preview" });
  const logoErr = h("p", { class: "field-error", role: "alert" });
  const logoFileId = nextId("logo");
  const logoPickText = h("span", { class: "logo-pick-text" });
  const logoInput = h("input", { type: "file", accept: LOGO_TYPES.join(","), id: logoFileId, class: "sr-only", "data-logo-input": "1" });
  const logoPick = h("label", { class: "btn btn-primary logo-pick", for: logoFileId }, logoInput, logoPickText);
  const logoRemove = button({ id: "logo-remove", label: t("business.logoRemove"), glyph: "trash", onClick: guard(async () => {
    logo = "";
    logoErr.textContent = "";
    logoInput.value = "";
    await persistLogo();
    ctx.notify(t("business.logoRemoved"), "success");
  }) });
  const paintLogo = () => {
    if (logo) {
      const img = h("img", { class: "logo-preview-img", id: "logo-preview-img", alt: "" });
      img.src = logo; // h() data: adresini reddeder: src dogrudan atanir
      logoPreview.replaceChildren(img);
    } else logoPreview.replaceChildren();
    logoPickText.textContent = t(logo ? "business.logoChange" : "business.logoChoose");
    logoRemove.hidden = !logo;
  };
  // Yalniz logo alanini yazar: kaydedilmis diger alanlar oldugu gibi kalir (formdaki kaydedilmemis yazi etkilenmez).
  const persistLogo = async () => {
    const cur = await ctx.business.get();
    await ctx.business.save({ ...cur, logo });
    paintLogo();
    await ctx.refresh();
  };
  logoInput.addEventListener("change", guard(async () => {
    const file = logoInput.files && logoInput.files[0];
    if (!file) return;
    logoErr.textContent = "";
    try {
      logo = await encodeLogo(file);
      await persistLogo();
      ctx.notify(t("hs.saved"), "success");
    } catch {
      logoErr.textContent = t("business.logoError"); // okunamayan / desteklenmeyen dosya beklenen kullanici durumudur: metinle bildirilir
      paintLogo();
    }
  }));
  paintLogo();
  const logoCard = h("div", { class: "card stack", id: "set-logo" },
    h("h3", { text: t("business.logo") }),
    h("p", { class: "field-hint", id: "set-logo-hint", text: t("business.logoHint") }),
    logoPreview,
    h("div", { class: "row logo-actions" }, logoPick, logoRemove),
    logoErr);

  // ---- Yazdirma ----
  const paper = select({ id: "set-paper", label: t("hs.set.paper"), value: pref.paper, options: PAPERS.map((p) => ({ value: p, label: t(`hs.set.paper.${p}`) })) });
  const markBox = h("input", { type: "checkbox", id: "set-brand-mark", checked: pref.brandMark === true });
  const printing = section({
    id: "set-printing", title: t("hs.set.printing"),
    fields: [{ element: paper.element }, { element: h("div", { class: "field" }, h("label", { class: "check", for: markBox.id }, markBox, h("span", { text: t("hs.set.brandMark") })), h("p", { class: "field-hint", text: t("hs.set.brandMarkHint") })) }],
    onSave: () => ctx.prefs.save({ paper: paper.input.value, brandMark: markBox.checked }),
  });

  // ---- Dil ve bicim ----
  const langSelect = select({ id: "setting-lang", label: t("settings.language"), value: s.lang, options: LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })), onChange: (v) => ctx.updateSettings(applyLanguage(s, v)) });
  for (const o of langSelect.input.options) o.lang = o.value;
  const format = h("div", { class: "card stack", id: "set-format" },
    h("h3", { text: t("hs.set.format") }),
    langSelect.element,
    h("p", { class: "field-hint", id: "setting-lang-note", text: t("settings.langNote") }),
    select({
      id: "setting-currency", label: t("settings.currency"), value: s.currency, options: CURRENCIES.map((c) => ({ value: c, label: c })),
      onChange: async (v) => {
        if (v === s.currency) return;
        const rescale = currencyDigits(v) !== currencyDigits(s.currency);
        const lossy = currencyDigits(v) < currencyDigits(s.currency);
        const { confirmed } = await confirmDialog({
          title: t("settings.currencyConfirmTitle"),
          message: rescale ? `${t("settings.currencyConfirmText")} ${t("settings.currencyConfirmRescale", { from: s.currency, to: v })}${lossy ? ` ${t("settings.currencyConfirmRound")}` : ""}` : t("settings.currencyConfirmText"),
          confirmLabel: t("settings.currencyConfirmButton"), cancelLabel: t("common.cancel"),
        });
        if (confirmed) await change({ currency: v }); else await ctx.refresh();
      },
    }).element,
    select({ id: "setting-locale", label: t("settings.locale"), value: s.locale, options: LOCALES.map((l) => ({ value: l.id, label: l.label })), onChange: (v) => change({ locale: v }) }).element,
    select({ id: "setting-theme", label: t("settings.theme"), value: s.theme, options: THEMES.map((x) => ({ value: x, label: t(`settings.theme.${x}`) })), onChange: (v) => change({ theme: v }) }).element,
  );

  // ---- Veri ----
  const every = field({ id: "set-backup-every", label: t("hs.set.backupEvery"), value: String(pref.backupEveryDays), inputmode: "numeric", autocomplete: "off" });
  const usageLine = h("p", { class: "muted", id: "set-usage", text: "" });
  usage(ctx.store).then((u) => {
    const mb = (u.bytes / 1024 / 1024).toFixed(2);
    usageLine.textContent = t("hs.set.usage", { kids: u.students, maxKids: RECORD_LIMITS.students, logs: u.logs, maxLogs: RECORD_LIMITS.logs, mb, maxMb: "10" });
    if (u.bytes >= SIZE_WARN_BYTES) usageLine.append(` ${t("hs.set.sizeNear", { mb, max: "10" })}`);
  }).catch(() => {});
  const exportCsv = (kind) => guard(async () => {
    const all = {};
    for (const c of DATA_COLLECTIONS) all[c] = await ctx.store.list(c);
    const L0 = labels(ctx);
    const L = { yes: t("hs.csv.yes"), no: t("hs.csv.no"), activity: t("hs.act.title"), date: t("hs.doc.date"), student: t("hs.kid.name"), subject: t("hs.subj.name"), core: t("hs.subj.core"), minutes: t("hs.log.minutes"), note: t("hs.log.note"), status: t("hs.doc.kind"), counted: t("hs.csv.counted"), kind: L0.kind };
    const p = await ctx.prefs.get();
    const text = kind === "hours" ? hoursCsv(all, p, L) : attendanceCsv(all, p, L);
    downloadText(`${ctx.config.fileSlug}-${kind}-${todayIso()}.csv`, "\ufeff" + text, "text/csv");
    ctx.notify(t("hs.csv.done"), "success");
  });
  const loadSample = guard(async () => {
    const n = (await ctx.store.count("students")) + (await ctx.store.count("logs"));
    if (n > 0) {
      const { confirmed } = await confirmDialog({ title: t("hs.sample.title"), message: t("hs.sample.replace"), confirmLabel: t("hs.sample.load"), cancelLabel: t("common.cancel"), danger: true });
      if (!confirmed) return;
    }
    const { data, prefs: sp } = buildSample(todayIso(), s.lang);
    const keep = {};
    for (const c of ["hsPrefs", "business"]) keep[c] = await ctx.store.list(c);
    await ctx.store.importAll({ ...data, ...keep }, { schemaVersion: ctx.store.schemaVersion });
    await ctx.prefs.save(sp);
    const b = await ctx.business.get();
    if (!b.name) await ctx.business.save({ ...b, name: t("hs.sample.school") });
    ctx.notify(t("hs.sample.loaded"), "success");
    ctx.navigate("today");
  });
  const data = h("div", { class: "card stack", id: "set-data" },
    h("h3", { text: t("hs.set.data") }),
    h("div", { class: "row" },
      button({ id: "btn-backup", label: t("hs.backup.download"), variant: "primary", exportAction: true, onClick: guard(async () => { if (await backupNow(ctx)) await ctx.refresh(); }) }),
      button({ id: "btn-restore", label: t("settings.restore"), onClick: () => restoreNow(ctx) })),
    h("p", { class: "muted", id: "set-plain", text: t("hs.set.plainFile") }), usageLine,
    h("div", { class: "row" },
      button({ id: "btn-csv-hours", label: t("hs.csv.hours"), glyph: "download", exportAction: true, onClick: exportCsv("hours") }),
      button({ id: "btn-csv-att", label: t("hs.csv.attendance"), glyph: "download", exportAction: true, onClick: exportCsv("attendance") })),
    h("form", { class: "stack", novalidate: true, on: { submit: guard(async (e) => {
      e.preventDefault();
      const r = checkBackupDays(every.input.value);
      every.setError(r.ok ? "" : t("hs.err.backupDays", { max: 90 }));
      if (!r.ok) return;
      await ctx.prefs.save({ backupEveryDays: r.value });
      saved();
    }) } }, every.element, h("div", { class: "row" }, button({ id: "set-backup-every-save", label: t("common.save"), type: "submit" }))),
    h("div", { class: "row" },
      button({ id: "btn-sample", label: t("hs.sample.load"), onClick: loadSample }),
      button({ id: "btn-delete-all", label: t("settings.deleteAll"), variant: "danger", onClick: () => deleteAllNow(ctx) })),
  );

  container.replaceChildren(
    h("h2", { text: t("settings.title") }),
    year, shop, logoCard, printing, format, data,
    h("div", { class: "card stack", id: "set-about" },
      h("p", { id: "settings-privacy", text: t("hs.privacy.text") }),
      h("p", { class: "muted", text: `${t("app.title")} ${t("app.subtitle")} · ${t("settings.version", { version: ctx.config.version })}` })),
    h("div", { class: "card stack", id: "settings-licenses" },
      h("h3", { text: t("settings.licenses") }),
      h("p", { id: "license-copyright", text: t("hs.license.copyright") }),
      h("p", { id: "license-grant", text: t("hs.license.grant") }),
      h("p", { id: "license-resale", text: t("hs.license.resale") }),
      h("p", { id: "license-warranty", text: t("hs.license.warranty") }),
      h("p", { id: "license-product", text: t("hs.license.product") }),
      h("p", { class: "muted", text: t("hs.about.trademarks") })),
  );
}
