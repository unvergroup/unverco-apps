// Tables, seat moves, delete order and meal marks (spec 2 Tables, spec 3 write rules, spec 5 meal marks). Pure logic: no DOM,
// no store, no imports. Party and capacity rules follow duplicates.js and checks.js (a logic file does not import another);
// keep them in step.
//
// Write plans are lists of steps { op: "add" | "patch" | "remove", collection, items | ids } already in the write order of
// schema.js `orderWrites`: references are emptied first, then the table / meal is removed (spec 3, O20).
//
// "Keep parties together" (N10). The moved guest always moves. With the box ticked, the other members of the same party
// (same party key, never a blank party) move too, but only those who are attending (`yes`) and sit where the moved guest
// sits (the same table, or both unseated). Declined, pending and elsewhere-seated members stay and are listed in `skipped`.
// A full table still takes the guests; the result says `over` (spec: "9/8").

// ---- Meal marks (O15) ----

export const MAX_MEALS = 6;
export const MEAL_STROKE = Object.freeze({ color: "#222", widthPt: 0.75 });
const mark = (slot, shape, fill) => Object.freeze({ slot, shape, fill, stroke: MEAL_STROKE });
export const MEAL_MARKS = Object.freeze([
  mark(0, "circle", "#0072B2"), mark(1, "square", "#D55E00"), mark(2, "triangle", "#009E73"),
  mark(3, "diamond", "#CC79A7"), mark(4, "star", "#E69F00"), mark(5, "plus", "#56B4E9"),
]);

// The mark of a slot, or null for a slot outside 0-5.
export function mealMark(slot) {
  return Number.isInteger(slot) && slot >= 0 && slot < MAX_MEALS ? MEAL_MARKS[slot] : null;
}

// The mark of a meal id, or null when the meal does not exist (the guest reads as "no meal").
export function markOfMeal(mealId, meals) {
  const m = Array.isArray(meals) && typeof mealId === "string" ? meals.find((x) => x && x.id === mealId) : undefined;
  return m ? mealMark(m.slot) : null;
}

export function canAddMeal(meals) {
  return (Array.isArray(meals) ? meals.length : 0) < MAX_MEALS;
}

// Lowest slot 0-5 no meal uses, or -1 when all six are taken.
export function freeMealSlot(meals) {
  const used = new Set((Array.isArray(meals) ? meals : []).map((m) => m && m.slot));
  for (let s = 0; s < MAX_MEALS; s++) if (!used.has(s)) return s;
  return -1;
}

// ---- Tables ----

const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const partyKey = (party) => String(party ?? "").normalize("NFC").toLowerCase().replace(/[\s ]+/g, " ").trim();
const wholeNumber = (v) => {
  const n = typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) ? n : NaN;
};

// Seated count per table, sorted by number. Seated = rsvp yes or pending at a table that exists (as Check 2).
// A table without a usable capacity counts as capacity 0.
export function tableLoads(guests, tables) {
  const ts = arr(tables);
  const seated = new Map(ts.map((t) => [t.id, 0]));
  for (const g of arr(guests)) if (g.rsvp !== "no" && seated.has(g.tableId)) seated.set(g.tableId, seated.get(g.tableId) + 1);
  return [...ts]
    .sort((a, b) => a.number - b.number)
    .map((t) => {
      const capacity = Number.isInteger(t.capacity) && t.capacity > 0 ? t.capacity : 0;
      const n = seated.get(t.id);
      return { tableId: t.id, number: t.number, capacity, seated: n, over: n > capacity };
    });
}

// Bulk setup: `count` tables of `capacity` seats (default 10), numbered from `start` (default: highest existing number + 1).
// Numbers already taken are skipped. -> { tables: [{ number, capacity }], errors: [{ field, key }] }
// Fields: count (1-999 whole), capacity (1-40 whole), start (1-999 whole), range (the numbers do not fit up to 999).
// Any error gives no tables. Text input ("8") is read as a number.
export function bulkTables(existing, count, capacity = 10, start) {
  const errors = [];
  const taken = new Set(arr(existing).map((t) => t.number));
  const n = wholeNumber(count), k = wholeNumber(capacity);
  if (!(n >= 1 && n <= 999)) errors.push({ field: "count", key: "count" });
  if (!(k >= 1 && k <= 40)) errors.push({ field: "capacity", key: "capacity" });
  let first = Math.max(0, ...taken.values()) + 1;
  if (start !== undefined) {
    first = wholeNumber(start);
    if (!(first >= 1 && first <= 999)) errors.push({ field: "start", key: "start" });
  }
  if (errors.length) return { tables: [], errors };
  const tables = [];
  for (let num = first; num <= 999 && tables.length < n; num++) if (!taken.has(num)) tables.push({ number: num, capacity: k });
  if (tables.length < n) return { tables: [], errors: [{ field: "range", key: "range" }] };
  return { tables, errors };
}

// ---- Moving guests ----

// movePlan({ guests, tables, guestId, tableId, wholeParty })
//   tableId: a table id, or null / undefined / "" for "Unseated". A table id that does not exist changes nothing.
// -> { ok: true, tableId, number, moves: [{ guestId, from, to }], skipped: [{ guestId, reason }], partyCount, seated, capacity, over }
//    or { ok: false, reason: "no_guest" | "no_table", moves: [], skipped: [] }
//   skipped reasons: declined, pending, elsewhere (N10), already_there. `partyCount` is how many would move with the box ticked.
//   from / to are table ids or null; a table that does not exist reads as null. `seated` / `over` describe the target table
//   after the moves (null table: seated 0, capacity 0, over false).
export function movePlan({ guests, tables, guestId, tableId, wholeParty } = {}) {
  const gs = arr(guests), ts = arr(tables);
  const fail = (reason) => ({ ok: false, reason, moves: [], skipped: [] });
  const target = tableId === undefined || tableId === null || tableId === "" ? null : tableId;
  const dest = target === null ? null : ts.find((t) => t.id === target);
  if (target !== null && !dest) return fail("no_table");
  const guest = gs.find((g) => g.id === guestId);
  if (!guest) return fail("no_guest");

  const live = new Set(ts.map((t) => t.id));
  const place = (g) => (live.has(g.tableId) ? g.tableId : null);
  const home = place(guest);
  const key = partyKey(guest.party);

  const candidates = [guest];
  const skipped = [];
  const seen = new Set([guest.id]);
  let partyCount = 1;
  if (key !== "") {
    for (const g of gs) {
      if (seen.has(g.id) || partyKey(g.party) !== key) continue;
      seen.add(g.id);
      const reason = g.rsvp === "no" ? "declined" : g.rsvp !== "yes" ? "pending" : place(g) !== home ? "elsewhere" : null;
      if (reason) { skipped.push({ guestId: g.id, reason }); continue; }
      partyCount++;
      if (wholeParty) candidates.push(g);
    }
  }
  const moves = [];
  const moved = new Map();
  for (const g of candidates) {
    if (place(g) === target) { if (wholeParty || g === guest) skipped.push({ guestId: g.id, reason: "already_there" }); continue; }
    moves.push({ guestId: g.id, from: place(g), to: target });
    moved.set(g.id, target);
  }
  const after = gs.map((g) => (moved.has(g.id) ? { ...g, tableId: moved.get(g.id) } : g));
  const load = dest ? tableLoads(after, ts).find((l) => l.tableId === target) : null;
  return {
    ok: true, tableId: target, number: dest ? dest.number : null, moves, skipped, partyCount,
    seated: load ? load.seated : 0, capacity: load ? load.capacity : 0, over: load ? load.over : false,
  };
}

// ---- Delete plans (spec 3: the referencing records are emptied first) ----

const none = (reason) => ({ ok: false, reason, affected: 0, guestIds: [], steps: [] });

// Deleting a table: every guest seated there (whatever the rsvp) is unseated first, then the table is removed.
export function deleteTablePlan(guests, tables, tableId) {
  if (!arr(tables).some((t) => t.id === tableId)) return none("no_table");
  const ids = arr(guests).filter((g) => g.tableId === tableId).map((g) => g.id);
  const steps = [];
  if (ids.length) steps.push({ op: "patch", collection: "guests", items: ids.map((id) => ({ id, patch: { tableId: null } })) });
  steps.push({ op: "remove", collection: "tables", ids: [tableId] });
  return { ok: true, affected: ids.length, guestIds: ids, steps };
}

// Deleting a meal option: every guest who chose it loses the choice first, then the option is removed.
export function deleteMealPlan(guests, meals, mealId) {
  if (!arr(meals).some((m) => m.id === mealId)) return none("no_meal");
  const ids = arr(guests).filter((g) => g.mealId === mealId).map((g) => g.id);
  const steps = [];
  if (ids.length) steps.push({ op: "patch", collection: "guests", items: ids.map((id) => ({ id, patch: { mealId: null } })) });
  steps.push({ op: "remove", collection: "meals", ids: [mealId] });
  return { ok: true, affected: ids.length, guestIds: ids, steps };
}
