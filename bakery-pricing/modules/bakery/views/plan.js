// Plan ekrani: secili haftanin (onayli + hazirlanan) siparisleri, urun bazinda uretim adedi / parti sayisi ve malzeme alisveris listesi.
// Hafta gecisi (onceki / bu hafta / sonraki), yazdirma (haftalik uretim ve alisveris listesi).
import { addDays, isIsoDate, todayIso } from "../../../core/dates.js";
import { add, button, h, put, table } from "../../../core/ui.js";
import { weekPlan, weekRange } from "../logic/plan.js";
import { weekDoc } from "../print/docs.js";
import { labels, printDoc } from "../print/screens.js";
import { loadAll, printButton, qtyText } from "./common.js";
import { orderCard, openOrderDetail } from "./orders.js";

export async function mountPlan(ctx, root, param) {
  const { t, tn, formatDate, formatNumber } = ctx.i18n;
  let data = await loadAll(ctx);
  let anchor = param && isIsoDate(param) ? param : todayIso();
  const head = h("div", { class: "page-head" });
  const body = h("div", { class: "stack" });
  const nav = h("div", { class: "row week-nav" });
  function paint() {
    const range = weekRange(anchor, ctx.i18n.locale);
    const p = weekPlan(data, range);
    put(head, h("div", {}, h("h2", { text: t("nav.plan") }), h("p", { class: "page-date", id: "plan-range", text: `${formatDate(range.from, { dateStyle: "medium" })} – ${formatDate(range.to, { dateStyle: "medium" })}` })),
      h("p", { class: "count-pill", role: "status", text: tn("plan.count", p.orders.length) }));
    put(nav, 
      button({ id: "plan-prev", label: t("plan.prev"), icon: "prev", onClick: () => { anchor = addDays(anchor, -7); paint(); } }),
      button({ id: "plan-this", label: t("plan.this"), onClick: () => { anchor = todayIso(); paint(); } }),
      button({ id: "plan-next", label: t("plan.next"), icon: "next", onClick: () => { anchor = addDays(anchor, 7); paint(); } }),
      printButton(ctx, { id: "plan-print", label: t("plan.print"), onClick: () => printDoc(ctx, weekDoc(labels(ctx), p)) }));
    const parts = [];
    if (p.inquiries) parts.push(h("p", { class: "banner banner-info", id: "plan-inquiries", text: tn("plan.inquiriesNote", p.inquiries) }));
    if (!p.orders.length) { put(body, ...parts, h("div", { class: "empty card" }, h("h3", { text: t("plan.empty") }), h("p", { class: "muted", text: t("plan.emptyHint") }))); return; }
    parts.push(h("section", { class: "card stack", id: "plan-production" }, h("h3", { text: t("plan.production") }),
      table({ caption: t("plan.production"), columns: [
        { key: "name", label: t("doc.col.product") },
        { key: "qty", label: t("doc.col.qty"), align: "num", render: (r) => formatNumber(r.qty, { maximumFractionDigits: 3 }) },
        { key: "batches", label: t("plan.batches"), align: "num", render: (r) => (r.batches === null ? "—" : formatNumber(r.batches, { maximumFractionDigits: 2 })) },
      ], rows: p.byRecipe })));
    const sh = p.shopping;
    const shop = h("section", { class: "card stack", id: "plan-shopping" }, h("h3", { text: t("plan.shopping") }), h("p", { class: "muted", text: t("plan.onHandNote") }));
    if (sh.rows.length) {
      add(shop, table({ caption: t("plan.shopping"), columns: [
        { key: "name", label: t("doc.col.ingredient"), render: (r) => r.ingredient.name },
        { key: "need", label: t("plan.need"), align: "num", render: (r) => qtyText(ctx, r.need, r.unit) },
        { key: "pk", label: t("plan.packages"), align: "num", render: (r) => t("plan.pkgOf", { n: r.packages, size: qtyText(ctx, r.ingredient.pkgQty, r.ingredient.pkgUnit) }) },
        { key: "cost", label: t("plan.buyCost"), align: "num", render: (r) => ctx.money.format(r.buyMinor) },
      ], rows: sh.rows }), h("p", { class: "total-line", id: "plan-buy-total", text: `${t("plan.buyTotal")}: ${ctx.money.format(sh.rows.reduce((s, r) => s + r.buyMinor, 0))}` }));
    } else add(shop, h("p", { class: "muted", text: t("plan.noShopping") }));
    if (sh.missing.length) add(shop, h("p", { class: "banner banner-warn", id: "plan-missing", text: t("plan.missingNote", { n: sh.missing.length }) }));
    if (sh.unknownItems) add(shop, h("p", { class: "field-hint", text: t("plan.unknownNote", { n: sh.unknownItems }) }));
    parts.push(shop);
    parts.push(h("section", { class: "stack", id: "plan-orders" }, h("h3", { text: t("plan.orders") }), h("div", { class: "card-list" }, ...p.orders.map((o) => orderCard(ctx, o, { onOpen: (x) => openOrderDetail(ctx, x.id, reload) })))));
    put(body, ...parts);
  }
  async function reload() { data = await loadAll(ctx); paint(); }
  ctx.onExternalChange(reload);
  put(root, head, nav, body);
  paint();
}
