// Hizli harcama: "+" (1) -> rakamlar (sayilmaz) -> zarf cipi (2) = kaydedildi. Tus takimi kurustan girer (1,2,5,0 -> 12,50; ondalik tusu yok).
// Fiziksel klavyede "12.50" ve "12,50" de 1.250 kurus olur (core/money.js keypadToMinor); asla 125.000 degil.
import { h, openDialog, field } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { keypadToMinor } from "../../../core/money.js";
import { addExpense, loadState, removeTransaction } from "../logic/actions.js";
import { dailyAmount } from "../logic/engine.js";
import { envIdOf, envName, money } from "./common.js";
import { moneyParts, sizeCls } from "./today.js";

export async function openQuickAdd(ctx) {
  const { t } = ctx.i18n;
  const state = await loadState(ctx.store);
  if (!state.payPlan || !state.payPlan.setupDone) { ctx.navigate("setup"); return; }
  const today = ctx.today();
  const res = dailyAmount(state, today);
  let typed = "";
  let showAll = false;
  const d = openDialog({ title: t("qa.title"), id: "qa", sheet: true, closeLabel: t("common.close") });
  d.dialog.classList.add("qa");
  const big = h("div", { class: "big num", id: "qa-amount", "aria-live": "polite" });
  const after = h("small", { class: "num", id: "qa-after" });
  const err = h("p", { class: "err", id: "qa-err", role: "alert" });
  const chips = h("div", { class: "chips", id: "qa-chips", role: "group", "aria-label": t("qa.hint") });
  const note = field({ label: t("tx.note"), id: "qa-note", attrs: { maxlength: 120, autocomplete: "off" } });
  const date = field({ label: t("tx.date"), id: "qa-date", type: "date", value: today });
  const more = h("div", { class: "more", id: "qa-more", hidden: true }, note.el, date.el);

  const value = () => keypadToMinor(typed);
  const paint = () => {
    const v = value();
    const p = moneyParts(ctx, Number.isInteger(v) ? v : 0);
    big.className = `big num${sizeCls(p)}`;
    big.replaceChildren(...[p.symFirst ? h("sup", { text: p.sym }) : null, p.num, p.symFirst ? null : h("sup", { text: p.sym }), h("span", { class: "cursor", "aria-hidden": "true" })].filter(Boolean));
    big.setAttribute("aria-label", t("qa.amountIs", { amount: money(ctx, Number.isInteger(v) ? v : 0) }));
    const leftAfter = res.leftTodayMinor - (Number.isInteger(v) ? v : 0);
    after.replaceChildren(t("qa.after"), " ", h("b", { text: money(ctx, leftAfter) }), " ", t("qa.leftToday"));
  };
  const press = (k) => {
    err.textContent = "";
    if (k === "back") typed = typed.slice(0, -1);
    else if (k === "." || k === ",") { if (!/[.,]/.test(typed) && typed.length < 9) typed += k; }
    else if (/^\d$/.test(k) && typed.length < 10) { if (!(typed === "" && k === "0")) typed += k; }
    paint();
  };

  const save = async (envelopeId) => {
    const v = value();
    if (!(Number.isInteger(v) && v > 0)) { err.textContent = t("qa.err.amount"); return; }
    try {
      const rec = await addExpense(ctx.store, { amountMinor: v, envelopeId, date: date.input.value || today, note: note.input.value });
      d.close(true);
      ctx.notify(t("qa.saved", { amount: money(ctx, v), env: envName(ctx, state.envelopes.find((e) => envIdOf(e) === envelopeId)) }), "info", { timeout: 5000, action: { label: t("common.undo"), id: "qa-undo", run: async () => { await removeTransaction(ctx.store, rec.id); ctx.refresh(); } } });
      ctx.refresh();
    } catch (e) { ctx.fail(e); }
  };

  const visible = state.envelopes.filter((e) => !e.hidden);
  const recent = (state.prefs.recentEnvelopes ?? []).map((id) => visible.find((e) => envIdOf(e) === id)).filter(Boolean);
  const ordered = [...recent, ...visible.filter((e) => !recent.includes(e))];
  const paintChips = () => {
    const list = showAll ? ordered : ordered.slice(0, 6);
    chips.replaceChildren(...list.map((e) => h("button", { type: "button", class: "chip", id: `qa-env-${envIdOf(e)}`, on: { click: () => save(envIdOf(e)) } }, icon(e.icon || "tag"), envName(ctx, e))),
      showAll ? null : h("button", { type: "button", class: "chip all", id: "qa-all", "aria-expanded": "false", on: { click: () => { showAll = true; paintChips(); chips.querySelector(".chip:nth-child(7)")?.focus(); } } }, icon("grid"), t("qa.all")));
  };
  const key = (label, k, attrs = {}) => h("button", { type: "button", class: `key${attrs.fn ? " fn" : " num"}`, id: `qa-key-${k === "back" ? "back" : k === "more" ? "more" : k}`, "data-rapid": "1", "aria-label": attrs.aria, on: { click: () => (k === "more" ? toggleMore() : press(k)) } }, ...(Array.isArray(label) ? label : [label]));
  const toggleMore = () => { more.hidden = !more.hidden; document.getElementById("qa-key-more").setAttribute("aria-expanded", String(!more.hidden)); if (!more.hidden) note.input.focus(); };

  d.body.append(
    h("div", { class: "amount" }, big, after),
    h("p", { class: "hint" }, t("qa.hintPre"), " ", h("b", { text: t("qa.hintSave") })),
    err, chips, more,
    h("div", { class: "keys" }, ..."123456789".split("").map((n) => key(n, n)),
      key([icon("calendar"), t("qa.more")], "more", { fn: true }), key("0", "0"), key([icon("back")], "back", { fn: true, aria: t("qa.backspace") })));
  d.dialog.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) return;
    if (/^[0-9]$/.test(e.key) || e.key === "." || e.key === ",") { e.preventDefault(); press(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
  });
  paint();
  paintChips();
  big.setAttribute("tabindex", "-1");
  big.focus();
  return d.done;
}
