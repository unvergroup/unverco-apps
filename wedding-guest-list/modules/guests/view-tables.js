// Tables view (U3): bulk set-up, table cards, pool of unseated attending guests, Move… dialog, edit / delete a table.
// Rules of the move come from logic/tables.js (movePlan); this file draws and writes. Text: messages.js. User text only via h() / textContent.
import { button, confirmDialog, field, h, nextId, select } from "../../core/ui.js";
import { bulkTables, deleteTablePlan, movePlan, tableLoads } from "./logic/tables.js";
import { liveMealId, liveTableId } from "./logic/schema.js";
import { addRecords, applySteps, loadData, loadPlan, newId, savePlan } from "./data.js";
import { badge, flashTarget, focusKey, guestName, mealSvg, plural, ranges, rsvpLabel, sortGuests } from "./parts.js";

const whole = (v) => (typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN);
const inRange = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const FOCUSABLE = "button, select, input, textarea, a[href], [tabindex]:not([tabindex='-1'])";

// root: the panel holder; env: { ctx, t, store, edition, go }; params: { focus, target }
export async function renderTables(root, env, params = {}) {
  const { ctx, t, store, edition } = env;
  const S = { target: params.target ?? null, addOpen: undefined, form: { count: null, seats: null, first: null } };
  let data = await loadData(store);
  let plan = await loadPlan(store);

  const sm = (b) => { b.classList.add("btn-sm"); return b; };
  const keyed = (el, k) => { el.dataset.key = k; return el; };
  const fail = (e) => ctx.fail(e);
  const tableNo = (n) => t("guests.table.n", { n });

  // The live region lives outside the redrawn part, so announcements made after a redraw are still read out.
  const live = h("div", { class: "visually-hidden", role: "status", "aria-live": "polite", "data-live": "tables" });
  const body = h("div", { class: "planner-wide" });
  root.replaceChildren(live, body);
  const announce = (text) => {
    if (live.textContent !== text) { live.textContent = text; return; }
    live.textContent = ""; // the same text again: clear first so it is read out again
    setTimeout(() => { live.textContent = text; }, 30);
  };

  async function reload(focus) {
    try { [data, plan] = [await loadData(store), await loadPlan(store)]; } catch (e) { return fail(e); }
    draw(focus);
  }

  // ---- dialogs (native <dialog>; focus is wrapped inside, Esc closes)
  function showDialog(form, titleId, cls = "dialog") {
    const dlg = h("dialog", { class: cls, "aria-labelledby": titleId }, form);
    dlg.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const items = [...dlg.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  }

  // ---- Move…
  function openMove(g, opener) {
    const loads = new Map(tableLoads(data.guests, data.tables).map((l) => [l.tableId, l]));
    const home = liveTableId(g, data.tables);
    const homeTable = data.tables.find((x) => x.id === home);
    const sorted = [...data.tables].sort((a, b) => a.number - b.number);
    const optLabel = (tb) => {
      const l = loads.get(tb.id) ?? { seated: 0, capacity: 0 };
      const key = tb.id === home ? "guests.move.optCurrent" : l.seated >= l.capacity ? "guests.move.optFull" : "guests.move.opt";
      return t(key, { n: tb.number, seated: l.seated, cap: l.capacity });
    };
    const titleId = nextId("dt");
    const sel = select({
      label: t("guests.move.to"), value: home ?? "",
      options: [{ value: "", label: t("guests.move.unseated") }, ...sorted.map((tb) => ({ value: tb.id, label: optLabel(tb) }))],
    });
    const party = movePlan({ guests: data.guests, tables: data.tables, guestId: g.id, tableId: home, wholeParty: false }).partyCount;
    const box = party > 1 ? h("input", { type: "checkbox", id: nextId("cb"), checked: plan.keepParties !== false }) : null;
    const boxText = h("span", {});
    const hint = h("p", { class: "field-hint", "aria-live": "polite" });
    const go = button({ label: t("guests.move.go"), variant: "primary", type: "submit" });
    const cancel = button({ label: t("common.cancel"), onClick: () => dlg.close("cancel") });
    const nowText = `${homeTable ? t("guests.move.nowAt", { n: homeTable.number }) : t("guests.move.nowNone")}${g.party ? ` · ${g.party}` : ""}`;

    function update() {
      const p = movePlan({ guests: data.guests, tables: data.tables, guestId: g.id, tableId: sel.input.value || null, wholeParty: box ? box.checked : false });
      boxText.textContent = t("guests.move.party", { n: p.partyCount ?? party });
      let text = "", warn = false;
      if (!p.ok) text = "";
      else if (!p.moves.length) text = t("guests.move.hintSame");
      else if (p.tableId === null) text = plural(t, "guests.move.hintUnseat", p.moves.length, { name: guestName(g) });
      else if (p.over) { text = t("guests.move.hintOver", { n: p.number, seated: p.seated, cap: p.capacity, by: p.seated - p.capacity }); warn = true; }
      else text = t("guests.move.hint", { n: p.number, seated: p.seated, cap: p.capacity });
      hint.textContent = text;
      hint.classList.toggle("hint-warn", warn);
      go.disabled = !p.ok || !p.moves.length;
    }
    sel.input.addEventListener("change", update);
    if (box) box.addEventListener("change", update);

    let result = null;
    let busy = false;
    async function submit(e) {
      e.preventDefault();
      if (busy || go.disabled) return;
      busy = true;
      try {
        const fresh = await loadData(store); // the plan is made again on what is saved now (another tab may have changed it)
        const p = movePlan({ guests: fresh.guests, tables: fresh.tables, guestId: g.id, tableId: sel.input.value || null, wholeParty: box ? box.checked : false });
        if (!p.ok) { ctx.notify(t("error.not_found"), "warn"); dlg.close("cancel"); return; }
        if (p.moves.length) await applySteps(store, [{ op: "patch", collection: "guests", items: p.moves.map((m) => ({ id: m.guestId, patch: { tableId: m.to } })) }]);
        if (box && box.checked !== (plan.keepParties !== false)) await savePlan(store, { keepParties: box.checked });
        const who = fresh.guests.find((x) => x.id === (p.moves[0] ? p.moves[0].guestId : g.id)) ?? g;
        result = { count: p.moves.length, name: guestName(who), where: p.tableId === null ? t("guests.move.unseated") : tableNo(p.number) };
        dlg.close("moved");
      } catch (err) {
        busy = false;
        fail(err);
      }
    }
    const form = h("form", { novalidate: true, on: { submit } },
      h("h2", { id: titleId, text: t("guests.move.title", { name: guestName(g) }) }),
      h("p", { class: "muted", text: nowText }),
      sel.element,
      box ? h("label", { class: "check", for: box.id }, box, boxText) : null,
      hint,
      h("div", { class: "dialog-actions" }, cancel, go));
    const dlg = showDialog(form, titleId);
    update();
    sel.input.focus();
    dlg.addEventListener("close", async () => {
      if (!result) { dlg.remove(); if (opener && opener.isConnected) opener.focus(); else focusKey(root, `move:${g.id}`); return; }
      S.target = g.id;
      announce(plural(t, "guests.move.done", result.count, { name: result.name, where: result.where }));
      await reload(`move:${g.id}`); // the dialog leaves the page only after the redraw: "dialog gone" means "view up to date"
      dlg.remove();
    });
  }

  // ---- Edit table
  function openEdit(tb, opener) {
    const titleId = nextId("dt");
    const num = field({ label: t("guests.tables.f.number"), type: "number", value: String(tb.number), inputmode: "numeric", min: 1, max: 999 });
    const seats = field({ label: t("guests.tables.f.seats"), type: "number", value: String(tb.capacity), inputmode: "numeric", min: 1, max: 40 });
    let saved = false;
    let busy = false;
    // Shows the errors against a list of tables; true when both fields are fine.
    function check(tables) {
      const n = whole(num.input.value), k = whole(seats.input.value);
      num.setError(!inRange(n, 1, 999) ? t("guests.tables.err.number") : tables.some((x) => x.id !== tb.id && x.number === n) ? t("guests.tables.err.exists", { n }) : "");
      seats.setError(inRange(k, 1, 40) ? "" : t("guests.tables.err.capacity"));
      const bad = [num, seats].find((f) => f.input.getAttribute("aria-invalid") === "true");
      if (bad) bad.input.focus();
      return !bad;
    }
    async function submit(e) {
      e.preventDefault();
      if (busy) return;
      if (!check(data.tables)) return;
      busy = true;
      try {
        if (!check((await loadData(store)).tables)) { busy = false; return; } // again on what is saved now
        const n = whole(num.input.value), k = whole(seats.input.value);
        // The number is checked once more in the store lock (another tab may have taken it a moment ago).
        const outcome = await store.transact("tables", (list) => {
          const i = list.findIndex((x) => x.id === tb.id);
          if (i < 0) return { list, result: "gone" };
          if (list.some((x) => x.id !== tb.id && x.number === n)) return { list, result: "taken" };
          const next = [...list];
          next[i] = { ...list[i], number: n, capacity: k, updatedAt: new Date().toISOString() };
          return { list: next, result: "ok" };
        });
        if (outcome === "gone") throw Object.assign(new Error("Record not found."), { code: "not_found" });
        if (outcome === "taken") { busy = false; check((await loadData(store)).tables); return; }
        saved = true;
        dlg.close("saved");
        ctx.notify(t("guests.tables.saved", { n }), "success");
      } catch (err) { busy = false; fail(err); }
    }
    const cancel = button({ label: t("common.cancel"), onClick: () => dlg.close("cancel") });
    const form = h("form", { novalidate: true, on: { submit } },
      h("h2", { id: titleId, text: t("guests.tables.editTitle", { n: tb.number }) }),
      h("div", { class: "grid-2" }, num.element, seats.element),
      h("div", { class: "dialog-actions" }, cancel, button({ label: t("common.save"), variant: "primary", type: "submit" })));
    const dlg = showDialog(form, titleId, "dialog dialog-form");
    num.input.focus();
    dlg.addEventListener("close", async () => {
      if (saved) { S.target = tb.id; await reload(`table:${tb.id}`); dlg.remove(); return; }
      dlg.remove();
      if (opener && opener.isConnected) opener.focus();
    });
  }

  // ---- Delete table
  async function deleteTable(tb, opener) {
    const plan2 = deleteTablePlan(data.guests, data.tables, tb.id);
    if (!plan2.ok) { await reload(); return; }
    const r = await confirmDialog({
      title: t("guests.tables.deleteTitle", { n: tb.number }),
      message: plan2.affected ? plural(t, "guests.tables.deleteText", plan2.affected) : t("guests.tables.deleteEmpty"),
      confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true,
    });
    if (!r.confirmed) { if (opener && opener.isConnected) opener.focus(); return; }
    try {
      const sorted = [...data.tables].sort((a, b) => a.number - b.number);
      const i = sorted.findIndex((x) => x.id === tb.id);
      const next = sorted[i + 1] ?? sorted[i - 1];
      await applySteps(store, plan2.steps);
      ctx.notify(t("guests.tables.deleted", { n: tb.number }), "success");
      await reload(next ? `table:${next.id}` : "add-tables");
    } catch (e) { fail(e); }
  }

  // ---- Add tables
  function addTables() {
    const attending = data.guests.filter((g) => g.rsvp === "yes").length;
    const top = Math.max(0, ...data.tables.map((x) => x.number).filter(Number.isInteger));
    const def = { count: String(data.tables.length ? 1 : Math.max(1, Math.ceil(attending / 10))), seats: "10", first: String(top + 1) };
    const f = S.form;
    const val = (k) => (f[k] === null ? def[k] : f[k]);
    const count = field({ label: t("guests.tables.add.count"), type: "number", value: val("count"), inputmode: "numeric", min: 1, max: 100 });
    const seats = field({ label: t("guests.tables.add.seats"), type: "number", value: val("seats"), inputmode: "numeric", min: 1, max: 40 });
    const first = field({ label: t("guests.tables.add.first"), type: "number", value: val("first"), inputmode: "numeric", min: 1, max: 999 });
    const hint = h("p", { class: "field-hint" });
    const submit = button({ label: "", variant: "primary", type: "submit" });

    function numbers() {
      const n = whole(count.input.value), k = whole(seats.input.value), st = whole(first.input.value);
      return { n, k, st, ok: inRange(n, 1, 100) && inRange(k, 1, 40) && inRange(st, 1, 999) && st + n - 1 <= 999 };
    }
    function refresh() {
      const { n, k, st, ok } = numbers();
      submit.textContent = inRange(n, 1, 100) ? plural(t, "guests.tables.add.btn", n) : t("guests.tables.add.btn.none");
      hint.textContent = ok ? plural(t, "guests.tables.add.hint", n, { a: st, b: st + n - 1, k }) : "";
    }
    for (const [k, fld] of [["count", count], ["seats", seats], ["first", first]]) {
      fld.input.addEventListener("input", () => { f[k] = fld.input.value; refresh(); });
    }

    // Shows the errors of the three fields against a list of tables; true when all are fine.
    function check(tables) {
      const { n, k, st } = numbers();
      count.setError(inRange(n, 1, 100) ? "" : t("guests.tables.err.count"));
      seats.setError(inRange(k, 1, 40) ? "" : t("guests.tables.err.capacity"));
      let firstErr = "";
      if (!inRange(st, 1, 999)) firstErr = t("guests.tables.err.number");
      else if (inRange(n, 1, 100)) {
        if (st + n - 1 > 999) firstErr = t("guests.tables.err.range");
        else {
          const taken = new Set(tables.map((x) => x.number));
          const used = [];
          for (let i = st; i < st + n; i++) if (taken.has(i)) used.push(i);
          if (used.length) firstErr = plural(t, "guests.tables.err.used", used.length, { list: ranges(used) });
        }
      }
      first.setError(firstErr);
      const bad = [count, seats, first].find((x) => x.input.getAttribute("aria-invalid") === "true");
      if (bad) bad.input.focus();
      return !bad;
    }

    // A double click or a second tab must not add the tables twice: the button is off while the write runs (released after the redraw),
    // and the numbers are checked again INSIDE the store lock on what is saved at that moment (addRecords check).
    let busy = false;
    async function onSubmit(e) {
      e.preventDefault();
      if (busy) return;
      if (!check(data.tables)) return;
      busy = true;
      submit.disabled = true;
      try {
        const fresh = await loadData(store); // numbers are checked again on what is saved now
        if (!check(fresh.tables)) return;
        const { n, k, st } = numbers();
        const made = bulkTables(fresh.tables, n, k, st);
        if (made.errors.length) { first.setError(t("guests.tables.err.range")); first.input.focus(); return; }
        const limit = edition.limitFor("tables");
        const items = made.tables.map((x) => ({ id: newId(), number: x.number, capacity: x.capacity }));
        try {
          await addRecords(store, "tables", items, (have, adding, list) => {
            if (have + adding > limit) throw Object.assign(new Error("demo limit"), { code: "limit_reached", limit });
            const taken = new Set(list.map((x) => x.number));
            if (items.some((x) => taken.has(x.number))) throw Object.assign(new Error("table numbers taken"), { code: "numbers_taken" });
          });
        } catch (err) {
          if (err && err.code === "limit_reached") ctx.notify(t("guests.demo.tables", { limit: err.limit ?? limit }), "warn");
          else if (err && err.code === "numbers_taken") check((await loadData(store)).tables); // another tab took a number: show the usual "already used" error
          else fail(err);
          return;
        }
        S.form = { count: null, seats: null, first: null };
        S.addOpen = false;
        announce(plural(t, "guests.tables.added", items.length));
        await reload(`table:${items[0].id}`);
      } finally {
        busy = false;
        if (submit.isConnected) submit.disabled = false;
      }
    }

    refresh();
    const open = S.addOpen === undefined ? data.tables.length === 0 : S.addOpen;
    const summary = h("summary", { class: "btn btn-ghost", "data-key": "add-tables", text: t("guests.tables.add.title") });
    const details = h("details", { class: "card add-tables", open, on: { toggle: () => { S.addOpen = details.open; } } },
      summary,
      h("form", { novalidate: true, on: { submit: onSubmit } },
        h("div", { class: "row" }, count.element, seats.element, first.element),
        hint,
        h("div", { class: "row" }, submit)));
    return details;
  }

  // ---- drawing
  function chip(g, withMove) {
    const meal = g.rsvp === "yes" || g.mealId ? data.meals.find((m) => m.id === liveMealId(g, data.meals)) : null;
    const sub = [g.party, g.rsvp === "yes" ? "" : rsvpLabel(t, g.rsvp)].filter(Boolean).join(" · ");
    const li = h("li", { class: "chip", "data-id": g.id },
      h("span", { class: "meal-slot", "aria-hidden": "true" }, meal ? h("span", { class: "meal-mark" }, mealSvg(meal.slot)) : null),
      h("span", { class: "chip-name" },
        h("bdi", { text: guestName(g) }),
        sub ? h("span", { class: "chip-party" }, h("bdi", { text: sub })) : null,
        meal ? h("span", { class: "visually-hidden", text: t("guests.tables.mealSr", { label: meal.label }) }) : null),
      withMove ? keyed(sm(button({ label: t("guests.move.btn"), ariaLabel: t("guests.move.aria", { name: guestName(g) }), onClick: (e) => openMove(g, e.currentTarget) })), `move:${g.id}`) : null);
    const mv = li.querySelector("button");
    if (mv) mv.setAttribute("aria-haspopup", "dialog");
    if (S.target === g.id) flashTarget(li);
    return li;
  }

  function pool() {
    const waiting = data.guests.filter((g) => g.rsvp === "yes" && !liveTableId(g, data.tables)).sort(sortGuests);
    const canMove = data.tables.length > 0;
    return h("aside", { class: "pool card", "aria-labelledby": "pool-h" },
      h("h3", { id: "pool-h" }, t("guests.pool.title"), " ", badge(waiting.length, waiting.length ? "warn" : undefined)),
      h("p", { class: "muted", text: t("guests.pool.text") }),
      waiting.length
        ? h("ul", { class: "chips" }, waiting.map((g) => chip(g, canMove)))
        : h("div", { class: "status status-ok" }, h("div", { text: t("guests.pool.ok") })),
      waiting.length && !canMove ? h("p", { class: "field-hint", text: t("guests.pool.needTables") }) : null);
  }

  function tableCard(tb, load) {
    const here = data.guests.filter((g) => liveTableId(g, data.tables) === tb.id).sort(sortGuests);
    const hid = `tbl-${tb.id}`;
    const meter = h("div", { class: "meter", "aria-hidden": "true" }, h("span", {}));
    meter.style.setProperty("--fill", `${load.capacity ? Math.min(100, Math.round((load.seated / load.capacity) * 100)) : 100}%`);
    const card = h("section", { class: `table-card${load.over ? " is-over" : ""}`, "aria-labelledby": hid, "data-id": tb.id },
      h("div", { class: "table-card-head" },
        h("h3", { id: hid, tabindex: "-1", "data-key": `table:${tb.id}`, text: tableNo(tb.number) }),
        h("span", { class: "seat-count", text: load.over ? t("guests.tables.seatedOver", { seated: load.seated, cap: load.capacity, by: load.seated - load.capacity }) : t("guests.tables.seated", { seated: load.seated, cap: load.capacity }) })),
      meter,
      here.length ? h("ul", { class: "chips" }, here.map((g) => chip(g, true))) : h("p", { class: "muted", text: t("guests.tables.noGuests") }),
      h("div", { class: "row table-card-actions" },
        sm(button({ label: t("common.edit"), ariaLabel: t("guests.tables.editAria", { n: tb.number }), onClick: (e) => openEdit(tb, e.currentTarget) })),
        sm(button({ label: t("common.delete"), ariaLabel: t("guests.tables.deleteAria", { n: tb.number }), onClick: (e) => deleteTable(tb, e.currentTarget) }))));
    if (S.target === tb.id) flashTarget(card);
    return card;
  }

  function draw(focus) {
    if (data.guests.length === 0 && data.tables.length === 0) {
      body.replaceChildren(h("section", { class: "empty stack", "aria-labelledby": "tbl-empty-h" },
        h("h2", { id: "tbl-empty-h", text: t("guests.empty.tablesNone.title") }),
        h("p", { text: t("guests.empty.tablesNone.text") }),
        h("div", { class: "row" }, button({ label: t("guests.empty.goGuests"), variant: "primary", onClick: () => env.go("guests") }))));
      return;
    }
    const loads = tableLoads(data.guests, data.tables);
    const used = loads.reduce((n, l) => n + l.seated, 0), cap = loads.reduce((n, l) => n + l.capacity, 0);
    const tableById = new Map(data.tables.map((x) => [x.id, x]));
    body.replaceChildren(
      h("div", { class: "view-head" }, h("h2", { text: t("guests.tab.tables") }),
        h("span", { class: "muted", text: t("guests.tables.summary", { tables: plural(t, "guests.tables.count", data.tables.length), seated: used, cap }) })),
      addTables(),
      h("div", { class: "tables-layout" },
        pool(),
        h("div", { class: "table-grid" }, data.tables.length ? loads.map((l) => tableCard(tableById.get(l.tableId), l)) : h("p", { class: "muted", text: t("guests.tables.noTables") }))));
    S.target = null;
    if (focus) focusKey(body, focus);
  }

  draw(params.focus);
  return { onExternal: () => (document.querySelector("dialog[open]") ? undefined : reload()) };
}
