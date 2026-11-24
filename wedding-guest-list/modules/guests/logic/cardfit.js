// Name fitting on a place card (spec 5, audit O19). Pure logic: no DOM, no store, no imports.
//
// Estimate: width = characters x 0.55 em [assumption, to be measured in Lora and fixed]. Start size is min(26, box height x 0.35);
// shrink by 0.5 pt down to 12 pt; if one line still does not fit, two lines at 12 pt (wrapped like the browser: at spaces,
// inside a word only when the word alone is longer than a line); if even that does not fit the name is not cut, it stays
// small and is reported as `tooLong` (Check 7). A box so low that the start size is below 12 pt makes that start size the floor.
// The DOM correction after drawing (shrink by 0.5 pt, at most 10 times) is the view's job.

export const FIT = Object.freeze({ maxPt: 26, minPt: 12, stepPt: 0.5, em: 0.55, heightFactor: 0.35 });

const EPS = 1e-9; // keeps an exact fit from failing on floating point noise

// Characters that fit on one line at `size` pt.
const capacity = (boxW, size) => Math.floor(boxW / (size * FIT.em) + EPS);

// Lines needed for `words` (code point lengths) when a line holds `cap` characters.
function wrap(words, cap) {
  if (cap < 1) return Infinity;
  let lines = 1, used = 0;
  for (const len0 of words) {
    let len = len0;
    if ((used === 0 ? len : used + 1 + len) <= cap) { used = used === 0 ? len : used + 1 + len; continue; }
    if (used > 0) { lines++; used = 0; }
    while (len > cap) { lines++; len -= cap; }
    used = len;
  }
  return lines;
}

const positive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

// boxW, boxH: the text box in pt (for a tent card the lower half). -> { size (pt), lines (1 | 2), tooLong }
// Throws TypeError for a box that is not a positive finite number.
export function fitName(name, boxW, boxH) {
  if (!positive(boxW) || !positive(boxH)) throw new TypeError("fitName needs a positive text box width and height (pt)");
  const text = String(name ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
  const words = text === "" ? [] : text.split(" ").map((w) => Array.from(w).length);
  const chars = Array.from(text).length;
  const start = Math.min(FIT.maxPt, boxH * FIT.heightFactor);
  const floor = Math.min(FIT.minPt, start);
  for (let size = start; ; size -= FIT.stepPt) {
    if (size < floor) size = floor;
    if (chars <= capacity(boxW, size)) return { size, lines: 1, tooLong: false };
    if (size === floor) break;
  }
  return { size: floor, lines: 2, tooLong: wrap(words, capacity(boxW, floor)) > 2 };
}
