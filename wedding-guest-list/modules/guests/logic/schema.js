// Data schema, repair and write order (spec 3, audit O20 and O23). Pure logic: no DOM, no store, no imports.
//
// sanitize(data) -> { data, fixes }   data: { collection: [record] } as the store exports it (the input is never changed)
//   fixes: [{ collection, id, field, kind }] in processing order. `kind`:
//     type (wrong type, read as text / number or emptied) · length (cut by code point) · normalized (made NFC)
//     enum (unknown value, default used) · range (number moved into its range) · missing (field absent, default used)
//     slot (meal slot invalid or taken, free slot used) · dangling (reference without a record, emptied)
//     id (no usable id, new one made) · unknown_field (field dropped) · dropped (record dropped)
//     unnamed (a guest had no name after repair: the name became UNNAMED_GUEST, the guest is kept; audit SC-O1)
//     dropped_collection (unknown collection dropped) · bad_collection (collection was not a list) · bad_data (not an object)
//   Order: unknown collections, then meals, tables, guests (references need them), prints, plan.
//
// Repair rules that go beyond the spec text (chosen here, say so if they should change):
//   - a guest with no first and no last name after repair is KEPT as UNNAMED_GUEST (fix kind "unnamed"; the pre-print check lists
//     it); a meal over the sixth is dropped (list order);
//   - a table number outside 1-999 is clamped, a missing / unreadable one gets the lowest unused number; repeated numbers stay
//     (Check 6 reports them); capacity is clamped to 1-40 (0 becomes 1), unreadable capacity becomes 10;
//   - one print record per kind, the last one wins; print entries may name guests that were deleted since (that is how
//     the diff finds removed guests), so their guest ids are not checked;
//   - only the first `plan` record stays;
//   - a print record may carry `options` (the card options at print time, see printdiff.js `optionsOf`); a missing one stays
//     missing (no fix), a malformed one is repaired field by field.
// The ranges of the custom card repeat the limits in cardlayout.js (a logic file does not import another); keep them in step.

// Invisible and control characters (bidi overrides, zero-width, NUL ...) leave every text field, as on the CSV path; the same two rules as
// normalize.js `stripInvisible` (repeated: a logic file does not import another). Tab, line feed and carriage return stay.
const stripInvisible = (s) => s.replace(/[\u200B-\u200F\uFEFF\u202A-\u202E\u2066-\u2069]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

// Name given to a guest whose name is empty after repair. checks.js repeats this text (a logic file does not import another).
export const UNNAMED_GUEST = "(unnamed guest)";

export const COLLECTIONS = Object.freeze(["guests", "tables", "meals", "prints", "plan"]);

export const PLAN_DEFAULTS = Object.freeze({
  signTitle: "Find Your Seat", coupleNames: "", eventDate: "", signSize: "18x24", signColumns: "auto", paper: "letter",
  cardPreset: "tent-3.5x2-letter4", offX100: 0, offY100: 0, showMealOnCards: false, keepParties: true,
});
const CARD_PRESETS = ["tent-3.5x2-letter4", "diy-tent-letter4", "custom"];
const CUSTOM_DEFAULTS = Object.freeze({
  paper: "letter", w100: 8890, h100: 10160, cols: 2, rows: 2, left100: 1905, top100: 3810, gapX100: 0, gapY100: 0, tent: true,
});
const CUSTOM_RANGES = Object.freeze({
  w100: [2000, 20000], h100: [2000, 20000], cols: [1, 10], rows: [1, 10],
  left100: [0, 5000], top100: [0, 5000], gapX100: [0, 2000], gapY100: [0, 2000],
});

const STAMPS = ["createdAt", "updatedAt"];
// A stamp (createdAt / updatedAt / prints.at) is an ISO date or date-time text of at most 40 characters; anything else is dropped.
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const isIso = (v) => typeof v === "string" && v.length <= 40 && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
// Printed names (prints.entries first / last) are cut at this many code points, like the guest fields they copy.
const ENTRY_NAME_MAX = 100;
const ID_MAX = 100; // record, guest and meal ids (own ids are UUIDs; a longer one is a hand-made file and is replaced)
const MAX_MARKS = 6; // one mark per meal slot
// Most entries kept in one print record (the same cap as a collection in a backup: core/backup.js MAX_RECORDS_PER_COLLECTION).
export const MAX_PRINT_ENTRIES = 5000;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.hasOwn(o, k);
const cut = (text, max) => {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
};
// Numbers and numeric text are read as numbers; anything else is NaN.
const num = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return NaN;
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ---- Read guard (spec 3: a reference without a record reads as empty) ----

const hasRecord = (id, records) => typeof id === "string" && id !== "" && Array.isArray(records) && records.some((r) => r && r.id === id);

// The table id of a guest when that table exists, else null.
export function liveTableId(guest, tables) {
  return guest && hasRecord(guest.tableId, tables) ? guest.tableId : null;
}
// The meal id of a guest when that meal exists, else null.
export function liveMealId(guest, meals) {
  return guest && hasRecord(guest.mealId, meals) ? guest.mealId : null;
}

// ---- Write order (O20) ----
// A step is { op: "add" | "patch" | "remove", collection, items | ids }. Order: adds first and the referenced collections first
// (meals, tables, guests, prints, plan); then patches (they empty references); then removes, the referencing collection first.
// The sort is stable and the input array is not changed.
const RANK = new Map(["meals", "tables", "guests", "prints", "plan"].map((c, i) => [c, i]));
const OP_ORDER = new Map([["add", 0], ["patch", 1], ["remove", 2]]);

export function orderWrites(steps) {
  const rank = (s) => (RANK.has(s.collection) ? RANK.get(s.collection) : RANK.size);
  const key = (s) => [OP_ORDER.has(s.op) ? OP_ORDER.get(s.op) : OP_ORDER.size, s.op === "remove" ? -rank(s) : s.op === "add" ? rank(s) : 0];
  return (Array.isArray(steps) ? steps : [])
    .map((s, i) => ({ s, i, k: key(s) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
    .map((e) => e.s);
}

// ---- Repair ----

export function sanitize(input) {
  const fixes = [];
  if (!isObj(input)) {
    return { data: {}, fixes: [{ collection: "", id: "", field: "", kind: "bad_data" }] };
  }
  const out = {};
  const fix = (collection, id, field, kind) => fixes.push({ collection, id, field, kind });
  const listOf = (name) => {
    const v = input[name];
    if (!Array.isArray(v)) {
      fix(name, "", "", "bad_collection");
      return [];
    }
    return v;
  };

  for (const name of Object.keys(input)) if (!COLLECTIONS.includes(name)) fix(name, "", "", "dropped_collection");

  // Common record frame: object check, id, store stamps. Returns the new record (stamps and id only) or null.
  // Ids are looked up in Sets (a list scan per repaired id made a backup with many repeated ids quadratic).
  const usedIds = new Map();
  const rawIds = new Map(); // collection -> every string id found in the input, so a made-up id never takes one of them
  const rawIdsOf = (name) => {
    if (!rawIds.has(name)) {
      const set = new Set();
      if (Array.isArray(input[name])) for (const r of input[name]) if (r && typeof r.id === "string") set.add(r.id);
      rawIds.set(name, set);
    }
    return rawIds.get(name);
  };
  const frame = (name, raw, index) => {
    if (!isObj(raw)) {
      fix(name, "", "", "dropped");
      return null;
    }
    const used = usedIds.get(name) || new Set();
    usedIds.set(name, used);
    let id = raw.id;
    if (typeof id !== "string" || id === "" || id.length > ID_MAX || used.has(id)) {
      const known = rawIdsOf(name);
      let n = index + 1;
      while (used.has(`repaired-${name}-${n}`) || known.has(`repaired-${name}-${n}`)) n++;
      id = `repaired-${name}-${n}`;
      fix(name, id, "id", "id");
    }
    used.add(id);
    const rec = { id };
    for (const s of STAMPS) {
      if (!own(raw, s)) continue;
      if (isIso(raw[s])) rec[s] = raw[s];
      else fix(name, id, s, "type");
    }
    return rec;
  };

  const unknownFields = (name, raw, rec, known) => {
    for (const k of Object.keys(raw)) if (!known.includes(k) && k !== "id" && !STAMPS.includes(k)) fix(name, rec.id, k, "unknown_field");
  };
  // One fix per field; the first reason wins (type, length, normalized).
  const text = (name, raw, rec, field, max, { min = 0, fallback = "" } = {}) => {
    const v = raw[field];
    let s, kind = null;
    if (v === undefined) { s = fallback; kind = "missing"; }
    else if (typeof v === "string") s = v;
    else if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") { s = String(v); kind = "type"; }
    else { s = fallback; kind = "type"; }
    const clean = stripInvisible(s);
    if (!kind && clean !== s) kind = "normalized";
    s = clean;
    const nfc = s.normalize("NFC");
    if (!kind && nfc !== s) kind = "normalized";
    s = nfc;
    const c = cut(s, max);
    if (c !== s) { s = c; if (!kind || kind === "normalized") kind = "length"; }
    if (s.length < min) { s = fallback; if (!kind) kind = "missing"; }
    if (kind) fix(name, rec.id, field, kind);
    rec[field] = s;
  };
  const oneOf = (name, raw, rec, field, values, def) => {
    const v = raw[field];
    if (values.includes(v)) rec[field] = v;
    else { rec[field] = def; fix(name, rec.id, field, v === undefined ? "missing" : "enum"); }
  };
  const int = (name, raw, rec, field, lo, hi, def, { step = 1 } = {}) => {
    const v = raw[field];
    const n = num(v);
    if (v === undefined) { rec[field] = def; fix(name, rec.id, field, "missing"); return; }
    if (!Number.isFinite(n)) { rec[field] = def; fix(name, rec.id, field, "type"); return; }
    const r = clamp(Math.round(n / step) * step, lo, hi);
    rec[field] = r;
    if (typeof v !== "number") fix(name, rec.id, field, "type");
    else if (r !== v) fix(name, rec.id, field, "range");
  };
  const bool = (name, raw, rec, field, def) => {
    const v = raw[field];
    if (typeof v === "boolean") rec[field] = v;
    else { rec[field] = def; fix(name, rec.id, field, v === undefined ? "missing" : "type"); }
  };
  const refId = (name, raw, rec, field) => {
    const v = raw[field];
    if (v === undefined) { rec[field] = null; fix(name, rec.id, field, "missing"); }
    else if (v === null || v === "") rec[field] = null;
    else if (typeof v === "string") rec[field] = v;
    else { rec[field] = null; fix(name, rec.id, field, "type"); }
  };

  // meals: at most six (list order), unique slots 0-5, label 1-24
  const MEAL_FIELDS = ["label", "slot"];
  const mealsRaw = own(input, "meals") ? listOf("meals") : [];
  const meals = [];
  mealsRaw.forEach((raw, i) => {
    const rec = frame("meals", raw, i);
    if (!rec) return;
    if (meals.length >= 6) { fix("meals", rec.id, "", "dropped"); return; }
    meals.push({ rec, raw });
  });
  const taken = new Set();
  const claimed = meals.map(({ raw }) => {
    const ok = Number.isInteger(raw.slot) && raw.slot >= 0 && raw.slot <= 5 && !taken.has(raw.slot);
    if (ok) taken.add(raw.slot);
    return ok;
  });
  meals.forEach(({ rec, raw }, i) => {
    if (claimed[i]) rec.slot = raw.slot;
    else {
      let free = 0;
      while (taken.has(free)) free++;
      taken.add(free);
      rec.slot = free;
      fix("meals", rec.id, "slot", "slot");
    }
    text("meals", raw, rec, "label", 24, { min: 1, fallback: `Meal ${rec.slot + 1}` });
    unknownFields("meals", raw, rec, MEAL_FIELDS);
  });
  if (own(input, "meals")) out.meals = meals.map((m) => m.rec);

  // tables
  const TABLE_FIELDS = ["number", "capacity"];
  const tablesRaw = own(input, "tables") ? listOf("tables") : [];
  const tables = [];
  tablesRaw.forEach((raw, i) => {
    const rec = frame("tables", raw, i);
    if (rec) tables.push({ rec, raw });
  });
  const numbers = new Set(tables.map(({ raw }) => num(raw.number)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 999));
  tables.forEach(({ rec, raw }) => {
    const n = num(raw.number);
    if (Number.isFinite(n)) int("tables", raw, rec, "number", 1, 999, 1);
    else {
      let free = 1;
      while (numbers.has(free) && free < 999) free++;
      numbers.add(free);
      rec.number = free;
      fix("tables", rec.id, "number", raw.number === undefined ? "missing" : "type");
    }
    int("tables", raw, rec, "capacity", 1, 40, 10);
    unknownFields("tables", raw, rec, TABLE_FIELDS);
  });
  if (own(input, "tables")) out.tables = tables.map((t) => t.rec);

  // guests
  const GUEST_FIELDS = ["first", "last", "party", "rsvp", "mealId", "age", "tableId", "notes", "source"];
  const tableIds = new Set((out.tables || []).map((t) => t.id));
  const mealIds = new Set((out.meals || []).map((m) => m.id));
  if (own(input, "guests")) {
    const guests = [];
    listOf("guests").forEach((raw, i) => {
      const rec = frame("guests", raw, i);
      if (!rec) return;
      text("guests", raw, rec, "first", 100);
      text("guests", raw, rec, "last", 100);
      text("guests", raw, rec, "party", 60);
      oneOf("guests", raw, rec, "rsvp", ["yes", "no", "pending"], "pending");
      refId("guests", raw, rec, "mealId");
      oneOf("guests", raw, rec, "age", ["adult", "child"], "adult");
      refId("guests", raw, rec, "tableId");
      text("guests", raw, rec, "notes", 500);
      oneOf("guests", raw, rec, "source", ["paste", "csv", "manual", "sample"], "manual");
      unknownFields("guests", raw, rec, GUEST_FIELDS);
      if (rec.tableId !== null && !tableIds.has(rec.tableId)) { rec.tableId = null; fix("guests", rec.id, "tableId", "dangling"); }
      if (rec.mealId !== null && !mealIds.has(rec.mealId)) { rec.mealId = null; fix("guests", rec.id, "mealId", "dangling"); }
      if (rec.first.trim() === "" && rec.last.trim() === "") { rec.first = UNNAMED_GUEST; rec.last = ""; fix("guests", rec.id, "first", "unnamed"); }
      guests.push(rec);
    });
    out.guests = guests;
  }

  // prints: one record per kind, the last wins
  if (own(input, "prints")) {
    const PRINT_FIELDS = ["kind", "at", "entries", "options"];
    const ENTRY_FIELDS = ["guestId", "first", "last", "tableNumber", "mealId", "rsvp"];
    const prints = [];
    listOf("prints").forEach((raw, i) => {
      const rec = frame("prints", raw, i);
      if (!rec) return;
      if (raw.kind !== "sign" && raw.kind !== "placecards") { fix("prints", rec.id, "kind", "enum"); fix("prints", rec.id, "", "dropped"); return; }
      rec.kind = raw.kind;
      const validAt = isIso(raw.at);
      if (!validAt) { fix("prints", rec.id, "at", raw.at === undefined ? "missing" : "type"); fix("prints", rec.id, "", "dropped"); return; }
      rec.at = raw.at;
      if (Array.isArray(raw.entries)) {
        rec.entries = [];
        if (raw.entries.length > MAX_PRINT_ENTRIES) fix("prints", rec.id, "entries", "dropped");
        for (const e of raw.entries.slice(0, MAX_PRINT_ENTRIES)) {
          if (!isObj(e) || typeof e.guestId !== "string" || e.guestId === "" || e.guestId.length > ID_MAX) { fix("prints", rec.id, "entries", "dropped"); continue; }
          const entry = { guestId: e.guestId };
          for (const f of ["first", "last"]) {
            const nfc = typeof e[f] === "string" ? stripInvisible(e[f]).normalize("NFC") : "";
            entry[f] = cut(nfc, ENTRY_NAME_MAX);
            if (typeof e[f] !== "string") fix("prints", rec.id, `entries.${f}`, "type");
            else if (entry[f] !== nfc) fix("prints", rec.id, `entries.${f}`, "length");
            else if (nfc !== e[f]) fix("prints", rec.id, `entries.${f}`, "normalized");
          }
          const tn = num(e.tableNumber);
          entry.tableNumber = Number.isInteger(tn) && tn >= 1 && tn <= 999 ? tn : null;
          if (e.tableNumber !== null && entry.tableNumber !== e.tableNumber) fix("prints", rec.id, "entries.tableNumber", "type");
          entry.mealId = typeof e.mealId === "string" && e.mealId !== "" && e.mealId.length <= ID_MAX ? e.mealId : null;
          if (e.mealId !== null && e.mealId !== undefined && entry.mealId !== e.mealId) fix("prints", rec.id, "entries.mealId", "type");
          entry.rsvp = ["yes", "no", "pending"].includes(e.rsvp) ? e.rsvp : "pending";
          if (entry.rsvp !== e.rsvp) fix("prints", rec.id, "entries.rsvp", "enum");
          for (const k of Object.keys(e)) if (!ENTRY_FIELDS.includes(k)) fix("prints", rec.id, `entries.${k}`, "unknown_field");
          rec.entries.push(entry);
        }
      } else {
        rec.entries = [];
        fix("prints", rec.id, "entries", raw.entries === undefined ? "missing" : "type");
      }
      if (raw.options !== undefined) {
        const opt = repairPrintOptions(raw.options, (f, k) => fix("prints", rec.id, f ? `options.${f}` : "options", k));
        if (opt) rec.options = opt;
      }
      unknownFields("prints", raw, rec, PRINT_FIELDS);
      prints.push(rec);
    });
    const kept = prints.filter((p, i) => {
      const later = prints.findIndex((q, j) => j > i && q.kind === p.kind) !== -1;
      if (later) fix("prints", p.id, "", "dropped");
      return !later;
    });
    out.prints = kept;
  }

  // plan: one record
  if (own(input, "plan")) {
    const PLAN_FIELDS = [...Object.keys(PLAN_DEFAULTS), "customCard"];
    const list = listOf("plan");
    const plans = [];
    list.forEach((raw, i) => {
      const rec = frame("plan", raw, i);
      if (!rec) return;
      if (plans.length >= 1) { fix("plan", rec.id, "", "dropped"); return; }
      const D = PLAN_DEFAULTS;
      text("plan", raw, rec, "signTitle", 40, { min: 1, fallback: D.signTitle });
      text("plan", raw, rec, "coupleNames", 60);
      const date = raw.eventDate;
      if (date === undefined) { rec.eventDate = ""; fix("plan", rec.id, "eventDate", "missing"); }
      else if (date === "" || validDay(date)) rec.eventDate = date;
      else { rec.eventDate = ""; fix("plan", rec.id, "eventDate", "type"); }
      oneOf("plan", raw, rec, "signSize", ["18x24", "24x36"], D.signSize);
      const cols = raw.signColumns;
      if (cols === "auto") rec.signColumns = "auto";
      else if (cols === undefined) { rec.signColumns = "auto"; fix("plan", rec.id, "signColumns", "missing"); }
      else int("plan", raw, rec, "signColumns", 1, 6, "auto");
      oneOf("plan", raw, rec, "paper", ["letter", "a4"], D.paper);
      oneOf("plan", raw, rec, "cardPreset", CARD_PRESETS, D.cardPreset);
      int("plan", raw, rec, "offX100", -1000, 1000, 0, { step: 50 });
      int("plan", raw, rec, "offY100", -1000, 1000, 0, { step: 50 });
      bool("plan", raw, rec, "showMealOnCards", D.showMealOnCards);
      bool("plan", raw, rec, "keepParties", D.keepParties);
      if (raw.customCard !== undefined) {
        if (isObj(raw.customCard)) rec.customCard = repairCard(raw.customCard, (f, k) => fix("plan", rec.id, `customCard.${f}`, k));
        else fix("plan", rec.id, "customCard", "type");
      }
      if (rec.cardPreset === "custom" && !rec.customCard) { rec.cardPreset = D.cardPreset; fix("plan", rec.id, "cardPreset", "dangling"); }
      unknownFields("plan", raw, rec, PLAN_FIELDS);
      plans.push(rec);
    });
    out.plan = plans;
  }

  return { data: out, fixes };
}

// Card options of a print record (printdiff.js optionsOf). Not an object: left out (reported), so no option comparison is made.
function repairPrintOptions(raw, report) {
  if (!isObj(raw)) { report("", "type"); return null; }
  const D = PLAN_DEFAULTS;
  const out = {};
  if (typeof raw.showMeal === "boolean") out.showMeal = raw.showMeal;
  else { out.showMeal = false; report("showMeal", raw.showMeal === undefined ? "missing" : "type"); }
  out.marks = [];
  if (Array.isArray(raw.marks)) {
    const seen = new Set();
    for (const m of raw.marks) {
      if (!isObj(m) || out.marks.length >= MAX_MARKS || typeof m.mealId !== "string" || m.mealId === "" || m.mealId.length > ID_MAX || seen.has(m.mealId) || !Number.isInteger(m.slot) || m.slot < 0 || m.slot > 5) { report("marks", "dropped"); continue; }
      seen.add(m.mealId);
      const mark = { mealId: m.mealId, slot: m.slot };
      if (typeof m.label === "string") mark.label = cut(m.label, 24); // the meal's name at print time (printdiff.js printedMealLabels)
      else if (m.label !== undefined) report("marks", "type");
      out.marks.push(mark);
    }
  } else report("marks", raw.marks === undefined ? "missing" : "type");
  if (CARD_PRESETS.includes(raw.cardPreset)) out.cardPreset = raw.cardPreset;
  else { out.cardPreset = D.cardPreset; report("cardPreset", raw.cardPreset === undefined ? "missing" : "enum"); }
  out.customCard = null;
  if (out.cardPreset === "custom") {
    if (isObj(raw.customCard)) out.customCard = repairCard(raw.customCard, (f, k) => report(`customCard.${f}`, k));
    else { out.cardPreset = D.cardPreset; report("customCard", raw.customCard === undefined ? "missing" : "type"); }
  }
  for (const f of ["offX100", "offY100"]) {
    const n = num(raw[f]);
    if (!Number.isFinite(n)) { out[f] = 0; report(f, raw[f] === undefined ? "missing" : "type"); continue; }
    out[f] = clamp(Math.round(n / 50) * 50, -1000, 1000);
    if (typeof raw[f] !== "number") report(f, "type");
    else if (out[f] !== raw[f]) report(f, "range");
  }
  return out;
}

function validDay(v) {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function repairCard(raw, report) {
  const D = CUSTOM_DEFAULTS;
  const card = {};
  card.paper = raw.paper === "letter" || raw.paper === "a4" ? raw.paper : D.paper;
  if (card.paper !== raw.paper) report("paper", raw.paper === undefined ? "missing" : "enum");
  for (const [f, [lo, hi]] of Object.entries(CUSTOM_RANGES)) {
    const n = num(raw[f]);
    if (!Number.isFinite(n)) { card[f] = D[f]; report(f, raw[f] === undefined ? "missing" : "type"); continue; }
    card[f] = clamp(Math.round(n), lo, hi);
    if (typeof raw[f] !== "number") report(f, "type");
    else if (card[f] !== raw[f]) report(f, "range");
  }
  card.tent = typeof raw.tent === "boolean" ? raw.tent : D.tent;
  if (typeof raw.tent !== "boolean") report("tent", raw.tent === undefined ? "missing" : "type");
  return card;
}
