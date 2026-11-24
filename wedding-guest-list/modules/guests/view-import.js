// Import wizard (U1): add the list (paste or CSV file) -> match columns -> review -> import.
// All rules live in logic/*; import-run.js chains them. Text: messages.js (guests.import.*). User text only via h() / textContent.
import { button, field, h, table } from "../../core/ui.js";
import { EditionLimitError } from "../../core/edition.js";
import { FIELDS, IGNORE, autoMap, canImport, setColumnField } from "./logic/mapping.js";
import { parse } from "./logic/parse.js";
import { addRecords, loadData } from "./data.js";
import { buildImport, previewRows } from "./import-run.js";
import { badge, plural, rsvpLabel, statusBox } from "./parts.js";

const BIG_INPUT = 200000; // characters / bytes above which the "Reading your list…" line is shown

// Opens the system file chooser. Call it straight from the click handler (browsers need the user's click).
// -> { name, bytes } or null when the chooser was cancelled.
export function pickCsv() {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: ".csv,.txt,text/csv,text/plain" });
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

// host: element that the wizard fills. env: { ctx, t, store, edition }.
// opts: { mode: "paste" | "csv", file?: { name, bytes }, onDone({ count }), onCancel() }
export function openImport(host, env, opts) {
  const { ctx, t, store, edition } = env;
  const S = {
    source: opts.mode === "csv" ? "csv" : "paste",
    input: opts.file ? opts.file.bytes : "",
    header: undefined, twoColumns: false,
    parsed: null, auto: null, mapping: [], exclude: new Set(), existing: null, full: null,
  };
  const limits = () => ({ guests: edition.limitFor("guests"), tables: edition.limitFor("tables") });
  const fieldLabel = (f) => t(`guests.import.field.${f}`);

  // ---- shell: card with step indicator and a heading that takes the focus
  function shell(step, heading, body, focus = true) {
    const head = h("h2", { id: "imp-h", class: "step-head", tabindex: "-1", text: heading });
    const names = ["guests.import.step.add", "guests.import.step.match", "guests.import.step.review"];
    const steps = h("ol", { class: "steps", "aria-label": t("guests.import.steps") },
      names.map((k, i) => h("li", { class: i + 1 < step ? "done" : "", "aria-current": i + 1 === step ? "step" : null }, t(k))));
    const cancel = button({ label: t("guests.import.cancel"), variant: "ghost", onClick: () => opts.onCancel() });
    if (ctx.clearTransient) ctx.clearTransient(); // a new step: earlier success toasts and warnings are done with
    host.replaceChildren(h("section", { class: "card", "aria-labelledby": "imp-h" },
      h("div", { class: "row between wizard-head" }, h("p", { class: "muted", text: t("guests.import.stepOf", { n: step }) }), cancel),
      steps, head, ...body));
    if (focus) head.focus();
    return head;
  }

  // ---- step 1
  function showStart(reason) {
    if (reason) {
      const again = async () => { const f = await pickCsv(); if (f) { S.source = "csv"; S.input = f.bytes; process(); } };
      shell(1, t("guests.import.cantRead"), [
        statusBox("danger", h("p", { text: t(`guests.parse.reason.${reason}`) }), { role: "alert" }),
        h("div", { class: "dialog-actions" },
          button({ label: t("guests.import.pasteInstead"), onClick: () => { S.source = "paste"; S.input = ""; showStart(); } }),
          button({ label: t("guests.import.chooseAnother"), variant: "primary", onClick: again }))]);
      return;
    }
    if (S.source === "csv") {
      shell(1, t("guests.import.csvHeading"), [
        h("p", { text: t("guests.import.csvText") }),
        h("div", { class: "dialog-actions" },
          button({ label: t("guests.import.pasteInstead"), onClick: () => { S.source = "paste"; S.input = ""; showStart(); } }),
          button({ label: t("guests.import.chooseFile"), variant: "primary", onClick: async () => { const f = await pickCsv(); if (f) { S.input = f.bytes; process(); } } }))]);
      return;
    }
    const box = field({ label: t("guests.import.pasteLabel"), multiline: true, hint: t("guests.import.pasteHint"), rows: 8, autocomplete: "off", spellcheck: "false" });
    box.input.value = typeof S.input === "string" ? S.input : "";
    const need = h("p", { class: "field-hint", id: "imp-need" });
    const next = button({ label: t("guests.import.next.match"), variant: "primary", onClick: () => { S.input = box.input.value; process(); } });
    next.setAttribute("aria-describedby", "imp-need");
    const sync = () => {
      const empty = box.input.value.trim() === "";
      next.disabled = empty;
      need.textContent = empty ? t("guests.import.pasteNeed") : "";
    };
    box.input.addEventListener("input", sync);
    shell(1, t("guests.import.pasteHeading"), [box.element, need, h("div", { class: "dialog-actions" }, next)]);
    sync();
    box.input.focus();
  }

  async function process() {
    const size = typeof S.input === "string" ? S.input.length : S.input.length;
    if (size > BIG_INPUT) {
      shell(1, t("guests.import.reading"), [h("p", { role: "status", text: t("guests.import.reading") })]);
      await new Promise((r) => setTimeout(r, 30));
    }
    const parsed = parse(S.input, { header: S.header, twoColumns: S.twoColumns });
    if (!parsed.ok) return showStart(parsed.reason);
    if (parsed.rows.length === 0) {
      if (S.source === "paste") return showStart();
      return showStart("xlsx"); // an empty file reads as "not a plain CSV" (same advice)
    }
    S.parsed = parsed;
    S.header = parsed.header;
    S.auto = autoMap(parsed.rows, { header: parsed.header });
    S.mapping = S.auto.mapping.slice();
    S.exclude = new Set();
    showMap();
  }

  // ---- step 2
  function showMap() {
    const p = S.parsed;
    const width = p.columns;
    const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 560px)").matches;
    const ignoredNote = h("p", { class: "field-hint", role: "status" });
    let noteTimer = null;
    const say = (text) => {
      ignoredNote.textContent = text;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { ignoredNote.textContent = ""; }, 5000);
    };

    const headerBox = h("input", { type: "checkbox", checked: S.header, id: "imp-header", on: { change: () => { S.header = headerBox.checked; reparse(); } } });
    const blocks = [
      h("p", { text: t("guests.import.map.intro") }),
      p.warnings.includes("cp1252") ? statusBox("warn", h("p", { text: t("guests.import.warn.cp1252") })) : null,
      h("label", { class: "check", for: "imp-header" }, headerBox, t("guests.import.headerBox")),
    ];
    if (S.twoColumns || p.singleColumnLastFirst) {
      const two = h("input", { type: "checkbox", checked: S.twoColumns, id: "imp-two", on: { change: () => { S.twoColumns = two.checked; reparse(); } } });
      blocks.push(h("label", { class: "check", for: "imp-two" }, two, t("guests.import.twoColumns")));
    }
    for (const w of S.auto.warnings) {
      blocks.push(statusBox("info", h("p", { text: t(`guests.import.warn.${w.code}`, { header: w.header ?? "" }) })));
    }

    const colEls = [];
    const grid = h("div", { class: "map-grid stack-top" });
    for (let i = 0; i < width; i++) {
      const id = `imp-col-${i}`;
      const name = p.header ? String(p.rows[0][i] ?? "") : "";
      const sel = h("select", { id, on: { change: () => { setField(i, sel.value); } } },
        [IGNORE, ...FIELDS].map((f) => h("option", { value: f, text: fieldLabel(f), selected: f === S.mapping[i] })));
      const samples = p.rows.slice(p.header ? 1 : 0).map((r) => r[i]).filter((v) => v !== "").slice(0, 3);
      const col = h("div", { class: "map-col" },
        h("div", { class: "field" },
          h("label", { for: id }, t("guests.import.column", { n: i + 1 }), name ? [": ", h("bdi", { text: name })] : null), sel),
        h("ul", { class: "map-samples", "aria-label": t("guests.import.firstValues", { n: i + 1 }) }, samples.map((v) => h("li", {}, h("bdi", { text: v })))));
      colEls.push({ col, sel });
      grid.append(col);
    }

    const previewHost = h("div", { class: "stack-top" });
    const hint = h("p", { class: "field-hint", id: "imp-names" });
    const next = button({ label: t("guests.import.next.review"), variant: "primary", onClick: () => showReview() });
    next.setAttribute("aria-describedby", "imp-names");

    function buildPreview() {
      const rows = previewRows({ rows: p.rows, rowNumbers: p.rowNumbers, header: S.header, mapping: S.mapping, existing: S.existing }, 5);
      const cols = [];
      S.mapping.forEach((f, i) => {
        if (f === IGNORE) return;
        const cell = {
          rsvp: (r) => rsvpLabel(t, r.rsvp), age: (r) => t(r.age === "child" ? "guests.age.child" : "guests.age.adult"),
          table: (r) => (r.table === null ? "" : t("guests.table.n", { n: r.table })),
        }[f] || ((r) => r[f]);
        cols.push({ key: `${f}${i}`, label: fieldLabel(f), render: cell });
      });
      const tbl = cols.length ? table({ caption: t("guests.import.previewCaption"), columns: cols, rows }) : h("p", { class: "muted", text: t("guests.import.previewNone") });
      if (narrow) return h("details", {}, h("summary", { text: t("guests.import.preview") }), tbl);
      return [h("h3", { text: t("guests.import.preview") }), tbl];
    }
    function refresh() {
      colEls.forEach(({ col, sel }, i) => { sel.value = S.mapping[i]; col.classList.toggle("is-ignored", S.mapping[i] === IGNORE); });
      previewHost.replaceChildren(...[].concat(buildPreview()));
      const ok = canImport(S.mapping);
      next.disabled = !ok;
      hint.textContent = ok ? "" : t("guests.import.needNames");
    }
    function setField(i, f) {
      const before = S.mapping;
      S.mapping = setColumnField(before, i, f);
      const cleared = S.mapping.map((x, j) => (j !== i && before[j] !== IGNORE && x === IGNORE ? j : -1)).filter((j) => j >= 0);
      refresh();
      if (cleared.length) say(t("guests.import.nowIgnored", { n: cleared[0] + 1 }));
    }
    async function reparse() {
      const keep = headerBox.checked;
      S.header = keep;
      const q = parse(S.input, { header: S.header, twoColumns: S.twoColumns });
      if (!q.ok) return showStart(q.reason);
      S.parsed = q;
      S.auto = autoMap(q.rows, { header: q.header });
      S.mapping = S.auto.mapping.slice();
      S.exclude = new Set();
      showMap();
    }

    // The existing tables / meals matter for the preview (table numbers, meal options); read them first.
    loadData(store).then((d) => { S.existing = d; refresh(); }).catch((e) => ctx.fail(e));
    S.existing = S.existing ?? { guests: [], tables: [], meals: [] };

    const back = button({ label: t("guests.import.back"), onClick: () => showStart() });
    shell(2, t("guests.import.map.heading"), [...blocks, grid, previewHost, ignoredNote, hint, h("div", { class: "dialog-actions" }, back, next)]);
    refresh();
  }

  // ---- step 3
  async function showReview() {
    try { S.existing = await loadData(store); } catch (e) { ctx.fail(e); return; }
    S.exclude = new Set();
    S.full = compute(new Set());
    drawReview(true);
  }
  function compute(exclude) {
    return buildImport({
      rows: S.parsed.rows, rowNumbers: S.parsed.rowNumbers, header: S.header, mapping: S.mapping, existing: S.existing,
      limits: limits(), exclude, source: S.source, parseReport: S.parsed.report, repeatedRows: S.parsed.report.repeatedRows,
    });
  }

  const rowsText = (lines) => {
    const shown = lines.slice(0, 8).join(", ");
    const list = lines.length > 8 ? t("guests.import.rows.more", { list: shown, n: lines.length - 8 }) : shown;
    return plural(t, "guests.import.rows", lines.length, { list });
  };
  const person = (g) => {
    const n = [g.first, g.last].filter(Boolean).join(" ");
    return g.party ? `${n} (${g.party})` : n;
  };

  function categories(final) {
    const r = final.report;
    const li = (text) => h("li", { text });
    const list = [];
    const add = (id, n, kind, title, items, open) => { if (n > 0) list.push({ id, n, kind, title, items, open }); };
    add("skipped", r.skippedDuplicates.length, null, plural(t, "guests.import.cat.skipped", r.skippedDuplicates.length),
      r.skippedDuplicates.map((g) => li(t("guests.import.item.row", { line: g.line, text: person(g) }))), false);
    const changed = [
      ...r.unknownRsvp.map((u) => li(t("guests.import.chg.rsvp", { rows: rowsText(u.lines), value: u.value }))),
      ...r.named.map((n) => li(t("guests.import.chg.tableName", { rows: rowsText(n.lines), name: n.name, number: n.number }))),
      ...r.invalid.map((v) => li(t("guests.import.chg.tableInvalid", { rows: rowsText(v.lines), value: v.value }))),
      ...r.overCapacity.map((o) => li(t("guests.import.chg.overCapacity", { number: o.number, assigned: o.assigned }))),
      ...r.cuts.map((c) => li(t(`guests.import.cut.${c.field === "first" || c.field === "last" ? "name" : c.field}`, { row: c.line ?? c.row, max: c.to }))),
      ...r.mealCuts.map((m) => li(t("guests.import.cut.meal", { label: m.label }))),
      ...r.cellCuts.map((n) => li(t("guests.import.cut.cell", { row: n }))),
    ];
    add("changed", changed.length, "warn", plural(t, "guests.import.cat.changed", changed.length), changed, true);
    if (r.mealsDropped.length) {
      const names = r.mealsDropped.map((m) => `${m.label} (${plural(t, "guests.import.n.rows", m.rows)})`).join(", ");
      list.push({ id: "mealsDropped", n: r.mealsDropped.length, kind: "warn", title: t("guests.import.cat.mealsDropped", { list: names }), items: [], open: false });
    }
    add("possible", S.full.report.possible.length, "warn", plural(t, "guests.import.cat.possible", S.full.report.possible.length),
      S.full.report.possible.map((g) => possibleItem(g)), true);
    add("twoPeople", r.twoPeople.length, null, plural(t, "guests.import.cat.twoPeople", r.twoPeople.length),
      r.twoPeople.map((x) => li(t("guests.import.item.twoPeople", { line: x.line, text: x.text }))), false);
    add("sameName", r.sameName.length, null, plural(t, "guests.import.cat.sameName", r.sameName.length),
      r.sameName.map((g) => li(t("guests.import.item.row", { line: g.line, text: g.party ? person(g) : `${person(g)} (${t("guests.import.noParty")})` }))), false);
    add("noName", r.noName.length, "warn", plural(t, "guests.import.cat.noName", r.noName.length), r.noName.map((n) => li(t("guests.import.item.rowOnly", { line: n }))), true);
    add("empty", r.emptyRowCount, null, plural(t, "guests.import.cat.empty", r.emptyRowCount), r.emptyRows.map((n) => li(t("guests.import.item.rowOnly", { line: n }))), false);
    add("extra", r.extraCells.length, null, plural(t, "guests.import.cat.extra", r.extraCells.length), r.extraCells.map((n) => li(t("guests.import.item.rowOnly", { line: n }))), false);
    add("quotes", r.unclosedQuotes.length, "warn", plural(t, "guests.import.cat.quotes", r.unclosedQuotes.length), r.unclosedQuotes.map((n) => li(t("guests.import.item.quote", { line: n }))), false);
    return list;
  }

  // A possible duplicate asks the user: nothing is dropped unless the box is cleared.
  function possibleItem(g) {
    const id = `imp-dup-${g.line}`;
    const box = h("input", { type: "checkbox", id, checked: !S.exclude.has(g.line), "data-key": `dup:${g.line}`,
      on: { change: () => { if (box.checked) S.exclude.delete(g.line); else S.exclude.add(g.line); drawReview(false, `dup:${g.line}`); } } });
    const why = g.kind === "file" ? t("guests.import.why.file", { line: g.pairLine }) : g.kind === "list" ? t("guests.import.flag.possible_duplicate") : t("guests.import.why.repeated");
    return h("li", {}, h("label", { class: "check", for: id }, box,
      h("span", {}, t("guests.import.item.import", { line: g.line, text: person(g) }), h("span", { class: "report-reason", text: why }))));
  }

  function drawReview(first, focusKeyName) {
    const open = new Map([...host.querySelectorAll("details[data-cat]")].map((d) => [d.dataset.cat, d.open]));
    const final = S.exclude.size ? compute(S.exclude) : S.full;
    const n = final.guests.length;
    const c = final.counts;
    const rep = final.report;
    const skipOnly = n === 0 && rep.skippedDuplicates.length > 0 && rep.limited.length === 0;
    const heading = n > 0 ? plural(t, "guests.import.ready", n) : skipOnly ? t("guests.import.nothingNew") : t("guests.import.noGuests");
    const parts = [plural(t, "guests.import.n.rows", c.rows)];
    const sum = h("p", {}, h("strong", { text: plural(t, "guests.import.n.guests", n) }), ` ${t("guests.import.from", { rows: parts[0] })}`);
    const extra = [c.meals ? plural(t, "guests.import.n.meals", c.meals) : null, c.tables ? plural(t, "guests.import.n.tables", c.tables) : null].filter(Boolean);
    if (extra.length) sum.append(` · ${extra.join(" · ")}`);

    const body = [];
    if (skipOnly) body.push(h("p", { text: t("guests.import.allInList") }));
    else if (n > 0) body.push(statusBox("ok", sum));
    for (const w of S.auto.warnings) if (w.code === "one_row_per_party") body.push(statusBox("info", h("p", { text: t("guests.import.warn.one_row_per_party", { header: w.header }) })));
    if (edition.isDemo && (rep.limited.length || rep.unseatedByLimit)) {
      const lines = [h("p", { text: t("guests.import.demo", { guests: limits().guests, tables: limits().tables, n: rep.limited.length }) })];
      if (rep.unseatedByLimit) lines.push(h("p", { text: t("guests.import.demoTables", { n: rep.unseatedByLimit, tables: limits().tables }) }));
      body.push(statusBox("warn", lines));
    }
    const cats = categories(final);
    if (cats.length) {
      body.push(h("ul", { class: "report stack-top" }, cats.map((k) => {
        const head = [badge(k.n, k.kind), " ", k.title];
        if (!k.items.length) return h("li", { class: "row" }, ...head);
        const isOpen = open.has(k.id) ? open.get(k.id) : k.open;
        return h("li", {}, h("details", { "data-cat": k.id, open: isOpen }, h("summary", {}, ...head), h("ul", {}, k.items)));
      })));
    }
    const fail = h("div", { id: "imp-fail" });
    const go = button({ label: n > 0 ? plural(t, "guests.import.go", n) : t("guests.import.go.none"), variant: "primary", disabled: n === 0, onClick: () => doImport(final, go, fail) });
    const back = button({ label: t("guests.import.back"), onClick: () => showMap() });
    shell(3, heading, [...body, fail, h("div", { class: "dialog-actions" }, back, go)], first);
    if (!first && focusKeyName) [...host.querySelectorAll("[data-key]")].find((e) => e.dataset.key === focusKeyName)?.focus();
  }

  async function doImport(final, goBtn, failHost) {
    goBtn.disabled = true;
    goBtn.textContent = t("guests.import.importing");
    const done = { meals: [], tables: [] };
    try {
      if (final.newMeals.length) { await addRecords(store, "meals", final.newMeals); done.meals = final.newMeals.map((m) => m.id); }
      if (final.newTables.length) {
        // Demo limits are checked again in the store lock, on what is saved now (another tab may have added since the preview).
        const limT = limits().tables;
        await addRecords(store, "tables", final.newTables, (have, adding) => { if (Number.isFinite(limT) && have + adding > limT) throw new EditionLimitError("tables", limT); });
        done.tables = final.newTables.map((m) => m.id);
      }
      const lim = limits().guests;
      await addRecords(store, "guests", final.guests, (have, adding) => { if (Number.isFinite(lim) && have + adding > lim) throw new EditionLimitError("guests", lim); });
    } catch (e) {
      console.error(e);
      for (const [c, ids] of [["meals", done.meals], ["tables", done.tables]]) {
        if (!ids.length) continue;
        try { const gone = new Set(ids); await store.transact(c, (l) => ({ list: l.filter((r) => !gone.has(r.id)), result: 0 })); } catch { /* best effort */ }
      }
      goBtn.disabled = false;
      goBtn.textContent = t("guests.import.retry");
      failHost.replaceChildren(statusBox("danger", h("p", { text: t("guests.import.failed") }), { role: "alert" }));
      return;
    }
    opts.onDone({ count: final.guests.length });
  }

  if (S.source === "csv" && opts.file) process(); else showStart();
}
