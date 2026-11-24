// Pure column mapping for the guest import: header detection, synonym table, priority rules, manual mapping.
// No DOM, no store, no imports. Lookups use Map / Set, so headers such as "constructor" or "__proto__" are safe.
//
// mapHeader(text)           -> { field, how: "exact" | "contains" } | null   (one header, exclusions applied)
// mapHeaders(cells)         -> field | "ignore" per column (priority rules applied)
// looksLikeHeader(row)      -> boolean (does the row match the synonym table? nothing else is looked at)
// detectHeader(rows)        -> boolean (is the first row a header? synonym match AND the matched values do not come back as data)
// autoMap(rows, opts)       -> { header, mapping, warnings, canImport }
// setColumnField / canImport / applyMapping: manual mapping and raw records for the import step.

export const IGNORE = "ignore";
export const FIELDS = Object.freeze(["name", "first", "last", "party", "rsvp", "meal", "age", "table", "notes"]);

// Synonym table of the spec (section 4). "exact" is compared whole, "contains" as a part of the header.
export const SYNONYMS = Object.freeze({
  name: { exact: ["name", "full name", "guest", "guest name", "guest full name", "attendee", "attendee name"], contains: [] },
  first: { exact: ["first", "first name", "firstname", "given name", "guest first name"], contains: ["first"] },
  last: { exact: ["last", "last name", "lastname", "surname", "family name", "guest last name"], contains: ["last", "surname"] },
  party: {
    exact: ["party", "party name", "party id", "household", "household name", "household id", "group", "group name", "family", "invitation", "invitation name"],
    contains: ["household", "party"],
  },
  rsvp: { exact: ["rsvp", "rsvp status", "status", "attending", "attendance", "response", "reply"], contains: ["attend", "rsvp"] },
  meal: {
    exact: ["meal", "meal choice", "meal selection", "entree", "entrée", "menu", "menu choice", "dinner choice", "food choice"],
    contains: ["meal", "entree", "menu"],
  },
  age: { exact: ["age", "age group", "adult child", "child", "is child", "kid", "guest type"], contains: ["child"] },
  table: { exact: ["table", "table number", "table no", "table #", "table name"], contains: ["table"] },
  notes: { exact: ["notes", "note", "comments", "comment"], contains: [] },
});

// "Contains" is tried in this order, so "Child Meal" is a meal column, not an age column.
const CONTAINS_ORDER = ["rsvp", "meal", "age", "table", "party", "first", "last"];

// A header with one of these words is never matched through "contains" ("Party Size", "Last Updated", "Guest Email").
const BLOCK_WORDS = new Set(["size", "count", "total", "date", "time", "updated", "created", "sent", "notes", "note", "comment",
  "email", "phone", "address", "street", "city", "state", "zip"]);

// Wedding-site export formats that were actually tried with a real export file. Empty: no site name is shown anywhere.
export const TESTED_SOURCES = Object.freeze([]);

// Lower case, accents and punctuation dropped, spaces collapsed.
export function normalizeHeader(text) {
  return String(text ?? "")
    .normalize("NFD").replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const EXACT = new Map();
for (const f of FIELDS) for (const term of SYNONYMS[f].exact) EXACT.set(normalizeHeader(term), f);

function isBlocked(norm) {
  if (` ${norm} `.includes(" number of ")) return true;
  for (const tok of norm.split(" ")) {
    if (BLOCK_WORDS.has(tok) || (tok.length > 1 && tok.endsWith("s") && BLOCK_WORDS.has(tok.slice(0, -1)))) return true;
  }
  return false;
}

export function mapHeader(text) {
  const norm = normalizeHeader(text);
  if (norm === "") return null;
  const exact = EXACT.get(norm);
  if (exact) return { field: exact, how: "exact" };
  if (isBlocked(norm)) return null;
  for (const f of CONTAINS_ORDER) {
    if (SYNONYMS[f].contains.some((w) => norm.includes(w))) return { field: f, how: "contains" };
  }
  return null;
}

// Priority: exact before contains; two candidates for one field keep the leftmost; first / last beat name.
export function mapHeaders(cells) {
  const hits = cells.map((c) => mapHeader(c));
  const out = cells.map(() => IGNORE);
  const taken = new Set();
  for (const how of ["exact", "contains"]) {
    hits.forEach((h, i) => {
      if (!h || h.how !== how || taken.has(h.field)) return;
      taken.add(h.field);
      out[i] = h.field;
    });
  }
  if (taken.has("first") || taken.has("last")) {
    const i = out.indexOf("name");
    if (i >= 0) out[i] = IGNORE;
  }
  return out;
}

// The first row matches the synonym table (exact or contains). A row of data can match too ("Maria Garcia, Attending").
export function looksLikeHeader(row) {
  if (!Array.isArray(row) || row.length === 0) return false;
  if (row.length === 1) return EXACT.has(normalizeHeader(row[0]));
  return row.some((c) => mapHeader(c) !== null);
}

const sameRow = (a, b) => Array.isArray(a) && a.length === b.length && a.every((c, i) => c === b[i]);

// A header word does not come back as data: when the value that matched also stands in the same column of a later row
// (not a full copy of the first row), the first row is a guest row and the list has no header (audit M-O1).
// The caller can always override this decision (parse / autoMap option `header`).
export function detectHeader(rows) {
  const row = rows && rows[0];
  if (!looksLikeHeader(row)) return false;
  const matched = row.length === 1
    ? [0]
    : row.map((c, i) => (mapHeader(c) !== null ? i : -1)).filter((i) => i >= 0);
  const wanted = matched.map((i) => normalizeHeader(row[i]));
  for (let r = 1; r < rows.length; r++) {
    if (sameRow(rows[r], row)) continue;
    for (let k = 0; k < matched.length; k++) {
      if (rows[r] && normalizeHeader(rows[r][matched[k]]) === wanted[k]) return false;
    }
  }
  return true;
}

const PEOPLE_WORDS = new Set(["party", "guest", "people", "attendee"]);
const COUNT_WORDS = new Set(["size", "count", "total"]);
const stem = (tok) => (tok.length > 3 && tok.endsWith("s") ? tok.slice(0, -1) : tok);

// "Party Size" style column whose values are mostly above 1: the file has one row per party.
function partySizeColumns(headers, dataRows) {
  const found = [];
  headers.forEach((h, col) => {
    const norm = normalizeHeader(h);
    const toks = norm.split(" ").map(stem);
    const who = toks.some((t) => PEOPLE_WORDS.has(t));
    const what = toks.some((t) => COUNT_WORDS.has(t)) || ` ${norm} `.includes(" number of ");
    if (!who || !what) return;
    let filled = 0, big = 0;
    for (const r of dataRows) {
      const v = String(r[col] ?? "").trim();
      if (v === "") continue;
      filled++;
      if (/^\d+$/.test(v) && Number(v) > 1) big++;
    }
    if (filled > 0 && big / filled >= 0.1) found.push({ column: col, header: String(h).trim() });
  });
  return found;
}

export function autoMap(rows, opts = {}) {
  const width = rows && rows[0] ? rows[0].length : 0;
  const header = typeof opts.header === "boolean" ? opts.header : detectHeader(rows);
  const warnings = [];
  let mapping;
  if (width === 0) mapping = [];
  else if (header) mapping = mapHeaders(rows[0]);
  else mapping = Array(width).fill(IGNORE);
  // A single column is always the name column unless its header says otherwise.
  if (width === 1 && mapping[0] === IGNORE) mapping = ["name"];
  if (width > 1 && mapping.every((f) => f === IGNORE)) {
    warnings.push({ code: "match_each_column" }); // text: dictionary key guests.import.warn.match_each_column
  }
  if (header) {
    for (const p of partySizeColumns(rows[0], rows.slice(1))) {
      mapping[p.column] = IGNORE;
      // text: dictionary key guests.import.warn.one_row_per_party, parameter {header}
      warnings.push({ code: "one_row_per_party", column: p.column, header: p.header });
    }
  }
  return { header, mapping, warnings, canImport: canImport(mapping) };
}

export function canImport(mapping) {
  return mapping.some((f) => f === "name" || f === "first" || f === "last");
}

// Manual mapping. The same field on a second column clears the first one; name and first / last clear each other
// (the most recent choice wins). Returns a new array.
export function setColumnField(mapping, col, field) {
  if (field !== IGNORE && !FIELDS.includes(field)) throw new Error(`Unknown field: ${field}`);
  const out = mapping.slice();
  if (field !== IGNORE) {
    const clear = field === "name" ? ["name", "first", "last"] : field === "first" || field === "last" ? [field, "name"] : [field];
    for (let i = 0; i < out.length; i++) if (clear.includes(out[i])) out[i] = IGNORE;
  }
  out[col] = field;
  return out;
}

// Raw (still unnormalised) field values per data row. Rows without any name are listed in `missingName`.
export function applyMapping(rows, mapping, opts = {}) {
  const header = opts.header === true;
  const lineOf = (i) => (opts.rowNumbers && opts.rowNumbers[i] !== undefined ? opts.rowNumbers[i] : i + 1);
  const colOf = new Map();
  mapping.forEach((f, i) => { if (f !== IGNORE && !colOf.has(f)) colOf.set(f, i); });
  const useName = !colOf.has("first") && !colOf.has("last");
  const ageCol = colOf.get("age");
  const ageHeader = header && ageCol !== undefined && rows[0] ? String(rows[0][ageCol] ?? "") : "";
  const records = [], missingName = [];
  for (let i = header ? 1 : 0; i < rows.length; i++) {
    const row = rows[i];
    const rec = { line: lineOf(i) };
    for (const f of FIELDS) {
      const c = colOf.get(f);
      rec[f] = c === undefined || (f === "name" && !useName) ? "" : String(row[c] ?? "");
    }
    if (rec.name === "" && rec.first === "" && rec.last === "") missingName.push(rec.line);
    else records.push(rec);
  }
  return { records, missingName, ageHeader };
}
