// Shared data helpers of the Planner views: reading the three collections and applying write plans.
// Every write goes through store.transact (one step per collection). Order of collections: meals, tables, guests (spec 3).
import { orderWrites, PLAN_DEFAULTS, sanitize } from "./logic/schema.js";
import { sampleData } from "./logic/sample.js";

const arr = (v) => (Array.isArray(v) ? v.filter((r) => r && typeof r === "object") : []);

export const now = () => new Date().toISOString();

let counter = 0;
export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  counter += 1;
  return `id-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

// -> { guests, tables, meals } (lists of records; anything that is not an object is left out)
export async function loadData(store) {
  const [guests, tables, meals] = await Promise.all(["guests", "tables", "meals"].map((c) => store.list(c)));
  return { guests: arr(guests), tables: arr(tables), meals: arr(meals) };
}

// Adds records that already carry their id (the importer and the sample make their own); stamps are added here.
// Safe to repeat: the decision is made inside the store lock on the list as it is saved NOW, so a double click or a second tab
// cannot add a record twice: an id that is already saved is skipped (result = number really added).
// check(have, adding, list) runs in the lock before the write; it throws to refuse (demo limit, a taken table number, ...).
export function addRecords(store, collection, items, check) {
  const t = now();
  return store.transact(collection, (list) => {
    const saved = new Set(list.map((r) => r.id));
    const fresh = items.filter((r) => !saved.has(r.id));
    if (check) check(list.length, fresh.length, list);
    return { list: [...list, ...fresh.map((r) => ({ ...r, createdAt: t, updatedAt: t }))], result: fresh.length };
  });
}

// First-open sample (demo). Writes only when guests, tables and meals are ALL empty at the moment of the first write, decided in
// the lock of the first collection written (meals): two tabs that open at once cannot both seed. -> true when this call seeded.
export async function seedIfEmpty(store, steps) {
  const adds = orderWrites(steps).filter((s) => s.op === "add");
  if (!adds.length) return false;
  const [first, ...rest] = adds;
  const t = now();
  const won = await store.transact(first.collection, async (list) => {
    const all = await Promise.all(["guests", "tables", "meals"].map((c) => store.list(c)));
    if (all.some((l) => Array.isArray(l) && l.length > 0)) return { list, result: false };
    return { list: [...list, ...first.items.map((r) => ({ ...r, createdAt: t, updatedAt: t }))], result: true };
  });
  if (!won) return false;
  for (const s of rest) await addRecords(store, s.collection, s.items);
  return true;
}

// Steps { op: "add" | "patch" | "remove", collection, items | ids } of tables.js / sample.js, in write order (schema.js orderWrites).
export async function applySteps(store, steps) {
  for (const s of orderWrites(steps)) {
    const t = now();
    if (s.op === "add") await addRecords(store, s.collection, s.items);
    else if (s.op === "patch") {
      const by = new Map(s.items.map((i) => [i.id, i.patch]));
      await store.transact(s.collection, (list) => ({ list: list.map((r) => (by.has(r.id) ? { ...r, ...by.get(r.id), updatedAt: t } : r)), result: by.size }));
    } else if (s.op === "remove") {
      const gone = new Set(s.ids);
      await store.transact(s.collection, (list) => ({ list: list.filter((r) => !gone.has(r.id)), result: gone.size }));
    }
  }
}

// ---- Added with the Tables / Check views (U3, U4) ----

// The plan record (one per store, see schema.js PLAN_DEFAULTS): the saved record over the defaults, or the defaults.
export async function loadPlan(store) {
  const list = await store.list("plan");
  const rec = Array.isArray(list) ? list.find((r) => r && typeof r === "object") : null;
  return { ...PLAN_DEFAULTS, ...(rec || {}) };
}

// Writes fields of the plan record; the first write creates the record with every default (what sanitize expects).
export function savePlan(store, patch) {
  return store.transact("plan", (list) => {
    const t = now();
    const rest = list.slice(1);
    const next = list.length ? { ...list[0], ...patch, updatedAt: t } : { id: newId(), ...PLAN_DEFAULTS, ...patch, createdAt: t, updatedAt: t };
    return { list: [next, ...rest], result: null };
  });
}

// Repairs the saved data once at start-up (schema.js `sanitize`). Writes only when something needed repair.
// -> null (nothing to repair) or { records, guestsLost }: records = distinct records that were repaired (a fix without a record, such
// as a dropped collection, counts as one), guestsLost = guest entries that were not objects and could not be kept.
// The write is made only if the saved data is still what was repaired (store.importAll `ifUnchanged`, checked in the lock): a change
// made by another tab in between is never overwritten; the repair is tried again on the new data (a few times), else at the next start.
export async function repairSaved(store) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const saved = await store.exportAll();
    const { data, fixes } = sanitize(saved);
    if (!fixes.length) return null;
    if (await store.importAll(data, { ifUnchanged: saved })) return summarize(fixes);
  }
  return null;
}

// fixes (schema.js sanitize) -> { records, guestsLost } (see repairSaved)
export function summarize(fixes) {
  const seen = new Set();
  let guestsLost = 0;
  fixes.forEach((f, i) => {
    seen.add(f.id ? `${f.collection}/${f.id}` : `#${i}`);
    if (f.collection === "guests" && f.kind === "dropped") guestsLost++;
  });
  return { records: seen.size, guestsLost };
}

// Backup restore, step before anything is written (core/backup.js setRestorePreparer): the backup data goes through `sanitize` first,
// so raw data is never saved. In the demo a backup with more own guests / tables than the demo holds is REFUSED (nothing changes):
// the import keeps "the first N", but a restore replaces everything, and a silently cut list would be a worse surprise than a clear
// "no". Records of the built-in sample (its exact ids) do not count: the demo opens with 40 sample guests and its own backups must restore.
// -> { data, report: { records, guestsLost } | null }
// Only the ids of the built-in sample are exempt; a hand-made file whose ids merely start with "sample-" counts like any other.
const SAMPLE_IDS = new Set(Object.values(sampleData()).flatMap((l) => l.map((r) => r.id)));

export function prepareRestore(data, { limits = {} } = {}) {
  const { data: clean, fixes } = sanitize(data);
  for (const c of ["guests", "tables"]) {
    const limit = limits[c];
    if (!Number.isFinite(limit)) continue;
    const own = (clean[c] || []).filter((r) => !SAMPLE_IDS.has(r.id)).length;
    if (own > limit) throw Object.assign(new Error(`Demo limit: ${own} ${c} in the backup, the demo holds ${limit}.`), { name: "BackupError", code: "demo_limit" });
  }
  return { data: clean, report: fixes.length ? summarize(fixes) : null };
}
