// Ayarlar: dil, tema, verileri disa aktar / sil, hakkinda (surum, lisans, marka bildirimi, YZ notu).
import { h, button } from "../../../core/ui.js";
import { downloadText } from "../../../core/files.js";
import { honestyNote } from "./common.js";

const localDay = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

export async function mountSettings(ctx, root) {
  const { t } = ctx;
  const sel = (id, label, value, options, onChange) => {
    const el = h("select", { id, on: { change: () => onChange(el.value) } }, options.map((o) => h("option", { value: o.value, text: o.label, selected: o.value === value })));
    return h("div", { class: "field" }, h("label", { for: id, text: label }), el);
  };
  root.replaceChildren(
    h("h1", { text: t("settings.title") }),
    h("section", { class: "card stack" },
      sel("set-lang", t("settings.language"), ctx.settings.lang, ctx.langOptions(), (v) => ctx.setSettings({ lang: v })),
      sel("set-theme", t("settings.theme"), ctx.settings.theme, ["dark", "light", "system"].map((x) => ({ value: x, label: t(`theme.${x}`) })), (v) => ctx.setSettings({ theme: v }))),
    h("section", { class: "card stack", "aria-labelledby": "data-h" },
      h("h2", { id: "data-h", text: t("settings.data") }),
      h("p", { id: "privacy-text", text: t("settings.privacy") }),
      h("div", { class: "row" },
        button({ id: "set-export", label: t("settings.export"), variant: "secondary", glyph: "download", onClick: () => {
          try { if (downloadText(`${ctx.config.fileSlug}-data-${localDay()}.json`, JSON.stringify(ctx.history.exportAll(), null, 2))) ctx.notify(t("settings.exported"), "success"); } catch (e) { ctx.fail(e); }
        } }),
        button({ id: "set-delete", label: t("settings.deleteAll"), variant: "danger", glyph: "trash", onClick: async () => {
          if (!(await ctx.confirm({ title: t("settings.deleteConfirm.title"), message: t("settings.deleteConfirm.text"), confirmLabel: t("settings.deleteAll") }))) return;
          try { await ctx.deleteAll(); ctx.notify(t("settings.deleted"), "success"); } catch (e) { ctx.fail(e); }
        } }))),
    h("section", { class: "card stack", "aria-labelledby": "about-h" },
      h("h2", { id: "about-h", text: t("about.title") }),
      h("p", {}, h("b", { text: `ÜNVERCO ${t("app.name")}` }), " · ", h("span", { id: "about-version", text: t("about.version", { version: ctx.config.version }) })),
      h("p", { text: t("about.license") }),
      h("p", { id: "about-trademarks", text: t("about.trademarks") }),
      h("p", { text: t("about.third") }),
      h("p", { id: "about-ai", text: t("about.ai") }),
      h("p", { class: "muted", text: t("about.company") })),
    honestyNote(t));
}
