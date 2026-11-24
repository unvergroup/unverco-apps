// Pure name splitting for a single "name" column. No DOM, no store, no imports.
// splitName(text) -> { first, last, twoPeople }
// "Last, First" when there is a comma; otherwise the last word is the last name and the rest the first name; one word is a first name.
// A known suffix as the last word stays with the word before it ("Robert Smith Jr." -> last "Smith Jr.").

const SUFFIX_WORDS = /^(?:jr|sr)\.?$/i; // Jr, Jr., Sr, Sr. in any case
const ROMAN_SUFFIXES = new Set(["II", "III", "IV", "V"]); // upper case only, so "Anna v" is not a suffix
const TWO_PEOPLE = /\s&\s|\sand\s/i;

const isSuffix = (word) => SUFFIX_WORDS.test(word) || ROMAN_SUFFIXES.has(word);
const squash = (text) => String(text ?? "").normalize("NFC").replace(/[\s ]+/g, " ").trim();

// "Smith Jr." / "John Smith" style words -> { first, last }; the suffix joins the word before it.
function fromWords(words) {
  if (words.length === 0) return { first: "", last: "" };
  if (words.length === 1) return { first: words[0], last: "" };
  const n = words.length;
  if (isSuffix(words[n - 1])) {
    return { first: words.slice(0, n - 2).join(" "), last: words.slice(n - 2).join(" ") };
  }
  return { first: words.slice(0, n - 1).join(" "), last: words[n - 1] };
}

export function splitName(text) {
  let s = squash(text);
  const twoPeople = TWO_PEOPLE.test(` ${s} `);
  // "John Smith, Jr.": a comma in front of a lone suffix is not the "Last, First" comma.
  s = s.replace(/\s*,\s*((?:jr|sr)\.?|II|III|IV|V)$/i, (m, suf) => (isSuffix(suf) ? ` ${suf}` : m));
  const comma = s.indexOf(",");
  if (comma >= 0) {
    return { first: s.slice(comma + 1).trim(), last: s.slice(0, comma).trim(), twoPeople };
  }
  const { first, last } = fromWords(s === "" ? [] : s.split(" "));
  return { first, last, twoPeople };
}
