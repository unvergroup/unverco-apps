// Veri islemleri (depo uzerinde) + bellekte geri al yigini (son 20 islem; kalici degil).
// Her dokunus aninda depoya yazilir. (habitId, date) basina tek kayit; value 0 ve rest false olan kayit silinir.
import { ENTRIES, HABITS, LIMITS, PREFS, PREFS_ID, clampValue, defaultPrefs, sanitizePrefs, validateHabit } from "./schema.js";
import { targetOf } from "./calc.js";

export const UNDO_MAX = 20;

export class HabitError extends Error {
  constructor(code, message) { super(message); this.name = "HabitError"; this.code = code; }
}

const clone = (v) => (v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)));

export function createRepo(store, { weekStartDefault = 1 } = {}) {
  const stack = [];
  const push = (op) => { stack.push(op); if (stack.length > UNDO_MAX) stack.shift(); };

  const repo = {
    undoSize: () => stack.length,
    clearUndo: () => { stack.length = 0; },

    async getPrefs() {
      const list = await store.list(PREFS);
      const r = list.find((p) => p.id === PREFS_ID);
      return r ? sanitizePrefs(r, weekStartDefault) : defaultPrefs(weekStartDefault);
    },
    async savePrefs(patch) {
      return store.transact(PREFS, (list) => {
        const i = list.findIndex((p) => p.id === PREFS_ID);
        const cur = i >= 0 ? sanitizePrefs(list[i], weekStartDefault) : defaultPrefs(weekStartDefault);
        const t = new Date().toISOString();
        const rec = { ...(i >= 0 ? list[i] : { createdAt: t }), ...sanitizePrefs({ ...cur, ...patch }, weekStartDefault), id: PREFS_ID, updatedAt: t };
        if (i >= 0) list[i] = rec; else list.push(rec);
        return { list, result: sanitizePrefs(rec, weekStartDefault) };
      });
    },

    async load() {
      const [habits, entries, prefs] = [await store.list(HABITS), await store.list(ENTRIES), await repo.getPrefs()];
      habits.sort((a, b) => a.order - b.order);
      return { habits, entries, prefs };
    },

    /** Yeni aliskanliklar (toplu). Sinir: 200 (nazik hata habit_limit). */
    async addHabits(list, today) {
      const clean = list.map((f) => {
        const v = validateHabit(f);
        if (!v.ok) throw new HabitError("invalid", Object.values(v.errors)[0]);
        return v.value;
      });
      return store.transactMany([HABITS], (tx) => {
        const cur = tx.list(HABITS);
        if (cur.length + clean.length > LIMITS.habits) throw new HabitError("habit_limit", "Habit limit reached.");
        let order = cur.reduce((m, h) => Math.max(m, h.order ?? 0), -1);
        return clean.map((v) => tx.add(HABITS, { ...v, order: ++order, archived: false, createdOn: today }));
      });
    },
    async addHabit(f, today, { record = true } = {}) {
      const rec = (await repo.addHabits([f], today))[0];
      if (record) push({ type: "add", id: rec.id });
      return rec;
    },

    async updateHabit(id, fields, { record = true } = {}) {
      const v = validateHabit(fields);
      if (!v.ok) throw new HabitError("invalid", Object.values(v.errors)[0]);
      const prev = await store.get(HABITS, id);
      const rec = await store.update(HABITS, id, v.value);
      if (record && prev) push({ type: "edit", id, prev: clone(prev) });
      return rec;
    },

    /** Sirada bir yukari (-1) / asagi (+1); yalniz arsivde olmayanlar arasinda. */
    async move(id, dir) {
      return store.transact(HABITS, (list) => {
        const act = list.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
        const i = act.findIndex((h) => h.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= act.length) return { list, result: false };
        [act[i], act[j]] = [act[j], act[i]];
        act.forEach((h, k) => { h.order = k; });
        let k = act.length;
        for (const h of list.filter((x) => x.archived).sort((a, b) => a.order - b.order)) h.order = k++;
        return { list, result: true };
      });
    },

    async setArchived(id, archived, { record = true } = {}) {
      const cur = await store.get(HABITS, id);
      if (!cur) throw new HabitError("not_found", "Habit not found.");
      if (record) push({ type: "archive", id, prev: cur.archived === true });
      return store.update(HABITS, id, { archived });
    },

    /** Kalici silme: aliskanlik ve tum kayitlari tek atomik yazmada. */
    async deleteForever(id) {
      const snap = await store.transactMany([HABITS, ENTRIES], (tx) => {
        const habit = clone(tx.get(HABITS, id));
        const entries = tx.list(ENTRIES).filter((e) => e.habitId === id).map(clone);
        tx.remove(HABITS, id);
        for (const e of entries) tx.remove(ENTRIES, e.id);
        return { habit, entries };
      });
      if (snap.habit) push({ type: "delete", habit: snap.habit, entries: snap.entries });
    },

    /**
     * Bir gunun kaydini degistirir. next: { value?, rest? } ya da fn(onceki { value, rest }) -> { value, rest }.
     * Doner { before, after } (kayit ya da null). record=false: geri al yiginina yazmaz (geri alma isleminin kendisi).
     */
    async setEntry(habitId, date, next, { record = true } = {}) {
      const res = await store.transact(ENTRIES, (list) => {
        const i = list.findIndex((e) => e.habitId === habitId && e.date === date);
        const before = i >= 0 ? clone(list[i]) : null;
        const prev = { value: before && !before.rest ? before.value : 0, rest: Boolean(before && before.rest) };
        const want = typeof next === "function" ? next(prev) : { ...prev, ...next };
        const rest = want.rest === true;
        const value = rest ? 0 : clampValue(want.value);
        let after = null;
        if (!rest && value === 0) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) { list[i] = { ...list[i], value, rest, updatedAt: new Date().toISOString() }; after = clone(list[i]); }
        else {
          const t = new Date().toISOString();
          after = { id: newId(), habitId, date, value, rest, createdAt: t, updatedAt: t };
          list.push(after);
        }
        return { list, result: { before, after } };
      });
      const same = JSON.stringify(res.before && { v: res.before.value, r: res.before.rest }) === JSON.stringify(res.after && { v: res.after.value, r: res.after.rest });
      if (record && !same) push({ type: "entry", habitId, date, prev: res.before });
      return res;
    },

    toggleCheck: (habit, date) => repo.setEntry(habit.id, date, (p) => ({ value: !p.rest && p.value >= targetOf(habit) ? 0 : targetOf(habit), rest: false })),
    step: (habit, date, delta) => repo.setEntry(habit.id, date, (p) => ({ value: (p.rest ? 0 : p.value) + delta, rest: false })),
    setValue: (habit, date, value) => repo.setEntry(habit.id, date, { value, rest: false }),
    toggleRest: (habit, date) => repo.setEntry(habit.id, date, (p) => ({ value: 0, rest: !p.rest })),

    /** Son islemi geri alir. Doner: geri alinan islem ya da null. */
    async undo() {
      const op = stack.pop();
      if (!op) return null;
      if (op.type === "archive") {
        await repo.setArchived(op.id, op.prev, { record: false });
      } else if (op.type === "edit") {
        await store.transact(HABITS, (list) => { const i = list.findIndex((h) => h.id === op.id); if (i >= 0) list[i] = op.prev; return { list, result: true }; });
      } else if (op.type === "add") {
        await store.transactMany([HABITS, ENTRIES], (tx) => { tx.remove(HABITS, op.id); for (const e of tx.list(ENTRIES)) if (e.habitId === op.id) tx.remove(ENTRIES, e.id); });
      } else if (op.type === "delete") {
        // Kalici silmenin geri alinmasi: aliskanlik ve kayitlari ozgun kimlikleriyle geri yazilir.
        await store.transact(HABITS, (list) => { if (!list.some((h) => h.id === op.habit.id)) list.push(op.habit); return { list, result: true }; });
        await store.transact(ENTRIES, (list) => { const have = new Set(list.map((e) => e.id)); for (const e of op.entries) if (!have.has(e.id)) list.push(e); return { list, result: true }; });
      } else if (op.type === "entry") {
        await store.transact(ENTRIES, (list) => {
          const i = list.findIndex((e) => e.habitId === op.habitId && e.date === op.date);
          if (i >= 0) list.splice(i, 1);
          if (op.prev) list.push(op.prev);
          return { list, result: true };
        });
      }
      return op;
    },
  };
  return repo;
}

let n = 0;
function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  n += 1;
  return `e-${Date.now().toString(36)}-${n}-${Math.random().toString(36).slice(2, 8)}`;
}
