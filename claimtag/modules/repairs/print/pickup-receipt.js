// Teslim fisi (spec 5, CT-18) ve hesap dokumu / invoice (CT-19). Tek sayfa; ic not, maliyet, kar, tedarikci, haber notu, gecmis basilmaz.
// Garanti satiri yalniz warrantyDays > 0 iken; "No warranty" satiri yoktur. Kullanici verisi yalniz h() / textContent.
import { h } from "../../../core/ui.js";
import { calcJob } from "../logic/calc.js";
import { lineNetMinor, lineTaxMinor } from "../../../core/line-items.js";
import { deviceTitle, deviceLine } from "../views/common.js";
import { kv, sec, testsGrid } from "./receipt.js";
import { invoiceDoc, slipDoc } from "./docs.js";

const partName = (t, l) => (l.kind === "part" && l.partType !== "unspecified" ? `${l.name} (${t(`repairs.part.${l.partType}`)})` : l.name);

function header(ctx, title, job) {
  const { t, formatDate } = ctx.i18n;
  return [
    h("div", { class: "rc-top" },
      h("div", {}, h("p", { class: "rc-title", text: title }), h("p", { class: "rc-ticket", text: job.number })),
      h("div", { class: "rc-right" },
        h("p", { class: "rc-date", text: `${t("repairs.doc.received")}: ${formatDate(job.receivedDate)}` }),
        job.handedOverDate ? h("p", { class: "rc-date", text: `${t("repairs.doc.pickedUp")}: ${formatDate(job.handedOverDate)}` }) : null)),
  ];
}

function customerSec(ctx, { customer, device }) {
  const { t } = ctx.i18n;
  return sec("", kv([[t("repairs.checkin.customer"), customer?.name], [t("repairs.checkin.phone"), customer?.phone], [t("repairs.checkin.device"), device ? `${deviceTitle(ctx, device)}${device.serial ? ` · ${device.serial}` : ""}` : ""]]));
}

function totalsTable(ctx, job, { showPaid = true } = {}) {
  const { t, formatCurrency } = ctx.i18n;
  const calc = calcJob(job);
  const row = (k, v, cls) => h("tr", { class: cls }, h("td", { text: k }), h("td", { class: "num", text: v }));
  const rows = [row(t("repairs.totals.total"), formatCurrency(calc.totalMinor), "is-total")];
  if (showPaid) {
    rows.push(row(t("repairs.totals.paid"), formatCurrency(calc.paidMinor)));
    const text = calc.display.kind === "overpaid" ? t("repairs.totals.overpaid", { amount: formatCurrency(calc.display.amountMinor) })
      : calc.display.kind === "deposit" ? t("repairs.totals.depositOnFile", { amount: formatCurrency(calc.display.amountMinor) })
        : t("repairs.totals.balanceDue", { amount: formatCurrency(calc.display.amountMinor) });
    rows.push(h("tr", { class: "is-total" }, h("td", { colspan: 2, text: text })));
  }
  return h("table", { class: "rc-totals" }, h("tbody", {}, ...rows));
}

export function buildSlip(ctx, data, ct) {
  const { t, formatDate } = ctx.i18n;
  const { job } = data;
  const warranty = job.warrantyDays > 0 && job.warrantyEnd;
  const out = h("div", { class: "rc-doc" }, h("div", { class: "rc-copy" },
    ...header(ctx, t(warranty ? "repairs.doc.slipWarranty" : "repairs.doc.slip"), job),
    customerSec(ctx, data),
    sec(t("repairs.doc.workDone"), (job.lines ?? []).length ? h("ul", { class: "rc-list" }, (job.lines ?? []).map((l) => h("li", { text: partName(t, l) }))) : h("p", { class: "rc-text", text: t("repairs.tests.notRecorded") }), totalsTable(ctx, job)),
  ));
  const copyEl = out.firstChild;
  const items = job.tests?.items ?? [];
  if (items.length) {
    copyEl.append(sec(t("repairs.pickup.testsTitle"),
      h("table", { class: "rc-table" },
        h("thead", {}, h("tr", {}, h("th", { text: "" }), h("th", { text: t("repairs.tests.before") }), h("th", { text: t("repairs.tests.after") }))),
        h("tbody", {}, items.map((i) => h("tr", {},
          h("td", { text: t(`repairs.test.${i.key}`) }),
          h("td", { text: i.before ? t(`repairs.tests.val.${i.before}`) : t("repairs.tests.notRecorded") }),
          h("td", { text: i.after ? t(`repairs.tests.val.${i.after}`) : t("repairs.tests.notRecorded") }))))),
      job.customerTested ? h("p", { class: "rc-note", text: t("repairs.doc.tried", { answer: t(`repairs.yn.${job.customerTested}`) }) }) : null));
  } else if (job.customerTested) {
    copyEl.append(sec("", h("p", { class: "rc-note", text: t("repairs.doc.tried", { answer: t(`repairs.yn.${job.customerTested}`) }) })));
  }
  if (warranty) copyEl.append(sec("", h("p", { class: "rc-text", text: t("repairs.doc.warranty", { n: job.warrantyDays, date: formatDate(job.warrantyEnd) }) })));
  if (ct.termsWarranty) copyEl.append(sec(t("repairs.doc.terms"), h("p", { class: "rc-terms", text: ct.termsWarranty })));
  copyEl.append(h("div", { class: "rc-sign" }, h("div", { text: t("repairs.doc.sigCustomer") }), h("div", { text: t("repairs.doc.date") })));
  return out;
}

export function buildInvoice(ctx, data, ct) {
  const { t, formatCurrency, formatPercent } = ctx.i18n;
  const { job } = data;
  const rows = (job.lines ?? []).map((l) => {
    const net = lineNetMinor(l);
    const tax = lineTaxMinor(l);
    return h("tr", {},
      h("td", { text: partName(t, l) }),
      h("td", { class: "num", text: ctx.i18n.formatNumber(l.qty, { maximumFractionDigits: 3 }) }),
      h("td", { class: "num", text: formatCurrency(l.unitMinor) }),
      h("td", { class: "num", text: l.taxRate === null ? "" : formatPercent(l.taxRate) }),
      h("td", { class: "num", text: formatCurrency(net + tax) }));
  });
  const calc = calcJob(job);
  const trow = (k, v) => h("tr", {}, h("td", { text: k }), h("td", { class: "num", text: v }));
  const totals = h("table", { class: "rc-totals" }, h("tbody", {},
    trow(t("repairs.totals.subtotal"), formatCurrency(calc.subtotalMinor)),
    calc.taxMinor ? trow(t("repairs.totals.tax"), formatCurrency(calc.taxMinor)) : null,
    h("tr", { class: "is-total" }, h("td", { text: t("repairs.totals.total") }), h("td", { class: "num", text: formatCurrency(calc.totalMinor) })),
    calc.paidMinor ? trow(t("repairs.totals.paid"), formatCurrency(calc.paidMinor)) : null));
  const balance = calc.display.kind === "overpaid" ? t("repairs.totals.overpaid", { amount: formatCurrency(calc.display.amountMinor) })
    : calc.display.kind === "deposit" ? t("repairs.totals.depositOnFile", { amount: formatCurrency(calc.display.amountMinor) })
      : t("repairs.totals.balanceDue", { amount: formatCurrency(calc.display.amountMinor) });
  return h("div", { class: "rc-doc" }, h("div", { class: "rc-copy" },
    ...header(ctx, t("repairs.doc.invoice"), job),
    customerSec(ctx, data),
    h("table", { class: "rc-table" },
      h("thead", {}, h("tr", {}, h("th", { text: t("repairs.lines.name") }), h("th", { class: "num", text: t("repairs.lines.qty") }), h("th", { class: "num", text: t("lineitems.unitPrice") }), h("th", { class: "num", text: t("repairs.lines.tax") }), h("th", { class: "num", text: t("lineitems.lineTotal") }))),
      h("tbody", {}, rows)),
    totals,
    h("p", { class: "rc-total-line", text: balance }),
    h("p", { class: "rc-note", text: t("repairs.doc.invoiceNote") })));
}

export async function printSlip(ctx, data) {
  const ct = await ctx.ct.get();
  await ctx.print({ title: data.job.number, node: buildSlip(ctx, data, ct), paper: ct.paper, doc: slipDoc(ctx, data, ct) });
}
export async function printInvoice(ctx, data) {
  const ct = await ctx.ct.get();
  await ctx.print({ title: data.job.number, node: buildInvoice(ctx, data, ct), paper: ct.paper, doc: invoiceDoc(ctx, data, ct) });
}
