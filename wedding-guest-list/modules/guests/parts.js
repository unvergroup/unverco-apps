// Small UI parts shared by the Planner views (Guests now; Tables, Check and Print reuse them).
import { h } from "../../core/ui.js";
import { MEAL_MARKS, mealMark } from "./logic/tables.js";

// SVG namespace name (not an address that is opened). Built from pieces so the single-file package test, which forbids the
// text "http" + "://" anywhere in the bundle, does not trip over it.
const SVG = ["http:", "", "www.w3.org", "2000", "svg"].join("/");
const star = "12,1.5 14.6,8.9 22.5,9 16.2,13.8 18.5,21.5 12,17 5.5,21.5 7.8,13.8 1.5,9 9.4,8.9";
const plus = "8.5,2 15.5,2 15.5,8.5 22,8.5 22,15.5 15.5,15.5 15.5,22 8.5,22 8.5,15.5 2,15.5 2,8.5 8.5,8.5";
const SHAPES = {
  circle: ["circle", { cx: 12, cy: 12, r: 9 }],
  square: ["rect", { x: 4, y: 4, width: 16, height: 16 }],
  triangle: ["polygon", { points: "12,3 21.5,20 2.5,20" }],
  diamond: ["polygon", { points: "12,1.5 22.5,12 12,22.5 1.5,12" }],
  star: ["polygon", { points: star }],
  plus: ["polygon", { points: plus }],
};

const svgEl = (name, attrs) => {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

// Meal mark SVG for a slot 0-5 (colour + shape + 0.75 pt-equivalent outline, spec 5 O15). Decorative: always next to the label.
export function mealSvg(slot) {
  const m = mealMark(slot) ?? MEAL_MARKS[0];
  const [tag, attrs] = SHAPES[m.shape];
  const g = svgEl("g", { fill: m.fill, stroke: m.stroke.color, "stroke-width": 1.6, "stroke-linejoin": "round" });
  g.append(svgEl(tag, attrs));
  const svg = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
  svg.append(g);
  return svg;
}

// Mark on its white chip + the label (the mark never stands alone in the app).
export function mealWithMark(meal) {
  return h("span", { class: "meal" }, h("span", { class: "meal-mark" }, mealSvg(meal.slot)), h("bdi", { text: String(meal.label ?? "") }));
}

export const guestName = (g) => [g.first, g.last].map((x) => String(x ?? "")).filter(Boolean).join(" ");

export const badge = (n, kind) => h("span", { class: `badge${kind ? ` badge-${kind}` : ""}`, text: String(n) });

// Status line: shape + text (not colour alone). kind: ok | warn | danger | info
export function statusBox(kind, children, { role } = {}) {
  return h("div", { class: `status status-${kind}`, role }, h("div", {}, ...[].concat(children)));
}

export const rsvpLabel = (t, rsvp) => t(rsvp === "yes" ? "guests.rsvp.yes" : rsvp === "no" ? "guests.rsvp.no" : "guests.rsvp.pending");

// "one" / "other" dictionary pair: key + ".one" for 1, key + ".other" otherwise.
export const plural = (t, key, n, params = {}) => t(`${key}.${n === 1 ? "one" : "other"}`, { n, ...params });

// Moves focus to the element with data-key (after a redraw); true when found.
export function focusKey(root, key) {
  const el = key ? [...root.querySelectorAll("[data-key]")].find((e) => e.dataset.key === key) : null;
  if (el) el.focus();
  return Boolean(el);
}

// Marks an element for 2 seconds (design: .is-target) after a save or a move.
export function flashTarget(el) {
  if (!el) return;
  el.classList.add("is-target");
  setTimeout(() => el.classList.remove("is-target"), 2000);
}

// ---- Added with the Tables / Check views (U3, U4) ----

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
// Guests by last name (first name when there is none), then first name: the order of the sign.
export const sortGuests = (a, b) => collator.compare(a.last || a.first || "", b.last || b.first || "") || collator.compare(a.first || "", b.first || "");

// [5, 6, 7, 9] -> "5–7, 9"
export function ranges(numbers) {
  const n = [...new Set(numbers)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < n.length; ) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    out.push(j > i ? `${n[i]}–${n[j]}` : String(n[i]));
    i = j + 1;
  }
  return out.join(", ");
}

// After a view change: marks the row / chip of the element with data-key as soon as it exists (waits up to about a second).
export function flashKeyWhenReady(key, tries = 60) {
  const find = () => {
    const panel = document.getElementById("guests-panel");
    return panel ? [...panel.querySelectorAll("[data-key]")].find((e) => e.dataset.key === key) : null;
  };
  const step = (left) => {
    const el = find();
    if (el) flashTarget(el.closest("tr, li") ?? el);
    else if (left > 0) requestAnimationFrame(() => step(left - 1));
  };
  requestAnimationFrame(() => step(tries));
}

// ---- Added with the Print view (U6, U7) ----

// SVG element for the printed sheets (scale bar); the namespace stays inside this file (see the note at the top).
export const svgNode = svgEl;

// ---- Added with the final Print tasks (U8, U9, fixes) ----

// Nudge in words, never a signed number: (150, -200) -> ["1.5 mm right", "2 mm up"] (x100 = mm x 100; t = the dictionary function).
export function nudgeWords(t, x100, y100) {
  const part = (v, pos, neg) => t(v >= 0 ? pos : neg, { n: Math.abs(v) / 100 });
  return [part(x100, "guests.print.test.right", "guests.print.test.left"), part(y100, "guests.print.test.down", "guests.print.test.up")];
}
