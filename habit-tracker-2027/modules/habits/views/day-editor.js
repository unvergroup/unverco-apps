// E3a Day editor: herhangi bir gecmis gunun tum etkin aliskanliklari (planli olmayan "Not planned" etiketiyle); onay / sayac (+ / - / sayi) /
// "Rest day" anahtari; Undo; Close. Gelecek tarih acilmaz. Her degisiklik o TARIHE yazilir (bugune degil).
import { h, nextId } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { dayStatus, habitDays, isPeriodic, isPlannedDay, targetOf } from "../logic/calc.js";
import { tile } from "./common.js";

export function openDayEditor(ctx, date, onChange) {
  const { t, i18n } = ctx;
  if (date > ctx.today()) return null;
  const tid = nextId("de");
  const body = h("div", { class: "de-list", id: "de-list" });
  const undo = h("button", { type: "button", class: "btn", id: "de-undo" }, icon("undo", { size: 20 }), h("span", { text: t("common.undo") }));
  const dlg = h("dialog", { class: "dialog editor day-editor", "aria-labelledby": tid, "data-date": date },
    h("h2", { id: tid, text: i18n.formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) }),
    body,
    h("div", { class: "dialog-actions" }, undo, h("button", { type: "button", class: "btn btn--gold", id: "de-close", text: t("common.close"), on: { click: () => dlg.close() } })));
  const paint = async () => {
    const focusId = document.activeElement?.id;
    const { active, idx } = await ctx.data();
    undo.disabled = ctx.repo.undoSize() === 0;
    body.replaceChildren(...active.map((x) => {
      const e = habitDays(idx, x).get(date);
      const st = dayStatus(x, e);
      const planned = isPeriodic(x) || isPlannedDay(x, date);
      const val = e && !e.rest ? e.value : 0;
      const refresh = async () => { await paint(); await onChange?.(); };
      const change = async (fn) => { try { await fn(); ctx.undoToast(t("toast.saved", { name: x.name }), refresh); await refresh(); } catch (ex) { ctx.fail(ex); } };
      let ctrl;
      if (x.kind === "count") {
        const num = h("input", { type: "number", class: "de-num", id: `de-val-${x.id}`, min: "0", max: "999", inputmode: "numeric", value: String(val), "aria-label": t("editor.value", { name: x.name }) });
        num.addEventListener("change", () => change(() => ctx.repo.setValue(x, date, Number(num.value))));
        ctrl = h("div", { class: "stepper", "data-rapid": "1" },
          h("button", { type: "button", class: "btn btn--icon", id: `de-minus-${x.id}`, "aria-label": t("row.remove", { name: x.name }), disabled: val <= 0 ? true : null, on: { click: () => change(() => ctx.repo.step(x, date, -1)) } }, icon("minus", { size: 20 })),
          num,
          h("button", { type: "button", class: "btn btn--icon btn--neon", id: `de-plus-${x.id}`, "aria-label": t("row.add", { name: x.name }), on: { click: () => change(() => ctx.repo.step(x, date, 1)) } }, icon("plus", { size: 20 })));
      } else {
        ctrl = h("button", { type: "button", role: "checkbox", class: `check hc-${x.color}`, id: `de-chk-${x.id}`, "aria-checked": st === "done" ? "true" : "false", "aria-label": x.name, on: { click: () => change(() => ctx.repo.toggleCheck(x, date)) } }, icon("check", { size: 24, sw: 2.5 }));
      }
      const rest = h("button", { type: "button", class: "btn btn--rest", id: `de-rest-${x.id}`, "aria-pressed": st === "rest" ? "true" : "false", on: { click: () => change(() => ctx.repo.toggleRest(x, date)) } }, icon("moon", { size: 18 }), h("span", { text: t("editor.rest") }));
      return h("div", { class: `de-row${st === "rest" ? " rest" : ""}`, id: `de-row-${x.id}` }, tile(x, "tile--sm"),
        h("div", { class: "de-main" }, h("div", { class: "nm", text: x.name }), planned ? null : h("span", { class: "badge", text: t("editor.notPlanned") }), x.kind === "count" ? h("span", { class: "de-target", text: `/ ${targetOf(x)}${x.unit ? " " + x.unit : ""}` }) : null),
        h("div", { class: "de-ctrls" }, ctrl, rest));
    }));
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  };
  undo.addEventListener("click", async () => { await ctx.repo.undo(); await paint(); await onChange?.(); });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  paint().then(() => { dlg.showModal(); dlg.querySelector("#de-close").focus(); });
  return dlg;
}
