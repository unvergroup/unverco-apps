// Ortak gorunum parcalari: karar rozeti, sayac satiri, ortam kartlari, dürüstlük notu, ice aktarma penceresi. Kullanici verisi YALNIZ textContent ile yazilir (h()).
import { h, button } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { pickTextFile } from "../../../core/files.js";
import { errorKey } from "../../../core/safe.js";
import { VERDICT_CLASS, VERDICT_ICON, VERDICT_KEY, safeRunUrl } from "../logic/verdict.js";
import { MAX_BYTES } from "../logic/validate.js";

export const honestyNote = (t) => h("p", { class: "honesty", id: "honesty-note", text: t("note.honesty") });

/** big: ana sayfa / sonuc basligi icin buyuk rozet. Renk tek basina bilgi tasimaz: simge + metin. */
export function verdictBadge(t, verdict, { big = false } = {}) {
  return h("div", { class: `verdict verdict-${VERDICT_CLASS[verdict]}${big ? " verdict-big" : ""}`, "data-verdict": verdict }, icon(VERDICT_ICON[verdict], { size: big ? 36 : 20 }), h("span", { class: "verdict-text", text: t(VERDICT_KEY[verdict]) }));
}

export function counts(t, summary) {
  const item = (key, n, cls) => h("div", { class: `count count-${cls}` }, h("b", { text: String(n) }), h("span", { text: t(key) }));
  return h("div", { class: "counts", role: "group", "aria-label": t("home.latest") }, item("count.passed", summary.passed, "passed"), item("count.failed", summary.failed, "failed"), item("count.warnings", summary.warnings, "warn"), item("count.skipped", summary.skipped, "skip"));
}

const KIND_ICON = { "desktop-emulation": "monitor", emulator: "smartphone", simulator: "smartphone" };

export function envCards(ctx, envs) {
  const { t } = ctx;
  return h("div", { class: "env-grid" }, envs.map((e) => {
    const url = safeRunUrl(e.run_url);
    return h("article", { class: `card env env-${e.status}`, "data-env": e.id },
      h("div", { class: "env-head" }, icon(KIND_ICON[e.kind], { size: 22 }), h("h3", { text: t(`kind.${e.kind}`) })),
      h("p", { class: "env-label", text: e.label }),
      h("p", { class: `env-status status-${e.status}` }, icon(e.status === "passed" ? "circle-check" : e.status === "failed" ? "circle-alert" : "triangle-alert", { size: 16 }), h("span", { text: t(`env.status.${e.status}`) })),
      h("p", { class: "env-counts", text: t("env.checks", { passed: ctx.i18n.formatNumber(e.passed), failed: ctx.i18n.formatNumber(e.failed) }) }),
      url ? h("a", { class: "link", href: url, target: "_blank", rel: "noopener noreferrer", text: t("env.run") }) : null);
  }));
}

export function metaList(ctx, entry) {
  const { t, i18n } = ctx;
  const d = entry.data;
  const row = (k, v) => (v ? [h("dt", { text: t(k) }), h("dd", { text: v })] : []);
  return h("dl", { class: "meta" }, ...row("home.when", i18n.formatDateTime(d.generated_at)), ...row("home.repo", d.repo), ...row("home.commit", d.commit), ...row("home.kit", d.kit_version), ...row("home.duration", i18n.formatDuration(d.summary.duration_sec)));
}

/** Ice aktarma penceresi: dosya sec ya da JSON yapistir. Hata pencerede kalir (role=alert), uygulama cokmez. */
export function openImportDialog(ctx) {
  const { t } = ctx;
  const old = document.getElementById("import-dialog");
  if (old) old.remove();
  const err = h("div", { class: "import-error", id: "import-error", role: "alert" });
  const area = h("textarea", { id: "import-text", rows: 6, spellcheck: "false", autocomplete: "off", "aria-describedby": "import-error" });
  const dlg = h("dialog", { class: "dialog", id: "import-dialog", "aria-labelledby": "import-title" });
  let busy = false;
  const show = (code, params) => {
    const key = code === "read" ? "import.err.read" : errorKey({ code });
    err.replaceChildren(h("b", { text: t("import.errTitle") }), h("p", { text: t(key, params ?? {}) }));
    err.scrollIntoView?.({ block: "nearest" });
  };
  const run = async (text, name, source) => {
    if (busy) return;
    busy = true;
    try {
      const r = await ctx.importText(text, name, source);
      if (r.ok) dlg.close(); else show(r.code, r.params);
    } finally { busy = false; }
  };
  dlg.append(h("form", { method: "dialog", on: { submit: (e) => e.preventDefault() } },
    h("h2", { id: "import-title", text: t("import.title") }),
    h("p", { class: "muted", text: t("import.hint") }),
    button({ id: "import-file", label: t("import.file"), variant: "primary", glyph: "upload", onClick: async () => {
      let f = null;
      try { f = await pickTextFile(".json,application/json", MAX_BYTES); } catch { show("read"); return; }
      if (!f) return;
      if (f.tooLarge) { show("too_large"); return; }
      await run(f.text, f.name, "file");
    } }),
    h("div", { class: "field" }, h("label", { for: "import-text", text: t("import.pasteLabel") }), area),
    button({ id: "import-paste", label: t("import.pasteBtn"), variant: "secondary", onClick: () => run(area.value, t("import.pasted"), "paste") }),
    err,
    h("div", { class: "dialog-actions" }, h("button", { type: "submit", class: "btn btn-secondary", id: "import-close", text: t("common.close"), on: { click: () => dlg.close() } }))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
