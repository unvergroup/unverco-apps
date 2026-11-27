// Kurulum: 3 soru (maas sikligi + tarih, maas tutari, bugunku bakiye). Sonra Today ilk sayiyi gosterir.
import { h, btn, field } from "../../../core/ui.js";
import { isIsoDate } from "../../../core/dates.js";
import { FREQUENCIES } from "../logic/schema.js";
import { loadSample, savePlan } from "../logic/actions.js";
import { disclaimerNote, readMoney } from "./common.js";

export async function mountSetup(ctx, root, { state, today }) {
  const { t } = ctx.i18n;
  const old = state.payPlan && !state.payPlan.sample ? state.payPlan : null;
  const d = { step: 1, frequency: old?.frequency ?? "", anchorDate: old?.anchorDate || today, semi1: String(old?.semiDays?.[0] ?? 1), semi2: String(old?.semiDays?.[1] ?? 15), monthDay: String(old?.monthDay ?? 1), next: old?.nextOverride ?? "", amount: "", balance: "" };
  const card = h("section", { class: "card glass wizard", "aria-labelledby": "setup-q" });
  const steps = h("div", { class: "steps", role: "img" });
  root.append(
    h("div", { class: "hello" }, h("h1", { text: t("setup.title") }), h("p", { text: t("setup.sub") })),
    steps, card,
    h("div", { class: "setup-foot" },
      btn({ label: t("setup.sample"), cls: "ghost", icon: "grid", id: "setup-sample", onClick: async () => {
        try { await loadSample(ctx.store, "biweekly", today, t); ctx.navigate("today"); } catch (e) { ctx.fail(e); }
      } }),
      disclaimerNote(ctx),
      h("img", { src: ctx.logoSrc(), alt: "ÜNVERCO", class: "logo-lg" })));

  const dayNum = (v) => /^\d{1,2}$/.test(String(v).trim()) && +v >= 1 && +v <= 31;
  const valid = () => {
    if (d.step === 1) {
      if (!FREQUENCIES.includes(d.frequency)) return false;
      if (d.frequency === "weekly" || d.frequency === "biweekly") return isIsoDate(d.anchorDate);
      if (d.frequency === "semimonthly") return dayNum(d.semi1) && dayNum(d.semi2);
      if (d.frequency === "monthly") return dayNum(d.monthDay);
      return isIsoDate(d.next) && d.next > today;
    }
    if (d.step === 2) { const v = readMoney(d.amount); return Number.isInteger(v) && v > 0; }
    return Number.isInteger(readMoney(d.balance, { allowNegative: true }));
  };

  const render = (focusId) => {
    steps.setAttribute("aria-label", t("setup.stepOf", { n: d.step, total: 3 }));
    steps.replaceChildren(...[1, 2, 3].map((n) => h("i", { class: n <= d.step ? "on" : "" })));
    const next = btn({ label: d.step === 3 ? t("setup.finish") : t("common.next"), cls: "primary", id: "setup-next-btn", disabled: !valid(), onClick: go });
    const refresh = () => { next.disabled = !valid(); };
    const body = [];
    if (d.step === 1) {
      body.push(h("h2", { id: "setup-q", text: t("setup.q1") }));
      body.push(h("div", { class: "freq", role: "group", "aria-labelledby": "setup-q" }, FREQUENCIES.map((f) =>
        h("button", { type: "button", id: `setup-freq-${f}`, "aria-pressed": String(d.frequency === f), on: { click: () => { d.frequency = f; render(`setup-freq-${f}`); } } }, t(`freq.${f}`), h("small", { text: t(`freq.${f}.hint`) })))));
      const err = (fl, ok, msg) => fl.setError(ok ? "" : msg);
      if (d.frequency === "weekly" || d.frequency === "biweekly") {
        const f = field({ label: t("setup.anchor"), id: "setup-anchor", type: "date", value: d.anchorDate, hint: t("setup.anchorHint") });
        f.input.addEventListener("input", () => { d.anchorDate = f.input.value; err(f, isIsoDate(d.anchorDate), t("setup.err.date")); refresh(); });
        err(f, isIsoDate(d.anchorDate), t("setup.err.date"));
        body.push(f.el);
      } else if (d.frequency === "semimonthly") {
        const a = field({ label: t("setup.semi1"), id: "setup-semi1", type: "number", value: d.semi1, attrs: { min: 1, max: 31, inputmode: "numeric" } });
        const b = field({ label: t("setup.semi2"), id: "setup-semi2", type: "number", value: d.semi2, attrs: { min: 1, max: 31, inputmode: "numeric" }, hint: t("setup.semiHint") });
        a.input.addEventListener("input", () => { d.semi1 = a.input.value; err(a, dayNum(d.semi1), t("setup.err.day")); refresh(); });
        b.input.addEventListener("input", () => { d.semi2 = b.input.value; err(b, dayNum(d.semi2), t("setup.err.day")); refresh(); });
        body.push(h("div", { class: "formgrid two" }, a.el, b.el));
      } else if (d.frequency === "monthly") {
        const a = field({ label: t("setup.monthDay"), id: "setup-monthday", type: "number", value: d.monthDay, attrs: { min: 1, max: 31, inputmode: "numeric" }, hint: t("setup.semiHint") });
        a.input.addEventListener("input", () => { d.monthDay = a.input.value; err(a, dayNum(d.monthDay), t("setup.err.day")); refresh(); });
        body.push(a.el);
      } else if (d.frequency === "irregular") {
        const a = field({ label: t("setup.nextPay"), id: "setup-nextpay", type: "date", value: d.next, hint: t("setup.nextPayHint") });
        const check = () => err(a, isIsoDate(d.next) && d.next > today, t("setup.err.next"));
        a.input.addEventListener("input", () => { d.next = a.input.value; check(); refresh(); });
        check();
        body.push(a.el);
      }
    } else if (d.step === 2) {
      body.push(h("h2", { id: "setup-q", text: t("setup.q2") }));
      const a = field({ label: t("setup.amount"), id: "setup-amount", value: d.amount, attrs: { inputmode: "decimal", autocomplete: "off" }, hint: t("setup.amountHint") });
      const check = () => { const v = readMoney(d.amount); a.setError(Number.isInteger(v) && v > 0 ? "" : t("setup.err.amount")); };
      a.input.addEventListener("input", () => { d.amount = a.input.value; check(); refresh(); });
      a.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && valid()) go(); });
      check();
      body.push(a.el);
    } else {
      body.push(h("h2", { id: "setup-q", text: t("setup.q3") }));
      const a = field({ label: t("setup.balance"), id: "setup-balance", value: d.balance, attrs: { inputmode: "decimal", autocomplete: "off" }, hint: t("setup.balanceHint") });
      const check = () => a.setError(Number.isInteger(readMoney(d.balance, { allowNegative: true })) ? "" : t("setup.err.balance"));
      a.input.addEventListener("input", () => { d.balance = a.input.value; check(); refresh(); });
      a.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && valid()) go(); });
      check();
      body.push(a.el);
    }
    body.push(h("div", { class: "navrow" },
      d.step > 1 ? btn({ label: t("common.back"), id: "setup-back", onClick: () => { d.step -= 1; render("setup-next-btn"); } }) : h("span"),
      next));
    card.replaceChildren(...body);
    const f = focusId && document.getElementById(focusId);
    if (f) f.focus();
    else card.querySelector("input")?.focus();
  };

  async function go() {
    if (!valid()) return;
    if (d.step < 3) { d.step += 1; render(); return; }
    const plan = {
      frequency: d.frequency, anchorDate: d.frequency === "weekly" || d.frequency === "biweekly" ? d.anchorDate : "",
      semiDays: [+d.semi1 || 1, +d.semi2 || 15], monthDay: +d.monthDay || 1,
      amountMinor: readMoney(d.amount), nextOverride: d.frequency === "irregular" ? d.next : "",
      startBalanceMinor: readMoney(d.balance, { allowNegative: true }), startDate: today, setupDone: true,
    };
    try { await savePlan(ctx.store, plan); ctx.navigate("today"); } catch (e) { ctx.fail(e); }
  }
  render();
}
