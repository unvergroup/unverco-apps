// Legibility of the sign (spec 5, G18). Pure functions, no DOM: the view measures the drawn sign and asks these.
// Body text sizes are in pt, 0.5 pt steps, 6 to 48. No sentence is written here: codes only (texts: messages.js guests.print.*).

export const BODY = Object.freeze({ min: 6, max: 48, step: 0.5, ok: 16, small: 12 });

// The largest size (pt) for which fits(pt) is true, by binary search; null when none. `beat` (optional): only sizes above it
// are searched, so a column count that cannot win costs one measurement. fits must be monotone (smaller always fits if larger does).
export function largestFit(fits, beat = null) {
  const steps = Math.round((BODY.max - BODY.min) / BODY.step);
  const size = (i) => BODY.min + i * BODY.step;
  let lo = beat === null ? -1 : Math.max(-1, Math.floor((beat - BODY.min) / BODY.step + 1e-9)); // index known to fit (or the bound)
  let hi = steps + 1;
  if (lo >= steps) return null;
  if (beat !== null && lo >= 0 && !fits(size(lo + 1))) return null;
  if (beat === null && !fits(size(0))) return null;
  if (beat === null) lo = 0;
  else lo = lo + 1 <= steps && fits(size(lo + 1)) ? lo + 1 : lo;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (mid > steps) { hi = mid; continue; }
    if (fits(size(mid))) lo = mid; else hi = mid;
  }
  return lo < 0 ? null : size(lo);
}

// board: "18x24" | "24x36"; body: pt chosen (null = does not fit even at 6 pt); alt: body pt on the 24 x 36 board (or null).
// -> { code: "ok" | "small" | "tooSmall" | "tooMany", suggest: "24x36" | null, altPt? }
export function decide({ board, body, alt }) {
  if (body === null || body === undefined) return { code: "tooMany", suggest: null };
  if (body >= BODY.ok) return { code: "ok", suggest: null };
  if (body >= BODY.small) return { code: "small", suggest: null };
  if (board === "18x24" && typeof alt === "number" && alt >= BODY.ok) return { code: "tooSmall", suggest: "24x36", altPt: alt };
  return { code: "tooSmall", suggest: null };
}
