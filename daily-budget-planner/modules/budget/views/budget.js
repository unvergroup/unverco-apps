// Budget: zarflar (donem siniri; gunluk tutardan DUSULMEZ, yalniz paylastirma) ve kumbaralar (aylik olmayan giderler, hedefler).
import { h, btn, field, openDialog } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { addDays, diffDays, isIsoDate } from "../../../core/dates.js";
import { ENVELOPE_ICONS } from "../logic/schema.js";
import { addToFund, archiveFund, deleteEnvelope, saveEnvelope, saveFund, showEnvelope, spendFromFund } from "../logic/actions.js";
import { envelopeSpent, fundSaved, fundShareAt, spendableThisPeriod } from "../logic/engine.js";
import { payTimeline } from "../logic/schedule.js";
import { bar, disclaimerNote, emptyState, envIdOf, envName, hello, md, money, plainMoney, readMoney } from "./common.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, String(attrs[k])); for (const c of kids) n.append(c); return n; };
let tab = "env"; // telefonda acik sekme (oturum boyunca)

export async function mountBudget(ctx, root, { state, result: res, today, param }) {
  const { t } = ctx.i18n;
  if (param === "funds") tab = "fund";
  ctx.setActions(h("a", { class: "iconbtn show-sm", href: "#/settings", id: "top-settings", "aria-label": t("nav.settings") }, icon("settings")));
  const total = diffDays(res.periodStart, res.nextPay);
  const dayN = Math.min(total, diffDays(res.periodStart, today) + 1);
  root.append(hello(t("budget.title"), t("budget.sub", { from: md(ctx, res.periodStart), to: md(ctx, addDays(res.nextPay, -1)), n: dayN, total })));
  const envSec = h("section", { "aria-labelledby": "h-env", id: "sec-env" });
  const fundSec = h("section", { "aria-labelledby": "h-fund", id: "sec-fund" });
  const tabs = h("div", { class: "tabs mobile-only", role: "group", "aria-label": t("budget.title") },
    h("button", { type: "button", id: "tab-env", "aria-pressed": String(tab === "env"), on: { click: () => { tab = "env"; ctx.refresh(); } } }, t("budget.envelopes")),
    h("button", { type: "button", id: "tab-fund", "aria-pressed": String(tab === "fund"), on: { click: () => { tab = "fund"; ctx.refresh(); } } }, t("budget.funds")));
  envSec.classList.toggle("hide-mobile", tab !== "env");
  fundSec.classList.toggle("hide-mobile", tab !== "fund");
  root.append(tabs, h("div", { class: "budgetcols" }, envSec, fundSec));

  // ---- Zarflar ----
  const visible = state.envelopes.filter((e) => !e.hidden);
  const limits = visible.reduce((n, e) => n + (e.limitPerPeriodMinor || 0), 0);
  envSec.append(h("div", { class: "sect" }, h("h2", { id: "h-env", text: t("budget.envelopes") }), btn({ label: t("common.add"), cls: "ghost sm", icon: "plus", id: "env-add", onClick: () => openEnvForm(ctx, null) })),
    h("div", { class: "summary glass", id: "env-summary" }, h("div", {}, h("small", { text: t("budget.envTotal") }), h("b", { class: "num", text: money(ctx, limits) })),
      h("div", { class: "right" }, h("small", { text: t("budget.spendablePeriod") }), h("b", { class: "num mint", text: money(ctx, spendableThisPeriod(state, res, today)) }))));
  const grid = h("div", { class: "envgrid", id: "env-grid" });
  for (const e of visible) {
    const id = envIdOf(e);
    const spent = envelopeSpent(state.transactions, id, res.periodStart, res.nextPay);
    const lim = e.limitPerPeriodMinor || 0;
    const over = lim > 0 && spent > lim;
    const card = h("button", { type: "button", class: `env glass${over ? " over" : ""}`, id: `env-${id}`, "aria-label": t("budget.editEnvNamed", { name: envName(ctx, e) }), on: { click: () => openEnvForm(ctx, e) } },
      h("div", { class: "top" }, h("span", { class: "chipico" }, icon(e.icon || "tag")), h("b", { text: envName(ctx, e) })));
    if (lim > 0) {
      card.append(h("div", { class: "left num" }, over ? t("env.over", { amount: money(ctx, spent - lim) }) : money(ctx, lim - spent), h("small", { text: t(over ? "env.thisPeriod" : "env.left") })),
        bar((spent / lim) * 100), h("div", { class: "of num", text: t("env.of", { spent: money(ctx, spent), limit: money(ctx, lim) }) }));
    } else card.append(h("div", { class: "left num" }, money(ctx, spent), h("small", { text: t("env.spentNoLimit") })), h("div", { class: "nolimit", text: t("env.noLimit") }));
    grid.append(card);
  }
  envSec.append(grid);
  const hidden = state.envelopes.filter((e) => e.hidden);
  if (hidden.length) envSec.append(h("div", { class: "hiddenlist" }, h("span", { class: "field-hint", text: t("budget.hidden") }), hidden.map((e) => btn({ label: envName(ctx, e), cls: "ghost sm", icon: "eye", id: `env-show-${envIdOf(e)}`, onClick: async () => { await ctx.change(() => showEnvelope(ctx.store, e.id)); ctx.refresh(); } }))));

  // ---- Kumbaralar ----
  fundSec.append(h("div", { class: "sect" }, h("h2", { id: "h-fund", text: t("budget.funds") }), btn({ label: t("common.add"), cls: "ghost sm", icon: "plus", id: "fund-add", onClick: () => openFundForm(ctx, null) })));
  const tl = payTimeline(state.payPlan, state.transactions, today);
  const active = state.funds.filter((f) => !f.archived);
  for (const f of active) {
    const saved = fundSaved(state.fundMoves, f.id);
    const share = fundShareAt(f, Math.max(0, saved), tl.next, state.payPlan, tl);
    const pct = f.targetMinor > 0 ? Math.min(100, Math.round((saved / f.targetMinor) * 100)) : 0;
    const reached = f.targetMinor > 0 && saved >= f.targetMinor;
    const C = 2 * Math.PI * 44;
    const visual = f.targetMinor > 0
      ? h("div", { class: "goal" }, svg("svg", { viewBox: "0 0 104 104", "aria-hidden": "true" },
          svg("defs", {}, svg("linearGradient", { id: `gold-${f.id}`, x1: 0, y1: 0, x2: 1, y2: 1 }, svg("stop", { offset: 0, "stop-color": "var(--gold-hi)" }), svg("stop", { offset: 1, "stop-color": "var(--gold-lo)" }))),
          svg("circle", { cx: 52, cy: 52, r: 44, fill: "none", stroke: "var(--glass-3)", "stroke-width": 9 }),
          pct > 0 ? svg("circle", { cx: 52, cy: 52, r: 44, fill: "none", stroke: `url(#gold-${f.id})`, "stroke-width": 9, "stroke-linecap": "round", "stroke-dasharray": `${((C * pct) / 100).toFixed(1)} ${C.toFixed(1)}` }) : ""),
        h("div", { class: "t num" }, h("div", {}, `${pct}%`, h("small", { text: t("fund.saved") }))))
      : h("span", { class: "chipbig" }, icon("piggy"));
    fundSec.append(h("article", { class: "fund glass", id: `fund-${f.id}` }, visual, h("div", { class: "tx" },
      h("h3", {}, h("button", { type: "button", class: "linklike", id: `fund-edit-${f.id}`, "aria-label": t("fund.editNamed", { name: f.name }), on: { click: () => openFundForm(ctx, f) } }, f.name)),
      h("p", { class: "num" }, ...(f.targetMinor > 0 ? [h("b", { text: money(ctx, saved) }), ` ${t("fund.of")} ${money(ctx, f.targetMinor)}`] : [h("b", { text: money(ctx, saved) }), ` ${t("fund.savedPlain")}`])),
      h("p", { class: "num" }, reached ? h("span", { class: "tag mint", text: t("fund.reached") }) : t("fund.perPay", { amount: money(ctx, share) }), f.targetDate ? ` · ${t("fund.by", { date: md(ctx, f.targetDate) })}` : ""),
      h("div", { class: "row2" },
        btn({ label: t("fund.addMoney"), cls: "ghost sm", id: `fund-money-${f.id}`, onClick: () => openFundMoney(ctx, f, "add", today) }),
        btn({ label: t("fund.spend"), cls: "ghost sm", id: `fund-spend-${f.id}`, onClick: () => openFundMoney(ctx, f, "spend", today) })))));
  }
  if (active.length < 3) fundSec.append(emptyState("piggy", t("fund.emptyTitle"), t("fund.emptyText"))); // maketteki gibi: kumbara onerisi
  root.append(disclaimerNote(ctx));
}

function openEnvForm(ctx, env) {
  const { t } = ctx.i18n;
  const d = openDialog({ title: t(env ? "budget.editEnv" : "budget.addEnv"), id: "env-dlg", closeLabel: t("common.close") });
  const preset = Boolean(env && env.presetId);
  const name = field({ label: t("budget.envName"), id: "env-name", value: env ? envName(ctx, env) : "", attrs: { maxlength: 40, disabled: preset, autocomplete: "off" } });
  const limit = field({ label: t("budget.envLimit"), id: "env-limit", value: env && env.limitPerPeriodMinor ? plainMoney(env.limitPerPeriodMinor) : "", attrs: { inputmode: "decimal", autocomplete: "off" }, hint: t("budget.envLimitHint") });
  const ic = field({ label: t("budget.envIcon"), id: "env-icon", value: env?.icon ?? "tag", options: ENVELOPE_ICONS.map((i) => ({ value: i, label: t(`icon.${i}`) })) });
  d.body.append(name.el, limit.el, ic.el);
  if (env) d.foot.append(btn({ label: t(preset ? "budget.hide" : "common.delete"), cls: "danger", icon: preset ? "eye-off" : "trash", id: "env-delete", onClick: async () => {
    if (!preset && !(await ctx.confirm({ title: t("budget.deleteEnvTitle"), message: t("budget.deleteEnvMsg") }))) return;
    try { await ctx.change(() => deleteEnvelope(ctx.store, env.id), (r) => t(r === "hidden" ? "done.hidden" : "done.deleted")); d.close(true); ctx.refresh(); } catch (e) { ctx.fail(e); }
  } }));
  d.foot.append(btn({ label: t("common.cancel"), id: "env-cancel", onClick: () => d.close() }), btn({ label: t("common.save"), cls: "primary", id: "env-save", onClick: async () => {
    const raw = limit.input.value.trim();
    const v = raw ? readMoney(raw) : 0;
    if (!(Number.isInteger(v) && v >= 0)) { limit.setError(t("setup.err.amount")); return; }
    if (!preset && !name.input.value.trim()) { name.setError(t("bills.err.name")); return; }
    try { await ctx.change(() => saveEnvelope(ctx.store, env?.id, { name: preset ? undefined : name.input.value, icon: ic.input.value, limitPerPeriodMinor: v })); d.close(true); ctx.refresh(); } catch (e) { ctx.fail(e); }
  } }));
  (preset ? limit : name).input.focus();
}

function openFundForm(ctx, fund) {
  const { t } = ctx.i18n;
  const d = openDialog({ title: t(fund ? "fund.edit" : "fund.add"), id: "fund-dlg", closeLabel: t("common.close") });
  const name = field({ label: t("fund.name"), id: "fund-name", value: fund?.name ?? "", attrs: { maxlength: 40, autocomplete: "off" } });
  const mode = field({ label: t("fund.mode"), id: "fund-mode", value: fund?.mode ?? "fixed", options: [{ value: "fixed", label: t("fund.mode.fixed") }, { value: "toDate", label: t("fund.mode.toDate") }] });
  const per = field({ label: t("fund.per"), id: "fund-per", value: fund?.perPeriodMinor ? plainMoney(fund.perPeriodMinor) : "", attrs: { inputmode: "decimal", autocomplete: "off" } });
  const target = field({ label: t("fund.target"), id: "fund-target", value: fund?.targetMinor ? plainMoney(fund.targetMinor) : "", attrs: { inputmode: "decimal", autocomplete: "off" }, hint: t("fund.targetHint") });
  const date = field({ label: t("fund.date"), id: "fund-date", type: "date", value: fund?.targetDate ?? "" });
  const sync = () => { per.el.hidden = mode.input.value !== "fixed"; };
  mode.input.addEventListener("change", sync);
  sync();
  d.body.append(name.el, mode.el, h("div", { class: "formgrid two" }, per.el, target.el, date.el));
  if (fund) d.foot.append(btn({ label: t("fund.archive"), cls: "danger", icon: "archive", id: "fund-archive", onClick: async () => {
    if (!(await ctx.confirm({ title: t("fund.archiveTitle"), message: t("fund.archiveMsg"), confirmLabel: t("fund.archive") }))) return;
    try { await ctx.change(() => archiveFund(ctx.store, fund.id, ctx.today()), t("done.archived")); d.close(true); ctx.refresh(); } catch (e) { ctx.fail(e); }
  } }));
  d.foot.append(btn({ label: t("common.cancel"), id: "fund-cancel", onClick: () => d.close() }), btn({ label: t("common.save"), cls: "primary", id: "fund-save", onClick: async () => {
    const num = (fl) => (fl.input.value.trim() ? readMoney(fl.input.value) : 0);
    const p = num(per), tg = num(target);
    let bad = false;
    const need = (fl, ok, key) => { fl.setError(ok ? "" : t(key)); if (!ok) bad = true; };
    need(name, name.input.value.trim().length > 0, "bills.err.name");
    need(target, Number.isInteger(tg) && tg >= 0 && (mode.input.value !== "toDate" || tg > 0), "fund.err.target");
    if (mode.input.value === "fixed") need(per, Number.isInteger(p) && p > 0, "setup.err.amount");
    else need(date, isIsoDate(date.input.value) && date.input.value > ctx.today(), "fund.err.date");
    if (bad) return;
    try { await ctx.change(() => saveFund(ctx.store, fund?.id, { name: name.input.value, mode: mode.input.value, perPeriodMinor: mode.input.value === "fixed" ? p : 0, targetMinor: tg, targetDate: date.input.value })); d.close(true); ctx.refresh(); } catch (e) { ctx.fail(e); }
  } }));
  name.input.focus();
}

function openFundMoney(ctx, fund, kind, today) {
  const { t } = ctx.i18n;
  const d = openDialog({ title: t(kind === "add" ? "fund.addMoneyTitle" : "fund.spendTitle", { name: fund.name }), id: "fundmoney-dlg", closeLabel: t("common.close") });
  const amt = field({ label: t("tx.amount"), id: "fm-amount", attrs: { inputmode: "decimal", autocomplete: "off" }, hint: kind === "spend" ? t("fund.spendHint") : t("fund.addHint") });
  const note = kind === "spend" ? field({ label: t("tx.note"), id: "fm-note", attrs: { maxlength: 120 } }) : null;
  d.body.append(amt.el, note ? note.el : null);
  d.foot.append(btn({ label: t("common.cancel"), id: "fm-cancel", onClick: () => d.close() }), btn({ label: t("common.save"), cls: "primary", id: "fm-save", onClick: async () => {
    const v = readMoney(amt.input.value);
    if (!(Number.isInteger(v) && v > 0)) { amt.setError(t("setup.err.amount")); return; }
    try {
      if (kind === "add") await ctx.change(() => addToFund(ctx.store, fund.id, v, today));
      else await ctx.change(() => spendFromFund(ctx.store, fund.id, { amountMinor: v, date: today, note: note.input.value || fund.name }));
      d.close(true); ctx.refresh();
    } catch (e) { if (e.code === "over_fund") amt.setError(t("fund.err.over")); else ctx.fail(e); }
  } }));
  amt.input.focus();
}
