// Ayarlar ekrani: yerel ayar, tema (para birimi secici bu urunde yok: urunde para tutari gosterilmez), yedek, geri yukle, hepsini sil, surum.
import { LOCALES } from "./i18n.js";
import { THEMES } from "./settings.js";
import { backupNow, deleteAllNow, restoreNow } from "./data-actions.js";
import { button, h, select } from "./ui.js";
import { FIXED_SCREENS, renderFixed } from "../modules/guests/view-about.js";

export function renderSettings(container, ctx) {
  const { t } = ctx.i18n;
  const s = ctx.settings;
  const change = (patch) => ctx.updateSettings({ ...s, ...patch });

  container.replaceChildren(
    h("h2", { text: t("settings.title") }),
    h(
      "div",
      { class: "card stack" },
      select({
        id: "setting-locale",
        label: t("settings.locale"),
        value: s.locale,
        options: LOCALES.map((l) => ({ value: l.id, label: l.label })),
        onChange: (v) => change({ locale: v }),
      }).element,
      select({
        id: "setting-theme",
        label: t("settings.theme"),
        value: s.theme,
        options: THEMES.map((x) => ({ value: x, label: t(`settings.theme.${x}`) })),
        onChange: (v) => change({ theme: v }),
      }).element
    ),
    h(
      "div",
      { class: "card stack" },
      h("h3", { text: t("settings.data") }),
      h(
        "div",
        { class: "row" },
        button({ label: t("settings.backup"), onClick: () => backupNow(ctx) }),
        button({ label: t("settings.restore"), onClick: () => restoreNow(ctx) }),
        button({ label: t("settings.deleteAll"), variant: "danger", onClick: () => deleteAllNow(ctx) })
      )
    ),
    h(
      "div",
      { class: "card stack" },
      h("h3", { text: t("guests.fixed.heading") }),
      h(
        "div",
        { class: "row" },
        FIXED_SCREENS.map((which) =>
          button({ label: t(`guests.fixed.${which}`), onClick: () => renderFixed(container, ctx, which, () => renderSettings(container, ctx)) })
        )
      )
    ),
    h(
      "div",
      { class: "card stack" },
      h("p", { text: t("settings.privacy") }),
      h("p", {
        class: "muted",
        text: `${ctx.config.appName} · ${t("settings.version", { version: ctx.config.version })} · ${t(
          ctx.edition.isDemo ? "settings.edition.demo" : "settings.edition.full"
        )}`,
      })
    )
  );
}
