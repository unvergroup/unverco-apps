// Yazdirma tetikleri: her belge TEK kapidan (core/print.js requestPrint) gecer. Model (docs.js) hem DOM'a hem PDF'e gider.
import { requestPrint } from "../../../core/print.js";
import { renderDoc } from "./render.js";

/** Belge modeli kurmak icin dil yardimcilari. */
export function labels(ctx) {
  const i = ctx.i18n;
  const time = (hhmm) => {
    if (!/^\d{2}:\d{2}$/.test(hhmm ?? "")) return "";
    const [hh, mm] = hhmm.split(":").map(Number);
    return new Intl.DateTimeFormat(`${i.locale}-u-nu-latn`, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hh, mm));
  };
  return { t: i.t, tn: i.tn, formatDate: i.formatDate, formatCurrency: i.formatCurrency, formatNumber: i.formatNumber, formatPercent: i.formatPercent, time, unit: (u) => i.t(`unit.${u}`) };
}

export const printDoc = (ctx, doc) => requestPrint(ctx, { title: doc.title, build: (paper) => renderDoc(doc, paper), doc });
