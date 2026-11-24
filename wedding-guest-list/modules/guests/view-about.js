// Fixed screens under Settings (U5, spec 9): About, Privacy, Licenses. Text from messages.js guests.fixed.*; the Lora copyright line and
// the OFL text from licenses-text.js. No links, no network, nothing is collected. Opened from core/settings-screen.js.
import { button, h } from "../../core/ui.js";
import { OFL_TEXT } from "./licenses-text.js";

export const FIXED_SCREENS = Object.freeze(["about", "privacy", "licenses"]);
export const BUILD_DATE = "2026-11-25"; // the day this version was built (shown next to the version number)

const isFile = () => globalThis.location && globalThis.location.protocol === "file:";

// container: the app panel; which: "about" | "privacy" | "licenses"; back(): returns to Settings.
export function renderFixed(container, ctx, which, back) {
  const { t } = ctx.i18n;
  const title = h("h2", { tabindex: "-1", text: t(`guests.fixed.${which}`) });
  const para = (key, params) => h("p", { text: t(key, params) });
  const list = (keys) => h("ul", {}, keys.map((k) => h("li", { text: t(k) })));
  let body;
  if (which === "privacy") {
    // file: -> storage-sharing warning (the same sentence goes into the start PDF); hosted -> server-log sentence. Never both.
    body = [para("guests.fixed.privacy.p1"), para(isFile() ? "guests.fixed.privacy.file" : "guests.fixed.privacy.hosted")];
  } else if (which === "about") {
    body = [
      para("guests.fixed.about.p1"),
      para("guests.fixed.about.p2"),
      h("p", { class: "muted", text: `${ctx.config.appName} · ${t("guests.fixed.about.version", { version: ctx.config.version, date: ctx.i18n.formatDate(BUILD_DATE) })}` }),
    ];
  } else {
    body = [
      h("h3", { text: t("guests.fixed.licenses.product") }),
      list(["guests.fixed.licenses.l1", "guests.fixed.licenses.l2", "guests.fixed.licenses.l3", "guests.fixed.licenses.l4"]),
      h("h3", { text: t("guests.fixed.licenses.font") }),
      para("guests.fixed.licenses.fontNote"),
      para("guests.fixed.licenses.fontScripts"),
      h("pre", { class: "license-text", tabindex: "0", "aria-label": t("guests.fixed.licenses.font"), text: OFL_TEXT }),
    ];
  }
  container.replaceChildren(
    h("div", { class: "row" }, button({ label: t("guests.fixed.back"), variant: "ghost", onClick: back })),
    title,
    h("div", { class: "card stack fixed-screen" }, ...body.filter(Boolean)));
  title.focus();
}
