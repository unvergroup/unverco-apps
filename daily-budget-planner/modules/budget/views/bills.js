// Bills: faturalar, onlari odeyen maasa gore gruplu (bu donem + sonraki 2 maas). Ekle / duzenle / sil, Mark paid.
import { h, btn, field, openDialog } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { addDays, isIsoDate } from "../../../core/dates.js";
import { REPEATS } from "../logic/schema.js";
import { markBillPaid, removeBill, saveBill, unmarkBillPaid } from "../logic/actions.js";
import { fundSaved, fundShareAt, periodBills } from "../logic/engine.js";
import { payTimeline } from "../logic/schedule.js";
import { bar, dateChip, disclaimerNote, emptyState, hello, md, money, plainMoney, readMoney } from "./common.js";

export async function mountBills(ctx, root, { state, result: res, today }) {
  const { t } = ctx.i18n;
  const plan = state.payPlan;
  const addBtn = btn({ label: t("bills.add"), cls: "primary", icon: "plus", id: "bill-add", ariaLabel: t("bills.add"), onClick: () => openBillForm(ctx, null, today) });
  addBtn.querySelector("span").classList.add("hide-sm"); // telefonda yalniz + simgesi; erisilebilir ad tam metin
  ctx.setActions(addBtn);
  root.append(hello(t("bills.title"), t("bills.sub")));
  if (!state.bills.length) {
    root.append(emptyState("receipt", t("bills.emptyTitle"), t("bills.emptyText"), btn({ label: t("bills.add"), cls: "primary", icon: "plus", id: "bill-add-empty", onClick: () => openBillForm(ctx, null, today) })), disclaimerNote(ctx));
    return;
  }
  const tl = payTimeline(plan, state.transactions, today);
  const { bounds, occurrences } = periodBills(state, tl);
  const funds = state.funds.filter((f) => !f.archived);
  // Kumbara paylari (ekrandaki satirlar motorla ayni islevden)
  const saved = new Map(funds.map((f) => [f.id, Math.max(0, fundSaved(state.fundMoves, f.id))]));
  const shares = [[], [], []];
  for (const k of [1, 2]) for (const f of funds) { const s = fundShareAt(f, saved.get(f.id), bounds[k], plan, tl); if (s > 0) shares[k].push({ f, s }); saved.set(f.id, saved.get(f.id) + s); }

  const grid = h("div", { class: "cols3" });
  let cum = 0;
  for (const k of [0, 1, 2]) {
    const occ = occurrences.filter((o) => o.idx === k && (o.paid || o.due >= plan.startDate));
    const unpaidSum = occ.filter((o) => !o.paid).reduce((n, o) => n + o.amountMinor, 0);
    const fundSum = shares[k].reduce((n, x) => n + x.s, 0);
    const due = unpaidSum + fundSum;
    const title = k === 0 ? t("bills.thisPeriod") : t("bills.payTitle", { date: md(ctx, bounds[k]) });
    const sub = k === 0 ? t("bills.thisSub", { from: md(ctx, bounds[0]), to: md(ctx, addDays(bounds[1], -1)), pay: md(ctx, bounds[0]) })
      : t("bills.paySub", { from: md(ctx, bounds[k]), to: md(ctx, addDays(bounds[k + 1], -1)), amount: money(ctx, plan.amountMinor) });
    const sec = h("section", { class: "period glass", id: `period-${k}`, "aria-labelledby": `p${k}` },
      h("div", { class: "period-head" }, h("div", {}, h("h3", { id: `p${k}`, text: title }), h("p", { text: sub })),
        h("div", { class: "tot" }, h("b", { class: "num", text: money(ctx, due) }), h("small", { text: t(k === 0 ? "bills.leftToPay" : "bills.due") }))));
    if (k === 0) {
      const covered = res.availableMinor >= 0;
      sec.append(h("div", { class: "cover" }, bar(covered ? 100 : 60, covered ? "" : "over"), h("p", {}, h("span", { text: t("bills.held") }), h("b", { class: `num${covered ? "" : " short"}`, text: covered ? t("bills.covered") : t("bills.shortBy", { amount: money(ctx, res.shortMinor) }) }))));
    } else {
      cum += due - plan.amountMinor;
      const over = due > plan.amountMinor;
      const coverP = over ? h("p", {}, h("span", {}, ...fill(t("bills.covers", { pay: md(ctx, bounds[k]), amount: "\u0000", total: "\u0001" }), money(ctx, plan.amountMinor), money(ctx, due))))
        : h("p", {}, h("span", {}, ...fill(t("bills.coversShort", { amount: "\u0000", total: "\u0001" }), money(ctx, due), money(ctx, plan.amountMinor))), h("span", { class: "num", text: t("bills.free", { amount: money(ctx, plan.amountMinor - due) }) }));
      const b = over ? h("div", { class: "bar" }) : bar((due / plan.amountMinor) * 100);
      if (over) { const o = h("i", { class: "over" }); o.style.width = "100%"; const i = h("i"); i.style.width = `${((plan.amountMinor / due) * 100).toFixed(1)}%`; b.append(o, i); }
      sec.append(h("div", { class: "cover" }, b, coverP));
      if (res.reserveK === k && res.reason.key === "reserve") sec.append(h("div", { class: "alert", role: "note" }, icon("alert"), h("span", {}, h("b", { class: "num", text: money(ctx, res.reserveMinor) }), " ", t("bills.asideAlert", { bill: res.reason.params.bill }))));
    }
    const list = h("ul", { class: "list" });
    for (const o of occ) {
      const tags = [];
      if (o.bill.kind === "debtMin") tags.push(h("span", { class: "tag gold", text: t("bills.minimum") }));
      if (!o.paid) tags.push(h("span", { class: "tag", text: t("bills.fromPay", { date: md(ctx, bounds[o.idx]) }) }));
      if (!o.paid && o.due < today) tags.push(h("span", { class: "tag coral", text: t("bills.overdue") }));
      list.append(h("li", { class: "item bill" }, dateChip(ctx, o.due),
        h("span", { class: "tx" }, h("span", { class: "l1" }, h("button", { type: "button", class: "linklike", "aria-label": t("bills.editNamed", { name: o.bill.name }), on: { click: () => openBillForm(ctx, o.bill, today) } }, h("b", { text: o.bill.name })), h("span", { class: "amt num", text: money(ctx, o.paid ? o.paidTx.amountMinor : o.amountMinor) })),
          o.paid ? h("small", { text: t("bills.paidOn", { date: md(ctx, o.paidTx.date) }) }) : h("span", { class: "meta" }, ...tags)),
        h("button", { type: "button", class: `paid${o.paid ? " done" : ""}`, id: `bp-${o.bill.id}-${o.due}`, "aria-pressed": String(o.paid), "aria-label": t("bills.markPaidNamed", { name: `${o.bill.name}, ${md(ctx, o.due)}` }), on: { click: async () => {
          try {
            if (o.paid) await ctx.change(() => unmarkBillPaid(ctx.store, o.bill.id, o.due), t("done.unpaid", { name: o.bill.name }));
            else await ctx.change(() => markBillPaid(ctx.store, o.bill.id, o.due, today), t("bills.paidToast", { name: o.bill.name }));
            ctx.refresh();
          } catch (e) { ctx.fail(e); }
        } } }, icon("check"))));
    }
    for (const { f, s } of shares[k]) list.append(h("li", { class: "item fundline" }, h("span", { class: "chipico" }, icon("piggy")), h("span", { class: "tx" }, h("b", { text: f.name }), h("small", { text: t("bills.fundLine") })), h("span", { class: "amt num", text: money(ctx, s) }), h("span", { class: "spacer44", "aria-hidden": "true" })));
    if (!list.children.length) list.append(h("li", { class: "item" }, h("span", { class: "listempty", text: t("bills.noneInPeriod") })));
    sec.append(list);
    grid.append(sec);
  }
  root.append(grid);
  // Tum faturalar (ufukta olmayanlar dahil): duzenleme listesi
  root.append(h("section", { class: "card glass", "aria-labelledby": "h-all" }, h("h2", { id: "h-all", text: t("bills.all") }),
    h("ul", { class: "list", id: "all-bills-list" }, [...state.bills].sort((a, b) => a.name.localeCompare(b.name)).map((b) => h("li", { class: "item" },
      h("span", { class: "chipico" }, icon(b.kind === "debtMin" ? "card" : "receipt")),
      h("span", { class: "tx" }, h("button", { type: "button", class: "linklike", id: `bill-edit-${b.id}`, on: { click: () => openBillForm(ctx, b, today) } }, h("b", { text: b.name })), h("small", { text: `${t(`repeat.${b.repeat}`, { n: b.everyN })} · ${t(b.payFrom === "earlier" ? "payFrom.earlier" : "payFrom.auto")}` })),
      h("span", { class: "amt num", text: money(ctx, b.amountMinor) }))))));
  root.append(disclaimerNote(ctx));
}

function fill(tpl, a, b) { const [x, rest = ""] = tpl.split("\u0000"); const [y, z = ""] = rest.split("\u0001"); return [x, h("b", { class: "num", text: a }), y, h("b", { class: "num", text: b }), z]; }

export function openBillForm(ctx, bill, today) {
  const { t } = ctx.i18n;
  const d = openDialog({ title: t(bill ? "bills.edit" : "bills.add"), id: "bill-dlg", closeLabel: t("common.close") });
  const name = field({ label: t("bills.name"), id: "bill-name", value: bill?.name ?? "", attrs: { maxlength: 60, autocomplete: "off" } });
  const amount = field({ label: t("bills.amount"), id: "bill-amount", value: bill ? plainMoney(bill.amountMinor) : "", attrs: { inputmode: "decimal", autocomplete: "off" } });
  const kind = field({ label: t("bills.kind"), id: "bill-kind", value: bill?.kind ?? "bill", options: [{ value: "bill", label: t("bills.kind.bill") }, { value: "debtMin", label: t("bills.kind.debtMin") }], hint: t("bills.kindHint") });
  const repeat = field({ label: t("bills.repeat"), id: "bill-repeat", value: bill?.repeat ?? "monthly", options: REPEATS.map((r) => ({ value: r, label: t(`repeat.${r}`, { n: "N" }) })) });
  const first = field({ label: t("bills.firstDue"), id: "bill-first", type: "date", value: bill?.firstDue ?? today });
  const everyN = field({ label: t("bills.everyN"), id: "bill-everyn", type: "number", value: String(bill?.everyN ?? 3), attrs: { min: 2, max: 12, inputmode: "numeric" } });
  const end = field({ label: t("bills.end"), id: "bill-end", type: "date", value: bill?.endDate ?? "", hint: t("bills.endHint") });
  const payFrom = field({ label: t("bills.payFrom"), id: "bill-payfrom", value: bill?.payFrom ?? "auto", options: [{ value: "auto", label: t("payFrom.auto") }, { value: "earlier", label: t("payFrom.earlier") }], hint: t("bills.payFromHint") });
  const showN = () => { everyN.el.hidden = repeat.input.value !== "everyNMonths"; };
  repeat.input.addEventListener("change", showN);
  showN();
  d.body.append(name.el, h("div", { class: "formgrid two" }, amount.el, kind.el, repeat.el, everyN.el, first.el, end.el), payFrom.el);
  if (bill) d.foot.append(btn({ label: t("common.delete"), cls: "danger", icon: "trash", id: "bill-delete", onClick: async () => {
    if (!(await ctx.confirm({ title: t("bills.deleteTitle"), message: t("bills.deleteMsg", { name: bill.name }) }))) return;
    try { await ctx.change(() => removeBill(ctx.store, bill.id), t("done.deleted")); d.close(true); ctx.refresh(); } catch (e) { ctx.fail(e); }
  } }));
  d.foot.append(btn({ label: t("common.cancel"), id: "bill-cancel", onClick: () => d.close() }), btn({ label: t("common.save"), cls: "primary", id: "bill-save", onClick: async () => {
    const v = readMoney(amount.input.value);
    let bad = false;
    const need = (fl, ok, key) => { fl.setError(ok ? "" : t(key)); if (!ok) bad = true; };
    need(name, name.input.value.trim().length > 0, "bills.err.name");
    need(amount, Number.isInteger(v) && v > 0, "setup.err.amount");
    need(first, isIsoDate(first.input.value), "setup.err.date");
    const n = Number(everyN.input.value);
    if (repeat.input.value === "everyNMonths") need(everyN, Number.isInteger(n) && n >= 2 && n <= 12, "bills.err.everyN");
    need(end, !end.input.value || (isIsoDate(end.input.value) && end.input.value >= first.input.value), "bills.err.end");
    if (bad) { d.body.querySelector('[aria-invalid="true"]')?.focus(); return; }
    try {
      await ctx.change(() => saveBill(ctx.store, bill?.id, { name: name.input.value, amountMinor: v, kind: kind.input.value, repeat: repeat.input.value, firstDue: first.input.value, everyN: repeat.input.value === "everyNMonths" ? n : 2, endDate: end.input.value, payFrom: payFrom.input.value, active: true }));
      d.close(true); ctx.refresh();
    } catch (e) { ctx.fail(e); }
  } }));
  name.input.focus();
  return d.done;
}
