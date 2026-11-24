// Gelir raporu (yazdirilabilir donem raporu): donem, ozet (gelir, bekleyen, randevu sayilari), hizmet bazli gelir, islem listesi.
// Belge govdesi core/print.js duzeniyle (rc-* sinifleri) kurulur; kullanici verisi yalniz metin dugumu olarak gider.
import { h } from "../../../core/ui.js";
import { revenueForRange } from "../logic/calc.js";
import { revenueByService } from "../logic/calc.js";
import { cashSummary, expensesByCategory, expensesInRange } from "../logic/expenses.js";
import { transactionRows } from "../logic/report.js";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, SERVICES } from "../logic/schema.js";

const cat = (ctx, k) => ctx.i18n.t(`exp.cat.${EXPENSE_CATEGORIES.includes(k) ? k : "other"}`);
const svc = (ctx, k) => (SERVICES.includes(k) ? ctx.i18n.t(`service.${k}`) : String(k ?? ""));

// data: { clients, pets, appointments }; range: { from, to }; periodLabel: "Bu ay" vb. (tum zamanlar: "Tum zamanlar")
export function buildReport(ctx, { data, range, periodLabel }) {
  const { t, formatDate, formatCurrency, formatNumber, formatPercent } = ctx.i18n;
  const sum = revenueForRange(data.appointments, range.from, range.to);
  const services = revenueByService(data.appointments, range);
  const rows = transactionRows(data, range.from, range.to);
  const cash = cashSummary(data.appointments, data.expenses, range.from, range.to);
  const expRows = expensesInRange(data.expenses, range.from, range.to);
  const cats = expensesByCategory(data.expenses, range.from, range.to);
  const isAll = range.from <= "0000-01-01";
  const span = isAll ? periodLabel : range.from === range.to ? formatDate(range.from, { dateStyle: "long" }) : `${formatDate(range.from, { dateStyle: "long" })} – ${formatDate(range.to, { dateStyle: "long" })}`;
  const kvRow = (k, v) => h("tr", {}, h("td", { text: k }), h("td", { class: "num", text: v }));
  const method = (m) => (m && PAYMENT_METHODS.includes(m) ? t(`payment.${m}`) : "");

  return h("div", { class: "rc-doc report-doc" },
    h("section", { class: "rc-copy" },
      h("div", { class: "rc-top" }, h("h2", { class: "rc-title", text: t("income.report.title") })),
      h("p", { class: "rc-date", text: `${t("income.report.period")}: ${span}` }),
      h("div", { class: "rc-sec" },
        h("h3", { text: t("income.report.summary") }),
        h("table", { class: "rc-totals" }, h("tbody", {},
          kvRow(t("income.total"), formatCurrency(sum.earnedMinor)),
          kvRow(t("income.pending"), formatCurrency(sum.outstandingMinor)),
          kvRow(t("income.booked"), formatCurrency(sum.bookedMinor)),
          kvRow(t("exp.total"), formatCurrency(cash.expensesMinor)),
          kvRow(t("cash.net"), formatCurrency(cash.netMinor)),
          kvRow(t("income.report.completed"), formatNumber(sum.completed)),
          kvRow(t("income.report.cancelled"), formatNumber(sum.cancelled)),
          kvRow(t("income.report.noShow"), formatNumber(sum.noShow))))),
      services.length
        ? h("div", { class: "rc-sec" },
            h("h3", { text: t("income.byService") }),
            h("table", { class: "rc-table" },
              h("thead", {}, h("tr", {}, h("th", { text: t("appt.service") }), h("th", { class: "num", text: "#" }), h("th", { class: "num", text: t("income.csv.amount") }), h("th", { class: "num", text: "%" }))),
              h("tbody", {}, services.map((r) => h("tr", {},
                h("td", { text: svc(ctx, r.service) }), h("td", { class: "num", text: formatNumber(r.count) }),
                h("td", { class: "num", text: formatCurrency(r.revenueMinor) }), h("td", { class: "num", text: formatPercent(Math.round(r.share * 1000) / 10) }))))))
        : null,
      h("div", { class: "rc-sec" },
        h("h3", { text: t("income.report.transactions") }),
        rows.length
          ? h("table", { class: "rc-table" },
              h("thead", {}, h("tr", {},
                h("th", { text: t("appt.date") }), h("th", { text: t("appt.client") }), h("th", { text: t("appt.pet") }), h("th", { text: t("appt.service") }),
                h("th", { class: "num", text: t("income.csv.amount") }), h("th", { text: t("appt.payment") }))),
              h("tbody", {}, rows.map((r) => h("tr", {},
                h("td", { text: formatDate(r.date) }), h("td", { text: r.client }), h("td", { text: r.pet }), h("td", { text: svc(ctx, r.service) }),
                h("td", { class: "num", text: formatCurrency(r.price) }),
                h("td", { text: r.paid ? `${t("payment.paid")}${method(r.method) ? ` · ${method(r.method)}` : ""}` : t("payment.pending") })))))
          : h("p", { class: "rc-note", text: t("income.noTransactions") })),
      h("div", { class: "rc-sec" },
        h("h3", { text: t("fin.tab.expenses") }),
        expRows.length
          ? h("div", {},
              h("table", { class: "rc-table" },
                h("thead", {}, h("tr", {},
                  h("th", { text: t("appt.date") }), h("th", { text: t("exp.category") }), h("th", { text: t("exp.description") }),
                  h("th", { text: t("appt.paymentMethod") }), h("th", { class: "num", text: t("exp.amount") }))),
                h("tbody", {}, expRows.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((e) => h("tr", {},
                  h("td", { text: formatDate(e.date) }), h("td", { text: cat(ctx, e.category) }), h("td", { text: e.description ?? "" }),
                  h("td", { text: method(e.paymentMethod) }), h("td", { class: "num", text: formatCurrency(e.amount) })))),
                h("tfoot", {}, h("tr", {}, h("th", { colspan: "4", text: t("exp.total") }), h("th", { class: "num", text: formatCurrency(cash.expensesMinor) })))),
              h("p", { class: "rc-note", text: cats.map((c) => `${cat(ctx, c.category)}: ${formatCurrency(c.totalMinor)}`).join(" · ") }))
          : h("p", { class: "rc-note", text: t("exp.empty") })),
      h("p", { class: "rc-note", text: t("cash.pendingNote") }),
      h("p", { class: "rc-note", text: t("income.report.generated", { date: formatDate(new Date(), { dateStyle: "long" }) }) })));
}

export async function printIncomeReport(ctx, args) {
  const paper = (await ctx.pet.get()).paper;
  // 80 mm fis rulosu bu genis tablo icin uygun degil: dile gore Letter / A4.
  const page = paper === "thermal80" ? (ctx.settings.lang === "en" ? "letter" : "a4") : paper;
  await ctx.print({ title: ctx.i18n.t("print.reportTitle"), node: buildReport(ctx, args), paper: page });
}
