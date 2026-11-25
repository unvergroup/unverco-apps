// Her yazdirma: belge modelini kurar (docs.js), cizer (render.js) ve yazdirmayi TEK KAPIDAN (core/print.js requestPrint) ister.
import { requestPrint } from "../../../core/print.js";
import { buildAttendanceDoc, buildPortfolioDoc, buildReadingDoc, buildRecordDoc, buildSubjectsDoc, buildWeekDoc } from "./docs.js";
import { renderDoc } from "./render.js";
import { ATT_KINDS, BOOK_STATUS } from "../logic/schema.js";

// Sure metni: 0 -> "0 min", 45 -> "45 min", 90 -> "1 h 30 min", 120 -> "2 h".
export function durText(t, formatNumber, min) {
  const n = Math.max(0, Math.round(min || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return t("hs.dur.m", { m: formatNumber(m) });
  return m ? t("hs.dur.hm", { h: formatNumber(h), m: formatNumber(m) }) : t("hs.dur.h", { h: formatNumber(h) });
}

export function labels(ctx) {
  const { t, tn, formatDate, formatNumber, formatCurrency } = ctx.i18n;
  return {
    t, tn, formatDate, formatNumber, formatCurrency,
    dur: (min) => durText(t, formatNumber, min),
    kind: (k) => (ATT_KINDS.includes(k) ? t(`hs.att.${k}`) : "—"),
    status: (k) => t(`hs.book.st.${BOOK_STATUS.includes(k) ? k : "toread"}`),
  };
}

const go = (ctx, doc) => requestPrint(ctx, { title: doc.title, build: (paper) => renderDoc(doc, paper), doc });

export const printWeek = (ctx, o) => go(ctx, buildWeekDoc(labels(ctx), o));
export const printAttendance = (ctx, o) => go(ctx, buildAttendanceDoc(labels(ctx), o));
export const printSubjects = (ctx, o) => go(ctx, buildSubjectsDoc(labels(ctx), o));
export const printReading = (ctx, o) => go(ctx, buildReadingDoc(labels(ctx), o));
export const printPortfolio = (ctx, o) => go(ctx, buildPortfolioDoc(labels(ctx), o));
export const printRecord = (ctx, o) => go(ctx, buildRecordDoc(labels(ctx), o));
