// Siparisler ekrani (varsayilan): yaklasan / sorgu / tamamlanan / tumu filtreleri; siparis karti (tarih, musteri, kalemler, toplam, kalan, durum).
// Ayrinti: bilgiler, kalemler, toplamlar, tahmini maliyet ve kar; "sonraki adim" tek dokunusla zinciri ilerletir; siparis onayi / teklif /
// kaporali fatura yazdirma (core/print.js tek kapisi). Form: musteri (onceki musterilerden tamamlama), tarih/saat, tariften kalemler, kapora.
import { todayIso } from "../../../core/dates.js";
import { add, button, field, h, nextId, put } from "../../../core/ui.js";
import { checkOrder, cleanRecord, LIMITS, STATUSES } from "../logic/schema.js";
import { customers, lineTotal, nextStatus, orderCost, orderTotals, suggestedDeposit, upcoming } from "../logic/orders.js";
import { orderDoc } from "../print/docs.js";
import { labels, printDoc } from "../print/screens.js";
import { emptyBox, errText, loadAll, moneyField, numberField, openForm, openModal, printButton, selectField, statusChip } from "./common.js";

const FILTERS = ["upcoming", "inquiry", "done", "all"];

export async function openOrderForm(ctx, order = null, data = null) {
  const { t } = ctx.i18n;
  data = data ?? (await loadAll(ctx));
  const { recipes, costs, prefs } = data;
  const listId = nextId("cust");
  const known = customers(data.orders);
  const name = field({ label: t("order.customer"), value: order?.customerName ?? "", maxlength: LIMITS.name, required: true, autocomplete: "off", id: "ord-customer", list: listId });
  const dl = h("datalist", { id: listId }, known.map((c) => h("option", { value: c.name })));
  const phone = field({ label: t("order.phone"), value: order?.phone ?? "", type: "tel", maxlength: LIMITS.phone, autocomplete: "off", id: "ord-phone" });
  const email = field({ label: t("order.email"), value: order?.email ?? "", type: "email", maxlength: LIMITS.email, autocomplete: "off", id: "ord-email" });
  name.input.addEventListener("change", () => {
    const c = known.find((k) => k.name.toLocaleLowerCase() === name.input.value.trim().toLocaleLowerCase());
    if (c) { if (!phone.input.value) phone.input.value = c.phone; if (!email.input.value) email.input.value = c.email; }
  });
  const date = field({ label: t("order.date"), type: "date", value: order?.date ?? todayIso(), required: true, id: "ord-date" });
  const time = field({ label: t("order.time"), type: "time", value: order?.time ?? "", id: "ord-time" });
  const status = selectField({ id: "ord-status", label: t("order.status"), value: order?.status ?? "inquiry", options: STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })) });
  const fee = moneyField(ctx, { label: t("order.deliveryFee"), value: order?.deliveryFeeMinor || null, id: "ord-fee" });
  const disc = moneyField(ctx, { label: t("order.discount"), value: order?.discountMinor || null, id: "ord-discount" });
  const deposit = moneyField(ctx, { label: t("order.deposit"), value: order?.depositMinor || null, id: "ord-deposit" });
  const note = field({ label: t("common.note"), value: order?.note ?? "", multiline: true, maxlength: LIMITS.note, id: "ord-note", hint: t("order.noteHint") });

  const lines = [];
  const box = h("div", { class: "stack ord-lines", id: "ord-lines" });
  const linesErr = h("p", { class: "field-error", role: "alert", id: "ord-lines-err" });
  const recOpts = [{ value: "", label: t("order.customItem") }, ...recipes.map((r) => ({ value: r.id, label: r.name }))];
  const defaultPrice = (rid) => { const r = data.recById.get(rid); const c = costs.get(rid); return r ? (r.salePriceMinor ?? c?.suggestedUnitMinor ?? null) : null; };
  const addLine = (it = null) => {
    const n = lines.length + 1;
    const rec = selectField({ id: `ord-line-rec-${n}`, label: t("order.product"), value: it ? it.recipeId : (recipes[0]?.id ?? ""), options: recOpts });
    const nm = field({ label: t("order.itemName"), value: it?.name ?? "", maxlength: LIMITS.itemName, autocomplete: "off", id: `ord-line-name-${n}` });
    const qty = numberField(ctx, { label: t("order.qty"), value: it?.qty ?? null, id: `ord-line-qty-${n}` });
    const price = moneyField(ctx, { label: t("order.unitPrice"), value: it ? it.unitPriceMinor : defaultPrice(rec.input.value), id: `ord-line-price-${n}` });
    const line = { rec, nm, qty, price };
    const syncName = () => { nm.element.hidden = rec.input.value !== ""; };
    rec.input.addEventListener("change", () => { const p = defaultPrice(rec.input.value); if (p !== null) price.input.value = ctx.i18n.formatNumber(p / 10 ** ctx.i18n.digits, { useGrouping: false, minimumFractionDigits: ctx.i18n.digits, maximumFractionDigits: ctx.i18n.digits }); syncName(); totals(); });
    syncName();
    const rm = button({ label: t("common.remove"), glyph: "trash", variant: "ghost", ariaLabel: t("order.removeLine", { n }), onClick: () => { lines.splice(lines.indexOf(line), 1); el.remove(); totals(); } });
    const el = h("div", { class: "rec-line", "data-line": String(n) }, rec.element, nm.element, h("div", { class: "grid-2" }, qty.element, price.element), h("div", { class: "row" }, rm));
    for (const x of [qty.input, price.input, nm.input]) x.addEventListener("input", totals);
    lines.push(line); add(box, el);
    return line;
  };
  for (const it of order?.items ?? []) addLine(it);
  if (!lines.length) addLine();
  const addBtn = button({ id: "ord-line-add", label: t("order.addLine"), glyph: "plus", onClick: () => addLine().qty.input.focus() });

  const sum = h("div", { class: "card stack ord-sum", id: "ord-sum", "aria-live": "polite" });
  const readItems = () => lines.map((l) => {
    const rid = l.rec.input.value;
    const r = data.recById.get(rid);
    return { recipeId: rid, name: r ? r.name : l.nm.input.value.trim(), qty: l.qty.read(), unitPriceMinor: l.price.read() };
  });
  const readAll = () => ({ customerName: name.input.value, phone: phone.input.value, email: email.input.value.trim(), date: date.input.value, time: time.input.value, status: status.input.value,
    deliveryFeeMinor: fee.read() ?? 0, discountMinor: disc.read() ?? 0, depositMinor: deposit.read() ?? 0, note: note.input.value, items: readItems() });
  function totals() {
    const v = readAll();
    const okItems = v.items.filter((i) => i.qty > 0 && Number.isSafeInteger(i.unitPriceMinor));
    const tt = orderTotals({ ...v, status: "confirmed", items: okItems, deliveryFeeMinor: Number.isSafeInteger(v.deliveryFeeMinor) ? v.deliveryFeeMinor : 0, discountMinor: Number.isSafeInteger(v.discountMinor) ? v.discountMinor : 0, depositMinor: Number.isSafeInteger(v.depositMinor) ? v.depositMinor : 0 });
    const f = ctx.money.format;
    put(sum, h("table", { class: "rc-totals" }, h("tbody", {},
      h("tr", { class: "is-total" }, h("td", { text: t("doc.total") }), h("td", { class: "num", id: "ord-total", text: f(tt.totalMinor) })),
      h("tr", {}, h("td", { text: t("order.depositSuggested", { pct: ctx.i18n.formatPercent(prefs.depositPct) }) }), h("td", { class: "num", id: "ord-deposit-suggested", text: f(suggestedDeposit(tt.totalMinor, prefs.depositPct)) })),
      h("tr", {}, h("td", { text: t("doc.balance") }), h("td", { class: "num", id: "ord-balance", text: f(tt.balanceMinor) })))));
    return tt;
  }
  for (const f of [fee, disc, deposit]) f.input.addEventListener("input", totals);
  totals();
  let result = null;
  const saved = await openForm(ctx, {
    title: order ? t("order.edit", { serial: order.serial }) : t("order.add"),
    groups: [
      { legend: t("order.who"), nodes: [name.element, dl, h("div", { class: "grid-2" }, phone.element, email.element)] },
      { legend: t("order.when"), nodes: [h("div", { class: "grid-2" }, date.element, time.element), status.element] },
      { legend: t("order.items"), nodes: [recipes.length ? null : h("p", { class: "banner banner-info", text: t("order.noRecipes") }), box, linesErr, h("div", { class: "row" }, addBtn)] },
      { legend: t("order.money"), nodes: [h("div", { class: "grid-2" }, fee.element, disc.element), deposit.element] },
      { legend: t("common.note"), nodes: [note.element] },
    ],
    extra: [sum],
    onSave: async () => {
      const v = readAll();
      let bad = false;
      const items = [];
      for (const l of lines) {
        l.qty.setError(""); l.price.setError(""); l.nm.setError("");
        const rid = l.rec.input.value; const q = l.qty.read(); const p = l.price.read();
        const nmv = rid ? data.recById.get(rid)?.name : l.nm.input.value.trim();
        if (!rid && !nmv && q === null) continue;
        if (!nmv) { l.nm.setError(t("msg.required")); bad = true; continue; }
        if (!(q > 0)) { l.qty.setError(t("msg.range")); bad = true; continue; }
        if (!Number.isSafeInteger(p) || p < 0) { l.price.setError(t("msg.range")); bad = true; continue; }
        items.push({ recipeId: rid, name: nmv, qty: q, unitPriceMinor: p });
      }
      for (const [f, val] of [[fee, v.deliveryFeeMinor], [disc, v.discountMinor], [deposit, v.depositMinor]]) { const ok = Number.isSafeInteger(val) && val >= 0; f.setError(ok ? "" : t("msg.range")); if (!ok) bad = true; }
      const tt = orderTotals({ ...v, items, status: "confirmed" });
      const chk = checkOrder({ ...v, items }, tt.totalMinor);
      name.setError(chk.errors.customerName ? errText(ctx, "required") : "");
      date.setError(chk.errors.date ? errText(ctx, "required") : "");
      time.setError(chk.errors.time ? errText(ctx, "time") : "");
      email.setError(chk.errors.email ? errText(ctx, "email") : "");
      if (chk.errors.depositMinor) deposit.setError(errText(ctx, "deposit"));
      linesErr.textContent = chk.errors.items ? t("order.needLine") : "";
      if (bad || !chk.ok) return false;
      const base = cleanRecord("orders", { ...v, items, serial: order?.serial ?? "", source: order?.source === "sample" ? "sample" : "manual" }).record;
      if (order) result = await ctx.store.update("orders", order.id, base);
      else result = await ctx.store.transactMany(["orders"], (tx) => tx.add("orders", { ...base, serial: tx.nextNumber("O", { year: Number(base.date.slice(0, 4)) || new Date().getFullYear() }) }));
      return true;
    },
  });
  if (saved) ctx.notify(t("common.saved"), "success");
  return saved ? result : null;
}

export async function openOrderDetail(ctx, id, onChange) {
  const { t, formatDate } = ctx.i18n;
  const data = await loadAll(ctx);
  const o = data.orders.find((x) => x.id === id);
  if (!o) { ctx.notify(t("error.not_found"), "error"); return; }
  const tt = orderTotals(o);
  const cost = orderCost(o, data.costs, data.recById);
  const f = ctx.money.format;
  const L = labels(ctx);
  const today = todayIso();
  const setStatus = async (s) => { await ctx.store.update("orders", o.id, { status: s }); ctx.notify(t("order.statusSet", { status: t(`status.${s}`) }), "success"); m.close(); await onChange?.(); };
  const next = nextStatus(o.status);
  const row = (k, v, strong, rid) => h("tr", { class: strong ? "is-total" : undefined, id: rid }, h("td", { text: k }), h("td", { class: "num", text: v }));
  const money = [row(t("doc.subtotal"), f(tt.itemsMinor))];
  if (tt.deliveryFeeMinor) money.push(row(t("order.deliveryFee"), f(tt.deliveryFeeMinor)));
  if (tt.discountMinor) money.push(row(t("order.discount"), f(-tt.discountMinor)));
  money.push(row(t("doc.total"), f(tt.totalMinor), true, "det-total"), row(o.status === "paid" ? t("doc.paid") : t("doc.depositReceived"), f(tt.paidMinor), false, "det-paid"), row(t("doc.balance"), f(tt.balanceMinor), true, "det-balance"));
  money.push(row(t("order.estCost"), cost.unknown ? `${f(cost.costMinor)} *` : f(cost.costMinor), false, "det-cost"), row(t("order.estProfit"), f(tt.totalMinor - cost.costMinor), false, "det-profit"));
  const m = openModal(ctx, { title: `${o.serial} · ${o.customerName}`, className: "detail-dialog", children: [
    h("div", { class: "stack" },
      h("p", { class: "row" }, statusChip(ctx, o.status), h("span", { class: "muted", id: "det-when", text: [formatDate(o.date, { dateStyle: "full" }), o.time ? L.time(o.time) : ""].filter(Boolean).join(" · ") })),
      o.phone || o.email ? h("p", { class: "muted", text: [o.phone, o.email].filter(Boolean).join(" · ") }) : null,
      h("ul", { class: "rec-ing-list", id: "det-items" }, o.items.map((it) => h("li", {}, h("span", { text: `${ctx.i18n.formatNumber(it.qty, { maximumFractionDigits: 3 })} × ${it.name} @ ${f(it.unitPriceMinor)}` }), h("span", { class: "num", text: f(lineTotal(it)) })))),
      h("table", { class: "rc-totals" }, h("tbody", {}, money)),
      cost.unknown ? h("p", { class: "field-hint", text: t("order.costUnknown") }) : null,
      o.note ? h("p", { class: "rc-text", text: o.note }) : null,
      next ? h("div", { class: "row" }, button({ id: "det-next", label: t(`order.next.${next}`), variant: "primary", onClick: () => setStatus(next) })) : null,
      h("div", { class: "row" },
        printButton(ctx, { id: "det-print-confirmation", label: t("order.print.confirmation"), onClick: () => printDoc(ctx, orderDoc(L, o, "confirmation", { prefs: data.prefs, today })) }),
        printButton(ctx, { id: "det-print-quote", label: t("order.print.quote"), onClick: () => printDoc(ctx, orderDoc(L, o, "quote", { prefs: data.prefs, today })) }),
        printButton(ctx, { id: "det-print-invoice", label: t("order.print.invoice"), onClick: () => printDoc(ctx, orderDoc(L, o, "invoice", { prefs: data.prefs, today })) })),
      h("div", { class: "row" },
        button({ id: "det-edit", label: t("common.edit"), glyph: "edit", onClick: async () => { m.close(); if (await openOrderForm(ctx, o)) await onChange?.(); } }),
        o.status !== "cancelled" && o.status !== "paid" ? button({ id: "det-cancel", label: t("order.cancel"), onClick: async () => { if (await ctx.confirm({ title: t("order.cancelTitle"), message: t("order.cancelText"), confirmLabel: t("order.cancel") })) await setStatus("cancelled"); } }) : null,
        button({ id: "det-delete", label: t("common.delete"), glyph: "trash", variant: "danger", onClick: async () => {
          if (!(await ctx.confirm({ title: t("order.deleteTitle"), message: t("order.deleteText", { serial: o.serial }) }))) return;
          await ctx.store.remove("orders", o.id); m.close(); ctx.notify(t("common.deleted"), "success"); await onChange?.();
        } }))),
  ] });
  return m.done;
}

export function orderCard(ctx, o, { late = false, onOpen }) {
  const { t, formatDate } = ctx.i18n;
  const tt = orderTotals(o);
  const L = labels(ctx);
  return h("button", { type: "button", class: `item-card ord-card${late ? " is-late" : ""}`, "data-order": o.id, on: { click: () => onOpen(o) } },
    h("span", { class: "item-top" }, h("strong", { class: "item-title", text: o.customerName }), statusChip(ctx, o.status), late ? h("span", { class: "badge badge-danger", text: t("order.late") }) : null),
    h("span", { class: "muted", text: `${o.serial} · ${[formatDate(o.date, { weekday: "short", month: "short", day: "numeric" }), o.time ? L.time(o.time) : ""].filter(Boolean).join(" ")}` }),
    h("span", { class: "item-sub", text: o.items.map((it) => `${ctx.i18n.formatNumber(it.qty, { maximumFractionDigits: 3 })} × ${it.name}`).join(", ") }),
    h("span", { class: "item-stats" },
      h("span", {}, h("span", { class: "stat-k", text: t("doc.total") }), h("span", { class: "stat-v", text: ctx.money.format(tt.totalMinor) })),
      h("span", {}, h("span", { class: "stat-k", text: t("doc.depositReceived") }), h("span", { class: "stat-v", text: ctx.money.format(tt.paidMinor) })),
      h("span", {}, h("span", { class: "stat-k", text: t("doc.balance") }), h("span", { class: "stat-v", text: ctx.money.format(tt.balanceMinor) }))));
}

export async function mountOrders(ctx, root, param) {
  const { t, tn } = ctx.i18n;
  let data = await loadAll(ctx);
  let filter = "upcoming";
  const today = todayIso();
  const head = h("div", { class: "page-head" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": t("order.filter") });
  const body = h("div", { class: "card-list", id: "ord-list" });
  const open = (o) => openOrderDetail(ctx, o.id, reload);
  const add = async () => { if (await openOrderForm(ctx, null, data)) await reload(); };
  function paint() {
    const up = upcoming(data.orders, today);
    put(head, h("div", {}, h("h2", { text: t("nav.orders") }), h("p", { class: "page-date", text: ctx.i18n.formatDate(today, { dateStyle: "full" }) })),
      h("p", { class: "count-pill", role: "status", id: "ord-open-count", text: tn("order.openCount", up.length) }));
    put(chips, ...FILTERS.map((k) => h("button", { type: "button", class: "chip", id: `ord-filter-${k}`, "aria-pressed": String(filter === k), text: t(`order.filter.${k}`), on: { click: () => { filter = k; paint(); document.getElementById(`ord-filter-${k}`)?.focus(); } } })));
    if (!data.orders.length) {
      put(body, emptyBox(t("order.empty"), t("order.emptyHint"), button({ id: "ord-add-first", label: t("order.add"), variant: "primary", onClick: add }), button({ id: "sample-load", label: t("sample.load"), onClick: () => ctx.sample.load() })));
      return;
    }
    let list;
    if (filter === "upcoming") list = up.filter((x) => x.order.status !== "inquiry");
    else if (filter === "inquiry") list = up.filter((x) => x.order.status === "inquiry");
    else {
      const src = filter === "done" ? data.orders.filter((o) => o.status === "delivered" || o.status === "paid") : data.orders;
      list = [...src].sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || ""))).map((o) => ({ order: o, late: false }));
    }
    put(body, ...(list.length ? list.map((x) => orderCard(ctx, x.order, { late: x.late, onOpen: open })) : [h("p", { class: "muted center", id: "ord-none", text: t(`order.none.${filter}`) })]));
  }
  async function reload() { data = await loadAll(ctx); paint(); }
  ctx.onExternalChange(reload);
  put(root, head, h("div", { class: "row toolbar-row" }, button({ id: "ord-add", label: t("order.add"), variant: "primary", glyph: "plus", onClick: add })), chips, body);
  paint();
  if (param && data.orders.some((o) => o.id === param)) open({ id: param });
}
