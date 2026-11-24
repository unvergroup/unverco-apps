// Pure CSV / pasted-text parser for the guest import. No DOM, no store.
// parse(input, opts) -> { ok:true, rows, rowNumbers, columns, delimiter, encoding, warnings, report, singleColumnLastFirst, header }
//                    or { ok:false, reason }   (reason: xlsx | xls | utf16 | too_large | too_many_rows; the texts are the dictionary
//                    keys guests.parse.reason.<reason> in messages.js)
// opts.header (boolean): the user's answer to "first row is a header"; missing = decided by mapping.js `detectHeader`
//   (the only place that decides). When the user changes the box, call parse again with the new value.
// `rows` keeps the header row (if any) as rows[0]. The result's `header` is the decision that was used.
// A row that repeats an earlier row is never dropped silently: a copy of a real header row is dropped and listed in
// report.repeatedHeaders; any other repeated row stays in the list and is listed in report.repeatedRows ("possible duplicate").
import { detectHeader, looksLikeHeader } from "./mapping.js";

export const MAX_BYTES = 5 * 1024 * 1024; // spec 4: files over 5 MB are refused
export const MAX_ROWS = 2000; // spec 4: more than 2,000 DATA rows (a header row is not counted) is refused
export const MAX_CELL = 500; // longest allowed field (notes); name/party/meal limits are applied after mapping

const MAX_QUOTED_BREAKS = 5; // spec 4 [assumption]: a quoted cell with more line breaks than this is plain text
const SCAN_BUDGET = 64 * 1024 * 1024; // guards the quote look-ahead against adversarial input
const MAX_BLANK_LISTED = 1000; // blank rows are listed up to this many, always counted in blankRowCount

const reject = (reason) => ({ ok: false, reason });

function truncateCodePoints(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

// Spec 4 order: delete invisible and control characters, collapse white space, then NFC (last).
function cleanCell(raw) {
  let s = raw.replace(/[\u200B-\u200F\uFEFF\u202A-\u202E\u2066-\u2069]/g, "");
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  s = s.replace(/\s+/g, " ").trim().normalize("NFC");
  // Reverse of the CSV export escape: a leading apostrophe in front of = + - @ is dropped.
  if (/^'[=+\-@]/.test(s)) s = s.slice(1);
  return s;
}

function decode(input) {
  if (typeof input === "string") {
    const text = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
    if (text.startsWith("PK\u0003\u0004")) return reject("xlsx");
    if (new TextEncoder().encode(text).length > MAX_BYTES) return reject("too_large");
    return { text, encoding: "utf-8", warnings: [] };
  }
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length > MAX_BYTES) return reject("too_large");
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return reject("xlsx");
  if (b.length >= 4 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return reject("xls");
  if (b.length >= 2 && ((b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF))) return reject("utf16");
  for (let i = 0, n = Math.min(b.length, 1024); i < n; i++) if (b[i] === 0) return reject("utf16");
  const start = b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF ? 3 : 0;
  const body = start ? b.subarray(start) : b;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8", warnings: [] };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(body), encoding: "windows-1252", warnings: ["cp1252"] };
  }
}

// Quote rule (spec 4, Y1): a quote opens a quoted cell only at the start of a cell. The closing quote is the first quote that
// is not doubled; it must be followed by the delimiter, a line break or the end of the text, and the cell may hold at most
// MAX_QUOTED_BREAKS line breaks. Otherwise the cell is plain text and ends on its own physical line (never swallows more).
// Returns the index of the closing quote, or -1 (plain text).
function findClose(text, start, delim, st) {
  const n = text.length;
  let breaks = 0, j = start + 1;
  let close = -1;
  for (; j < n; j++) {
    const c = text.charCodeAt(j);
    if (c === 34) {
      if (text.charCodeAt(j + 1) === 34) { j++; continue; }
      close = j;
      break;
    }
    if (c === 10 || (c === 13 && text.charCodeAt(j + 1) !== 10)) {
      if (++breaks > MAX_QUOTED_BREAKS) break;
    }
  }
  st.scanned += j - start;
  if (close < 0 || st.scanned > SCAN_BUDGET) return -1;
  const next = text[close + 1];
  if (close + 1 >= n || next === "\n" || next === "\r" || next === delim) return close;
  return -1;
}

// Calls onRow(cells, line) for every record (line = physical line number where the record starts);
// onRow returns true to stop early. `unclosed` collects the lines where a quote was treated as plain text.
function tokenize(text, delim, onRow, unclosed) {
  const n = text.length;
  if (n === 0) return;
  const st = { scanned: 0 };
  let row = [], line = 1, rowLine = 1, i = 0;
  for (;;) {
    let cell = "", quoted = false;
    if (text.charCodeAt(i) === 34) {
      const close = st.scanned > SCAN_BUDGET ? -1 : findClose(text, i, delim, st);
      if (close >= 0) {
        const inner = text.slice(i + 1, close);
        cell = inner.replace(/""/g, '"');
        line += (inner.match(/\r\n|\r|\n/g) || []).length;
        i = close + 1;
        quoted = true;
      } else if (unclosed[unclosed.length - 1] !== line) {
        unclosed.push(line);
      }
    }
    if (!quoted) {
      const from = i;
      while (i < n && text[i] !== delim && text[i] !== "\n" && text[i] !== "\r") i++;
      cell = text.slice(from, i);
    }
    row.push(cell);
    if (i >= n) { onRow(row, rowLine); return; }
    if (text[i] === delim) { i++; continue; }
    i += text[i] === "\r" && text[i + 1] === "\n" ? 2 : 1;
    if (onRow(row, rowLine)) return;
    row = [];
    line++;
    rowLine = line;
    if (i >= n) return; // a trailing line break does not start another row
  }
}

const DELIMS = ["\t", ";", ","]; // priority order on ties

// Spec 4 (Y4): counted per RECORD (a line break inside a quoted cell does not split it), first 10 non-blank records.
function detectDelimiter(text) {
  let best = null;
  for (const d of DELIMS) {
    const freq = new Map();
    let records = 0;
    tokenize(text, d, (cells) => {
      if (cells.length === 1 && cells[0].trim() === "") return false; // a blank line, not a line of delimiters
      records++;
      if (cells.length > 1) freq.set(cells.length - 1, (freq.get(cells.length - 1) || 0) + 1);
      return records >= 10;
    }, []);
    const top = Math.max(0, ...freq.values());
    const coverage = records ? top / records : 0;
    if (coverage >= 0.8 && (!best || coverage > best.coverage)) best = { d, coverage };
  }
  return best ? best.d : null;
}

// Cleans every record. Blank records are counted. The header decision is made after the whole text was read (the values of the
// first row must not come back as data). Stops as soon as the data row limit is certainly passed.
function build(text, delim, forcedHeader) {
  const report = {
    blankRows: [], blankRowCount: 0, repeatedHeaders: [], repeatedRows: [], paddedRows: [], extraCells: [],
    unclosedQuotes: [], truncatedCells: [],
  };
  let kept = [];
  let first = null, copies = 0, overLimit = false;
  const blank = (line) => {
    report.blankRowCount++;
    if (report.blankRows.length < MAX_BLANK_LISTED) report.blankRows.push(line);
  };
  tokenize(text, delim, (raw, line) => {
    if (raw.length === 1 && raw[0] === "") { blank(line); return false; }
    const cells = raw.map(cleanCell);
    if (cells.every((c) => c === "")) { blank(line); return false; }
    if (!first) first = cells;
    else if (cells.length === first.length && cells.every((c, j) => c === first[j])) copies++;
    kept.push({ cells, line });
    // Copies of the first row may still be dropped (header), so they do not count; at most 4 x the limit is ever held.
    if (kept.length - copies > MAX_ROWS + 1 || kept.length > 4 * MAX_ROWS) { overLimit = true; return true; }
    return false;
  }, report.unclosedQuotes);
  const header = typeof forcedHeader === "boolean" ? forcedHeader : detectHeader(kept.map((r) => r.cells));
  if (!overLimit && kept.length > 0) {
    const dropCopies = header && looksLikeHeader(first);
    const isCopy = (r) => r.cells.length === first.length && r.cells.every((c, j) => c === first[j]);
    const out = [kept[0]];
    for (let i = 1; i < kept.length; i++) {
      if (isCopy(kept[i])) {
        if (dropCopies) { report.repeatedHeaders.push(kept[i].line); continue; }
        report.repeatedRows.push(kept[i].line);
      }
      out.push(kept[i]);
    }
    kept = out;
    if (kept.length - (header ? 1 : 0) > MAX_ROWS) overLimit = true;
  }
  return { kept, report, header, overLimit };
}

export function parse(input, opts = {}) {
  const dec = decode(input);
  if (dec.ok === false) return dec;
  const { text, encoding, warnings } = dec;

  let delimiter = detectDelimiter(text);
  let built = build(text, delimiter, opts.header);
  let singleColumnLastFirst = false;

  // spec 4: headerless pasted text with exactly one comma per line is one "Last, First" column
  if (!built.overLimit && delimiter === "," && !opts.twoColumns && built.kept.length > 0
    && built.kept.every((r) => r.cells.length === 2) && !built.header) {
    delimiter = null;
    built = build(text, null, opts.header);
    singleColumnLastFirst = true;
  }
  if (built.overLimit) return reject("too_many_rows");

  const { kept, report } = built;
  const width = kept.length ? kept[0].cells.length : 0;
  const rows = [], rowNumbers = [];
  for (const { cells, line } of kept) {
    let out = cells;
    if (out.length < width) { out = out.concat(Array(width - out.length).fill("")); report.paddedRows.push(line); }
    else if (out.length > width) {
      if (out.slice(width).some((c) => c !== "")) report.extraCells.push(line);
      out = out.slice(0, width);
    }
    out = out.map((c, j) => {
      const cut = truncateCodePoints(c, MAX_CELL);
      if (cut !== c) report.truncatedCells.push({ row: line, col: j });
      return cut;
    });
    rows.push(out);
    rowNumbers.push(line);
  }
  return { ok: true, rows, rowNumbers, columns: width, delimiter, encoding, warnings, report, singleColumnLastFirst, header: built.header };
}
