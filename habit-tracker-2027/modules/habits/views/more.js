// E6 More: Printables (My year, My month, Blank year, Blank months; kagit; yil), Reminders (.ics), Your data (yedek, geri yukle, CSV,
// son yedek, 7 gun hatirlatma anahtari, hepsini sil), Settings (tema, hafta baslangici, dil), Help, About (logo, surum, lisans, gizlilik).
import { h } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { defaultYear, yearRange } from "../logic/calc.js";
import { blankMonthsDoc, blankYearDoc } from "../print/docs.js";
import { canvasMeasure } from "../../../core/canvas-doc.js";
import { agoText, topbar } from "./common.js";
import { backupNow, deleteAll, exportCsv, exportIcs, restoreNow } from "./data-actions.js";
import { docLabels } from "./doc-labels.js";
import { printMonth } from "./month.js";
import { printYear } from "./year.js";

const pad = (n) => String(n).padStart(2, "0");

export async function mountMore(ctx, root) {
  const render = async () => {
    const { t, i18n } = ctx;
    const today = ctx.today();
    const { habits, entries, prefs } = await ctx.data();
    const range = yearRange(habits, entries, today);
    if (!ctx.printYear) ctx.printYear = defaultYear(today, prefs.viewYear);
    if (!ctx.printMonth) ctx.printMonth = +today.slice(5, 7);
    const focusId = document.activeElement?.id;

    const card = (id, ic, title, ...kids) => h("section", { class: "more-card glass", id, "aria-labelledby": `${id}-h` }, h("h2", { id: `${id}-h` }, icon(ic, { size: 20, cls: "card-ico" }), h("span", { text: title })), ...kids);
    const action = (id, ic, label, fn, cls = "") => h("button", { type: "button", class: `btn ${cls}`, id, on: { click: fn } }, icon(ic, { size: 20 }), h("span", { text: label }));
    const radios = (name, opts, cur, onPick, label) => h("div", { class: `seg${opts.length === 3 ? " seg--fill" : ""}`, role: "radiogroup", "aria-label": label }, opts.map(([v, text]) =>
      h("label", { class: "seg-opt" }, h("input", { type: "radio", name, id: `${name}-${v}`, value: String(v), checked: String(cur) === String(v), on: { change: () => onPick(v) } }), h("span", { text }))));
    const selectBox = (id, opts, cur, onPick, label) => {
      const s = h("select", { id, class: "select-native", "aria-label": label, on: { change: () => onPick(s.value) } }, opts.map(([v, text]) => h("option", { value: String(v), text })));
      s.value = String(cur);
      return h("label", { class: "select" }, s, icon("down", { size: 16 }));
    };
    const years = []; for (let y = range.min; y <= range.max; y++) years.push([y, String(y)]);
    const L = () => docLabels(ctx, ctx.printYear);

    const printables = card("more-print", "printer", t("print.h"),
      h("div", { class: "opt-row" },
        h("span", { class: "opt-label", text: t("print.year") }), selectBox("pr-year", years, ctx.printYear, (v) => { ctx.printYear = +v; render(); }, t("print.year")),
        h("span", { class: "opt-label", text: t("print.month") }), selectBox("pr-month", i18n.monthsLong.map((m, i) => [i + 1, m]), ctx.printMonth, (v) => { ctx.printMonth = +v; }, t("print.month"))),
      h("div", { class: "opt-row" }, h("span", { class: "opt-label", text: t("print.paper") }),
        radios("pr-paper", [["letter", t("print.letter")], ["a4", t("print.a4")]], prefs.paper, async (v) => { await ctx.repo.savePrefs({ paper: v }); }, t("print.paper"))),
      h("div", { class: "btn-grid" },
        action("pr-my-year", "grid", t("print.myYear"), () => printYear(ctx, ctx.printYear, null)),
        action("pr-my-month", "cal", t("print.myMonth"), () => printMonth(ctx, `${ctx.printYear}-${pad(ctx.printMonth)}`)),
        action("pr-blank-year", "file", t("print.blankYear", { year: ctx.printYear }), () => ctx.print({ filename: `blank-year-${ctx.printYear}`, title: String(ctx.printYear), build: (paper, logo) => blankYearDoc(ctx.printYear, { ...L(), logo }, canvasMeasure(), paper) })),
        action("pr-blank-months", "file", t("print.blankMonths", { year: ctx.printYear }), () => ctx.print({ filename: `blank-months-${ctx.printYear}`, title: String(ctx.printYear), build: (paper, logo) => blankMonthsDoc(ctx.printYear, { ...L(), logo }, canvasMeasure(), paper) }))),
      h("p", { class: "hint", text: t("print.hint") }));

    const reminders = card("more-rem", "bell", t("rem.h"),
      h("p", { class: "muted", id: "rem-text", text: t("rem.text") }),
      action("rem-ics", "download", t("rem.btn"), () => exportIcs(ctx)),
      h("p", { class: "hint", text: t("rem.how") }),
      h("p", { class: "hint", id: "rem-daily", text: t("rem.daily") }));

    const sw = h("input", { type: "checkbox", role: "switch", id: "data-remind", class: "switch", checked: prefs.backupReminder, on: { change: async (e) => { await ctx.repo.savePrefs({ backupReminder: e.target.checked }); } } });
    const data = card("more-data", "shield", t("data.h"),
      h("p", { class: "muted", id: "data-last", text: prefs.lastBackupAt ? t("data.last", { when: `${i18n.formatDate(new Date(prefs.lastBackupAt))} (${agoText(i18n, prefs.lastBackupAt, today)})` }) : t("data.never") }),
      h("div", { class: "btn-grid" },
        action("data-backup", "download", t("data.backup"), async () => { if (await backupNow(ctx)) await render(); }, "btn--gold"),
        action("data-restore", "upload", t("data.restore"), () => restoreNow(ctx)),
        action("data-csv", "file", t("data.csv"), () => exportCsv(ctx))),
      h("label", { class: "switch-row", for: "data-remind" }, h("span", { text: t("data.remind") }), sw),
      h("p", { class: "hint", text: t("data.hint") }),
      action("data-delete", "trash", t("data.delete"), () => deleteAll(ctx), "btn--danger"));

    const settings = card("more-set", "palette", t("set.h"),
      h("div", { class: "opt-row" }, h("span", { class: "opt-label", text: t("set.theme") }),
        radios("set-theme", [["system", t("set.system")], ["light", t("set.light")], ["dark", t("set.dark")]], ctx.settings.theme, (v) => ctx.setSettings({ theme: v }), t("set.theme"))),
      h("div", { class: "opt-row" }, h("span", { class: "opt-label", text: t("set.weekStart") }),
        radios("set-week", [[1, i18n.weekdayLong[1]], [0, i18n.weekdayLong[0]]], prefs.weekStart, async (v) => { await ctx.repo.savePrefs({ weekStart: +v }); await render(); }, t("set.weekStart"))),
      h("div", { class: "opt-row" }, h("span", { class: "opt-label", text: t("set.language") }),
        selectBox("set-lang", ctx.langOptions().map((o) => [o.value, o.label]), ctx.settings.lang, (v) => ctx.setSettings({ lang: v }), t("set.language"))));

    const help = card("more-help", "help", t("help.h"),
      ...["start", "streak", "print", "move", "ios"].map((k) => h("details", { class: "help-item", id: `help-${k}` }, h("summary", { text: t(`help.${k}`) }), h("p", { text: t(`help.${k}Text`) }))));

    const about = card("more-about", "info", t("about.h"),
      h("div", { class: "about-brand" }, ctx.logo("about-logo"), h("div", {}, h("b", { text: t("app.name") }), h("span", { class: "muted", id: "about-version", text: t("about.version", { v: ctx.config.version }) }))),
      h("p", { id: "about-privacy", text: t("about.privacy") }),
      h("p", { class: "muted", text: t("about.license") }),
      h("p", { class: "muted", text: t("about.icons") }));

    root.replaceChildren(topbar(t("more.eyebrow"), t("more.title")), h("div", { class: "more-grid" }, printables, data, reminders, settings, help, about));
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  };
  await render();
  ctx.onExternalChange(render);
  return null;
}
