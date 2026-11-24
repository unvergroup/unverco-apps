// Pure duplicate detection and import planning (audit O21). No DOM, no store, no imports. Lookups use Map / Set.
//
// A guest is the same person as an existing one when the name key AND the party match (two blank parties match).
// Existing guests are never changed. Inside one file, equal names are all added; they are only flagged:
//   "duplicate" = same name, same filled party (Check 3), "same_name" = same name, other or blank party (Check 5).
// A file guest is skipped as "duplicate" only when the file holds no more guests with that name and party than the list
// already does (importing the same file twice adds nothing). When the file holds MORE (the list has 1, the file 2), nobody is
// skipped: all of them are imported and flagged "possible_duplicate" (audit D-O1: a guest never disappears silently).

const fold = (text) => String(text ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[\s ]+/g, " ").trim();

export function nameKey(first, last) {
  return `${fold(first)}|${fold(last)}`;
}

export function partyKey(party) {
  return String(party ?? "").normalize("NFC").toLowerCase().replace(/[\s ]+/g, " ").trim();
}

export function sameParty(a, b) {
  return partyKey(a) === partyKey(b);
}

const finite = (n) => typeof n === "number" && Number.isFinite(n);

// How many of `count` incoming guests fit under `limit` when `current` already exist. Infinity / undefined: all.
export function takeWithinLimit(count, current, limit) {
  if (!finite(limit)) return { take: count, dropped: 0 };
  const take = Math.max(0, Math.min(count, limit - current));
  return { take, dropped: count - take };
}

// New table numbers the demo may still open. Numbers that already exist cost nothing; each number counts once.
export function takeTablesWithinLimit(needed, existing, limit) {
  const have = new Set(existing);
  const seen = new Set();
  const fresh = [];
  for (const n of needed) {
    if (have.has(n) || seen.has(n)) continue;
    seen.add(n);
    fresh.push(n);
  }
  const { take } = takeWithinLimit(fresh.length, have.size, limit);
  return { create: fresh.slice(0, take), refused: fresh.slice(take) };
}

// Guests whose table was refused stay without a table.
export function dropRefusedTables(numbers, refused) {
  const no = new Set(refused);
  let unseated = 0;
  const out = numbers.map((n) => {
    if (n !== null && no.has(n)) { unseated++; return null; }
    return n;
  });
  return { numbers: out, unseated };
}

// incoming: [{ first, last, party }], existing: [{ first, last, party }], opts.guestLimit (demo: 12; default no limit).
// -> { rows: [{ status: "add" | "skip", reason, flag, pairOf }], add: [incoming indexes], counts }
//    flag: null | "duplicate" | "same_name" | "possible_duplicate"
export function planImport(incoming, existing, opts = {}) {
  const byName = new Map(); // nameKey -> [party keys] of existing guests
  for (const g of existing) {
    const k = nameKey(g.first, g.last);
    const list = byName.get(k);
    if (list) list.push(partyKey(g.party)); else byName.set(k, [partyKey(g.party)]);
  }
  const rows = incoming.map(() => ({ status: "add", reason: null, flag: null, pairOf: null }));
  const same = (g) => `${nameKey(g.first, g.last)}\u0000${partyKey(g.party)}`;
  const haveCount = new Map(), fileCount = new Map();
  for (const g of existing) haveCount.set(same(g), (haveCount.get(same(g)) || 0) + 1);
  for (const g of incoming) fileCount.set(same(g), (fileCount.get(same(g)) || 0) + 1);
  const possible = new Set();
  const candidates = [];
  incoming.forEach((g, i) => {
    const have = haveCount.get(same(g)) || 0;
    if (have > 0 && fileCount.get(same(g)) <= have) { rows[i].status = "skip"; rows[i].reason = "duplicate"; }
    else {
      if (have > 0) possible.add(i);
      candidates.push(i);
    }
  });
  const { take } = takeWithinLimit(candidates.length, existing.length, opts.guestLimit);
  const add = candidates.slice(0, take);
  for (const i of candidates.slice(take)) { rows[i].status = "skip"; rows[i].reason = "limit"; }

  // Flags: compare each added row with the existing guests and the rows added before it.
  const seen = new Map(); // nameKey -> [{ party, index }] of rows added earlier in this file
  for (const i of add) {
    const g = incoming[i];
    const k = nameKey(g.first, g.last);
    const p = partyKey(g.party);
    const earlier = seen.get(k) || [];
    const twin = earlier.find((e) => p !== "" && e.party === p);
    if (twin) { rows[i].flag = "duplicate"; rows[i].pairOf = twin.index; }
    else if (earlier.length > 0) { rows[i].flag = "same_name"; rows[i].pairOf = earlier[0].index; }
    else if (byName.has(k)) rows[i].flag = "same_name";
    if (possible.has(i)) { rows[i].flag = "possible_duplicate"; rows[i].pairOf = null; }
    earlier.push({ party: p, index: i });
    seen.set(k, earlier);
  }
  const count = (f) => rows.filter((r) => r.flag === f).length;
  return {
    rows,
    add,
    counts: {
      incoming: incoming.length,
      added: add.length,
      skippedDuplicates: rows.filter((r) => r.reason === "duplicate").length,
      notAdded: rows.filter((r) => r.reason === "limit").length,
      flaggedDuplicate: count("duplicate"),
      flaggedSameName: count("same_name"),
      flaggedPossibleDuplicate: count("possible_duplicate"),
    },
  };
}
