// Raporlar: aylik ozet, yillik kar-zarar (kategori bazli), kategori dokumu, kilometre kaydi. Ekranda onizleme + tek gecitten yazdirma
// (core/print.js requestPrint; iPhone ana ekran uygulamasinda PDF -> paylasim sayfasi) + muhasebeci icin CSV.
import { todayIso } from "../../../core/dates.js";
import { requestPrint } from "../../../core/print.js";
import { guardWrite } from "../../../core/safe.js";
import { button, h } from "../../../core/ui.js";
import { inRange, monthRange, yearRange, yearsOf } from "../logic/calc.js";
import { REPORTS, buildReport } from "../print/docs.js";
import { renderDoc } from "../print/render.js";
import { disclaimer, labels, loadData, selectField, fill } from "./common.js";
import { exportEntriesCsv } from "./entries.js";

const pick = { year: null, month: null };

export async function mountReports(ctx, root, param) {
  const { t } = ctx.i18n;
  const guard = guardWrite((e) => ctx.fail(e));
  const id = REPORTS.includes(param) ? param : "pl";

  const draw = async (focusSel) => {
    const data = await loadData(ctx);
    const today = todayIso();
    const cy = Number(today.slice(0, 4));
    const years = yearsOf([data.entries, data.trips], cy);
    const year = years.includes(pick.year) ? pick.year : cy;
    const month = pick.month ?? Number(today.slice(5, 7));
    const L = labels(ctx, data);
    const args = { entries: data.entries, trips: data.trips, year, month, rateMilli: data.ledger.rateMilli, now: new Date() };
    const doc = buildReport(id, L, args);
    const title = `${doc.title} · ${doc.period}`;

    const tabs = h("nav", { class: "report-tabs", "aria-label": t("reports.choose") },
      ...REPORTS.map((r) => h("a", { class: "chip", id: `report-tab-${r}`, href: `#/reports/${r}`, "aria-current": r === id ? "page" : "false", text: t(`reports.tab.${r}`) })));
    const yearSel = selectField({ id: "report-year", label: t("dash.year"), value: String(year), options: years.map((v) => ({ value: String(v), label: String(v) })), onChange: (v) => { pick.year = Number(v); draw("#report-year"); } });
    const monthSel = id === "month" ? selectField({ id: "report-month", label: t("report.month"), value: String(month), options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: L.monthName(i + 1) })), onChange: (v) => { pick.month = Number(v); draw("#report-month"); } }) : null;
    const range = id === "month" ? monthRange(year, month) : yearRange(year);

    const print = guard(async () => {
      await requestPrint(ctx, { title, build: (paper) => renderDoc(doc, paper), doc });
    }, "report-print");
    const csv = guard(async () => {
      if (id === "mileage") { ctx.navigate("mileage"); return; }
      exportEntriesCsv(ctx, data, data.entries.filter((e) => inRange(e.date, range)), range);
    }, "report-csv");

    fill(root, 
      h("div", { class: "screen-head" }, h("h2", { text: t("reports.title") }), h("p", { class: "muted biz-chip", text: data.business.name })),
      tabs,
      h("p", { class: "muted", id: "report-about", text: t(`reports.about.${id}`) }),
      h("div", { class: "row year-row" }, yearSel.element, monthSel ? monthSel.element : null),
      h("div", { class: "row action-row" },
        button({ id: "report-print", label: t("report.print"), variant: "primary", glyph: "print", exportAction: true, onClick: print }),
        button({ id: "report-csv", label: id === "mileage" ? t("report.mileageCsv") : t("csv.exportPeriod"), exportAction: true, onClick: csv })),
      h("p", { class: "muted", text: t("report.printHint") }),
      // Onizleme iki duzende: genis ekranda tablo, 480 px altinda blok duzeni (render.js rolls; yatay kirpma / kaydirma yok). Yazdirma degismez.
      h("div", { class: "card doc-preview", id: "report-preview", "data-report": id, "data-empty": doc.empty ? "1" : "0" },
        h("div", { class: "pv-wide" }, renderDoc(doc, "letter")), h("div", { class: "pv-narrow" }, renderDoc(doc, "thermal80"))),
      disclaimer(ctx));
    if (focusSel) root.querySelector(focusSel)?.focus();
  };
  await draw();
  ctx.onExternalChange(() => draw());
}
