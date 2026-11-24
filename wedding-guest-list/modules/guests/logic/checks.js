// Pre-print check (spec 7, G24). Pure logic: no DOM, no store, no imports. Warns, never blocks.
//
// The name too long to fit a card (part of item 7) and the number of changes since the sign was printed (item 8) are computed by
// other files (cardfit.js, printdiff.js) and arrive as parameters. Name and party keys follow the rules of duplicates.js
// (a logic file does not import another); keep the two in step.
//
// runChecks({ guests, tables, meals, tooLong, staleCount }) -> { checks: [{ id, key, count, items }] (ids 1-8), issues }
//   guests: [{ id, first, last, party, rsvp, mealId, tableId }]   tables: [{ id, number, capacity }]   meals: [{ id }]
//   tooLong: ids of guests whose card name does not fit in two lines at 12 pt   staleCount: changes since marked printed
// Items by check:
//   1 { guestId }                                   attending, no table (or a table that no longer exists)
//   2 { tableId, number, seated, capacity }          more seated (rsvp yes or pending) than the table holds
//   3 { guestIds }                                   same name and same filled party
//   4 { guestId }                                    attending, no meal, while meals are defined
//   5 { guestIds }                                   same name, a different or blank party
//   6 { type: "duplicate", number, tableIds } | { type: "gap", from, to }   between the lowest and the highest number
//   7 { kind: "seatedDeclined" | "seatedPending" | "nameTooLong" | "unnamedGuest", guestId }
//     "unnamedGuest" = a guest whose name is the repair placeholder (audit SC-O1); such guests are left out of checks 3 and 5
//   8 no items: `count` is the number of changes

export const CHECK_KEYS = Object.freeze([
  "unseatedAttending", "overCapacity", "duplicates", "missingMeal", "sameName", "tableNumbers", "seatingAndNames", "outOfDate",
]);

const UNNAMED_GUEST = "(unnamed guest)"; // = schema.js UNNAMED_GUEST (a test keeps the two equal)
const isUnnamed = (g) => g.first === UNNAMED_GUEST && (g.last ?? "") === "";

const fold = (text) => String(text ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[\s ]+/g, " ").trim();
const nameKey = (g) => `${fold(g.first)}|${fold(g.last)}`;
const partyKey = (party) => String(party ?? "").normalize("NFC").toLowerCase().replace(/[\s ]+/g, " ").trim();

const isWhole = (n) => typeof n === "number" && Number.isInteger(n);

// Same-name groups (two or more guests) in order of first appearance.
function nameGroups(guests) {
  const groups = new Map();
  for (const g of guests) {
    const k = nameKey(g);
    if (k === "|" || isUnnamed(g)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  return [...groups.values()].filter((l) => l.length > 1);
}

function duplicatesAndSameName(guests) {
  const dup = [], same = [];
  for (const group of nameGroups(guests)) {
    const byParty = new Map();
    for (const g of group) {
      const p = partyKey(g.party);
      if (p === "") continue;
      if (!byParty.has(p)) byParty.set(p, []);
      byParty.get(p).push(g.id);
    }
    for (const ids of byParty.values()) if (ids.length > 1) dup.push({ guestIds: ids });
    const allOneParty = byParty.size === 1 && [...byParty.values()][0].length === group.length;
    if (!allOneParty) same.push({ guestIds: group.map((g) => g.id) });
  }
  return { dup, same };
}

function tableNumberItems(tables) {
  const byNumber = new Map();
  for (const t of tables) {
    if (!isWhole(t.number)) continue;
    if (!byNumber.has(t.number)) byNumber.set(t.number, []);
    byNumber.get(t.number).push(t.id);
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  const items = [];
  for (const n of numbers) if (byNumber.get(n).length > 1) items.push({ type: "duplicate", number: n, tableIds: byNumber.get(n) });
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] - numbers[i - 1] > 1) items.push({ type: "gap", from: numbers[i - 1] + 1, to: numbers[i] - 1 });
  }
  return items;
}

export function runChecks(input) {
  const { guests: g0, tables: t0, meals: m0, tooLong: tl0, staleCount } = input || {};
  const guests = Array.isArray(g0) ? g0 : [], tables = Array.isArray(t0) ? t0 : [];
  const mealIds = new Set((Array.isArray(m0) ? m0 : []).map((m) => m.id));
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const seated = (g) => Boolean(g.tableId) && tableById.has(g.tableId);

  const unseated = guests.filter((g) => g.rsvp === "yes" && !seated(g)).map((g) => ({ guestId: g.id }));

  const taken = new Map();
  for (const g of guests) if (g.rsvp !== "no" && seated(g)) taken.set(g.tableId, (taken.get(g.tableId) || 0) + 1);
  const over = tables
    .filter((t) => isWhole(t.capacity) && (taken.get(t.id) || 0) > t.capacity)
    .map((t) => ({ tableId: t.id, number: t.number, seated: taken.get(t.id), capacity: t.capacity }))
    .sort((a, b) => a.number - b.number);

  const { dup, same } = duplicatesAndSameName(guests);

  const noMeal = mealIds.size === 0 ? [] : guests
    .filter((g) => g.rsvp === "yes" && !(g.mealId && mealIds.has(g.mealId)))
    .map((g) => ({ guestId: g.id }));

  const seating = [];
  for (const g of guests) {
    if (!seated(g)) continue;
    if (g.rsvp === "no") seating.push({ kind: "seatedDeclined", guestId: g.id });
    else if (g.rsvp !== "yes") seating.push({ kind: "seatedPending", guestId: g.id });
  }
  for (const g of guests) if (isUnnamed(g)) seating.push({ kind: "unnamedGuest", guestId: g.id });
  const known = new Set(guests.map((g) => g.id));
  for (const id of new Set(Array.isArray(tl0) ? tl0 : [])) if (known.has(id)) seating.push({ kind: "nameTooLong", guestId: id });

  const stale = isWhole(staleCount) && staleCount > 0 ? staleCount : 0;

  const lists = [unseated, over, dup, noMeal, same, tableNumberItems(tables), seating, []];
  const checks = lists.map((items, i) => ({ id: i + 1, key: CHECK_KEYS[i], count: i === 7 ? stale : items.length, items }));
  return { checks, issues: checks.reduce((n, c) => n + c.count, 0) };
}
