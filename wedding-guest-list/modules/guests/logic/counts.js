// Pure counting for the guest strip, the "attending, no meal" list and the caterer sheet. No DOM, no store, no imports.
// Only rsvp "yes" guests are counted in meal tables; seated "pending" guests are reported separately (spec 5c, E2).

// Strip numbers. Adults and children are counted among attending guests; an unknown rsvp counts as pending.
export function counts(guests) {
  const c = { invited: 0, attending: 0, declined: 0, pending: 0, adults: 0, children: 0 };
  for (const g of guests || []) {
    c.invited++;
    if (g.rsvp === "yes") {
      c.attending++;
      if (g.age === "child") c.children++; else c.adults++;
    } else if (g.rsvp === "no") c.declined++;
    else c.pending++;
  }
  return c;
}

// Attending guests without a (valid) meal, in input order. No meal options defined: nothing is missing.
export function missingMeals(guests, meals) {
  if (!meals || meals.length === 0) return [];
  const ids = new Set(meals.map((m) => m.id));
  return (guests || []).filter((g) => g.rsvp === "yes" && !(g.mealId && ids.has(g.mealId)));
}

const blank = (n) => ({ guests: 0, adults: 0, children: 0, byMeal: Array(n).fill(0), noMeal: 0 });

function add(row, g, mealIndex) {
  row.guests++;
  if (g.age === "child") row.children++; else row.adults++;
  const i = g.mealId ? mealIndex.get(g.mealId) : undefined;
  if (i === undefined) row.noMeal++; else row.byMeal[i]++;
}

// Data of the caterer sheet.
// -> { meals, attending, rows: [{ tableId, number, ...counts }], notSeated, total, seatedPending, balanced }
// `total` is counted on its own from all attending guests; `balanced` says table rows + notSeated add up to it in every column.
export function catererSheet(guests, tables, meals) {
  const ms = [...(meals || [])].sort((a, b) => a.slot - b.slot);
  const mealIndex = new Map(ms.map((m, i) => [m.id, i]));
  const ts = [...(tables || [])].sort((a, b) => a.number - b.number);
  const rowOf = new Map(ts.map((t) => [t.id, { tableId: t.id, number: t.number, ...blank(ms.length) }]));
  const notSeated = blank(ms.length);
  const total = blank(ms.length);
  let seatedPending = 0;
  for (const g of guests || []) {
    const row = g.tableId ? rowOf.get(g.tableId) : undefined;
    if (g.rsvp === "pending" && row) seatedPending++;
    if (g.rsvp !== "yes") continue;
    add(total, g, mealIndex);
    add(row || notSeated, g, mealIndex);
  }
  const rows = ts.map((t) => rowOf.get(t.id));
  const parts = [...rows, notSeated];
  const sum = (pick) => parts.reduce((a, r) => a + pick(r), 0);
  const balanced = sum((r) => r.guests) === total.guests && sum((r) => r.adults) === total.adults
    && sum((r) => r.children) === total.children && sum((r) => r.noMeal) === total.noMeal
    && total.byMeal.every((n, i) => sum((r) => r.byMeal[i]) === n);
  return { meals: ms, attending: total.guests, rows, notSeated, total, seatedPending, balanced };
}
