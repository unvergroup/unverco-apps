// Ana sayfa: son ice aktarilan sonuc (karar, sayilar, ortam kartlari) ya da bos durum (kurulum / ice aktar / ornek).
import { h, button } from "../../../core/ui.js";
import { SAMPLES } from "../logic/sample.js";
import { effectiveVerdict, VERDICT_KEY } from "../logic/verdict.js";
import { counts, envCards, honestyNote, metaList, openImportDialog, verdictBadge } from "./common.js";

export async function mountHome(ctx, root) {
  const { t } = ctx;
  const entry = ctx.history.latest();
  if (!entry) {
    root.replaceChildren(
      h("h1", { text: t("home.title") }),
      h("section", { class: "card empty-hero" },
        h("h2", { text: t("home.empty.title") }),
        h("p", { text: t("home.empty.text") }),
        h("div", { class: "row" },
          button({ id: "home-start", label: t("home.start"), variant: "primary", glyph: "sparkle", onClick: () => ctx.navigate("setup") }),
          button({ id: "home-import", label: t("home.import"), variant: "secondary", glyph: "upload", onClick: () => openImportDialog(ctx) })),
        h("h3", { text: t("home.sample") }),
        h("div", { class: "row" },
          button({ id: "sample-ship", label: t("home.sample.ship"), variant: "secondary", onClick: () => ctx.importSample("ship") }),
          button({ id: "sample-dontship", label: t("home.sample.dontship"), variant: "secondary", onClick: () => ctx.importSample("dontship") }))),
      honestyNote(t));
    return;
  }
  const ev = effectiveVerdict(entry.data);
  const adjusted = ev.adjusted ? h("p", { class: "banner banner-warn", id: "verdict-adjusted", role: "status", text: t(`verdict.adjusted.${ev.reason}`) }) : null;
  root.replaceChildren(
    h("h1", { text: t("home.title") }),
    h("section", { class: "card hero", "aria-labelledby": "latest-h" },
      h("div", { class: "hero-top" },
        h("h2", { id: "latest-h", class: "eyebrow", text: t("home.latest") }),
        entry.source === "sample" ? h("span", { class: "chip", id: "sample-badge", text: t("home.sampleBadge") }) : null),
      verdictBadge(t, ev.verdict, { big: true }),
      h("p", { class: "verdict-explain", text: t(`${VERDICT_KEY[ev.verdict]}.text`) }),
      adjusted,
      counts(t, entry.data.summary),
      metaList(ctx, entry),
      h("div", { class: "row" },
        button({ id: "home-open", label: t("home.openResults"), variant: "primary", glyph: "list", onClick: () => ctx.navigate(`results/${entry.id}`) }),
        button({ id: "home-import", label: t("home.importAnother"), variant: "secondary", glyph: "upload", onClick: () => openImportDialog(ctx) }))),
    h("h2", { text: t("home.envs") }),
    envCards(ctx, entry.data.environments),
    honestyNote(t));
}
