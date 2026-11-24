// Her ekranin yazdir islevi: belge modelini kurar (docs.js), cizer (render.js) ve yazdirmayi TEK KAPIDAN (core/print.js requestPrint) ister.
import { todayIso } from "../../../core/dates.js";
import { requestPrint } from "../../../core/print.js";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, SERVICES } from "../logic/schema.js";
import { fmtTime } from "../views/common.js";
import { buildCalendarDoc, buildCashDoc, buildClientsDoc, buildExpensesDoc, buildIncomeDoc, buildRemindersDoc, buildTodayDoc } from "./docs.js";
import { renderDoc } from "./render.js";

// Belge etiket yardimcilari (i18n + bilinmeyen anahtar icin guvenli geri donus).
export function labels(ctx) {
  const { t, tn, formatDate, formatCurrency, formatNumber, formatPercent } = ctx.i18n;
  return {
    t, tn, formatDate, formatCurrency, formatNumber, formatPercent,
    time: (hhmm) => fmtTime(ctx, hhmm),
    service: (k) => (SERVICES.includes(k) ? t(`service.${k}`) : String(k ?? "")),
    category: (k) => t(`exp.cat.${EXPENSE_CATEGORIES.includes(k) ? k : "other"}`),
    method: (k) => (k && PAYMENT_METHODS.includes(k) ? t(`payment.${k}`) : ""),
  };
}

const go = (ctx, doc) => requestPrint(ctx, { title: doc.title, build: (paper) => renderDoc(doc, paper), doc });

export const printToday = (ctx, { data, today = todayIso() }) => go(ctx, buildTodayDoc(labels(ctx), { data, today }));
export const printCalendar = (ctx, { data, sel, mode }) => go(ctx, buildCalendarDoc(labels(ctx), { data, sel, mode }));
export const printClients = (ctx, { data, clients, query }) => go(ctx, buildClientsDoc(labels(ctx), { data, clients, query }));
export const printReminders = (ctx, { data, filter, today = todayIso() }) => go(ctx, buildRemindersDoc(labels(ctx), { data, today, filter }));
export const printIncomeReport = (ctx, { data, range, periodLabel }) => go(ctx, buildIncomeDoc(labels(ctx), { data, range, periodLabel }));
export const printExpenses = (ctx, { data, range, periodLabel }) => go(ctx, buildExpensesDoc(labels(ctx), { data, range, periodLabel }));
export const printCash = (ctx, { data, range, periodLabel }) => go(ctx, buildCashDoc(labels(ctx), { data, range, periodLabel }));
