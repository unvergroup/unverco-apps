// Settings: maas takvimi, gorunum, dil, para birimi ve bicim (yalniz gorunum), yazdirma, veriler (yedek / geri yukleme / CSV /
// ornek veri / hepsini sil), gizlilik, uyari cumlesi, hakkinda (orijinal ÜNVERCO logosu), lisans.
import { h, btn, field } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { CURRENCIES, LANGS, LANG_DEFAULTS, LANG_NAMES, LOCALES } from "../../../core/i18n.js";
import { isIsoDate } from "../../../core/dates.js";
import { backupFileName, exportBackupText, parseBackup } from "../../../core/backup.js";
import { downloadText, pickTextFile } from "../../../core/files.js";
import { FREQUENCIES } from "../logic/schema.js";
import { restoreFromText } from "../logic/data.js";
import { SAMPLE_KINDS } from "../logic/sample.js";
import { ensureSeed, hasSample, loadSample, removeSample, savePlan, savePrefs } from "../logic/actions.js";
import { disclaimerNote, hello, plainMoney, readMoney } from "./common.js";

export async function backupNow(ctx) {
  try {
    const text = await exportBackupText(ctx.store, { appId: ctx.config.appId });
    if (!downloadText(backupFileName(ctx.config.fileSlug, new Date()), text)) return false;
    await savePrefs(ctx.store, { lastBackupAt: new Date().toISOString() });
    ctx.notify(ctx.i18n.t("backup.done"));
    return true;
  } catch (e) { ctx.fail(e); return false; }
}

export async function mountSettings(ctx, root, { state }) {
  const { t } = ctx.i18n;
  const p = state.prefs;
  root.append(hello(t("set.title"), t("set.sub")));
  const grid = h("div", { class: "settings-grid" });
  root.append(grid);
  const card = (id, title, ...kids) => h("section", { class: "card glass", id, "aria-labelledby": `${id}-h` }, h("h2", { id: `${id}-h`, text: title }), ...kids);

  // ---- Maas takvimi ----
  const plan = state.payPlan;
  if (plan && plan.setupDone) {
    const freq = field({ label: t("set.freq"), id: "set-freq", value: plan.frequency, options: FREQUENCIES.map((f) => ({ value: f, label: t(`freq.${f}`) })) });
    const anchor = field({ label: t("setup.anchor"), id: "set-anchor", type: "date", value: plan.anchorDate || "" });
    const s1 = field({ label: t("setup.semi1"), id: "set-semi1", type: "number", value: String(plan.semiDays?.[0] ?? 1), attrs: { min: 1, max: 31 } });
    const s2 = field({ label: t("setup.semi2"), id: "set-semi2", type: "number", value: String(plan.semiDays?.[1] ?? 15), attrs: { min: 1, max: 31 } });
    const mday = field({ label: t("setup.monthDay"), id: "set-monthday", type: "number", value: String(plan.monthDay ?? 1), attrs: { min: 1, max: 31 } });
    const amt = field({ label: t("setup.amount"), id: "set-amount", value: plainMoney(plan.amountMinor), attrs: { inputmode: "decimal" } });
    const over = field({ label: t("set.override"), id: "set-override", type: "date", value: plan.nextOverride || "", hint: t("set.overrideHint") });
    const sync = () => { const f = freq.input.value; anchor.el.hidden = !(f === "weekly" || f === "biweekly"); s1.el.hidden = s2.el.hidden = f !== "semimonthly"; mday.el.hidden = f !== "monthly"; };
    freq.input.addEventListener("change", sync);
    sync();
    grid.append(card("set-pay", t("set.pay"), freq.el, h("div", { class: "formgrid two" }, anchor.el, s1.el, s2.el, mday.el, amt.el, over.el),
      h("div", { class: "btnrow" }, btn({ label: t("common.save"), cls: "primary", id: "set-pay-save", onClick: async () => {
        const v = readMoney(amt.input.value);
        if (!(Number.isInteger(v) && v > 0)) { amt.setError(t("setup.err.amount")); return; }
        amt.setError("");
        const f = freq.input.value;
        if ((f === "weekly" || f === "biweekly") && !isIsoDate(anchor.input.value)) { anchor.setError(t("setup.err.date")); return; }
        if (f === "irregular" && !isIsoDate(over.input.value)) { over.setError(t("setup.err.next")); return; }
        try {
          await ctx.change(() => savePlan(ctx.store, { ...plan, frequency: f, anchorDate: anchor.input.value, semiDays: [+s1.input.value || 1, +s2.input.value || 15], monthDay: +mday.input.value || 1, amountMinor: v, nextOverride: isIsoDate(over.input.value) ? over.input.value : "" }), t("set.saved"));
          ctx.refresh();
        } catch (e) { ctx.fail(e); }
      } }), btn({ label: t("set.clearOverride"), id: "set-override-clear", onClick: () => { over.input.value = ""; } }))));
  }

  // ---- Gorunum + dil ----
  const seg = h("div", { class: "seg", role: "group", "aria-label": t("set.theme") }, ["dark", "light", "system"].map((v) =>
    h("button", { type: "button", id: `theme-${v}`, "aria-pressed": String(p.theme === v), on: { click: () => ctx.setPrefs({ theme: v }) } }, icon(v === "dark" ? "moon" : v === "light" ? "sun" : "eye"), t(`set.theme.${v}`))));
  const lang = field({ label: t("set.lang"), id: "set-lang", value: p.lang, options: LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })) });
  lang.input.addEventListener("change", () => ctx.setPrefs({ lang: lang.input.value, locale: LANG_DEFAULTS[lang.input.value].locale })); // tarih/sayi bicimi dile gore; para birimi DEGISMEZ
  grid.append(card("set-look", t("set.appearance"), h("p", { text: t("set.theme") }), seg, lang.el));

  // ---- Para birimi ve bicim ----
  const cur = field({ label: t("set.currency"), id: "set-currency", value: p.currency, options: CURRENCIES.map((c) => ({ value: c, label: c })), hint: t("set.currencyHint") });
  const loc = field({ label: t("set.locale"), id: "set-locale", value: p.locale, options: LOCALES.map((l) => ({ value: l.id, label: l.label })) });
  cur.input.addEventListener("change", () => ctx.setPrefs({ currency: cur.input.value }));
  loc.input.addEventListener("change", () => ctx.setPrefs({ locale: loc.input.value }));
  grid.append(card("set-money", t("set.money"), cur.el, loc.el));

  // ---- Yazdirma ----
  const paper = field({ label: t("set.paper"), id: "set-paper", value: p.paper, options: [{ value: "letter", label: "US Letter" }, { value: "a4", label: "A4" }] });
  paper.input.addEventListener("change", () => ctx.setPrefs({ paper: paper.input.value }));
  grid.append(card("set-print", t("set.printing"), paper.el, h("div", { class: "btnrow" },
    h("a", { class: "btn ghost", href: "#/print/plan", id: "set-print-plan" }, icon("printer"), t("print.planTitle")),
    h("a", { class: "btn ghost", href: "#/print/blank", id: "set-print-blank" }, icon("file"), t("print.blankTitle")))));

  // ---- Veriler ----
  const every = field({ label: t("set.remind"), id: "set-remind", value: String(p.backupEveryDays), options: [0, 3, 7, 14, 30].map((n) => ({ value: String(n), label: n ? t("set.remindDays", { n }) : t("set.remindOff") })) });
  every.input.addEventListener("change", () => ctx.setPrefs({ backupEveryDays: Number(every.input.value) }));
  const kind = field({ label: t("set.sampleKind"), id: "set-sample-kind", value: "biweekly", options: SAMPLE_KINDS.map((k) => ({ value: k, label: t(`freq.${k}`) })) });
  grid.append(card("set-data", t("set.data"), h("p", { text: t("set.dataHint") }),
    h("div", { class: "btnrow" },
      btn({ label: t("set.backup"), cls: "primary", icon: "download", id: "set-backup", onClick: async () => { if (await backupNow(ctx)) ctx.refresh(); } }),
      btn({ label: t("set.restore"), icon: "upload", id: "set-restore", onClick: () => restore(ctx) }),
      h("a", { class: "btn ghost", href: "#/activity", id: "set-export" }, icon("file"), t("act.export"))),
    every.el, kind.el,
    h("div", { class: "btnrow" },
      btn({ label: t("set.loadSample"), icon: "grid", id: "set-sample", onClick: async () => { try { await ctx.change(() => loadSample(ctx.store, kind.input.value, ctx.today(), t), t("set.sampleLoaded")); ctx.navigate("today"); } catch (e) { ctx.fail(e); } } }),
      hasSample(state) ? btn({ label: t("set.removeSample"), icon: "trash", id: "set-sample-remove", onClick: async () => { try { await ctx.change(() => removeSample(ctx.store), t("set.sampleRemoved")); ctx.refresh(); } catch (e) { ctx.fail(e); } } }) : null,
      btn({ label: t("set.deleteAll"), cls: "danger", icon: "trash", id: "set-delete-all", onClick: async () => {
        if (!(await ctx.confirm({ title: t("set.deleteAllTitle"), message: t("set.deleteAllMsg"), confirmLabel: t("set.deleteAll") }))) return;
        try { await ctx.change(async () => { await ctx.store.clearAll(); await ensureSeed(ctx.store, { lang: p.lang, locale: p.locale, currency: p.currency, theme: p.theme }); }, t("done.deletedAll")); ctx.navigate("setup"); } catch (e) { ctx.fail(e); }
      } }))));

  // ---- Gizlilik, uyari, hakkinda ----
  grid.append(card("set-privacy", t("set.privacy"), h("p", { text: t("set.privacyText") }), h("p", { text: t("disclaimer") })));
  grid.append(card("set-about", t("set.about"), h("div", { class: "about" },
    h("img", { src: ctx.logoSrc(), alt: "ÜNVERCO", id: "about-logo", class: "logo-lg" }),
    h("p", { text: `${t("app.name")} · ${t("set.version", { v: ctx.config.version })}` }),
    h("p", { text: t("set.license") }), h("p", { text: t("set.icons") }))));
  root.append(disclaimerNote(ctx));
}

async function restore(ctx) {
  const { t } = ctx.i18n;
  const file = await pickTextFile(".json,application/json", 10 * 1024 * 1024);
  if (!file) return;
  if (file.tooLarge) { ctx.notify(t("err.too_large"), "error"); return; }
  try {
    parseBackup(file.text, { appId: ctx.config.appId, schemaVersion: ctx.store.schemaVersion }); // once dogrula, sonra sor
  } catch (e) { ctx.fail(e); return; }
  if (!(await ctx.confirm({ title: t("set.restoreTitle"), message: t("set.restoreMsg"), confirmLabel: t("set.restore") }))) return;
  try { await ctx.change(() => restoreFromText(ctx.store, file.text, ctx.config.appId), t("set.restored")); ctx.navigate("today"); } catch (e) { ctx.fail(e); }
}
