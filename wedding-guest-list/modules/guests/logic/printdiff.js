// Changes since printed (spec 5, G32; audit O13). Pure logic: no DOM, no store, no imports.
//
// A printout's image (`prints.entries`) holds the guests that were on the sign / cards: tableId resolves to a table and rsvp is not "no".
// Entry: { guestId, first, last, tableNumber, mealId, rsvp }; tableNumber is the number of the table, not its id (O13), so renumbering
// a table shows as a change for every guest at it. Guests are matched by id: a guest deleted and added again is removed + added.
// Only the printed image and the current image are compared, so several edits of one guest are one change, and edits that
// cancel out are no change.
//
// Card options (audit PD-O1): the printout record also keeps `options` (see `optionsOf`): the marker switch, the marker of each
// meal (meal id -> slot) and the card layout (preset id, custom size, nudge). If one of them changed after printing, the cards it
// touches are printed again: a layout or nudge change touches ALL cards; the marker switch touches the cards of guests with a
// meal; a changed marker of a meal touches the cards of guests with that meal. A record without `options` (older data) is not
// compared for options.

export const DIFF_FIELDS = Object.freeze(["first", "last", "tableNumber", "mealId", "rsvp"]);

// What the card or the sign shows: a change in these needs a new print. Meal shows only on cards with the marker on; rsvp never.
const NAME_TABLE = new Set(["first", "last", "tableNumber"]);

// Entries of the current state, in guest order, ready to be stored by [Mark as printed] or compared by `diff`.
export function snapshotOf(guests, tables) {
  const number = new Map();
  for (const t of tables || []) number.set(t.id, t.number);
  const out = [];
  for (const g of guests || []) {
    if (g.rsvp === "no" || !g.tableId || !number.has(g.tableId)) continue;
    out.push({
      guestId: g.id, first: g.first, last: g.last, tableNumber: number.get(g.tableId),
      mealId: g.mealId ?? null, rsvp: g.rsvp === "yes" ? "yes" : "pending",
    });
  }
  return out;
}

const DEFAULT_PRESET = "tent-3.5x2-letter4"; // keep in step with schema.js PLAN_DEFAULTS.cardPreset
const CARD_KEYS = ["paper", "w100", "h100", "cols", "rows", "left100", "top100", "gapX100", "gapY100", "tent"];

// What the printed cards depend on besides the guests, from the plan record and the meals. Stored in `prints.options`.
// -> { showMeal, marks: [{ mealId, slot, label }], cardPreset, customCard | null, offX100, offY100 }
export function optionsOf(plan, meals) {
  const p = plan && typeof plan === "object" ? plan : {};
  const cardPreset = typeof p.cardPreset === "string" ? p.cardPreset : DEFAULT_PRESET;
  const custom = cardPreset === "custom" && p.customCard && typeof p.customCard === "object" ? p.customCard : null;
  return {
    showMeal: p.showMealOnCards === true,
    // `label` is kept so the Changes panel can name a meal option that was deleted after printing (the record is the only place its name survives).
    marks: (Array.isArray(meals) ? meals : []).filter((m) => m && typeof m.id === "string").map((m) => ({ mealId: m.id, slot: m.slot, label: typeof m.label === "string" ? m.label : "" })),
    cardPreset,
    customCard: custom ? Object.fromEntries(CARD_KEYS.map((k) => [k, custom[k]])) : null,
    offX100: typeof p.offX100 === "number" ? p.offX100 : 0,
    offY100: typeof p.offY100 === "number" ? p.offY100 : 0,
  };
}

const sameCard = (a, b) => (a === null || a === undefined || b === null || b === undefined
  ? (a ?? null) === (b ?? null)
  : CARD_KEYS.every((k) => a[k] === b[k]));

// printed / current options -> null when there is nothing to compare, else
// { layout, showMealChanged, showMealNow, marks: [mealId whose marker changed while the marker shows on both prints] }
function compareOptions(before, after) {
  if (!before || typeof before !== "object" || !after || typeof after !== "object") return null;
  const slots = (o) => new Map((Array.isArray(o.marks) ? o.marks : []).map((m) => [m.mealId, m.slot]));
  const was = slots(before), now = slots(after);
  const marks = [];
  if (before.showMeal === true && after.showMeal === true) {
    for (const id of new Set([...was.keys(), ...now.keys()])) if (was.get(id) !== now.get(id)) marks.push(id);
  }
  return {
    layout: before.cardPreset !== after.cardPreset || before.offX100 !== after.offX100 || before.offY100 !== after.offY100
      || (after.cardPreset === "custom" && !sameCard(before.customCard, after.customCard)),
    showMealChanged: (before.showMeal === true) !== (after.showMeal === true),
    showMealNow: after.showMeal === true,
    marks,
  };
}

const norm = (field, v) => (field === "mealId" ? (v === undefined || v === "" ? null : v) : v);

const byId = (list) => {
  const m = new Map();
  for (const e of list || []) m.set(e.guestId, e);
  return m;
};

// printed: the stored entries, or null when nothing was marked printed (then there is nothing to compare: returns null).
// current: entries of the current state (see snapshotOf).
// cmp (optional): { before: the options stored with the printout, after: optionsOf(plan, meals) now }.
// -> { added: [entry], removed: [printed entry], changed: [{ guestId, before, after, fields }], current: [entry], options }
//    with `fields` in DIFF_FIELDS order; `current` is every current entry; `options` is null when no options were compared,
//    else { layout, showMealChanged, showMealNow, marks }.
export function diff(printed, current, cmp) {
  if (!Array.isArray(printed)) return null;
  const was = byId(printed), now = byId(current);
  const added = [], removed = [], changed = [];
  for (const [id, after] of now) {
    const before = was.get(id);
    if (!before) { added.push(after); continue; }
    const fields = DIFF_FIELDS.filter((f) => norm(f, before[f]) !== norm(f, after[f]));
    if (fields.length) changed.push({ guestId: id, before, after, fields });
  }
  for (const [id, before] of was) if (!now.has(id)) removed.push(before);
  return { added, removed, changed, current: [...now.values()], options: compareOptions(cmp && cmp.before, cmp && cmp.after) };
}

// Changes that make the sign out of date: added + removed + name or table changed. Meal and rsvp changes do not count.
export function signStaleCount(d) {
  if (!d) return 0;
  return d.added.length + d.removed.length + d.changed.filter((c) => c.fields.some((f) => NAME_TABLE.has(f))).length;
}

// Cards for "Print changed cards only": { print, noReprint, discard }.
// print = added, then changed guests whose name, table or (marker on) meal changed, then guests touched by a card option change
// (see the top of this file), as current entries; with a layout or nudge change: every current entry, in current order;
// noReprint = changed guests that only changed rsvp (or meal with the marker off); discard = printed entries of removed guests.
export function reprintSet(d, opts = {}) {
  if (!d) return { print: [], noReprint: [], discard: [] };
  const o = d.options || null;
  const showMeal = o ? o.showMealNow : opts.showMeal === true;
  if (o && o.layout) return { print: [...(d.current || [])], noReprint: [], discard: [...d.removed] };
  const touched = (before, after) => {
    if (!o) return false;
    if (o.showMealChanged) return Boolean((before && before.mealId) || after.mealId);
    return o.marks.length > 0 && (o.marks.includes(after.mealId) || Boolean(before && o.marks.includes(before.mealId)));
  };
  const print = [...d.added], noReprint = [];
  const done = new Set(print.map((e) => e.guestId));
  for (const c of d.changed) {
    const needs = c.fields.some((f) => NAME_TABLE.has(f) || (f === "mealId" && showMeal)) || touched(c.before, c.after);
    if (needs) { print.push(c.after); done.add(c.guestId); } else noReprint.push(c.after);
  }
  const changedIds = new Set(d.changed.map((c) => c.guestId));
  for (const e of d.current || []) {
    if (done.has(e.guestId) || changedIds.has(e.guestId)) continue;
    if (touched(e, e)) print.push(e);
  }
  return { print, noReprint, discard: [...d.removed] };
}

// Names of the meal options as they were when the cards were printed: mealId -> label (from `prints.options.marks`).
// Older records have no label: those ids are left out (the caller shows a neutral text for a deleted option).
export function printedMealLabels(options) {
  const out = new Map();
  const marks = options && typeof options === "object" && Array.isArray(options.marks) ? options.marks : [];
  for (const m of marks) if (m && typeof m.mealId === "string" && typeof m.label === "string" && m.label !== "") out.set(m.mealId, m.label);
  return out;
}
