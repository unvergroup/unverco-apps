// Pure sorting and letter grouping for the seating sign and alphabetical place cards.
// No DOM, no store, no imports.
//
// Guests on the sign (set S): tableId points at an existing table and rsvp is not "no".
// Sort key: last name (first name when there is no last name). Heading letter: the first letter character of the key
// (punctuation and digits skipped) that the collator treats as equal to an A-Z letter; otherwise "#", listed last (audit O12).

const COLLATOR = new Intl.Collator("en", { sensitivity: "base" });
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const letterCache = new Map();

function letterOf(ch) {
  let hit = letterCache.get(ch);
  if (hit === undefined) {
    hit = LETTERS.find((l) => COLLATOR.compare(ch, l) === 0) || "#";
    letterCache.set(ch, hit);
  }
  return hit;
}

const firstLetterIndex = (text) => {
  const m = /\p{L}/u.exec(text);
  return m ? m.index : -1;
};

export function groupLetter(key) {
  const text = String(key ?? "").normalize("NFC");
  const i = firstLetterIndex(text);
  if (i < 0) return "#";
  return letterOf(String.fromCodePoint(text.codePointAt(i)));
}

const rank = (letter) => (letter === "#" ? 26 : letter.charCodeAt(0) - 65);

function buildEntries(guests, tables) {
  const byId = new Map((tables || []).map((t) => [t.id, t]));
  const out = [];
  for (const g of guests || []) {
    if (g.rsvp === "no" || !g.tableId) continue;
    const t = byId.get(g.tableId);
    if (!t) continue;
    const first = String(g.first ?? "").normalize("NFC").trim();
    const last = String(g.last ?? "").normalize("NFC").trim();
    const key = last || first;
    const i = firstLetterIndex(key);
    out.push({
      id: g.id,
      first,
      last,
      name: [first, last].filter(Boolean).join(" "),
      tableNumber: t.number,
      letter: groupLetter(key),
      sortKey: i > 0 ? key.slice(i) : key,
    });
  }
  return out;
}

function compareAlpha(a, b) {
  return rank(a.letter) - rank(b.letter)
    || COLLATOR.compare(a.sortKey, b.sortKey)
    || COLLATOR.compare(a.first, b.first)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// Flat list in sign order (heading letters A-Z, then "#").
export function signEntries(guests, tables) {
  return buildEntries(guests, tables).sort(compareAlpha);
}

// [{ letter, entries }] with only the letters that occur, "#" last.
export function signGroups(guests, tables) {
  const groups = [];
  for (const e of signEntries(guests, tables)) {
    const last = groups[groups.length - 1];
    if (last && last.letter === e.letter) last.entries.push(e);
    else groups.push({ letter: e.letter, entries: [e] });
  }
  return groups;
}

// Place card order (spec 5 b): table number first, then the sign order inside a table. There is no order choice.
export function cardOrder(guests, tables) {
  const list = signEntries(guests, tables);
  const index = new Map(list.map((e, i) => [e.id, i]));
  return [...list].sort((a, b) => a.tableNumber - b.tableNumber || index.get(a.id) - index.get(b.id));
}
