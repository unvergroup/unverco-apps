// Tek sayfalik yazdirma raporu (DOM). Yalniz #print-root icine konur; ekranda gorunmez. Kisaltma: en cok 12 hata, metinler 140 karakter.
import { h } from "../../../core/ui.js";
import { effectiveVerdict, sortFailures, VERDICT_KEY } from "../logic/verdict.js";

export const PRINT_MAX_FAILURES = 12;
const clip = (s, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildPrintReport(ctx, entry) {
  const { t, i18n } = ctx;
  const d = entry.data;
  const ev = effectiveVerdict(d);
  const s = d.summary;
  const failures = sortFailures(d.failures);
  const shown = failures.slice(0, PRINT_MAX_FAILURES);
  const meta = [i18n.formatDateTime(d.generated_at), d.repo, d.commit && `${t("home.commit")} ${d.commit}`, d.kit_version && `${t("home.kit")} ${d.kit_version}`].filter(Boolean).join(" · ");
  return h("section", { class: "p-report" },
    h("h1", { text: `ÜNVERCO ${t("app.name")} · ${t("print.title")}` }),
    h("div", { class: "p-verdict", text: t(VERDICT_KEY[ev.verdict]) }),
    h("p", { class: "p-meta", text: meta }),
    h("p", { class: "p-counts", text: `${t("count.passed")}: ${s.passed} · ${t("count.failed")}: ${s.failed} · ${t("count.warnings")}: ${s.warnings} · ${t("count.skipped")}: ${s.skipped}` }),
    h("h2", { text: t("home.envs") }),
    h("table", {}, h("tbody", {}, d.environments.map((e) => h("tr", {}, h("td", { text: t(`kind.${e.kind}`) }), h("td", { text: clip(e.label, 70) }), h("td", { text: t(`env.status.${e.status}`) }), h("td", { text: t("env.checks", { passed: e.passed, failed: e.failed }) }))))),
    shown.length ? h("h2", { text: i18n.tn("results.failures", failures.length) }) : null,
    shown.length ? h("table", {}, h("tbody", {}, shown.map((f) => h("tr", {}, h("td", { text: f.priority }), h("td", { text: f.environment }), h("td", { text: clip(f.check, 60) }), h("td", { text: clip(f.message) }))))) : null,
    failures.length > shown.length ? h("p", { class: "p-note", text: t("print.more", { n: failures.length - shown.length }) }) : null,
    h("p", { class: "p-note", text: t("note.honesty") }));
}
