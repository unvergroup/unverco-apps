// Built-in sample list (spec 6, G27): 40 invented guests, the same people as tests/fixtures/liste-40.csv (a test compares them
// row by row). Pure logic: no DOM, no store, no imports. Every record id starts with "sample-"; the data has no stamps (the store adds them).
//
// Plans are lists of steps { op, collection, items | ids } in the write order of schema.js `orderWrites`.

export const SAMPLE_PREFIX = "sample-";

export const isSampleId = (id) => typeof id === "string" && id.startsWith(SAMPLE_PREFIX);

const MEALS = ["Beef", "Salmon", "Vegetarian", "Kids"];
const TABLE_COUNT = 5;
const TABLE_CAPACITY = 8;

// first, last, party, rsvp, meal, age, table number ("" = no table)
const ROWS = [
  ["Ángel", "Ortiz", "Ortiz", "yes", "Beef", "adult", "1"],
  ["Maria", "Ortiz", "Ortiz", "yes", "Salmon", "adult", "1"],
  ["Noah", "Ortiz", "Ortiz", "yes", "Kids", "child", "1"],
  ["Michael", "Brown", "Brown Family", "yes", "Beef", "adult", "1"],
  ["Linda", "Brown", "Brown Family", "yes", "Salmon", "adult", "1"],
  ["Aiden", "Brown", "Brown Family", "yes", "Kids", "child", "1"],
  ["Ann", "Lee", "Lee", "yes", "Vegetarian", "adult", "1"],
  ["Tom", "Lee", "Lee", "yes", "Beef", "adult", "1"],
  ["Marta", "Łabędź", "Łabędź", "yes", "Salmon", "adult", "2"],
  ["Piotr", "Łabędź", "Łabędź", "yes", "Beef", "adult", "2"],
  ["Zoë", "Brooks", "Brooks", "yes", "Vegetarian", "adult", "2"],
  ["Emily", "Brennan", "Brennan", "yes", "Salmon", "adult", "2"],
  ["Minh", "Đặng", "Đặng", "yes", "Beef", "adult", "2"],
  ["Lan", "Đặng", "Đặng", "yes", "Salmon", "adult", "2"],
  ["Ștefan", "Țăran", "Țăran", "yes", "Beef", "adult", "2"],
  ["Ioana", "Țăran", "Țăran", "yes", "Vegetarian", "adult", "2"],
  ["Łukasz", "Żółć", "Żółć", "yes", "Beef", "adult", "3"],
  ["Anna", "Żółć", "Żółć", "yes", "Salmon", "adult", "3"],
  ["محمد", "الفاسي", "الفاسي", "yes", "Beef", "adult", "3"],
  ["Layla", "الفاسي", "الفاسي", "yes", "Vegetarian", "adult", "3"],
  ["Lily", "Chen", "Chen", "yes", "Kids", "child", "3"],
  ["David", "Chen", "Chen", "yes", "Beef", "adult", "3"],
  ["Sarah", "Adams", "Adams", "yes", "Salmon", "adult", "4"],
  ["Michael", "Brown", "College Friends", "yes", "Vegetarian", "adult", "4"],
  ["Emma", "Davis", "Davis", "yes", "Beef", "adult", "4"],
  ["John", "Davis", "Davis", "yes", "Salmon", "adult", "4"],
  ["Olivia", "Nguyen", "Nguyen", "yes", "Vegetarian", "adult", "5"],
  ["Ethan", "Nguyen", "Nguyen", "yes", "Salmon", "adult", "5"],
  ["Zoe", "Young", "Young", "yes", "", "adult", "5"],
  ["Grace", "O'Brien", "O'Brien", "yes", "", "adult", "5"],
  ["Henry", "Walker", "Walker", "yes", "Beef", "adult", ""],
  ["Sofia", "Walker", "Walker", "yes", "Salmon", "adult", ""],
  ["Robert", "Stone", "Stone", "no", "", "adult", ""],
  ["Karen", "Stone", "Stone", "no", "", "adult", ""],
  ["Paul", "Hale", "Hale", "no", "", "adult", ""],
  ["Nina", "Hale", "Hale", "no", "", "adult", ""],
  ["Victor", "Reyes", "Reyes", "no", "", "adult", ""],
  ["Carla", "Mendes", "Mendes", "pending", "", "adult", ""],
  ["Ravi", "Patel", "Patel", "pending", "", "adult", ""],
  ["Tess", "Murphy", "Murphy", "pending", "", "adult", ""],
];

// -> { guests, tables, meals } as fresh objects; each call returns its own copy.
export function sampleData() {
  const meals = MEALS.map((label, slot) => ({ id: `${SAMPLE_PREFIX}m${slot}`, label, slot }));
  const tables = Array.from({ length: TABLE_COUNT }, (_, i) => ({ id: `${SAMPLE_PREFIX}t${i + 1}`, number: i + 1, capacity: TABLE_CAPACITY }));
  const guests = ROWS.map(([first, last, party, rsvp, meal, age, table], i) => ({
    id: `${SAMPLE_PREFIX}g${String(i + 1).padStart(2, "0")}`,
    first, last, party, rsvp,
    mealId: meal ? `${SAMPLE_PREFIX}m${MEALS.indexOf(meal)}` : null,
    age,
    tableId: table ? `${SAMPLE_PREFIX}t${table}` : null,
    notes: "",
    source: "sample",
  }));
  return { guests, tables, meals };
}

const list = (v) => (Array.isArray(v) ? v.filter((r) => r && typeof r === "object") : []);

const MAX_MEALS = 6; // a list holds six meals, slots 0-5 (schema.js)
const MAX_TABLE_NUMBER = 999;

// Load plan for `data` ({ guests, tables, meals } as exported). Sample records already there are not added again
// (loading twice adds nothing). `needsConfirm`: the app already holds records that are not sample records.
// -> { needsConfirm, steps, mealsSkipped, guestsWithoutMeal, tablesRenumbered }
//   steps in the order meals, tables, guests; a collection with nothing to add has no step.
// The sample never lands on top of the user's own records (audit SM-O1):
//   - a sample meal takes its own slot when that slot is free, else the lowest free slot; a list holds six meals, so the sample
//     meals that do not fit are not added (`mealsSkipped`) and the sample guests that point at them get no meal (`guestsWithoutMeal`);
//   - a sample table whose number is already used by another table gets the lowest unused number (`tablesRenumbered`);
//     guests point at tables by id, so nobody moves.
export function sampleLoadPlan(data) {
  const d = data && typeof data === "object" ? data : {};
  const s = sampleData();
  const steps = [];
  const out = { mealsSkipped: 0, guestsWithoutMeal: 0, tablesRenumbered: 0 };

  const haveMeals = list(d.meals);
  const haveIds = (c) => new Set(list(d[c]).map((r) => r.id));
  const mealIds = haveIds("meals");
  const slots = new Set(haveMeals.map((m) => m.slot).filter((n) => Number.isInteger(n)));
  let mealCount = haveMeals.length;
  const mealItems = [], skippedMeals = new Set();
  for (const m of s.meals) {
    if (mealIds.has(m.id)) continue;
    if (mealCount >= MAX_MEALS) { skippedMeals.add(m.id); out.mealsSkipped++; continue; }
    let slot = m.slot;
    if (slots.has(slot)) { slot = 0; while (slots.has(slot)) slot++; }
    slots.add(slot);
    mealCount++;
    mealItems.push({ ...m, slot });
  }
  if (mealItems.length) steps.push({ op: "add", collection: "meals", items: mealItems });

  const tableIds = haveIds("tables");
  const used = new Set(list(d.tables).map((t) => t.number).filter((n) => Number.isInteger(n)));
  const tableItems = [];
  for (const t of s.tables) {
    if (tableIds.has(t.id)) continue;
    let number = t.number;
    if (used.has(number)) {
      number = 1;
      while (used.has(number) && number < MAX_TABLE_NUMBER) number++;
      out.tablesRenumbered++;
    }
    used.add(number);
    tableItems.push({ ...t, number });
  }
  if (tableItems.length) steps.push({ op: "add", collection: "tables", items: tableItems });

  const guestIds = haveIds("guests");
  const guestItems = [];
  for (const g of s.guests) {
    if (guestIds.has(g.id)) continue;
    if (g.mealId && skippedMeals.has(g.mealId)) { guestItems.push({ ...g, mealId: null }); out.guestsWithoutMeal++; }
    else guestItems.push(g);
  }
  if (guestItems.length) steps.push({ op: "add", collection: "guests", items: guestItems });

  const needsConfirm = ["guests", "tables", "meals"].some((c) => list(d[c]).some((r) => !isSampleId(r.id)));
  return { needsConfirm, steps, ...out };
}

// Remove plan: every record whose id starts with "sample-" goes, edited or not. User records stay, also the user tables that
// sample guests sat at. User guests that point at a sample table or meal are emptied first (spec 3 delete order).
// -> { steps, removed: { guests, tables, meals } }
export function sampleRemovePlan(data) {
  const d = data && typeof data === "object" ? data : {};
  const gone = { guests: [], tables: [], meals: [] };
  for (const c of Object.keys(gone)) gone[c] = list(d[c]).filter((r) => isSampleId(r.id)).map((r) => r.id);
  const patches = [];
  for (const g of list(d.guests)) {
    if (isSampleId(g.id)) continue;
    const patch = {};
    if (isSampleId(g.tableId)) patch.tableId = null;
    if (isSampleId(g.mealId)) patch.mealId = null;
    if (Object.keys(patch).length) patches.push({ id: g.id, patch });
  }
  const steps = [];
  if (patches.length) steps.push({ op: "patch", collection: "guests", items: patches });
  for (const c of ["guests", "tables", "meals"]) if (gone[c].length) steps.push({ op: "remove", collection: c, ids: gone[c] });
  return { steps, removed: { guests: gone.guests.length, tables: gone.tables.length, meals: gone.meals.length } };
}
