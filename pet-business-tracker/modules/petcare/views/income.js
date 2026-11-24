// Gelir ekrani: donem secici (Bugun / Bu hafta / Bu ay / Tum zamanlar), buyuk toplam gelir, hizmet bazli yatay cubuklar (yalniz CSS),
// odenen - bekleyen dagilimi, son islemler tablosu ve ozet kartlari (toplam randevu, benzersiz musteri, ortalama bilet).
// "CSV indir": secili donemin tamamlanan randevulari (Blob + indirme, cihazda; muhasebeci icin). "Raporu yazdir": ayni donemin yazdirilabilir raporu.
// Gelir kurali (logic/calc.js): tamamlanmis + odenmis randevular = tahsil edilen; tamamlanmis ama odenmemisler "odeme bekleyen";
// henuz tamamlanmamis (planlandi / onaylandi / devam ediyor) randevular "planlanan" (booked) olarak AYRI gosterilir, hicbir tutar ekrandan kaybolmaz.
// Ekran uc bolumludur: Gelir | Giderler | Kasa (alt gezinme 6 sekmede kalir; 7. sekme 320 px'e sigmaz). Donem secici ucunde ortaktir.
import { addDays, daysInMonth, startOfWeek, toIso, todayIso } from "../../../core/dates.js";
import { downloadText } from "../../../core/files.js";
import { roundDiv } from "../../../core/money.js";
import { button, createTabs, emptyState, h, table } from "../../../core/ui.js";
import { revenueByService, revenueForRange } from "../logic/calc.js";
import { PAYMENT_METHODS } from "../logic/schema.js";
import { csvFileName, csvText, transactionRows } from "../logic/report.js";
import { printIncomeReport } from "../print/report.js";
import { loadAll, openAppointmentDetail, serviceName } from "./common.js";
import { buildCashView, buildExpensesView, exportExpensesCsv, openExpenseForm } from "./expenses.js";

const PERIODS = ["today", "week", "month", "all"];
const VIEWS = ["income", "expenses", "cash"];
const RECENT = 15;

export function periodRange(period, today = todayIso()) {
  if (period === "today") return { from: today, to: today };
  if (period === "week") { const s = startOfWeek(today, 0); return { from: s, to: addDays(s, 6) }; }
  if (period === "month") { const [y, m] = today.split("-").map(Number); return { from: toIso(y, m, 1), to: toIso(y, m, daysInMonth(y, m)) }; }
  return { from: "0000-01-01", to: "9999-12-31" };
}

// Cubuk: genislik CSSOM ile (--w); satir ici stil metni yok (CSP).
const bar = (pct, cls = "") => {
  const fill = h("span", { class: `bar-fill ${cls}`.trim() });
  fill.style.setProperty("--w", `${Math.max(0, Math.min(100, pct))}%`);
  return h("span", { class: "bar", "aria-hidden": "true" }, fill);
};

export async function mountIncome(ctx, root) {
  const { t, tn, formatNumber, formatPercent, formatDate } = ctx.i18n;
  const fmt = ctx.money.format;
  const state = { period: "month", view: "income" };
  let data = await loadAll(ctx);
  const chips = h("div", { class: "chips", role: "group", "aria-label": t("income.period") });

  // Secili donem icin CSV (virgullu ondalik dillerde ";" ayiracli, Excel icin UTF-8 BOM'lu)
  function exportCsv() {
    const range = periodRange(state.period);
    const rows = transactionRows(data, range.from, range.to);
    if (!rows.length) { ctx.notify(t("income.exportEmpty"), "warn"); return; }
    const text = csvText(rows, {
      headers: { date: t("appt.date"), time: t("appt.time"), client: t("appt.client"), pet: t("appt.pet"), service: t("appt.service"), amount: t("income.csv.amount"), status: t("appt.payment"), method: t("appt.paymentMethod") },
      delimiter: ctx.i18n.csv.delimiter, decimal: ctx.i18n.csv.decimal, yes: t("payment.paid"), no: t("payment.pending"),
      serviceLabel: (k) => serviceName(ctx, k), methodLabel: (k) => (PAYMENT_METHODS.includes(k) ? t(`payment.${k}`) : k),
    });
    if (downloadText(csvFileName(range.from, range.to, ctx.config.fileSlug), text, "text/csv")) ctx.notify(t("income.csvDone"), "success");
  }
  const printReport = () => printIncomeReport(ctx, { data, range: periodRange(state.period), periodLabel: t(`income.period.${state.period}`) });
  const reportBtn = () => button({ id: "income-report", glyph: "print", label: t("income.printReport"), exportAction: true, onClick: printReport });
  const actions = h("div", { class: "row income-actions" });
  function paintActions() {
    if (state.view === "expenses") {
      actions.replaceChildren(
        button({ id: "expense-add", variant: "primary", label: t("exp.add"), onClick: addExpense }),
        button({ id: "expense-csv", label: `⬇ ${t("exp.exportCsv")}`, exportAction: true, onClick: () => exportExpensesCsv(ctx, { data, range: periodRange(state.period) }) }));
    } else if (state.view === "cash") actions.replaceChildren(reportBtn());
    else actions.replaceChildren(button({ id: "income-csv", label: `⬇ ${t("income.exportCsv")}`, exportAction: true, onClick: exportCsv }), reportBtn());
  }
  async function addExpense() {
    const r = await openExpenseForm(ctx, {});
    if (r.saved) await reload("#expense-add", r.date);
  }
  const body = h("div", { class: "stack income-body" });

  function paint() {
    const range = periodRange(state.period);
    chips.replaceChildren(...PERIODS.map((p) => h("button", { type: "button", class: "chip", id: `period-${p}`, "aria-pressed": String(state.period === p), text: t(`income.period.${p}`), on: { click: () => { state.period = p; paint(); document.getElementById(`period-${p}`)?.focus(); } } })));
    if (state.view === "expenses") { body.replaceChildren(...buildExpensesView(ctx, { data, range, reload })); return; }
    if (state.view === "cash") { body.replaceChildren(...buildCashView(ctx, { data, range })); return; }
    paintIncome(range);
  }

  function paintIncome(range) {
    const sum = revenueForRange(data.appointments, range.from, range.to);
    const services = revenueByService(data.appointments, range);
    const inRange = data.appointments.filter((a) => a.date >= range.from && a.date <= range.to);
    const clients = new Set(inRange.filter((a) => a.status !== "cancelled").map((a) => a.clientId));
    const paidCount = services.reduce((s, r) => s + r.count, 0);
    const average = paidCount ? roundDiv(sum.earnedMinor, paidCount) : 0;
    const billed = sum.earnedMinor + sum.outstandingMinor;

    const stat = (label, value) => h("div", { class: "stat" }, h("span", { class: "stat-label", text: label }), h("span", { class: "stat-value", text: value }));
    const serviceRows = services.length
      ? h("ul", { class: "bars", "aria-label": t("income.byService") }, ...services.map((r) => h("li", { class: "bar-row" },
          h("span", { class: "bar-label", text: serviceName(ctx, r.service) }),
          bar(r.share * 100),
          h("span", { class: "bar-value", text: `${fmt(r.revenueMinor)} · ${formatPercent(Math.round(r.share * 1000) / 10)}` }))))
      : h("p", { class: "muted", text: t("income.noServiceData") });

    const txns = inRange.filter((a) => a.status === "completed").sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)).slice(0, RECENT);
    const recent = txns.length
      ? table({
        caption: t("income.recent"),
        columns: [
          { key: "date", label: t("appt.date"), nowrap: true, render: (a) => formatDate(a.date) },
          { key: "client", label: t("appt.client"), render: (a) => h("button", { type: "button", class: "link-btn", "aria-label": `${data.cById.get(a.clientId)?.name ?? ""}, ${formatDate(a.date)}`, text: data.cById.get(a.clientId)?.name ?? t("common.unknown"), on: { click: () => openAppointmentDetail(ctx, a.id, reload) } }) },
          { key: "service", label: t("appt.service"), narrowHide: false, render: (a) => serviceName(ctx, a.service) },
          { key: "price", label: t("appt.price"), align: "num", render: (a) => fmt(a.price) },
          { key: "paid", label: t("appt.payment"), render: (a) => h("span", { class: `badge ${a.paid ? "badge-ok" : "badge-warn"}`, text: a.paid ? t("payment.paid") : t("payment.pending") }) },
        ],
        rows: txns,
      })
      : emptyState({ title: t("income.noTransactions") });

    // Gorsel hiyerarsi: EN ONEMLI rakam (tahsil edilen) en buyuk kahraman kartta; odeme bekleyen ve planlanan
    // ayni olcude iki ikincil kartta yan yana. Hicbir tutar ekrandan kaybolmaz.
    const appts = (n) => tn("income.bookedCount", n, { n: formatNumber(n) }); // "{n} appointments" (genel sayac metni)
    const moneyCard = ({ id, label, value, valueId, note, hint, cls }) => h("section", { class: `card money-card${cls ? " " + cls : ""}`, id, "aria-label": label },
      h("p", { class: "money-label", text: label }),
      h("p", { class: "money-value", id: valueId, text: value }),
      note ? h("p", { class: "money-sub", id: `${valueId}-count`, text: note }) : null,
      hint ? h("p", { class: "money-hint", text: hint }) : null);

    // Donemde hic para hareketi yok: "0" demekle yetinilmez, ne yapilacagi soylenir (cubuklar / bos tablolar gosterilmez).
    const allZero = sum.earnedMinor === 0 && sum.outstandingMinor === 0 && sum.bookedMinor === 0;
    const emptyAll = emptyState({ title: t("income.emptyAll.title"), text: t("income.emptyAll.text") });
    emptyAll.id = "income-empty-all";

    // replaceChildren(null) "null" METNI yazar: bos (null) ogeler suzulur.
    body.replaceChildren(...[
      h("section", { class: "card income-hero", "aria-label": t("income.total") },
        h("p", { class: "money-label", text: t("income.total") }),
        h("p", { class: "income-total", id: "income-total", text: fmt(sum.earnedMinor) }),
        paidCount ? h("p", { class: "money-sub", text: appts(paidCount) }) : null),
      h("div", { class: "money-grid" },
        moneyCard({ id: "income-pending-card", label: t("income.pending"), value: fmt(sum.outstandingMinor), valueId: "income-pending", hint: t("cash.pendingNote"), cls: "is-pending" }),
        moneyCard({ id: "income-booked-card", label: t("income.booked"), value: fmt(sum.bookedMinor), valueId: "income-booked", note: appts(sum.bookedCount), hint: sum.bookedCount ? t("income.bookedHint") : null, cls: "booked-card" })),
      h("p", { class: "income-note", id: "income-note", text: t("income.note") }),
      sum.completed === 0 && sum.bookedCount > 0
        ? h("p", { class: "banner", id: "income-empty-booked", role: "status", text: t("income.emptyBooked", { amount: fmt(sum.bookedMinor), count: appts(sum.bookedCount) }) })
        : null,
      allZero ? emptyAll : null,
      allZero ? null : h("section", { class: "card stack", "aria-label": t("income.paymentStatus") },
        h("h3", { text: t("income.paymentStatus") }),
        h("ul", { class: "bars" },
          h("li", { class: "bar-row" }, h("span", { class: "bar-label", text: t("income.paid") }), bar(billed ? (sum.earnedMinor / billed) * 100 : 0, "bar-ok"), h("span", { class: "bar-value", text: fmt(sum.earnedMinor) })),
          h("li", { class: "bar-row" }, h("span", { class: "bar-label", text: t("income.pending") }), bar(billed ? (sum.outstandingMinor / billed) * 100 : 0, "bar-warn"), h("span", { class: "bar-value", text: fmt(sum.outstandingMinor) })))),
      allZero ? null : h("section", { class: "card stack", "aria-label": t("income.byService") }, h("h3", { text: t("income.byService") }), serviceRows),
      allZero ? null : h("div", { class: "stat-grid" },
        stat(t("income.stat.appointments"), formatNumber(sum.count)),
        stat(t("income.stat.clients"), formatNumber(clients.size)),
        stat(t("income.stat.average"), fmt(average))),
      allZero ? null : h("section", { class: "stack", "aria-label": t("income.recent") }, h("h3", { text: t("income.recent") }), recent)].filter(Boolean));
  }

  // reload(focusSel?, savedDate?): verileri yeniden okur. Kaydedilen gider secili donemin disindaysa tum kayitlar gosterilir (kayit "kayboldu" sanilmasin).
  async function reload(focusSel, savedDate) {
    data = await loadAll(ctx);
    if (typeof savedDate === "string") {
      const r = periodRange(state.period);
      if (savedDate < r.from || savedDate > r.to) { state.period = "all"; ctx.notify(t("exp.shownAll"), "info"); }
    }
    paint();
    if (typeof focusSel === "string") document.querySelector(focusSel)?.focus();
  }
  ctx.onExternalChange(() => reload());
  const tabs = createTabs({
    items: VIEWS.map((v) => ({ id: v, label: t(`fin.tab.${v}`) })), selected: state.view, label: t("fin.tabs"),
    onSelect: (v) => { state.view = v; paintActions(); paint(); },
  });
  tabs.element.classList.add("fin-tabs");
  root.replaceChildren(h("h2", { text: t("fin.title") }), tabs.element, chips, actions, body);
  paintActions();
  paint();
}
