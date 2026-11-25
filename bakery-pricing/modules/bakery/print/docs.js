// Yazdirilabilir belge MODELLERI (saf veri; DOM yok). Ayni model hem tarayici yazdirmasina (print/render.js) hem iPhone PDF'ine (core/canvas-doc.js) gider.
// L: { t, tn, formatDate, formatCurrency, formatNumber, formatPercent, time(hhmm), unit(u) }.
// Belge: { id, title, period, sections[], notes[] }  (bicim: core/canvas-doc.js layoutDoc)
import { addDays } from "../../../core/dates.js";
import { lineTotal, orderTotals, suggestedDeposit } from "../logic/orders.js";
import { displayOptions, readableQty } from "../logic/units.js";

const qty = (L, n) => L.formatNumber(n, { maximumFractionDigits: 3 });
/** Birimli miktar: g / ml tam sayi, digerleri en cok 2 ondalik (gorunum; ic hesap hassas). */
const amt = (L, n0, u0) => { const { n, unit: u } = readableQty(n0, u0); return `${L.formatNumber(n, displayOptions(n, u))} ${L.unit(u)}`; };
const when = (L, o) => [L.formatDate(o.date, { dateStyle: "full" }), o.time ? L.time(o.time) : ""].filter(Boolean).join(" · ");

/** Siparis belgesi. kind: "confirmation" (siparis onayi) | "quote" (teklif) | "invoice" (kaporali fatura). today: YYYY-MM-DD. */
export function orderDoc(L, order, kind, { prefs, today }) {
  const tt = orderTotals(order);
  const t = L.t;
  const title = t(`doc.${kind}.title`, { serial: order.serial || "" }).trim();
  let period;
  if (kind === "quote") period = t("doc.quote.period", { date: L.formatDate(today, { dateStyle: "long" }), until: L.formatDate(addDays(today, prefs.quoteValidDays), { dateStyle: "long" }) });
  else if (kind === "invoice") period = t("doc.invoice.period", { date: L.formatDate(today, { dateStyle: "long" }) });
  else period = t("doc.confirmation.period", { when: when(L, order) });
  const sections = [
    { kind: "kv", heading: t("doc.customer"), rows: [[t("doc.name"), order.customerName], [t("order.phone"), order.phone], [t("order.email"), order.email], [t(kind === "quote" ? "doc.eventDate" : "doc.dueDate"), when(L, order)]].filter(([, v]) => v) },
    {
      kind: "table", heading: t("doc.items"),
      columns: [{ key: "name", label: t("doc.col.item"), primary: true }, { key: "qty", label: t("doc.col.qty"), num: true }, { key: "unit", label: t("doc.col.unitPrice"), num: true }, { key: "amount", label: t("doc.col.amount"), num: true, amount: true }],
      rows: order.items.map((it) => ({ name: it.name, qty: qty(L, it.qty), unit: L.formatCurrency(it.unitPriceMinor), amount: L.formatCurrency(lineTotal(it)) })),
    },
  ];
  const kv = [[t("doc.subtotal"), L.formatCurrency(tt.itemsMinor)]];
  if (tt.deliveryFeeMinor) kv.push([t("order.deliveryFee"), L.formatCurrency(tt.deliveryFeeMinor)]);
  if (tt.discountMinor) kv.push([t("order.discount"), L.formatCurrency(-tt.discountMinor)]);
  kv.push([t("doc.total"), L.formatCurrency(tt.totalMinor), true]);
  if (kind === "quote") {
    const dep = tt.depositMinor || suggestedDeposit(tt.totalMinor, prefs.depositPct);
    if (dep) kv.push([t("doc.depositToBook"), L.formatCurrency(dep)]);
  } else if (order.status === "paid") {
    kv.push([t("doc.paid"), L.formatCurrency(tt.paidMinor)], [t("doc.balance"), L.formatCurrency(0), true]);
  } else {
    kv.push([t("doc.depositReceived"), L.formatCurrency(tt.depositMinor)], [t("doc.balance"), L.formatCurrency(tt.balanceMinor), true]);
  }
  sections.push({ kind: "kv", heading: t("doc.summary"), rows: kv });
  const notes = [];
  if (order.note) notes.push(order.note);
  if (kind === "quote") notes.push(t("doc.quote.note", { until: L.formatDate(addDays(today, prefs.quoteValidDays), { dateStyle: "long" }) }));
  if (kind === "invoice" && order.status === "paid") notes.push(t("doc.invoice.paidNote"));
  if (prefs.docNote) notes.push(prefs.docNote);
  return { id: `${kind}-${order.serial || "order"}`, title, period, sections, notes };
}

/** Tarif maliyet karti. */
export function recipeCardDoc(L, recipe, c, prefs) {
  const t = L.t;
  const sections = [{
    kind: "table", heading: t("doc.recipe.ingredients"),
    columns: [{ key: "name", label: t("doc.col.ingredient"), primary: true }, { key: "amount", label: t("doc.col.amountUsed"), num: true }, { key: "cost", label: t("doc.col.cost"), num: true, amount: true }],
    rows: c.lines.map((l) => ({ name: l.name || t("recipe.deletedIngredient"), amount: amt(L, l.qty, l.unit), cost: l.ok ? L.formatCurrency(l.costMinor) : t("recipe.noCost") })),
    total: { label: t("cost.ingredients"), value: L.formatCurrency(c.ingredientsMinor) },
  }];
  const rows = [
    [t("cost.ingredients"), L.formatCurrency(c.ingredientsMinor)],
    [t("cost.packaging"), L.formatCurrency(c.packagingMinor)],
    [t("cost.laborLine", { min: recipe.laborMinutes, rate: L.formatCurrency(prefs.hourlyRateMinor) }), L.formatCurrency(c.laborMinor)],
    [t("cost.subtotal"), L.formatCurrency(c.subtotalMinor)],
    [t("cost.overheadLine", { pct: L.formatPercent(c.overheadPct) }), L.formatCurrency(c.overheadMinor)],
    [t("cost.batch"), L.formatCurrency(c.batchMinor), true],
    [t("cost.perUnit", { unit: recipe.yieldUnit || t("recipe.unitsDefault") }), L.formatCurrency(c.unitMinor), true],
  ];
  const sug = [];
  if (c.suggestedUnitMinor !== null) {
    sug.push([t(`cost.suggested.${prefs.pricingMode}`, { pct: L.formatPercent(prefs.targetPct) }), L.formatCurrency(c.suggestedUnitMinor), true]);
    sug.push([t("cost.suggestedBatch"), L.formatCurrency(c.suggestedBatchMinor)]);
  }
  if (c.sale.status !== "none") {
    sug.push([t("cost.yourPrice"), L.formatCurrency(c.sale.priceMinor)]);
    sug.push([t("cost.profitPerUnit"), L.formatCurrency(c.sale.profitMinor)]);
    if (c.sale.marginPct !== null) sug.push([t("cost.margin"), L.formatPercent(c.sale.marginPct)]);
  }
  sections.push({ kind: "kv", heading: t("doc.recipe.breakdown"), rows });
  if (sug.length) sections.push({ kind: "kv", heading: t("doc.recipe.pricing"), rows: sug });
  const notes = [];
  if (c.missing) notes.push(t("cost.missingNote", { n: c.missing }));
  if (c.sale.status === "loss") notes.push(t("cost.warn.loss"));
  else if (c.sale.status === "below") notes.push(t("cost.warn.below"));
  notes.push(t("doc.recipe.note"));
  return { id: "recipe-card", title: t("doc.recipe.title", { name: recipe.name }), period: t("doc.recipe.period", { yield: `${qty(L, recipe.yieldQty)} ${recipe.yieldUnit || t("recipe.unitsDefault")}` }), sections, notes };
}

/** Haftalik uretim + alisveris listesi. plan: logic/plan.js weekPlan. */
export function weekDoc(L, plan) {
  const t = L.t;
  const period = `${L.formatDate(plan.range.from, { dateStyle: "long" })} – ${L.formatDate(plan.range.to, { dateStyle: "long" })}`;
  const sections = [];
  if (!plan.orders.length) sections.push({ kind: "empty", text: t("plan.empty") });
  else {
    sections.push({
      kind: "table", heading: t("plan.orders"),
      columns: [{ key: "date", label: t("doc.col.date"), primary: true, nowrap: true }, { key: "time", label: t("doc.col.time"), primary: true, nowrap: true }, { key: "who", label: t("order.customer"), primary: true, nowrap: true }, { key: "items", label: t("doc.items") }, { key: "status", label: t("order.status"), nowrap: true }],
      rows: plan.orders.map((o) => ({ date: L.formatDate(o.date, { weekday: "short", month: "short", day: "numeric" }), time: o.time ? L.time(o.time) : "", who: o.customerName, items: o.items.map((it) => `${qty(L, it.qty)} × ${it.name}`).join(", "), status: t(`status.${o.status}`) })),
    });
    sections.push({
      kind: "table", heading: t("plan.production"),
      columns: [{ key: "name", label: t("doc.col.product"), primary: true }, { key: "qty", label: t("doc.col.qty"), num: true, amount: true }, { key: "batches", label: t("plan.batches"), num: true }],
      rows: plan.byRecipe.map((r) => ({ name: r.name, qty: qty(L, r.qty), batches: r.batches === null ? "" : L.formatNumber(r.batches, { maximumFractionDigits: 2 }) })),
    });
    const sh = plan.shopping;
    sections.push(sh.rows.length ? {
      kind: "table", heading: t("plan.shopping"),
      columns: [{ key: "name", label: t("doc.col.ingredient"), primary: true }, { key: "need", label: t("plan.need"), num: true }, { key: "pk", label: t("plan.packages"), num: true }, { key: "cost", label: t("plan.buyCost"), num: true, amount: true }],
      rows: sh.rows.map((r) => ({ name: r.ingredient.name, need: amt(L, r.need, r.unit), pk: t("plan.pkgOf", { n: r.packages, size: amt(L, r.ingredient.pkgQty, r.ingredient.pkgUnit) }), cost: L.formatCurrency(r.buyMinor) })),
      total: { label: t("plan.buyTotal"), value: L.formatCurrency(sh.rows.reduce((s, r) => s + r.buyMinor, 0)) },
    } : { kind: "note", text: t("plan.noShopping") });
  }
  const notes = [];
  if (plan.inquiries) notes.push(L.tn("plan.inquiriesNote", plan.inquiries));
  if (plan.shopping.missing.length) notes.push(t("plan.missingNote", { n: plan.shopping.missing.length }));
  if (plan.shopping.unknownItems) notes.push(t("plan.unknownNote", { n: plan.shopping.unknownItems }));
  notes.push(t("plan.onHandNote"));
  return { id: "weekly-plan", title: t("doc.week.title"), period, sections, notes };
}

/** Aylik satis ozeti. s: logic/sales.js monthSummary. label: "November 2026". */
export function monthDoc(L, s, label) {
  const t = L.t;
  const sections = [{
    kind: "kv", heading: t("sales.summary"),
    rows: [
      [L.tn("sales.paidOrders", s.paid.count), L.formatCurrency(s.paid.totalMinor), true],
      [t("sales.cost"), L.formatCurrency(s.paid.costMinor)],
      [t("sales.profit"), L.formatCurrency(s.paid.profitMinor), true],
      [L.tn("sales.unpaid", s.unpaid.count), L.formatCurrency(s.unpaid.balanceMinor)],
      [L.tn("sales.deposits", s.deposits.count), L.formatCurrency(s.deposits.depositMinor)],
      [t("sales.cancelled"), String(s.cancelled)],
    ],
  }];
  if (s.byProduct.length) {
    sections.push({
      kind: "table", heading: t("sales.byProduct"),
      columns: [{ key: "name", label: t("doc.col.product"), primary: true }, { key: "qty", label: t("doc.col.qty"), num: true }, { key: "total", label: t("doc.col.amount"), num: true, amount: true }],
      rows: [...s.byProduct.map((p) => ({ name: p.name, qty: qty(L, p.qty), total: L.formatCurrency(p.totalMinor) })),
        ...(s.paid.extrasMinor ? [{ name: t("sales.extras"), qty: "", total: L.formatCurrency(s.paid.extrasMinor) }] : [])],
      total: { label: t("sales.sales"), value: L.formatCurrency(s.paid.totalMinor) },
    });
  }
  const list = s.orders.filter((o) => o.status !== "cancelled").sort((a, b) => a.date.localeCompare(b.date));
  sections.push(list.length ? {
    kind: "table", heading: t("sales.orders"),
    columns: [{ key: "date", label: t("doc.col.date"), primary: true, nowrap: true }, { key: "serial", label: t("order.number"), nowrap: true }, { key: "who", label: t("order.customer"), primary: true }, { key: "status", label: t("order.status"), nowrap: true }, { key: "total", label: t("doc.total"), num: true, amount: true }],
    rows: list.map((o) => ({ date: L.formatDate(o.date), serial: o.serial, who: o.customerName, status: t(`status.${o.status}`), total: L.formatCurrency(orderTotals(o).totalMinor) })),
  } : { kind: "empty", text: t("sales.empty") });
  const notes = [t("sales.ruleNote")];
  if (s.paid.unknownCost) notes.push(t("sales.unknownCostNote", { n: s.paid.unknownCost }));
  return { id: "monthly-sales", title: t("doc.month.title"), period: label, sections, notes };
}
