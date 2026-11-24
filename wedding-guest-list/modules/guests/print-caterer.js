// Print > Caterer sheet (U8): the counts table for the caterer (spec 5 (c), design baski-ciktilari.md section 5).
// Data comes from logic/counts.js `catererSheet` (nothing is counted here). Page: doc-letter / doc-a4 (@page margin 0 so the browser prints no
// header / footer with the local file path; the 12.7 mm margin is inside the page: .doc padding, a repeated empty row in thead and in tfoot,
// and a footnote box at the bottom of every page).
// User text (couple's names, meal names) only through h() / textContent; names sit in <bdi>.
import { h } from "../../core/ui.js";
import { mealSvg, plural } from "./parts.js";
import { signDate } from "./print-sign.js";

// Paper of the caterer sheet (plan.paper). px = CSS px at 96 dpi, for the scaled preview.
export const DOC_PAGE = Object.freeze({
  letter: { key: "doc-letter", name: "Letter", w: 816, h: 1056 },
  a4: { key: "doc-a4", name: "A4", w: 793.7, h: 1122.5 },
});

const mark = (slot) => {
  const svg = mealSvg(slot);
  svg.setAttribute("class", "mark");
  return svg;
};

const numCells = (row) => [row.guests, row.adults, row.children].map(String);

// opts: { paper: "letter" | "a4", couple, date ("YYYY-MM-DD" | ""), printed (text, already formatted), sheet (catererSheet result), t,
//         tableLabel(n), demoText | null, heading: "h1" (printed copy) | "div" (preview) }
// -> section.out.doc
export function buildCaterer(opts) {
  const { paper, couple, date, printed, sheet, t, tableLabel, demoText, heading = "h1" } = opts;
  const meals = sheet.meals;
  const cols = 4 + (meals.length ? meals.length + 1 : 0);
  const head = [t("guests.print.caterer.col.table"), t("guests.print.caterer.col.guests"), t("guests.print.caterer.col.adults"), t("guests.print.caterer.col.children")]
    .map((text) => h("th", { scope: "col", text }));
  for (const m of meals) head.push(h("th", { scope: "col" }, mark(m.slot), h("bdi", { text: m.label })));
  if (meals.length) head.push(h("th", { scope: "col", text: t("guests.print.caterer.col.noMeal") }));

  const cells = (row) => [...numCells(row), ...(meals.length ? [...row.byMeal.map(String), String(row.noMeal)] : [])];
  const tr = (label, row, cls) => h("tr", { class: cls }, h("td", {}, label), cells(row).map((c) => h("td", { text: c })));
  // A row that would only say "0" is left out: "Not seated" (no unseated attending guest) and "Seated, RSVP pending: 0" (B13).
  const body = [
    ...sheet.rows.map((r) => tr(tableLabel(r.number), r)),
    ...(sheet.notSeated.guests > 0 ? [tr(t("guests.print.caterer.row.notSeated"), sheet.notSeated, "row-unseated")] : []),
    tr(t("guests.print.caterer.row.total"), sheet.total, "row-total"),
    ...(sheet.seatedPending > 0 ? [h("tr", { class: "row-pending" }, h("td", { colspan: cols, text: t("guests.print.caterer.pending", { n: sheet.seatedPending }) }))] : []),
  ];

  const metaParts = [];
  if (couple) metaParts.push(h("bdi", { text: couple }));
  if (signDate(date)) metaParts.push(signDate(date));
  if (printed) metaParts.push(printed);
  const meta = h("p", { class: "doc-meta" }, metaParts.flatMap((p, i) => (i ? [" · ", p] : [p])));

  const legend = meals.length
    ? h("div", { class: "legend" },
      meals.map((m, i) => h("span", {}, mark(m.slot), h("bdi", { text: m.label }), ` ${sheet.total.byMeal[i]}`)),
      h("span", {}, `${t("guests.print.caterer.legendNoMeal")} ${sheet.total.noMeal}`))
    : null;

  return h("section", { class: "out doc", "data-print": DOC_PAGE[paper].key },
    h(heading, { class: "doc-title", text: t("guests.print.caterer.title") }),
    metaParts.length ? meta : null,
    h("p", { class: "doc-total", text: t("guests.print.caterer.attending", { n: sheet.attending, a: sheet.total.adults, c: sheet.total.children }) }),
    legend,
    h("table", {}, h("thead", {}, h("tr", { class: "head-gap", "aria-hidden": "true" }, h("td", { colspan: cols })), h("tr", {}, head)), h("tbody", {}, body),
      h("tfoot", { "aria-hidden": "true" }, h("tr", {}, h("td", { colspan: cols })))),
    h("p", { class: "doc-foot" }, demoText ? h("span", { class: "demo-line", text: demoText }) : null, t("guests.print.caterer.foot")));
}

export const tablesCount = (t, n) => plural(t, "guests.print.tables", n);
