// Satislar ekrani: secili ayin ozeti (odenen satis, tahmini maliyet ve kar, teslim edilip odenmemis, alinan kapora, iptal), urun bazinda satis,
// ay gecisi, yazdirma (aylik satis ozeti) ve siparis CSV'si (muhasebeci / tablo icin; cihazda uretilir).
import { todayIso } from "../../../core/dates.js";
import { downloadText } from "../../../core/files.js";
import { toCsv } from "../../../core/backup.js";
import { formatMinorPlain } from "../../../core/money.js";
import { add, button, h, put, table } from "../../../core/ui.js";
import { orderTotals } from "../logic/orders.js";
import { monthOf, monthSummary, shiftMonth } from "../logic/sales.js";
import { monthDoc } from "../print/docs.js";
import { labels, printDoc } from "../print/screens.js";
import { loadAll, printButton } from "./common.js";

/** Tum siparisler CSV (her satir bir siparis). Tutarlar duz sayi (1234.50) ve ayrac dile gore. */
export function ordersCsv(ctx, orders) {
  const { t } = ctx.i18n;
  const dec = ctx.i18n.csv.decimal;
  const num = (m) => { const s = formatMinorPlain(m); return dec === "," ? s.replace(".", ",") : s; };
  const rows = [...orders].sort((a, b) => a.date.localeCompare(b.date)).map((o) => {
    const tt = orderTotals(o);
    return { serial: o.serial, date: o.date, time: o.time, customer: o.customerName, phone: o.phone, email: o.email, status: t(`status.${o.status}`),
      items: o.items.map((it) => `${it.qty} x ${it.name}`).join("; "), total: num(tt.totalMinor), deposit: num(tt.depositMinor), paid: num(tt.paidMinor), balance: num(tt.balanceMinor), note: o.note };
  });
  const cols = ["serial", "date", "time", "customer", "phone", "email", "status", "items", "total", "deposit", "paid", "balance", "note"].map((k) => ({ key: k, label: t(`csv.${k}`) }));
  let text = toCsv(rows, cols);
  if (ctx.i18n.csv.delimiter === ";") text = toCsvSemicolon(rows, cols);
  return "﻿" + text;
}
function toCsvSemicolon(rows, cols) {
  const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => cell(c.label)).join(";"), ...rows.map((r) => cols.map((c) => cell(r[c.key])).join(";"))].join("\r\n") + "\r\n";
}
export function exportOrdersCsv(ctx, orders) {
  if (!orders.length) { ctx.notify(ctx.i18n.t("sales.csvEmpty"), "warn"); return; }
  if (downloadText(`${ctx.config.fileSlug}-orders-${todayIso()}.csv`, ordersCsv(ctx, orders), "text/csv")) ctx.notify(ctx.i18n.t("sales.csvDone"), "success");
}

export async function mountSales(ctx, root, param) {
  const { t, tn, formatNumber } = ctx.i18n;
  let data = await loadAll(ctx);
  let ym = param && /^\d{4}-\d{2}$/.test(param) ? param : monthOf(todayIso());
  const head = h("div", { class: "page-head" });
  const nav = h("div", { class: "row week-nav" });
  const body = h("div", { class: "stack" });
  const monthLabel = () => { const [y, m] = ym.split("-").map(Number); return new Intl.DateTimeFormat(`${ctx.i18n.locale}-u-nu-latn`, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1)); };
  function paint() {
    const s = monthSummary(data, ym, data.costs);
    const f = ctx.money.format;
    put(head, h("div", {}, h("h2", { text: t("nav.sales") }), h("p", { class: "page-date", id: "sales-month", text: monthLabel() })));
    put(nav, 
      button({ id: "sales-prev", label: t("sales.prev"), icon: "prev", onClick: () => { ym = shiftMonth(ym, -1); paint(); } }),
      button({ id: "sales-this", label: t("sales.this"), onClick: () => { ym = monthOf(todayIso()); paint(); } }),
      button({ id: "sales-next", label: t("sales.next"), icon: "next", onClick: () => { ym = shiftMonth(ym, 1); paint(); } }),
      printButton(ctx, { id: "sales-print", label: t("sales.print"), onClick: () => printDoc(ctx, monthDoc(labels(ctx), s, monthLabel())) }),
      button({ id: "sales-csv", label: t("sales.csv"), glyph: "download", exportAction: true, onClick: () => exportOrdersCsv(ctx, data.orders) }));
    const kpi = (id, k, v, sub) => h("div", { class: "kpi", id }, h("span", { class: "stat-k", text: k }), h("strong", { class: "kpi-v", text: v }), sub ? h("span", { class: "muted", text: sub }) : null);
    put(body, 
      h("div", { class: "kpi-grid" },
        kpi("kpi-sales", t("sales.sales"), f(s.paid.totalMinor), tn("sales.paidOrders", s.paid.count)),
        kpi("kpi-profit", t("sales.profit"), f(s.paid.profitMinor), `${t("sales.cost")}: ${f(s.paid.costMinor)}`),
        kpi("kpi-unpaid", t("sales.toCollect"), f(s.unpaid.balanceMinor), tn("sales.unpaid", s.unpaid.count)),
        kpi("kpi-deposits", t("sales.depositsHeld"), f(s.deposits.depositMinor), tn("sales.deposits", s.deposits.count))),
      h("p", { class: "field-hint", text: t("sales.ruleNote") }),
      s.byProduct.length ? h("section", { class: "card stack", id: "sales-products" }, h("h3", { text: t("sales.byProduct") }), table({ caption: t("sales.byProduct"), columns: [
        { key: "name", label: t("doc.col.product") },
        { key: "qty", label: t("doc.col.qty"), align: "num", render: (r) => (r.qty === null ? "" : formatNumber(r.qty, { maximumFractionDigits: 3 })) },
        { key: "total", label: t("doc.col.amount"), align: "num", render: (r) => f(r.totalMinor) },
      ], rows: [...s.byProduct, ...(s.paid.extrasMinor ? [{ name: t("sales.extras"), qty: null, totalMinor: s.paid.extrasMinor, extra: true }] : [])],
      footer: h("tr", { class: "is-total", id: "sales-products-total" }, h("th", { scope: "row", colspan: "2", text: t("sales.sales") }), h("td", { class: "num", text: f(s.paid.totalMinor) })) })) : h("div", { class: "empty card" }, h("h3", { text: t("sales.empty") }), h("p", { class: "muted", text: t("sales.emptyHint") })),
      s.cancelled ? h("p", { class: "muted", text: `${t("sales.cancelled")}: ${s.cancelled}` }) : null);
  }
  async function reload() { data = await loadAll(ctx); paint(); }
  ctx.onExternalChange(reload);
  put(root, head, nav, body);
  paint();
}
