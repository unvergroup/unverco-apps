// Ayarlar ekrani (spec 2.6): dukkan, bilet, sartlar, teslim, mesajlar, baski, dil ve bicim, veri, gizlilik / lisans.
// Her bolum kendi formudur: dogrular, hatayi alanin altina yazar, ctx.ct.save ile yazar. Kullanici verisi yalniz textContent.
import { CURRENCIES, LANGS, LANG_NAMES, LOCALES } from "./i18n.js";
import { MAX_CONTACT_LINES, linesFromText, linesToText } from "./business.js";
import { THEMES, TEMPLATE_KEYS, CT_LIMITS, applyLanguage, checkCountryCode, checkDays, checkPrefix, checkReminderDays, checkReviewLink, checkShopPhone, checkTerms } from "./settings.js";
import { backupNow, deleteAllNow, restoreNow, usage, SIZE_WARN_BYTES } from "./data-actions.js";
import { currencyDigits } from "./money.js";
import { guardWrite } from "./safe.js";
import { button, confirmDialog, field, focusFirstInvalid, h, select } from "./ui.js";
import { LIMITS } from "../modules/repairs/logic/schema.js";
import { fillTemplate } from "../modules/repairs/logic/templates.js";

const ERR_KEY = { termsLong: "repairs.err.termsLong", prefix: "repairs.err.prefix", countryCode: "repairs.err.countryCode", reviewLink: "repairs.err.reviewLink", phone: "repairs.err.phone", days: "repairs.err.days", reminderDays: "repairs.err.reminderDays" };

export async function renderSettings(container, ctx) {
  const { t } = ctx.i18n;
  const s = ctx.settings;
  const ct = await ctx.ct.get();
  const biz = await ctx.business.get();
  const guard = guardWrite((e) => ctx.fail(e));
  const change = (patch) => ctx.updateSettings({ ...s, ...patch });
  const errText = (r) => t(ERR_KEY[r.error] ?? "repairs.err.required", { max: r.max, lines: r.lines });
  const saved = () => ctx.notify(t("repairs.x.saved"), "success");

  // Bolum cercevesi: form + kaydet dugmesi. fields: [{ f, check(): {ok,value,error} , key }]
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
        if (r.ok) patch[x.key] = r.value; else bad = true;
      }
      if (bad) { focusFirstInvalid(form); return; }
      if ((await onSave(patch)) !== false) saved();
    }));
    return form;
  };

  // ---- Shop ----
  const name = field({ label: t("business.name"), value: biz.name, maxlength: LIMITS.name, autocomplete: "organization" });
  const lines = field({ label: t("business.contact"), value: linesToText(biz.lines), multiline: true, hint: t("business.contactHint", { max: MAX_CONTACT_LINES }) });
  lines.input.rows = 4;
  const accent = field({ label: t("business.accent"), type: "color", value: biz.accent });
  const shopPhone = field({ label: t("repairs.set.shopPhone"), value: ct.shopPhone, type: "tel", autocomplete: "tel" });
  const shop = section({
    id: "set-shop", title: t("repairs.set.shop"),
    fields: [{ f: name }, { f: lines }, { f: accent }, { f: shopPhone, key: "shopPhone", check: () => checkShopPhone(shopPhone.input.value) }],
    onSave: async (patch) => {
      await ctx.business.save({ name: name.input.value, lines: linesFromText(lines.input.value), accent: accent.input.value });
      await ctx.ct.save(patch);
    },
  });

  // ---- Tickets ----
  const prefix = field({ label: t("repairs.set.prefix"), value: ct.ticketPrefix, maxlength: 6, hint: t("repairs.set.prefixNote"), autocomplete: "off" });
  const tickets = section({ id: "set-tickets", title: t("repairs.set.tickets"), fields: [{ f: prefix, key: "ticketPrefix", check: () => checkPrefix(prefix.input.value) }], onSave: (p) => ctx.ct.save(p) });

  // ---- Terms ----
  const termField = (key, label) => {
    const f = field({ label, value: ct[key], multiline: true, hint: t("repairs.err.termsLong", { max: CT_LIMITS[key][0], lines: CT_LIMITS[key][1] }) });
    f.input.rows = 5;
    return { f, key, check: () => checkTerms(f.input.value, key) };
  };
  const terms = section({
    id: "set-terms", title: t("repairs.set.terms"), intro: [h("p", { class: "muted", text: t("repairs.note.terms") })],
    fields: [termField("termsIntake", t("repairs.set.termsIntake")), termField("termsStorage", t("repairs.set.termsStorage")), termField("termsWarranty", t("repairs.set.termsWarranty"))],
    onSave: (p) => ctx.ct.save(p),
  });

  // ---- Pickup ----
  const warranty = field({ label: t("repairs.set.defaultWarranty"), value: ct.defaultWarrantyDays === null ? "" : String(ct.defaultWarrantyDays), inputmode: "numeric", autocomplete: "off", hint: t("repairs.common.commonValue") });
  const remind = field({ label: t("repairs.set.reminderDays"), value: ct.reminderDays.join(", "), autocomplete: "off", hint: t("repairs.common.commonValue") });
  const pickup = section({
    id: "set-pickup", title: t("repairs.set.pickup"),
    intro: [h("p", { class: "muted", text: t("repairs.note.warranty") }), h("p", { class: "muted", text: t("repairs.note.unclaimed") })],
    fields: [
      { f: warranty, key: "defaultWarrantyDays", check: () => (warranty.input.value.trim() === "" ? { ok: true, value: null } : checkDays(warranty.input.value)) },
      { f: remind, key: "reminderDays", check: () => checkReminderDays(remind.input.value) },
    ],
    onSave: (p) => ctx.ct.save(p),
  });

  // ---- Messages ----
  let order = [...ct.channelOrder];
  const orderBox = h("div", { class: "stack", id: "channel-order" });
  const paintOrder = () => {
    orderBox.replaceChildren(...order.map((c, i) => h("div", { class: "row", "data-rapid": "1" },
      h("span", { class: "grow", text: `${i + 1}. ${t(`repairs.channel.${c}`)}` }),
      button({ label: "↑", ariaLabel: `${t("repairs.x.up")}: ${t(`repairs.channel.${c}`)}`, disabled: i === 0, onClick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; paintOrder(); } }),
      button({ label: "↓", ariaLabel: `${t("repairs.x.down")}: ${t(`repairs.channel.${c}`)}`, disabled: i === order.length - 1, onClick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; paintOrder(); } }))));
  };
  paintOrder();
  const country = field({ label: t("repairs.set.countryCode"), value: ct.countryCode, inputmode: "numeric", autocomplete: "off", maxlength: 3 });
  const review = field({ label: t("repairs.set.reviewLink"), value: ct.reviewLink, type: "url", autocomplete: "off", hint: t("repairs.note.review") });
  const tplFields = TEMPLATE_KEYS.map((k) => {
    const def = t(`repairs.msg.${k}`);
    const f = field({ label: t(`repairs.msg.title.${k}`), value: ct.templates[k] ?? def, multiline: true, maxlength: CT_LIMITS.template });
    f.input.rows = 4;
    const reset = button({ label: t("repairs.set.resetTemplate"), onClick: () => { f.input.value = def; f.setError(""); } });
    f.element.append(h("div", { class: "row" }, reset));
    return { f, k, def };
  });
  const messages = section({
    id: "set-messages", title: t("repairs.set.messages"),
    intro: [h("p", { class: "muted", text: t("repairs.note.messaging") })],
    fields: [{ f: country, key: "countryCode", check: () => checkCountryCode(country.input.value) }, { f: review, key: "reviewLink", check: () => checkReviewLink(review.input.value) }],
    extra: [h("h4", { text: t("repairs.set.channelOrder") }), orderBox, h("h4", { text: t("repairs.set.templates") }), h("p", { class: "muted", text: t("repairs.set.placeholders") }), ...tplFields.map((x) => x.f.element)],
    onSave: async (patch) => {
      const templates = {};
      for (const x of tplFields) {
        const v = x.f.input.value.trim();
        const r = fillTemplate(v, {});
        if (r.unknown.length) { x.f.setError(t("repairs.set.unknownPlaceholder", { p: r.unknown.map((p) => `{${p}}`).join(" ") })); x.f.input.focus(); return false; }
        x.f.setError("");
        templates[x.k] = v === "" || v === x.def ? null : v;
      }
      await ctx.ct.save({ ...patch, templates, channelOrder: order });
      return true;
    },
  });

  // ---- Printing ----
  const paper = select({
    id: "set-paper", label: t("repairs.set.paper"), value: ct.paper,
    options: ["letter", "a4", "thermal80"].map((p) => ({ value: p, label: t(`repairs.set.paper.${p}`) })),
  });
  const passcode = h("input", { type: "checkbox", id: "set-passcode", checked: ct.printPasscodeLine });
  const printing = section({
    id: "set-printing", title: t("repairs.set.printing"),
    fields: [{ element: paper.element, f: paper, key: "paper", check: () => ({ ok: true, value: paper.input.value }), setError() {} }, { element: h("div", { class: "field" }, h("label", { class: "check", for: "set-passcode" }, passcode, t("repairs.set.passcodeLine")), h("p", { class: "field-hint", text: t("repairs.set.passcodeLineNote") })) }],
    onSave: (p) => ctx.ct.save({ ...p, printPasscodeLine: passcode.checked }),
  });

  // ---- Language & format ----
  const langSelect = select({ id: "setting-lang", label: t("settings.language"), value: s.lang, options: LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })), onChange: (v) => ctx.updateSettings(applyLanguage(s, v)) });
  for (const o of langSelect.input.options) o.lang = o.value;
  const format = h("div", { class: "card stack", id: "set-format" },
    h("h3", { text: t("repairs.set.format") }),
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

  // ---- Data ----
  const every = field({ label: t("repairs.set.backupEvery"), value: String(ct.backupEveryDays), inputmode: "numeric", autocomplete: "off" });
  const usageLine = h("p", { class: "muted", id: "set-usage", text: "" });
  const sizeNote = h("p", { class: "muted", id: "set-plain", text: t("repairs.common.plainTextFile") });
  usage(ctx.store).then((u) => {
    const mb = (u.bytes / 1048576).toFixed(2);
    usageLine.textContent = t("repairs.set.usage", { jobs: u.jobs, maxJobs: LIMITS.jobs, mb, maxMb: "10" });
    if (u.bytes >= SIZE_WARN_BYTES) usageLine.append(` ${t("repairs.limit.sizeNear", { mb, max: "10" })}`);
  }).catch(() => {});
  const language = LANG_NAMES[s.lang];
  const data = h("div", { class: "card stack", id: "set-data" },
    h("h3", { text: t("repairs.set.data") }),
    h("div", { class: "row" },
      button({ id: "btn-backup", label: t("repairs.backup.download"), variant: "primary", exportAction: true, onClick: guard(async () => { if (await backupNow(ctx)) await ctx.refresh(); }) }),
      button({ id: "btn-restore", label: t("settings.restore"), onClick: () => restoreNow(ctx) })),
    sizeNote, usageLine,
    h("form", { class: "stack", id: "set-backup-days", novalidate: true, on: { submit: guard(async (e) => {
      e.preventDefault();
      const r = checkDays(every.input.value, { min: 1, max: 90 });
      every.setError(r.ok ? "" : t("repairs.err.days", { max: 90 }));
      if (!r.ok) { focusFirstInvalid(e.currentTarget); return; }
      await ctx.ct.save({ backupEveryDays: r.value });
      saved();
    }) } }, every.element, h("div", { class: "row" }, button({ label: t("common.save"), type: "submit" }))),
    h("div", { class: "row" },
      button({ id: "btn-reset-defaults", label: t("repairs.set.resetDefaults", { language }), onClick: async () => {
        const { confirmed } = await confirmDialog({ title: t("repairs.set.resetDefaults", { language }), message: t("repairs.set.resetDefaultsConfirm", { language }), confirmLabel: t("repairs.set.resetDefaults", { language }), cancelLabel: t("common.cancel") });
        if (!confirmed) return;
        try { await ctx.ct.resetNumeric(s.lang); await ctx.refresh(); } catch (e) { ctx.fail(e); }
      } }),
      button({ id: "btn-delete-all", label: t("settings.deleteAll"), variant: "danger", onClick: () => deleteAllNow(ctx) })),
  );

  container.replaceChildren(
    h("h2", { text: t("settings.title") }),
    shop, tickets, terms, pickup, messages, printing, format, data,
    h("div", { class: "card stack", id: "set-about" },
      h("p", { id: "settings-privacy", text: t("repairs.privacy.text") }),
      h("p", { class: "muted", text: `${t("app.title")} · ${t("settings.version", { version: ctx.config.version })}` })),
    h("div", { class: "card stack", id: "settings-licenses" },
      h("h3", { text: t("settings.licenses") }),
      h("p", { text: t("repairs.license.product") }),
      h("p", { class: "muted", text: t("repairs.about.ai") }),
      h("p", { class: "muted", text: t("repairs.about.trademarks") }),
      h("p", { class: "muted", text: t("settings.langNote") })),
  );
}
