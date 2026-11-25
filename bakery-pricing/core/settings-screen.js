// Ayarlar ekrani: isletme, logo, fiyatlama varsayilanlari, yazdirma, dil ve bicim, veri (yedek, CSV, ornek veri), gizlilik, lisans.
// Her bolum kendi formudur: dogrular, hatayi alanin altina yazar, ctx.prefs.save ile yazar. Kullanici verisi yalniz textContent.
// ctx: { i18n, settings, config, store, prefs, business, notify, fail, refresh, updateSettings, sample }
import { CURRENCIES, LANGS, LANG_NAMES, LOCALES } from "./i18n.js";
import { LIMITS_BUSINESS, validatePhone } from "./business.js";
import { LOGO_TYPES, encodeLogo, isLogoDataUrl } from "./logo.js";
import { THEMES, applyLanguage, checkBackupDays, PAPERS, PRICING_MODES, PREF_LIMITS, LIMITS, targetMax } from "./settings.js";
import { formatMinorPlain } from "./money.js";
import { localizeNumber, parseMoneyText, parseNumberText } from "./number-input.js";
import { backupNow, deleteAllNow, restoreNow, usage, SIZE_WARN_BYTES } from "./data-actions.js";
import { currencyDigits } from "./money.js";
import { guardWrite } from "./safe.js";
import { button, confirmDialog, field, focusFirstInvalid, h, nextId, select } from "./ui.js";

const ERR_KEY = { pct: "bk.err.pct", money: "bk.err.money", days: "bk.err.days", phone: "bk.err.phone" };

export async function renderSettings(container, ctx) {
  const { t } = ctx.i18n;
  const s = ctx.settings;
  const pref = await ctx.prefs.get();
  const biz = await ctx.business.get();
  const guard = guardWrite((e) => ctx.fail(e));
  const change = (patch) => ctx.updateSettings({ ...s, ...patch });
  const errText = (r) => t(ERR_KEY[r.error] ?? "bk.err.required", { min: r.min, max: r.max });
  const saved = () => ctx.notify(t("bk.saved"), "success");

  // Bolum cercevesi: form + kaydet dugmesi. fields: [{ f, key, check(): {ok,value,error} }]
  const section = ({ id, title, intro, fields, extra, onSave }) => {
    const form = h("form", { class: "card stack", id, "aria-labelledby": `${id}-t`, novalidate: true });
    form.append(h("h3", { id: `${id}-t`, text: title }), ...(intro ?? []), ...fields.map((x) => x.f?.element ?? x.element), ...(extra ?? []));
    form.append(h("div", { class: "row" }, button({ label: t("common.save"), variant: "primary", type: "submit" })));
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
      if ((await onSave(patch)) !== false) saved();
    }));
    return form;
  };

  // ---- Isletme ----
  const name = field({ label: t("business.name"), value: biz.name, maxlength: LIMITS_BUSINESS.name, autocomplete: "organization" });
  const phone = field({ label: t("business.phone"), value: biz.phone, type: "tel", autocomplete: "tel", maxlength: LIMITS_BUSINESS.phone });
  const address = field({ label: t("business.address"), value: biz.address, multiline: true, maxlength: LIMITS_BUSINESS.address });
  address.input.rows = 2;
  const logoNote = field({ label: t("business.logoNote"), value: biz.logoNote, maxlength: LIMITS_BUSINESS.logoNote, hint: t("business.logoNoteHint") });
  const accent = field({ label: t("business.accent"), type: "color", value: biz.accent });
  const shop = section({
    id: "set-business", title: t("bk.set.business"),
    fields: [
      { f: name },
      { f: phone, check: () => (phone.input.value.trim() === "" ? { ok: true, value: {} } : validatePhone(phone.input.value).ok ? { ok: true, value: {} } : { ok: false, error: "phone" }) },
      { f: address }, { f: logoNote }, { f: accent },
    ],
    onSave: async () => { await ctx.business.save({ name: name.input.value, phone: phone.input.value, address: address.input.value, logo, logoNote: logoNote.input.value, accent: accent.input.value }); },
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
      ctx.notify(t("bk.saved"), "success");
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

  // ---- Fiyatlama varsayilanlari (tum tarifler ve yeni siparisler) ----
  const dec = ctx.i18n.decimal;
  const numVal = (v) => localizeNumber(String(v), dec);
  const readNum = (f) => parseNumberText(f.input.value.trim(), { decimal: dec });
  const rate = field({ label: t("bk.set.hourly"), value: localizeNumber(formatMinorPlain(pref.hourlyRateMinor), dec), inputmode: "decimal", autocomplete: "off", id: "set-hourly", hint: t("bk.set.hourlyHint") });
  const overhead = field({ label: t("bk.set.overhead"), value: numVal(pref.overheadPct), inputmode: "decimal", autocomplete: "off", id: "set-overhead", hint: t("bk.set.overheadHint") });
  const mode = select({ id: "set-mode", label: t("bk.set.mode"), value: pref.pricingMode, options: PRICING_MODES.map((m) => ({ value: m, label: t(`bk.set.mode.${m}`) })) });
  const modeHint = h("p", { class: "field-hint", id: "set-mode-hint", text: t("bk.set.modeHint") });
  mode.element.append(modeHint);
  const target = field({ label: t("bk.set.target"), value: numVal(pref.targetPct), inputmode: "decimal", autocomplete: "off", id: "set-target" });
  const deposit = field({ label: t("bk.set.deposit"), value: numVal(pref.depositPct), inputmode: "decimal", autocomplete: "off", id: "set-deposit" });
  const valid = field({ label: t("bk.set.quoteValid"), value: String(pref.quoteValidDays), inputmode: "numeric", autocomplete: "off", id: "set-valid" });
  const docNote = field({ label: t("bk.set.docNote"), value: pref.docNote, multiline: true, maxlength: PREF_LIMITS.docNote, id: "set-docnote", hint: t("bk.set.docNoteHint") });
  const pctCheck = (f, max) => () => { const n = readNum(f); return Number.isFinite(n) && n >= 0 && n <= max ? { ok: true, value: Math.round(n * 100) / 100 } : { ok: false, error: "pct", max }; };
  const pricing = section({
    id: "set-pricing", title: t("bk.set.pricing"), intro: [h("p", { class: "muted", text: t("bk.set.pricingIntro") })],
    fields: [
      { f: rate, key: "hourlyRateMinor", check: () => { const m = parseMoneyText(rate.input.value.trim(), { decimal: dec }); return Number.isSafeInteger(m) && m >= 0 && m <= PREF_LIMITS.hourlyMax ? { ok: true, value: m } : { ok: false, error: "money" }; } },
      { f: overhead, key: "overheadPct", check: pctCheck(overhead, PREF_LIMITS.overheadMax) },
      { element: mode.element, f: { setError() {} }, key: "pricingMode", check: () => ({ ok: true, value: mode.input.value }) },
      { f: target, key: "targetPct", check: () => pctCheck(target, targetMax(mode.input.value))() },
      { f: deposit, key: "depositPct", check: pctCheck(deposit, PREF_LIMITS.depositMax) },
      { f: valid, key: "quoteValidDays", check: () => { const v = valid.input.value.trim(); const n = Number(v); return /^\d+$/.test(v) && n >= PREF_LIMITS.validMin && n <= PREF_LIMITS.validMax ? { ok: true, value: n } : { ok: false, error: "days", max: PREF_LIMITS.validMax }; } },
      { f: docNote, key: "docNote", check: () => ({ ok: true, value: docNote.input.value }) },
    ],
    onSave: async (p) => { await ctx.prefs.save(p); },
  });
  // ---- Yazdirma ----
  const paper = select({ id: "set-paper", label: t("bk.set.paper"), value: pref.paper, options: PAPERS.map((p) => ({ value: p, label: t(`bk.set.paper.${p}`) })) });
  // UNVERCO markasi yazdirilan belgelerde VARSAYILAN OLARAK KAPALI; acikken yalniz altbilgide tek satir metin olur.
  const markBox = h("input", { type: "checkbox", id: "set-brand-mark", checked: pref.brandMark === true });
  const markField = h("div", { class: "field" },
    h("label", { class: "check", for: markBox.id }, markBox, h("span", { text: t("bk.set.brandMark") })),
    h("p", { class: "field-hint", id: "set-brand-mark-hint", text: t("bk.set.brandMarkHint") }));
  const printing = section({
    id: "set-printing", title: t("bk.set.printing"),
    fields: [
      { element: paper.element, f: paper, key: "paper", check: () => ({ ok: true, value: paper.input.value }), setError() {} },
      { element: markField, f: { setError() {} }, key: "brandMark", check: () => ({ ok: true, value: markBox.checked }) },
    ],
    onSave: (p) => ctx.prefs.save(p),
  });

  // ---- Dil ve bicim ----
  const langSelect = select({ id: "setting-lang", label: t("settings.language"), value: s.lang, options: LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })), onChange: (v) => ctx.updateSettings(applyLanguage(s, v)) });
  for (const o of langSelect.input.options) o.lang = o.value;
  const format = h("div", { class: "card stack", id: "set-format" },
    h("h3", { text: t("bk.set.format") }),
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
  const every = field({ label: t("bk.set.backupEvery"), value: String(pref.backupEveryDays), inputmode: "numeric", autocomplete: "off" });
  const usageLine = h("p", { class: "muted", id: "set-usage", text: "" });
  usage(ctx.store).then((u) => {
    const mb = (u.bytes / 1048576).toFixed(2);
    usageLine.textContent = t("bk.set.usage", { ingredients: u.ingredients, recipes: u.recipes, orders: u.orders, maxOrders: LIMITS.orders, mb, maxMb: "10" });
    if (u.bytes >= SIZE_WARN_BYTES) usageLine.append(` ${t("bk.limit.sizeNear", { mb, max: "10" })}`);
  }).catch(() => {});
  const language = LANG_NAMES[s.lang];
  const data = h("div", { class: "card stack", id: "set-data" },
    h("h3", { text: t("bk.set.data") }),
    h("div", { class: "row" },
      button({ id: "btn-backup", label: t("bk.backup.download"), variant: "primary", exportAction: true, onClick: guard(async () => { if (await backupNow(ctx)) await ctx.refresh(); }) }),
      button({ id: "btn-restore", label: t("settings.restore"), onClick: () => restoreNow(ctx) }),
      button({ id: "btn-csv", label: t("bk.set.csv"), exportAction: true, onClick: () => ctx.exportCsv() })),
    h("div", { class: "row" },
      button({ id: "btn-sample-load", label: t("sample.load"), onClick: guard(async () => { await ctx.sample.load(); }) }),
      button({ id: "btn-sample-remove", label: t("sample.remove"), onClick: guard(async () => { await ctx.sample.remove(); }) })),
    h("p", { class: "muted", id: "set-plain", text: t("bk.common.plainTextFile") }), usageLine,
    h("form", { class: "stack", id: "set-backup-days", novalidate: true, on: { submit: guard(async (e) => {
      e.preventDefault();
      const r = checkBackupDays(every.input.value);
      every.setError(r.ok ? "" : t("bk.err.days", { max: 90 }));
      if (!r.ok) { focusFirstInvalid(e.currentTarget); return; }
      await ctx.prefs.save({ backupEveryDays: r.value });
      saved();
    }) } }, every.element, h("div", { class: "row" }, button({ label: t("common.save"), type: "submit" }))),
    h("div", { class: "row" },
      button({ id: "btn-reset-defaults", label: t("bk.set.resetDefaults", { language }), onClick: async () => {
        const { confirmed } = await confirmDialog({ title: t("bk.set.resetDefaults", { language }), message: t("bk.set.resetDefaultsConfirm", { language }), confirmLabel: t("bk.set.resetDefaults", { language }), cancelLabel: t("common.cancel") });
        if (!confirmed) return;
        try { await ctx.prefs.resetDefaults(s.lang); await ctx.refresh(); } catch (e) { ctx.fail(e); }
      } }),
      button({ id: "btn-delete-all", label: t("settings.deleteAll"), variant: "danger", onClick: () => deleteAllNow(ctx) })),
  );

  container.replaceChildren(
    h("h2", { text: t("settings.title") }),
    pricing, shop, logoCard, printing, format, data,
    h("div", { class: "card stack", id: "set-about" },
      h("p", { id: "settings-privacy", text: t("bk.privacy.text") }),
      h("p", { id: "settings-scope", class: "muted", text: t("bk.scope.text") }),
      h("p", { class: "muted", text: `${t("app.title")} · ${t("settings.version", { version: ctx.config.version })}` })),
    h("div", { class: "card stack", id: "settings-licenses" },
      h("h3", { text: t("settings.licenses") }),
      h("p", { id: "license-copyright", text: t("bk.license.copyright") }),
      h("p", { id: "license-grant", text: t("bk.license.grant") }),
      h("p", { id: "license-resale", text: t("bk.license.resale") }),
      h("p", { id: "license-warranty", text: t("bk.license.warranty") }),
      h("p", { id: "license-product", text: t("bk.license.product") }),
      h("p", { class: "muted", text: t("bk.about.trademarks") })),
  );
}
