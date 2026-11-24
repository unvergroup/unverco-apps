// Print > Changes since printed (U9, G32; design ekranlar.md 5.6). The panel under the options of the sign and of the place cards:
// three states (not marked as printed / up to date / N changes), the groups "Reprint these cards", "Throw away these cards" and "No
// reprint needed", and [Print changed cards only (n)]. The comparison itself is logic/printdiff.js; this file only reads its result
// and writes the sentences (dictionary keys guests.changes.*). Names sit in <bdi>; user text only through h() / textContent.
import { button, h, nextId } from "../../core/ui.js";
import { diff, optionsOf, printedMealLabels, reprintSet, signStaleCount, snapshotOf } from "./logic/printdiff.js";
import { badge, guestName, plural, statusBox } from "./parts.js";

const MAX_ROWS = 8;
const NAME_TABLE = ["first", "last", "tableNumber"];

const nameOf = (e) => guestName(e);

// The last record of this kind and what changed since. kind: "sign" | "cards".
// -> { state: "none" } | { state: "ok" | "stale", at, count, d, ... } (see below). Pure: no DOM.
export function changeModel(kind, prints, data, plan) {
  const recKind = kind === "sign" ? "sign" : "placecards";
  const rec = (Array.isArray(prints) ? prints : []).filter((p) => p && p.kind === recKind).at(-1);
  if (!rec) return { state: "none" };
  const d = diff(rec.entries, snapshotOf(data.guests, data.tables), kind === "cards" ? { before: rec.options, after: optionsOf(plan, data.meals) } : undefined);
  if (!d) return { state: "none" };
  if (kind === "sign") {
    const count = signStaleCount(d);
    return { state: count ? "stale" : "ok", at: rec.at, count, d };
  }
  const set = reprintSet(d, { showMeal: plan.showMealOnCards === true });
  const o = d.options;
  const count = d.added.length + d.removed.length + d.changed.length;
  const named = new Set([...d.added.map((e) => e.guestId), ...d.changed.map((c) => c.guestId)]);
  const optionOnly = set.print.filter((e) => !named.has(e.guestId));
  const note = o && o.layout ? "layout" : optionOnly.length ? "marks" : null;
  return { state: count || note ? "stale" : "ok", at: rec.at, count, d, set, note, optionOnly, printedMeals: printedMealLabels(rec.options) };
}

// ---- rows

const del = (v) => h("del", { text: v });
const ins = (v) => h("ins", { text: v });

// What changed for one guest: { nodes: [visible parts], spoken: sentence }. `fields` limits what is listed.
function changeParts(t, c, fields, mealLabel, name) {
  const nodes = [], spoken = [];
  const arrow = (label, a, b) => nodes.push(h("span", { class: "change-diff" }, label, label ? " " : "", del(a), " → ", ins(b)));
  const rsvp = (v) => t(v === "yes" ? "guests.rsvp.yes" : "guests.rsvp.pending");
  for (const f of fields) {
    if (!c.fields.includes(f)) continue;
    if (f === "tableNumber") { arrow(t("guests.table.n", { n: "" }).trim(), String(c.before.tableNumber), String(c.after.tableNumber)); spoken.push(t("guests.changes.sr.table", { name, from: c.before.tableNumber, to: c.after.tableNumber })); }
    else if (f === "mealId") { const a = mealLabel(c.before.mealId, true), b = mealLabel(c.after.mealId, false); arrow(t("guests.changes.f.meal"), a, b); spoken.push(t("guests.changes.sr.meal", { name, from: a, to: b })); }
    else if (f === "rsvp") { const a = rsvp(c.before.rsvp), b = rsvp(c.after.rsvp); arrow(t("guests.changes.f.rsvp"), a, b); spoken.push(t("guests.changes.sr.rsvp", { name, from: a, to: b })); }
  }
  if (fields.includes("first") && c.fields.some((f) => f === "first" || f === "last")) {
    const a = nameOf(c.before), b = nameOf(c.after);
    nodes.unshift(h("span", { class: "change-diff" }, t("guests.changes.f.name"), " ", del(a), " → ", ins(b)));
    spoken.unshift(t("guests.changes.sr.name", { name: b, from: a, to: b }));
  }
  return { nodes, spoken };
}

const row = (name, parts, spoken) => {
  const li = h("li", { "aria-label": spoken || null }, h("bdi", { text: name }), ...parts.flatMap((p) => [" · ", p]));
  return li;
};

// opts: { t, formatDate, kind: "sign" | "cards", onPrintChanged(ids) }
// -> { element, update({ prints, data, plan }) -> { reprintIds: [guestId], count }, setBusy(bool), focusHeading() }
export function createChangesPanel(opts) {
  const { t, formatDate, kind } = opts;
  const headId = nextId("changes-h");
  const heading = h("h3", { id: headId, tabindex: "-1", text: t("guests.changes.title") });
  const element = h("section", { class: "changes", "aria-labelledby": headId }, heading);
  let busy = false, printBtn = null;
  const expanded = new Set();
  let last = null;

  function groupEl(key, title, items) {
    if (!items.length) return null;
    const open = expanded.has(key) || items.length <= MAX_ROWS;
    const list = h("ul", {}, (open ? items : items.slice(0, MAX_ROWS)).map((i) => i));
    return h("div", { class: "change-group" }, h("h4", {}, badge(items.length, key === "reprint" ? "warn" : undefined), " ", title), list,
      open ? null : button({ label: t("guests.changes.showAll", { n: items.length }), variant: "ghost", onClick: () => { expanded.add(key); draw(); } }));
  }

  function draw() {
    if (!last) return;
    const { model, data, plan } = last;
    const date = model.at ? formatDate(model.at) : "";
    element.classList.toggle("is-stale", model.state === "stale");
    const parts = [heading];
    printBtn = null;
    if (model.state === "none") {
      parts.push(statusBox("info", [h("p", { text: t("guests.changes.none") }), h("p", { class: "muted", text: t(`guests.changes.none.${kind}`) })]));
    } else if (model.state === "ok") {
      parts.push(statusBox("ok", h("p", { text: t(`guests.changes.ok.${kind}`, { date }) })));
    } else if (kind === "sign") {
      parts.push(statusBox("warn", h("p", { text: plural(t, "guests.changes.sign.stale", model.count, { date }) })));
      const items = [
        ...model.d.added.map((e) => row(nameOf(e) || t("guests.print.unnamed"), [t("guests.changes.row.added"), t("guests.table.n", { n: e.tableNumber })])),
        ...model.d.changed.filter((c) => c.fields.some((f) => NAME_TABLE.includes(f))).map((c) => {
          const p = changeParts(t, c, ["first", "tableNumber"], () => "", nameOf(c.after));
          return row(nameOf(c.after) || t("guests.print.unnamed"), p.nodes, p.spoken.join(". "));
        }),
        ...model.d.removed.map((e) => row(nameOf(e) || t("guests.print.unnamed"), [t("guests.changes.row.removed")])),
      ];
      const open = expanded.has("sign") || items.length <= MAX_ROWS;
      parts.push(h("ul", { class: "change-group change-list", "aria-label": t("guests.changes.g.names") }, open ? items : items.slice(0, MAX_ROWS)));
      if (!open) parts.push(button({ label: t("guests.changes.showAll", { n: items.length }), variant: "ghost", onClick: () => { expanded.add("sign"); draw(); } }));
    } else {
      parts.push(cardsStale(model, data, plan, date));
    }
    element.replaceChildren(...parts.flat().filter(Boolean));
  }

  function cardsStale(model, data, plan, date) {
    const { d, set } = model;
    const mealById = new Map(data.meals.map((m) => [m.id, m.label]));
    // wasPrinted: the "before" side is named as it was when printed; an option deleted since is named from the print record (or neutrally).
    const mealLabel = (id, wasPrinted) => {
      if (!id) return t("guests.meal.none");
      if (wasPrinted && model.printedMeals && model.printedMeals.has(id)) return model.printedMeals.get(id);
      return mealById.has(id) ? mealById.get(id) : t("guests.changes.meal.deleted");
    };
    const byId = new Map(data.guests.map((g) => [g.id, g]));
    const changedBy = new Map(d.changed.map((c) => [c.guestId, c]));
    const isAdded = new Set(d.added.map((e) => e.guestId));
    const showMeal = plan.showMealOnCards === true;
    const out = [];
    if (model.count) {
      out.push(statusBox("warn", h("p", {}, h("strong", { text: plural(t, "guests.changes.count", model.count) }), t("guests.changes.since.cards", { date }))));
    }
    const cards = (n) => plural(t, "guests.print.cardsCount", n);
    if (model.note === "layout") out.push(statusBox("warn", h("p", { text: t("guests.changes.layout", { date, cards: cards(d.current.length) }) })));
    else if (model.note === "marks") out.push(statusBox("warn", h("p", { text: t("guests.changes.marks", { date, cards: cards(model.optionOnly.length) }) })));

    const reprint = [];
    if (model.note !== "layout") {
      for (const e of set.print) {
        const name = nameOf(e) || t("guests.print.unnamed");
        if (isAdded.has(e.guestId)) { reprint.push(row(name, [t("guests.changes.row.new"), t("guests.table.n", { n: e.tableNumber })])); continue; }
        const c = changedBy.get(e.guestId);
        const fields = ["first", "tableNumber", ...(showMeal ? ["mealId"] : [])];
        const p = c ? changeParts(t, c, fields, mealLabel, name) : { nodes: [], spoken: [] };
        reprint.push(p.nodes.length ? row(name, p.nodes, p.spoken.join(". ")) : row(name, [t("guests.changes.row.symbol")]));
      }
    }
    const discard = set.discard.map((e) => {
      const g = byId.get(e.guestId);
      const why = !g ? "deleted" : g.rsvp === "no" ? "declined" : "unseated";
      return row(nameOf(e) || t("guests.print.unnamed"), [t(`guests.changes.row.${why}`), t("guests.changes.row.was", { n: e.tableNumber })]);
    });
    const keep = set.noReprint.map((e) => {
      const c = changedBy.get(e.guestId);
      const p = changeParts(t, c, ["mealId", "rsvp"], mealLabel, nameOf(e));
      return row(nameOf(e) || t("guests.print.unnamed"), p.nodes, p.spoken.join(". "));
    });
    out.push(groupEl("reprint", t("guests.changes.g.reprint"), reprint), groupEl("discard", t("guests.changes.g.discard"), discard), groupEl("keep", t("guests.changes.g.keep"), keep));
    if (set.print.length) {
      printBtn = button({ label: t("guests.changes.printChanged", { n: set.print.length }), variant: "primary", onClick: () => opts.onPrintChanged(set.print.map((e) => e.guestId)) });
      printBtn.disabled = busy;
      out.push(h("div", { class: "print-actions" }, printBtn));
    }
    return out;
  }

  return {
    element,
    update({ prints, data, plan }) {
      const model = changeModel(kind, prints, data, plan);
      last = { model, data, plan };
      draw();
      return { reprintIds: model.state === "stale" && kind === "cards" ? model.set.print.map((e) => e.guestId) : [], count: model.count || 0, state: model.state };
    },
    setBusy(b) { busy = b; if (printBtn) printBtn.disabled = b; },
    focusHeading() { heading.scrollIntoView?.({ block: "start" }); heading.focus(); },
  };
}
