// Print > Sign (U6): builds the sign at page size and measures it (spec 5, design baski-ciktilari.md section 2). The sign is drawn once
// at real size (18 x 24 in or 24 x 36 in) and the same builder draws the scaled preview, so what is measured is what is printed.
// User text goes in through h() only; names sit in <bdi>. Sizes are set with style.setProperty (no style attribute in markup).
import { h } from "../../core/ui.js";
import { signGroups } from "./logic/signsort.js";
import { BODY, decide, largestFit } from "./print-legibility.js";

export const SIGN_SIZES = Object.freeze(["18x24", "24x36"]);
export const SIGN_PAGE = Object.freeze({ "18x24": { w: 1728, h: 2304, name: "sign-18x24" }, "24x36": { w: 2304, h: 3456, name: "sign-24x36" } }); // CSS px (96 dpi)
export const MAX_COLUMNS = 6;

const DATE = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }) : null;

// "2027-06-13" -> "June 13, 2027" (a local date: no time zone shift); "" or a date that does not exist -> "".
export function signDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return "";
  return DATE.format(date);
}

// opts: { size, title, couple, date, groups (signsort.signGroups), tableLabel(n), unnamed, demoText | null, body (pt), cols,
//         heading: "h1" (default) | "div" }
// -> section.out.sign (title block, then letter headings and rows). Empty couple / date add no element.
// The title of the printed sign is a heading (h1: the sign is the only content of the print document, so a PDF reader or a screen
// reader finds a real title). The scaled preview passes "div": it is an image of the page and must not add a second h1 to the app.
export function buildSign(opts) {
  const { size, title, couple, date, groups, tableLabel, unnamed, demoText, body = 18, cols = 3, heading = "h1" } = opts;
  const head = h("header", { class: "sign-head" },
    h(heading, { class: "sign-title" }, h("bdi", { text: title })),
    couple ? h("p", { class: "sign-couple" }, h("bdi", { text: couple })) : null,
    signDate(date) ? h("p", { class: "sign-date", text: signDate(date) }) : null);
  const rows = [];
  for (const g of groups) {
    rows.push(h("div", { class: "sign-letter", text: g.letter }));
    for (const e of g.entries) {
      rows.push(h("div", { class: "sign-row" },
        h("bdi", { class: "sign-name", text: e.name || unnamed }),
        h("span", { class: "sign-lead", "aria-hidden": "true" }),
        h("span", { class: "sign-table", text: tableLabel(e.tableNumber) })));
    }
  }
  const el = h("section", { class: "out sign", "data-print": SIGN_PAGE[size].name, "data-size": size },
    head, h("div", { class: "sign-body" }, rows), demoText ? h("p", { class: "demo-foot", text: demoText }) : null);
  setSignSizes(el, body, cols);
  return el;
}

export function setSignSizes(el, body, cols) {
  el.style.setProperty("--body", `${body}pt`);
  el.style.setProperty("--cols", String(cols));
}

export const signGroupsOf = (guests, tables) => signGroups(guests, tables);

// Measures a sign element that is laid out at page size (the print root in measuring mode) and fits the body text.
// cols: "auto" or 1-6. -> { body (pt | null when even 6 pt does not fit), cols }. Leaves the sizes set on the element.
export function measureSign(el, cols) {
  const bodyEl = el.querySelector(".sign-body");
  const fitsWith = (c) => (pt) => {
    setSignSizes(el, pt, c);
    return bodyEl.scrollWidth <= bodyEl.clientWidth + 0.5; // columns that do not fit open new columns to the right
  };
  let best = null;
  const tryCols = cols === "auto" ? Array.from({ length: MAX_COLUMNS }, (_, i) => i + 1) : [Number(cols)];
  for (const c of tryCols) {
    const pt = largestFit(fitsWith(c), best ? best.body : null); // a larger count only wins with a strictly larger size
    if (pt !== null && (best === null || pt > best.body)) best = { body: pt, cols: c };
  }
  const out = best ?? { body: null, cols: cols === "auto" ? MAX_COLUMNS : Number(cols) };
  setSignSizes(el, out.body ?? BODY.min, out.cols);
  return out;
}

// Full decision for the chosen board: measures the 24 x 36 sign too when the small board reads "Too small".
// build(size) -> a fresh sign element at page size, already attached in measuring mode (the caller owns it and removes it).
export function judgeSign({ size, cols, buildAt }) {
  const mine = buildAt(size);
  const m = measureSign(mine.el, cols);
  mine.done();
  let alt = null;
  if (size === "18x24" && m.body !== null && m.body < BODY.small) {
    const big = buildAt("24x36");
    alt = measureSign(big.el, cols).body;
    big.done();
  }
  return { ...m, verdict: decide({ board: size, body: m.body, alt }) };
}
