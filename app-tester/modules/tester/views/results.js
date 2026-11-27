// Sonuclar: hata listesi (P0 -> P1 -> P2), ortam / oncelik suzgeci, her hata icin yeniden uretme adimlari ve tek dokunusla "Copy fix prompt".
import { h, button } from "../../../core/ui.js";
import { requestPrint } from "../../../core/print.js";
import { copyText } from "../logic/clipboard.js";
import { effectiveVerdict, failureEnvironments, filterFailures, sortFailures, VERDICT_KEY } from "../logic/verdict.js";
import { buildPrintReport } from "./print-report.js";
import { counts, honestyNote, metaList, openImportDialog, verdictBadge } from "./common.js";

const filters = { environment: "all", priority: "all" }; // yalniz bellekte; ekran degisince korunur, sonuc degisince sifirlanir
let filterFor = null;

function failureCard(ctx, f) {
  const { t } = ctx;
  const fieldRow = (k, v, mono = false) => (v ? [h("dt", { text: t(k) }), h("dd", { class: mono ? "mono" : null, text: v })] : []);
  const copyBtn = button({ id: `copy-${f.id}`, label: t("failure.copy"), variant: "primary", glyph: "copy", onClick: async () => {
    const ok = await copyText(f.fix_prompt);
    ctx.notify(t(ok ? "failure.copied" : "failure.copyFail"), ok ? "success" : "error");
  } });
  copyBtn.dataset.rapid = "1";
  return h("article", { class: `card failure prio-${f.priority}`, "data-failure": f.id, "data-priority": f.priority },
    h("header", { class: "failure-head" },
      h("span", { class: `prio prio-${f.priority}`, text: t(`priority.${f.priority}`) }),
      h("span", { class: "failure-id", text: f.id })),
    h("h3", { class: "failure-check", text: f.check || f.id }),
    h("p", { class: "failure-msg", text: f.message }),
    h("dl", { class: "meta" },
      ...fieldRow("failure.env", f.environment), ...fieldRow("failure.profile", f.profile),
      ...(f.screenshot ? [h("dt", { text: t("failure.screenshot") }), h("dd", {}, h("code", { class: "path", text: f.screenshot }), h("small", { class: "muted", text: ` ${t("failure.screenshotHint")}` }))] : [])),
    f.repro ? h("div", {}, h("h4", { text: t("failure.repro") }), h("pre", { class: "repro", text: f.repro })) : null,
    h("div", { class: "fix" },
      h("h4", { text: t("failure.fix") }),
      h("div", { class: "row" }, copyBtn),
      h("details", {}, h("summary", { text: t("failure.showPrompt") }), h("pre", { class: "prompt", text: f.fix_prompt }))));
}

export async function mountResults(ctx, root, id) {
  const { t, i18n } = ctx;
  const entry = id ? ctx.history.get(id) : ctx.history.latest();
  if (!entry) {
    root.replaceChildren(h("h1", { text: t("results.title") }), h("section", { class: "card empty-hero" }, h("p", { id: "results-none", text: t("results.none") }), button({ id: "results-import", label: t("results.noneAction"), variant: "primary", glyph: "upload", onClick: () => openImportDialog(ctx) })), honestyNote(t));
    return;
  }
  if (filterFor !== entry.id) { filters.environment = "all"; filters.priority = "all"; filterFor = entry.id; }
  const d = entry.data;
  const ev = effectiveVerdict(d);
  const all = sortFailures(d.failures);
  const envs = failureEnvironments(d);
  if (!envs.includes(filters.environment)) filters.environment = "all";
  const list = h("div", { class: "failure-list", id: "failure-list" });
  const info = h("p", { class: "muted", id: "results-showing", role: "status" });

  function paintList() {
    const shown = filterFailures(all, filters);
    info.textContent = t("results.showing", { shown: i18n.formatNumber(shown.length), total: i18n.formatNumber(all.length) });
    list.replaceChildren(...(shown.length ? shown.map((f) => failureCard(ctx, f)) : [h("p", { class: "muted", id: "results-nomatch", text: t(all.length ? "results.noMatch" : "results.noFailures") })]));
  }
  const sel = (id, label, value, options, onChange) => {
    const el = h("select", { id, on: { change: () => onChange(el.value) } }, options.map((o) => h("option", { value: o.value, text: o.label, selected: o.value === value })));
    return h("div", { class: "field" }, h("label", { for: id, text: label }), el);
  };

  root.replaceChildren(
    h("header", { class: "results-head" },
      h("h1", { text: t("results.title") }),
      button({ id: "results-print", label: t("results.print"), variant: "secondary", glyph: "printer", onClick: () => requestPrint({ build: () => buildPrintReport(ctx, entry), title: `${ctx.config.fileSlug}-report` }) })),
    h("section", { class: "card summary-card" },
      h("div", { class: "summary-top" }, verdictBadge(t, ev.verdict), h("p", { class: "verdict-explain", text: t(`${VERDICT_KEY[ev.verdict]}.text`) })),
      ev.adjusted ? h("p", { class: "banner banner-warn", role: "status", text: t(`verdict.adjusted.${ev.reason}`) }) : null,
      counts(t, d.summary),
      metaList(ctx, entry)),
    h("h2", { id: "failures-h", text: i18n.tn("results.failures", all.length) }),
    all.length ? h("div", { class: "filters", role: "group", "aria-label": t("results.filters") },
      sel("filter-env", t("filter.env"), filters.environment, [{ value: "all", label: t("filter.all") }, ...envs.map((e) => ({ value: e, label: e }))], (v) => { filters.environment = v; paintList(); }),
      sel("filter-priority", t("filter.priority"), filters.priority, [{ value: "all", label: t("filter.all") }, ...["P0", "P1", "P2"].map((p) => ({ value: p, label: t(`priority.${p}`) }))], (v) => { filters.priority = v; paintList(); })) : null,
    all.length ? info : null,
    list,
    d.notes.length ? h("section", { class: "card" }, h("h2", { text: t("results.notes") }), h("ul", {}, d.notes.map((n) => h("li", { text: n })))) : null,
    honestyNote(t));
  paintList();
}
