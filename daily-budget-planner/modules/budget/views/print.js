// Yazdirma onizlemesi: belge secimi (donem plani / bos sablon), kagit (Letter / A4), beyaz onizleme, "Print / Save PDF".
// Cizim ve teslim yalniz ctx.print -> core/print.js (tek gecit). Onizleme ayni cizimin goruntusudur.
import { h, btn, field } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { renderPlanCanvas } from "../../../core/print.js";
import { buildPlanModel } from "../print/plan.js";
import { periodBills } from "../logic/engine.js";
import { payTimeline } from "../logic/schedule.js";
import { envName, hello } from "./common.js";

let paperChoice = "";

export async function mountPrint(ctx, root, { state, result, today, param }) {
  const { t } = ctx.i18n;
  const kind = param === "blank" || !result ? "blank" : "plan";
  const paper = paperChoice || state.prefs.paper;
  root.append(hello(t("print.title"), t("print.sub")));
  const seg = h("div", { class: "seg", role: "group", "aria-label": t("print.doc") },
    h("a", { class: "btn ghost", href: "#/print/plan", id: "doc-plan", "aria-current": kind === "plan" ? "true" : undefined, "aria-disabled": result ? undefined : "true" }, t("print.planTitle")),
    h("a", { class: "btn ghost", href: "#/print/blank", id: "doc-blank", "aria-current": kind === "blank" ? "true" : undefined }, t("print.blankTitle")));
  const pf = field({ label: t("set.paper"), id: "print-paper", value: paper, options: [{ value: "letter", label: "US Letter" }, { value: "a4", label: "A4" }] });
  pf.input.addEventListener("change", () => { paperChoice = pf.input.value; ctx.refresh(); });
  const go = btn({ label: t("print.go"), cls: "primary", icon: "printer", id: "print-go", onClick: () => ctx.print(kind, pf.input.value) });
  const occ = result ? periodBills(state, payTimeline(state.payPlan, state.transactions, today)).occurrences : [];
  const model = buildPlanModel({ state, result, occurrences: occ, envelopes: state.envelopes, today, i18n: ctx.i18n, blank: kind === "blank", envName: (e) => envName(ctx, e) });
  const canvas = await renderPlanCanvas(model, paper, { logoSrc: ctx.logoSrc("paper") });
  const img = h("img", { id: "print-preview", alt: t("print.previewAlt", { doc: model.title }), width: canvas.width, height: canvas.height });
  img.src = canvas.toDataURL("image/png");
  root.append(h("section", { class: "card glass" }, seg, h("div", { class: "formgrid two" }, pf.el, h("div", { class: "field" }, h("span", { class: "field-hint", text: t("print.phoneHint") }), go))),
    h("div", { class: "card glass preview-wrap" }, img),
    h("p", { class: "note" }, icon("info", { size: 14 }), " ", t("print.whiteNote")));
}
