// Import pipeline without any DOM: parsed rows + column mapping -> guests, meals, tables and a structured report.
// The logic files decide every rule; this file only chains them (mapping -> names -> normalise -> duplicates -> tables).
// Text for the report comes from messages.js (the view builds it from the codes and numbers returned here).
import { applyMapping } from "./logic/mapping.js";
import { splitName } from "./logic/names.js";
import { assignTables, clampColumn, normalizeAge, normalizeMeals, normalizeRsvp, parseTableValue } from "./logic/normalize.js";
import { dropRefusedTables, planImport, takeTablesWithinLimit } from "./logic/duplicates.js";
import { newId } from "./data.js";

const MAX_MEALS = 6;
const key = (v) => String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

// Groups source lines by a text value: [{ value, lines }] in first-seen order.
function groupLines(entries) {
  const by = new Map();
  for (const [value, line] of entries) {
    const k = key(value);
    const e = by.get(k);
    if (e) e.lines.push(line); else by.set(k, { value, lines: [line] });
  }
  return [...by.values()];
}

// o: { rows, rowNumbers, header, mapping, existing: { guests, tables, meals }, limits: { guests, tables } (Infinity = none),
//      exclude: Set of source lines the user chose not to import, source: "paste" | "csv", repeatedRows: [lines], parseReport }
export function buildImport(o) {
  const existing = { guests: o.existing?.guests ?? [], tables: o.existing?.tables ?? [], meals: o.existing?.meals ?? [] };
  const limits = { guests: o.limits?.guests ?? Infinity, tables: o.limits?.tables ?? Infinity };
  const exclude = o.exclude ?? new Set();
  const { records: mapped, missingName, ageHeader } = applyMapping(o.rows, o.mapping, { header: o.header, rowNumbers: o.rowNumbers });
  const dataRows = o.rows.length - (o.header ? 1 : 0);

  // 1. names (single column: split; first / last columns: as they are), then people without any name
  const noName = [...missingName];
  let recs = [];
  for (const r of mapped) {
    const sp = r.name !== "" ? splitName(r.name) : { first: r.first, last: r.last, twoPeople: false };
    if (sp.first === "" && sp.last === "") noName.push(r.line);
    else recs.push({ ...r, first: sp.first, last: sp.last, twoPeople: sp.twoPeople, nameText: r.name });
  }
  noName.sort((a, b) => a - b);
  recs = recs.filter((r) => !exclude.has(r.line));
  const lines = recs.map((r) => r.line);

  // 2. field limits (by code point)
  const cuts = [];
  const clamp = (kind, field) => {
    const c = clampColumn(kind, recs.map((r) => r[field]), lines);
    cuts.push(...c.truncated.map((x) => ({ ...x, field })));
    return c.values;
  };
  const first = clamp("name", "first");
  const last = clamp("name", "last");
  const party = clamp("party", "party");
  const notes = clamp("notes", "notes");

  // 3. RSVP, age, meals
  const rsvpRes = recs.map((r) => normalizeRsvp(r.rsvp));
  const unknownRsvp = groupLines(recs.flatMap((r, i) => (rsvpRes[i].recognized ? [] : [[r.rsvp, r.line]])));
  const age = recs.map((r) => normalizeAge(r.age, { header: ageHeader }));
  const mealRes = normalizeMeals(recs.map((r) => r.meal), { existing: existing.meals.map((m) => String(m.label ?? "")), max: MAX_MEALS });

  // 4. duplicates and demo limit
  const incoming = recs.map((_, i) => ({ first: first[i], last: last[i], party: party[i] }));
  const plan = planImport(incoming, existing.guests, { guestLimit: limits.guests });
  const add = plan.add;

  // 5. tables (only for the guests that are really added)
  const tableMapped = o.mapping.includes("table");
  let numbers = add.map(() => null);
  let newTables = [], named = [], invalid = [], overCapacity = [], refusedTables = [], unseatedByLimit = 0;
  if (tableMapped) {
    const values = add.map((i) => recs[i].table);
    const a = assignTables(values, { existing: existing.tables });
    numbers = a.numbers;
    overCapacity = a.overCapacity;
    const wanted = new Map(a.tables.map((t) => [t.number, t]));
    const lim = takeTablesWithinLimit(a.numbers.filter((n) => n !== null), existing.tables.map((t) => t.number), limits.tables);
    refusedTables = lim.refused;
    const dropped = dropRefusedTables(numbers, lim.refused);
    numbers = dropped.numbers;
    unseatedByLimit = dropped.unseated;
    newTables = lim.create.filter((n) => wanted.has(n)).map((n) => ({ id: newId(), number: n, capacity: wanted.get(n).capacity }));
    // report: names mapped to numbers and invalid cells, with their source lines
    const parsed = add.map((i) => ({ p: parseTableValue(recs[i].table), line: recs[i].line }));
    named = a.named.map((n) => ({ name: n.name, number: n.number, lines: parsed.filter((x) => x.p.kind === "name" && key(x.p.name) === key(n.name)).map((x) => x.line) }));
    invalid = a.invalid.map((v) => ({
      value: v.value, reason: v.reason,
      lines: parsed.filter((x) => (x.p.kind === "invalid" && x.p.value === v.value) || (x.p.kind === "name" && key(x.p.name) === key(v.value))).map((x) => x.line),
    }));
  }
  const tableIdOf = new Map(existing.tables.map((t) => [t.number, t.id]));
  for (const t of newTables) tableIdOf.set(t.number, t.id);

  // 6. new meal options with free slots
  const used = new Set(existing.meals.map((m) => m.slot));
  const newMeals = mealRes.newLabels.map((label) => {
    let slot = 0;
    while (used.has(slot)) slot++;
    used.add(slot);
    return { id: newId(), label, slot };
  });
  const mealIdOf = new Map(existing.meals.map((m) => [key(m.label), m.id]));
  for (const m of newMeals) mealIdOf.set(key(m.label), m.id);

  // 7. the guest records (no stamps; the writer adds them)
  const source = o.source === "csv" ? "csv" : "paste";
  const guests = add.map((i, n) => ({
    id: newId(), first: first[i], last: last[i], party: party[i], rsvp: rsvpRes[i].value,
    mealId: mealRes.labels[i] ? mealIdOf.get(key(mealRes.labels[i])) ?? null : null,
    age: age[i], tableId: numbers[n] === null ? null : tableIdOf.get(numbers[n]) ?? null, notes: notes[i], source,
  }));

  // 8. report
  const label = (i) => ({ line: recs[i].line, first: first[i], last: last[i], party: party[i] });
  const repeated = new Set(o.repeatedRows ?? []);
  const possible = [];
  for (const i of add) {
    const f = plan.rows[i].flag;
    if (f === "duplicate") possible.push({ ...label(i), kind: "file", pairLine: recs[plan.rows[i].pairOf].line });
    else if (f === "possible_duplicate") possible.push({ ...label(i), kind: "list" });
    else if (repeated.has(recs[i].line)) possible.push({ ...label(i), kind: "repeated" });
  }
  const sameName = add.filter((i) => plan.rows[i].flag === "same_name").map(label);
  const meta = o.parseReport ?? {};
  const report = {
    skippedDuplicates: recs.map((_, i) => i).filter((i) => plan.rows[i].reason === "duplicate").map(label),
    limited: recs.map((_, i) => i).filter((i) => plan.rows[i].reason === "limit").map(label),
    noName,
    possible,
    sameName,
    twoPeople: add.filter((i) => recs[i].twoPeople).map((i) => ({ line: recs[i].line, text: recs[i].nameText })),
    unknownRsvp, named, invalid, overCapacity, cuts,
    mealCuts: mealRes.truncated, mealsDropped: mealRes.dropped,
    cellCuts: (meta.truncatedCells ?? []).map((c) => c.row),
    emptyRows: [...(meta.blankRows ?? []), ...(meta.repeatedHeaders ?? [])].sort((a, b) => a - b),
    emptyRowCount: (meta.blankRowCount ?? 0) + (meta.repeatedHeaders ?? []).length,
    extraCells: meta.extraCells ?? [],
    unclosedQuotes: meta.unclosedQuotes ?? [],
    refusedTables, unseatedByLimit,
  };
  return { guests, newMeals, newTables, report, counts: { rows: dataRows, guests: guests.length, meals: newMeals.length, tables: newTables.length } };
}

// Normalised cell values of the first rows for the preview (spec 3: what will be imported, not the raw text).
// -> [{ line, name, first, last, party, rsvp ("yes" | "no" | "pending"), meal, age, table (number | null), notes }]
export function previewRows(o, count = 5) {
  const { records, ageHeader } = applyMapping(o.rows, o.mapping, { header: o.header, rowNumbers: o.rowNumbers });
  const existing = o.existing ?? {};
  const meals = normalizeMeals(records.map((r) => r.meal), { existing: (existing.meals ?? []).map((m) => String(m.label ?? "")), max: MAX_MEALS });
  const tables = o.mapping.includes("table") ? assignTables(records.map((r) => r.table), { existing: existing.tables ?? [] }).numbers : [];
  return records.slice(0, count).map((r, i) => ({
    line: r.line, name: r.name, first: r.first, last: r.last, party: clampColumn("party", [r.party]).values[0],
    rsvp: normalizeRsvp(r.rsvp).value, meal: meals.labels[i] ?? "", age: normalizeAge(r.age, { header: ageHeader }),
    table: tables[i] ?? null, notes: clampColumn("notes", [r.notes]).values[0],
  }));
}
