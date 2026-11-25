// Ayarlar ekrani (Income & Expense Tracker): isletmeler, kategoriler, kilometre, yazdirma, dil ve bicim, veri, gizlilik / lisans.
// Kullanici verisi yalniz textContent. ctx: { i18n, settings, config, store, ledger, business, notify, fail, refresh, updateSettings }
import { CURRENCIES, LANGS, LANG_NAMES, LOCALES } from "./i18n.js";
import { THEMES, applyLanguage, checkBackupDays, PAPERS, UNITS } from "./settings.js";
import { backupNow, deleteAllNow, restoreNow, usage, SIZE_WARN_BYTES } from "./data-actions.js";
import { currencyDigits } from "./money.js";
import { guardWrite } from "./safe.js";
import { button, confirmDialog, field, focusFirstInvalid, h, select } from "./ui.js";
import { buildBusinessCard, buildCategoryCard } from "../modules/ledger/views/manage.js";
import { parseRate, rateText } from "../modules/ledger/logic/mileage.js";
import { RECEIPTS_BUDGET_CHARS, RECORD_LIMITS } from "../modules/ledger/logic/schema.js";

export async function renderSettings(container, ctx) {
  const { t, formatNumber } = ctx.i18n;
  const s = ctx.settings;
  const led = await ctx.ledger.get();
  const guard = guardWrite((e) => ctx.fail(e));
  const change = (patch) => ctx.updateSettings({ ...s, ...patch });
  const saved = () => ctx.notify(t("msg.saved"), "success");

  const businesses = await buildBusinessCard(ctx);
  const categories = await buildCategoryCard(ctx);

  // ---- Kilometre ----
  const rate = field({ label: t("trip.rateLabel", { unit: t(`unit.${led.distanceUnit}`), currency: s.currency }), value: led.rateMilli === null ? "" : rateText(led.rateMilli), inputmode: "decimal", autocomplete: "off", hint: t("trip.rateHint") });
  rate.input.id = "set-rate"; rate.element.querySelector("label").setAttribute("for", "set-rate");
  const unit = select({ id: "set-unit", label: t("set.unit"), value: led.distanceUnit, options: UNITS.map((u) => ({ value: u, label: t(`unit.long.${u}`) })) });
  const mileage = h("form", { class: "card stack", id: "set-mileage", novalidate: true },
    h("h3", { text: t("set.mileage") }), unit.element, rate.element, h("p", { class: "muted", text: t("trip.rateNote") }),
    h("div", { class: "row" }, button({ label: t("common.save"), variant: "primary", type: "submit" })));
  mileage.addEventListener("submit", guard(async () => {
    const r = parseRate(rate.input.value);
    rate.setError(Number.isNaN(r) ? t("trip.rateInvalid") : "");
    if (Number.isNaN(r)) { focusFirstInvalid(mileage); return; }
    await ctx.ledger.save({ rateMilli: r, distanceUnit: unit.input.value });
    saved();
    await ctx.refresh();
  }));

  // ---- Yazdirma ----
  const paper = select({ id: "set-paper", label: t("set.paper"), value: led.paper, options: PAPERS.map((p) => ({ value: p, label: t(`set.paper.${p}`) })) });
  const markBox = h("input", { type: "checkbox", id: "set-brand-mark", checked: led.brandMark === true });
  const printing = h("form", { class: "card stack", id: "set-printing", novalidate: true },
    h("h3", { text: t("set.printing") }), paper.element,
    h("label", { class: "check", for: markBox.id }, markBox, h("span", { text: t("set.brandMark") })),
    h("p", { class: "field-hint", text: t("set.brandMarkHint") }),
    h("div", { class: "row" }, button({ label: t("common.save"), variant: "primary", type: "submit" })));
  printing.addEventListener("submit", guard(async () => { await ctx.ledger.save({ paper: paper.input.value, brandMark: markBox.checked }); saved(); }));

  // ---- Dil ve bicim ----
  const langSelect = select({ id: "setting-lang", label: t("settings.language"), value: s.lang, options: LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })), onChange: (v) => ctx.updateSettings(applyLanguage(s, v)) });
  for (const o of langSelect.input.options) o.lang = o.value;
  const format = h("div", { class: "card stack", id: "set-format" },
    h("h3", { text: t("set.format") }),
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
  const every = field({ label: t("set.backupEvery"), value: String(led.backupEveryDays), inputmode: "numeric", autocomplete: "off" });
  const usageLine = h("p", { class: "muted", id: "set-usage", text: "" });
  usage(ctx.store).then((u) => {
    const mb = (u.bytes / 1048576).toFixed(2);
    usageLine.textContent = t("set.usage", { entries: formatNumber(u.entries), max: formatNumber(RECORD_LIMITS.entries), trips: formatNumber(u.trips), receipts: formatNumber(u.receipts),
      receiptMb: (u.receiptChars / 1048576).toFixed(1), receiptMax: (RECEIPTS_BUDGET_CHARS / 1048576).toFixed(0), mb, maxMb: "10" });
    if (u.bytes >= SIZE_WARN_BYTES) usageLine.append(` ${t("set.sizeNear", { mb, max: "10" })}`);
  }).catch(() => {});
  const data = h("div", { class: "card stack", id: "set-data" },
    h("h3", { text: t("set.data") }),
    h("div", { class: "row" },
      button({ id: "btn-backup", label: t("backup.download"), variant: "primary", exportAction: true, onClick: guard(async () => { if (await backupNow(ctx)) await ctx.refresh(); }) }),
      button({ id: "btn-restore", label: t("settings.restore"), onClick: () => restoreNow(ctx) })),
    h("p", { class: "muted", id: "set-plain", text: t("set.plainTextFile") }), usageLine,
    h("form", { class: "stack", id: "set-backup-days", novalidate: true, on: { submit: guard(async (e) => {
      e.preventDefault();
      const r = checkBackupDays(every.input.value);
      every.setError(r.ok ? "" : t("set.errDays", { max: 90 }));
      if (!r.ok) { focusFirstInvalid(e.currentTarget); return; }
      await ctx.ledger.save({ backupEveryDays: r.value });
      saved();
    }) } }, every.element, h("div", { class: "row" }, button({ label: t("common.save"), type: "submit" }))),
    h("div", { class: "row" }, button({ id: "btn-delete-all", label: t("settings.deleteAll"), variant: "danger", onClick: () => deleteAllNow(ctx) })),
  );

  container.replaceChildren(
    h("h2", { text: t("settings.title") }),
    businesses, categories, mileage, printing, format, data,
    h("div", { class: "card stack", id: "set-about" },
      h("p", { id: "settings-privacy", text: t("settings.privacy") }),
      h("p", { id: "settings-disclaimer", text: t("disclaimer.tax") }),
      h("p", { class: "muted", text: `${t("app.title")} ${t("app.subtitle")} · ${t("settings.version", { version: ctx.config.version })}` })),
    h("div", { class: "card stack", id: "settings-licenses" },
      h("h3", { text: t("settings.licenses") }),
      h("p", { id: "license-copyright", text: t("license.copyright") }),
      h("p", { id: "license-grant", text: t("license.grant") }),
      h("p", { id: "license-resale", text: t("license.resale") }),
      h("p", { id: "license-warranty", text: t("license.warranty") }),
      h("p", { class: "muted", text: t("about.trademarks") })),
  );
}
