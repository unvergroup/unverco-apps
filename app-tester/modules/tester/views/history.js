// Gecmis: onceki ice aktarimlar (cihazda, en cok 50); ac, sil, hepsini sil.
import { h, button } from "../../../core/ui.js";
import { effectiveVerdict } from "../logic/verdict.js";
import { honestyNote, verdictBadge } from "./common.js";

export async function mountHistory(ctx, root) {
  const { t, i18n } = ctx;
  const list = ctx.history.list();
  const rows = list.map((e) => {
    const ev = effectiveVerdict(e.data);
    return h("li", { class: "card hist", "data-entry": e.id },
      h("div", { class: "hist-main" },
        verdictBadge(t, ev.verdict),
        h("div", {},
          h("p", { class: "hist-title", text: [e.data.repo, e.data.commit].filter(Boolean).join(" · ") || e.name }),
          h("p", { class: "muted", text: `${t("history.imported", { date: i18n.formatDateTime(e.importedAt) })} · ${i18n.tn("history.failures", e.data.failures.length)}${e.name ? ` · ${e.name}` : ""}` }),
          e.source === "sample" ? h("span", { class: "chip", text: t("history.sample") }) : null)),
      h("div", { class: "row" },
        button({ id: `open-${e.id}`, label: t("history.open"), variant: "secondary", onClick: () => ctx.navigate(`results/${e.id}`) }),
        button({ id: `del-${e.id}`, label: t("history.delete"), variant: "danger", glyph: "trash", onClick: async () => {
          if (!(await ctx.confirm({ title: t("history.confirm.title"), message: t("history.confirm.text"), confirmLabel: t("history.delete") }))) return;
          try { ctx.history.remove(e.id); ctx.notify(t("history.deleted"), "success"); await ctx.refresh(); } catch (err) { ctx.fail(err); }
        } })));
  });
  root.replaceChildren(
    h("h1", { text: t("history.title") }),
    list.length ? h("ul", { class: "hist-list", id: "history-list" }, rows) : h("section", { class: "card empty-hero" }, h("p", { id: "history-empty", text: t("history.empty") })),
    h("p", { class: "muted", text: t("history.limit") }),
    list.length ? button({ id: "history-clear", label: t("history.deleteAll"), variant: "danger", glyph: "trash", onClick: async () => {
      if (!(await ctx.confirm({ title: t("history.confirmAll.title"), message: t("history.confirmAll.text"), confirmLabel: t("history.deleteAll") }))) return;
      try { ctx.history.clear(); ctx.notify(t("history.deleted"), "success"); await ctx.refresh(); } catch (err) { ctx.fail(err); }
    } }) : null,
    honestyNote(t));
}
