// Kurulum sihirbazi: 5 adim, bir seferde bir adim; maliyet notu ve gereksinimler. Adim yalniz bellekte tutulur.
import { h, button } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { honestyNote, openImportDialog } from "./common.js";

export const STEPS = 5;
let step = 1;

export async function mountSetup(ctx, root) {
  const { t } = ctx;
  const body = h("section", { class: "card wizard", id: "wizard", "aria-live": "polite" });
  const dots = h("ol", { class: "steps", "aria-label": t("setup.title") });

  function paint() {
    dots.replaceChildren(...Array.from({ length: STEPS }, (_, i) => {
      const n = i + 1;
      return h("li", {}, h("button", { type: "button", class: `step-dot${n === step ? " is-current" : ""}${n < step ? " is-done" : ""}`, id: `step-dot-${n}`, "aria-current": n === step ? "step" : null, "aria-label": t("setup.progress", { n, total: STEPS }), on: { click: () => { step = n; paint(); } } }, n < step ? icon("check", { size: 16, sw: 3 }) : String(n)));
    }));
    body.replaceChildren(
      h("p", { class: "eyebrow", id: "step-progress", text: t("setup.progress", { n: step, total: STEPS }) }),
      h("h2", { id: "step-title", tabindex: "-1", text: t(`setup.step${step}.title`) }),
      h("p", { class: "step-text", text: t(`setup.step${step}.text`) }),
      h("div", { class: "row" },
        step > 1 ? button({ id: "step-back", label: t("common.back"), icon: "back", variant: "secondary", onClick: () => { step--; paint(); focusTitle(); } }) : null,
        step < STEPS ? button({ id: "step-next", label: t("common.next"), icon: "next", variant: "primary", onClick: () => { step++; paint(); focusTitle(); } })
          : button({ id: "step-import", label: t("setup.goImport"), variant: "primary", glyph: "upload", onClick: () => openImportDialog(ctx) })));
  }
  const focusTitle = () => document.getElementById("step-title")?.focus({ preventScroll: true });

  root.replaceChildren(
    h("h1", { text: t("setup.title") }),
    h("p", { class: "lead", text: t("setup.intro") }),
    dots, body,
    h("section", { class: "card", "aria-labelledby": "cost-h" }, h("h2", { id: "cost-h", text: t("setup.cost.title") }), h("p", { id: "cost-text", text: t("setup.cost.text") })),
    h("section", { class: "card", "aria-labelledby": "req-h" }, h("h2", { id: "req-h", text: t("setup.req.title") }),
      h("ul", { class: "ticks" }, [1, 2, 3, 4].map((n) => h("li", {}, icon("check", { size: 16, sw: 3 }), h("span", { text: t(`setup.req.${n}`) }))))),
    honestyNote(t));
  paint();
}
