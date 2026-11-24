// Pure value normalisation for the guest import: RSVP, age, meals, tables and field limits.
// No DOM, no store, no imports. Lookup tables are Map / Set so odd values such as "__proto__" are safe.

export const LIMITS = Object.freeze({ name: 100, party: 60, notes: 500, meal: 24 });

const MAX_MEALS = 6;
const MAX_TABLE_NUMBER = 999;
const MAX_TABLE_CAPACITY = 40;
const DEFAULT_TABLE_CAPACITY = 10;

const key = (v) => String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const cut = (text, max) => {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
};

const RSVP = new Map();
for (const v of ["yes", "y", "attending", "accepted", "accept", "will attend", "joyfully accepts", "coming", "confirmed", "true", "1"]) RSVP.set(v, "yes");
for (const v of ["no", "n", "declined", "decline", "not attending", "regrets", "regretfully declines", "cannot attend", "not coming", "false", "0"]) RSVP.set(v, "no");
for (const v of ["", "pending", "no response", "awaiting", "invited", "not responded", "maybe", "tbd", "-"]) RSVP.set(v, "pending");

// Values that mean "nothing chosen" (audit O11: they must not open an option or a table).
// Meals: exactly the spec 4 list. Tables: the same plus "unassigned" and typographic dashes.
const MEAL_NONE = new Set(["", "-", "none", "n/a", "na", "tbd", "not selected"]);
const TABLE_NONE = new Set(["", "-", "\u2013", "\u2014", "none", "n/a", "na", "tbd", "not selected", "unassigned"]);

export function normalizeRsvp(value) {
  const hit = RSVP.get(key(value));
  return hit ? { value: hit, recognized: true } : { value: "pending", recognized: false };
}

// Whole column: values plus the unrecognised ones with the number of rows each (first-seen spelling).
export function normalizeRsvpColumn(values) {
  const seen = new Map();
  const out = values.map((v) => {
    const r = normalizeRsvp(v);
    if (!r.recognized) {
      const k = key(v), e = seen.get(k);
      if (e) e.rows++; else seen.set(k, { value: String(v).trim(), rows: 1 });
    }
    return r.value;
  });
  return { values: out, unrecognized: [...seen.values()] };
}

const CHILD_HEADERS = new Set(["child", "is child", "kid", "is kid", "ischild"]);
const TRUTHY = new Set(["yes", "true", "1", "x", "y"]);
const CHILD_WORDS = /child|kid|infant|baby/;

export function normalizeAge(value, opts = {}) {
  const v = key(value);
  const header = key(opts.header).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (CHILD_HEADERS.has(header)) return TRUTHY.has(v) || CHILD_WORDS.test(v) ? "child" : "adult";
  if (CHILD_WORDS.test(v)) return "child";
  if (/^\d{1,2}$/.test(v) && Number(v) <= 12) return "child";
  return "adult";
}

// Meals: map values to existing options (case-insensitive) or open new ones, at most `max` options in total.
// Over the limit, the most frequent values stay (ties: first seen); the rest become "no meal" and are reported.
export function normalizeMeals(values, opts = {}) {
  const existing = opts.existing || [];
  const max = opts.max ?? MAX_MEALS;
  const byKey = new Map(existing.map((l) => [key(l), l]));
  const truncated = [];
  const cands = new Map(); // key -> { label, rows, first }
  const keys = values.map((raw, i) => {
    let label = String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
    if (MEAL_NONE.has(label.toLowerCase())) return null;
    const clipped = cut(label, LIMITS.meal);
    if (clipped !== label) {
      if (!truncated.some((t) => t.label === label)) truncated.push({ label });
      label = clipped;
    }
    const k = key(label);
    if (!byKey.has(k)) {
      const c = cands.get(k);
      if (c) c.rows++; else cands.set(k, { label, rows: 1, first: i });
    }
    return k;
  });
  const free = Math.max(0, max - existing.length);
  const ranked = [...cands.entries()].sort((a, b) => b[1].rows - a[1].rows || a[1].first - b[1].first);
  const keep = new Map(ranked.slice(0, free));
  const dropped = ranked.slice(free).map(([, c]) => ({ label: c.label, rows: c.rows }));
  const newLabels = [...keep.values()].sort((a, b) => a.first - b.first).map((c) => c.label);
  const labels = keys.map((k) => {
    if (k === null) return null;
    if (byKey.has(k)) return byKey.get(k);
    return keep.has(k) ? keep.get(k).label : null;
  });
  return { labels, newLabels, dropped, truncated };
}

// One table cell: "4", "Table 4", "#4" are numbers; other text is a table name that only lives in the import report
// (the file's own label for a table, mapped to a number); 0, 1000+ and 4.5 are invalid.
// "1,000" / "1.000" is a thousands group (1000), not 1: a three-digit group after the separator is out of range.
export function parseTableValue(value) {
  const text = String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (TABLE_NONE.has(text.toLowerCase())) return { kind: "none" };
  const m = /^(?:(?:table|tbl)\s*)?#?\s*(-?\d+)(?:[.,](\d+))?$/i.exec(text);
  if (m) {
    const frac = m[2];
    if (frac && frac.length >= 3) return { kind: "invalid", reason: "out_of_range", value: text };
    if (frac && /[1-9]/.test(frac)) return { kind: "invalid", reason: "not_integer", value: text };
    const n = Number(m[1]);
    if (n < 1 || n > MAX_TABLE_NUMBER) return { kind: "invalid", reason: "out_of_range", value: text };
    return { kind: "number", number: n };
  }
  return { kind: "name", name: text };
}

// Table column -> table numbers per row plus the tables that have to be created ({ number, capacity }).
// Numbers named in the file (and existing tables) are reserved first; a table name then takes the smallest free number,
// the same name always the same number; `named` lists these for the report ("'Head Table' -> Table 7").
// New tables get capacity max(10, assigned), at most 40; more than 40 assigned is reported, not refused.
export function assignTables(values, opts = {}) {
  const existing = opts.existing || [];
  const parsed = values.map(parseTableValue);
  const used = new Set(existing.map((t) => t.number));
  const byName = new Map();
  for (const p of parsed) if (p.kind === "number") used.add(p.number);
  const invalid = new Map();
  const named = new Map(); // key -> { name, number, rows }
  const counts = new Map();
  const nextFree = () => {
    for (let n = 1; n <= MAX_TABLE_NUMBER; n++) if (!used.has(n)) return n;
    return null;
  };
  const numbers = parsed.map((p) => {
    let number = null;
    if (p.kind === "number") number = p.number;
    else if (p.kind === "name") {
      const k = key(p.name);
      if (byName.has(k)) number = byName.get(k);
      else {
        number = nextFree();
        if (number !== null) { used.add(number); byName.set(k, number); }
      }
      if (number !== null) {
        const e = named.get(k);
        if (e) e.rows++; else named.set(k, { name: p.name, number, rows: 1 });
      } else {
        const e = invalid.get("n:" + k);
        if (e) e.rows++; else invalid.set("n:" + k, { value: p.name, rows: 1, reason: "no_free_number" });
      }
    } else if (p.kind === "invalid") {
      const e = invalid.get(p.value);
      if (e) e.rows++; else invalid.set(p.value, { value: p.value, rows: 1, reason: p.reason });
    }
    if (number !== null) counts.set(number, (counts.get(number) || 0) + 1);
    return number;
  });
  const have = new Set(existing.map((t) => t.number));
  const tables = [...counts.keys()].filter((n) => !have.has(n)).sort((a, b) => a - b).map((number) => ({
    number,
    capacity: Math.min(MAX_TABLE_CAPACITY, Math.max(DEFAULT_TABLE_CAPACITY, counts.get(number))),
  }));
  const overCapacity = [...counts.entries()].filter(([, c]) => c > MAX_TABLE_CAPACITY).map(([number, assigned]) => ({ number, assigned }));
  return { numbers, tables, named: [...named.values()], invalid: [...invalid.values()], overCapacity };
}

// Invisible and control characters (bidi overrides, zero-width, NUL ...): the same two rules as the CSV path (parse.js cleanCell) and
// schema.js `text`. Tab, line feed and carriage return stay (a note may have lines).
export const stripInvisible = (s) => s.replace(/[\u200B-\u200F\uFEFF\u202A-\u202E\u2066-\u2069]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

// Field limits by code point (never in the middle of an emoji); `kind` is one of LIMITS' keys.
export function clampField(kind, value) {
  const text = stripInvisible(String(value ?? "")).normalize("NFC");
  const value2 = cut(text, LIMITS[kind]);
  return { value: value2, truncated: value2 !== text };
}

// Whole column; `rowNumbers` are the source line numbers used in the report.
export function clampColumn(kind, values, rowNumbers = []) {
  const truncated = [];
  const out = values.map((v, i) => {
    const r = clampField(kind, v);
    if (r.truncated) truncated.push({ kind, row: rowNumbers[i] ?? i + 1, from: Array.from(String(v).normalize("NFC")).length, to: LIMITS[kind] });
    return r.value;
  });
  return { values: out, truncated };
}
