// Guests view (U2): count strip, meal options, "Attending, no meal", guest table (add / edit / delete, filter), sample data.
// The import wizard (view-import.js) takes over this view while it is open. Text: messages.js. User text only via h() / textContent.
import { button, confirmDialog, field, h, nextId, select } from "../../core/ui.js";
import { counts, missingMeals } from "./logic/counts.js";
import { clampField } from "./logic/normalize.js";
import { liveMealId, liveTableId } from "./logic/schema.js";
import { isSampleId, sampleLoadPlan, sampleRemovePlan } from "./logic/sample.js";
import { canAddMeal, deleteMealPlan, freeMealSlot, tableLoads } from "./logic/tables.js";
import { applySteps, loadData, newId, now } from "./data.js";
import { badge, flashTarget, focusKey, guestName, mealWithMark, plural, rsvpLabel } from "./parts.js";
import { openImport, pickCsv } from "./view-import.js";

const FILTERS = ["all", "yes", "pending", "no"];
const pass = { all: () => true, yes: (g) => g.rsvp === "yes", no: (g) => g.rsvp === "no", pending: (g) => g.rsvp !== "yes" && g.rsvp !== "no" };
const hasSample = (d) => ["guests", "tables", "meals"].some((c) => d[c].some((r) => isSampleId(r.id)));

// root: the panel; env: { ctx, t, store, edition, go }; params: { flash }
export async function renderGuests(root, env, params = {}) {
  const { ctx, t, store, edition } = env;
  const S = { filter: "all", renaming: null, wizard: false, flash: params.flash ?? null, target: null };
  let data = await loadData(store);

  const sm = (b) => { b.classList.add("btn-sm"); return b; };
  const keyed = (el, k) => { el.dataset.key = k; return el; };
  const fail = (e) => ctx.fail(e);

  // One write action at a time in this view: a double click must not run it twice. The button is off while the action runs and is
  // released after it is finished, which includes the redraw (reload). The write itself also decides on the saved data in the store lock.
  let writing = false;
  async function exclusive(btn, fn) {
    if (writing) return undefined;
    writing = true;
    if (btn) btn.disabled = true;
    try {
      return await fn();
    } finally {
      writing = false;
      if (btn && btn.isConnected) {
        btn.disabled = false;
        // A confirm dialog closed without a change: while the button was off the focus could not return to it (it fell to <body>).
        if (!document.activeElement || document.activeElement === document.body) btn.focus();
      }
    }
  }

  async function reload(focus) {
    try { data = await loadData(store); } catch (e) { return fail(e); }
    draw(focus);
  }

  // ---- gates (demo)
  function gate() {
    if (edition.isDemo && hasSample(data)) { ctx.notify(t("guests.sample.blocked", { limit: edition.limitFor("guests") }), "warn"); return false; }
    return true;
  }
  function gateAdd() {
    if (!gate()) return false;
    const c = edition.check("guests", data.guests.length);
    if (!c.ok) { ctx.notify(t("guests.demo.guests", { limit: c.limit }), "warn"); return false; }
    return true;
  }

  // ---- import
  function startImport(mode, file) {
    S.wizard = true;
    openImport(root, env, {
      mode, file,
      onCancel: () => { S.wizard = false; reload(mode === "csv" ? "csv" : "paste"); },
      onDone: ({ count }) => { S.wizard = false; S.flash = { count }; reload("flash"); },
    });
    root.querySelector("textarea")?.focus();
  }
  async function importCsv() {
    if (!gate()) return;
    const file = await pickCsv();
    if (file) startImport("csv", file);
  }

  // ---- sample data
  function loadSample(ev) {
    return exclusive(ev && ev.currentTarget, async () => {
      try {
        const plan = sampleLoadPlan(data);
        if (plan.needsConfirm) {
          const r = await confirmDialog({ title: t("guests.sample.loadTitle"), message: t("guests.sample.loadText"), confirmLabel: t("guests.sample.load"), cancelLabel: t("common.cancel") });
          if (!r.confirmed) return;
        }
        await applySteps(store, plan.steps); // ids that are already saved are skipped in the lock (data.js addRecords)
        if (plan.mealsSkipped) ctx.notify(t("guests.sample.mealsSkipped"), "warn");
        else ctx.notify(t("guests.sample.loaded"), "success");
        await reload("remove-sample");
      } catch (e) { fail(e); }
    });
  }
  function removeSample(ev) {
    return exclusive(ev && ev.currentTarget, async () => {
      try {
        const r = await confirmDialog({ title: t("guests.sample.removeTitle"), message: t("guests.sample.removeText"), confirmLabel: t("guests.sample.remove"), cancelLabel: t("common.cancel"), danger: true });
        if (!r.confirmed) return;
        await applySteps(store, sampleRemovePlan(data).steps);
        ctx.notify(t("guests.sample.removed"), "success");
        await reload("paste");
      } catch (e) { fail(e); }
    });
  }

  // ---- guests: add / edit / delete
  async function deleteGuest(g, next) {
    const r = await confirmDialog({ title: t("guests.delete.title", { name: guestName(g) }), message: t("guests.delete.text"), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true });
    if (!r.confirmed) return false;
    try {
      await store.remove("guests", g.id);
      ctx.notify(t("guests.deleted", { name: guestName(g) }), "success");
      await reload(next);
    } catch (e) { fail(e); }
    return true;
  }
  const nextFocus = (g) => {
    const shown = data.guests.filter(pass[S.filter]);
    const i = shown.findIndex((x) => x.id === g.id);
    const neighbour = shown[i + 1] ?? shown[i - 1];
    return neighbour ? `edit:${neighbour.id}` : "paste";
  };

  // Add / edit dialog. focusField: "meal" when opened from "Choose meal".
  function guestDialog(g, focusField) {
    const isNew = !g;
    const titleId = nextId("dt");
    const first = field({ label: t("guests.form.first"), value: g?.first ?? "", maxlength: 100, autocomplete: "off" });
    const last = field({ label: t("guests.form.last"), value: g?.last ?? "", maxlength: 100, autocomplete: "off" });
    const party = field({ label: t("guests.form.party"), value: g?.party ?? "", maxlength: 60, hint: t("guests.form.partyHint"), autocomplete: "off" });
    const rsvp = select({ label: t("guests.form.rsvp"), value: g?.rsvp ?? "pending", options: ["yes", "pending", "no"].map((v) => ({ value: v, label: rsvpLabel(t, v) })) });
    const meal = data.meals.length
      ? select({ label: t("guests.form.meal"), value: liveMealId(g ?? {}, data.meals) ?? "", options: [{ value: "", label: t("guests.meal.none") }, ...data.meals.map((m) => ({ value: m.id, label: m.label }))] })
      : null;
    const age = select({ label: t("guests.form.age"), value: g?.age === "child" ? "child" : "adult", options: ["adult", "child"].map((v) => ({ value: v, label: t(`guests.age.${v}`) })) });
    const loads = new Map(tableLoads(data.guests, data.tables).map((l) => [l.tableId, l]));
    const tableSel = select({
      label: t("guests.form.table"), value: liveTableId(g ?? {}, data.tables) ?? "",
      options: [{ value: "", label: t("guests.table.none") }, ...[...data.tables].sort((a, b) => a.number - b.number).map((tb) => ({ value: tb.id, label: t("guests.table.option", { n: tb.number, seated: loads.get(tb.id)?.seated ?? 0, cap: loads.get(tb.id)?.capacity ?? 0 }) }))],
    });
    const notes = field({ label: t("guests.form.notes"), value: g?.notes ?? "", multiline: true, maxlength: 500, hint: t("guests.form.notesHint") });

    return new Promise((resolve) => {
      const cancel = button({ label: t("common.cancel"), onClick: () => dlg.close("cancel") });
      const save = button({ label: t("common.save"), variant: "primary", type: "submit" });
      const del = isNew ? null : button({ label: t("guests.form.delete"), variant: "danger", onClick: () => dlg.close("delete") });
      if (del) del.classList.add("spacer");
      const form = h("form", { novalidate: true, on: { submit: onSubmit } },
        h("h2", { id: titleId, text: isNew ? t("guests.form.addTitle") : t("guests.form.editTitle", { name: guestName(g) }) }),
        h("div", { class: "grid-2" }, first.element, last.element),
        party.element, rsvp.element,
        meal ? meal.element : h("p", { class: "muted", text: t("guests.form.mealFirst") }),
        h("div", { class: "grid-2" }, age.element, tableSel.element),
        notes.element,
        h("div", { class: "dialog-actions" }, del, cancel, save));
      const dlg = h("dialog", { class: "dialog dialog-form", "aria-labelledby": titleId }, form);
      let outcome = { action: "cancel" };
      dlg.addEventListener("close", () => {
        dlg.remove();
        resolve(dlg.returnValue === "delete" ? { action: "delete" } : outcome);
      });
      let busy = false;
      async function onSubmit(e) {
        e.preventDefault();
        if (busy) return;
        const f = clampField("name", first.input.value.trim()).value;
        const l = clampField("name", last.input.value.trim()).value;
        first.setError("");
        if (f === "" && l === "") { first.setError(t("guests.form.nameNeeded")); first.input.focus(); return; }
        const fields = {
          first: f, last: l, party: clampField("party", party.input.value.trim()).value, rsvp: rsvp.input.value,
          mealId: meal && meal.input.value ? meal.input.value : null, age: age.input.value, tableId: tableSel.input.value || null,
          notes: clampField("notes", notes.input.value.trim()).value,
        };
        busy = true;
        try {
          let id = g?.id;
          if (isNew) id = (await edition.add(store, "guests", { ...fields, source: "manual" })).id;
          else await store.update("guests", g.id, fields);
          outcome = { action: "saved", id, name: guestName(fields) };
          dlg.close("saved");
        } catch (err) {
          busy = false;
          if (err && err.code === "limit_reached") { ctx.notify(t("guests.demo.guests", { limit: err.limit ?? edition.limitFor("guests") }), "warn"); dlg.close("cancel"); }
          else fail(err);
        }
      }
      document.body.append(dlg);
      dlg.showModal();
      if (focusField === "meal" && meal) meal.input.focus();
    });
  }

  async function openGuest(g, focusField) {
    if (!g && !gateAdd()) return;
    const r = await guestDialog(g, focusField);
    if (r.action === "delete") {
      const done = await deleteGuest(g, nextFocus(g));
      if (!done) focusKey(root, `edit:${g.id}`);
      return;
    }
    if (r.action === "saved") {
      ctx.notify(t("guests.saved", { name: r.name }), "success");
      const visible = pass[S.filter]((await store.get("guests", r.id)) ?? {});
      if (!visible) S.filter = "all";
      S.target = r.id;
      await reload(`edit:${r.id}`);
      return;
    }
    focusKey(root, g ? `edit:${g.id}` : "add");
  }

  // ---- meals
  function addMeal(input, errEl, ev) {
    const btn = ev && ev.currentTarget && ev.currentTarget.tagName === "BUTTON" ? ev.currentTarget : null;
    return exclusive(btn, async () => {
      const label = clampField("meal", input.value.trim()).value;
      const taken = data.meals.some((m) => m.label.toLowerCase() === label.toLowerCase());
      errEl.textContent = label === "" ? t("guests.meal.nameNeeded") : taken ? t("guests.meal.nameTaken", { label }) : "";
      input.setAttribute("aria-invalid", errEl.textContent ? "true" : "false");
      if (errEl.textContent) { input.focus(); return; }
      try {
        // Name and room are checked again in the store lock, on the meals saved at that moment.
        const made = await store.transact("meals", (list) => {
          if (list.some((m) => m.label.toLowerCase() === label.toLowerCase())) return { list, result: "taken" };
          if (!canAddMeal(list)) return { list, result: null };
          const slot = freeMealSlot(list);
          const rec = { id: newId(), label, slot, createdAt: now(), updatedAt: now() };
          return { list: [...list, rec], result: rec.id };
        });
        if (made === "taken") {
          errEl.textContent = t("guests.meal.nameTaken", { label });
          input.setAttribute("aria-invalid", "true");
          input.focus();
          return;
        }
        if (!made) { ctx.notify(t("guests.meal.max"), "warn"); return; }
        ctx.notify(t("guests.meal.added", { label }), "success");
        await reload("meal-input");
      } catch (e) { fail(e); }
    });
  }
  function renameMeal(m, input, errEl, ev) {
    const btn = ev && ev.currentTarget && ev.currentTarget.tagName === "BUTTON" ? ev.currentTarget : null;
    return exclusive(btn, async () => {
      const label = clampField("meal", input.value.trim()).value;
      const taken = data.meals.some((x) => x.id !== m.id && x.label.toLowerCase() === label.toLowerCase());
      errEl.textContent = label === "" ? t("guests.meal.nameNeeded") : taken ? t("guests.meal.nameTaken", { label }) : "";
      input.setAttribute("aria-invalid", errEl.textContent ? "true" : "false");
      if (errEl.textContent) { input.focus(); return; }
      try {
        const out = await store.transact("meals", (list) => {
          const i = list.findIndex((x) => x.id === m.id);
          if (i < 0) return { list, result: "gone" };
          if (list.some((x) => x.id !== m.id && x.label.toLowerCase() === label.toLowerCase())) return { list, result: "taken" };
          const next = [...list];
          next[i] = { ...list[i], label, updatedAt: now() };
          return { list: next, result: "ok" };
        });
        if (out === "gone") throw Object.assign(new Error("Record not found."), { code: "not_found" });
        if (out === "taken") { errEl.textContent = t("guests.meal.nameTaken", { label }); input.setAttribute("aria-invalid", "true"); input.focus(); return; }
        S.renaming = null;
        ctx.notify(t("guests.meal.renamed", { label }), "success");
        await reload(`rename:${m.id}`);
      } catch (e) { fail(e); }
    });
  }
  function deleteMeal(m, ev) {
    return exclusive(ev && ev.currentTarget, async () => {
      const plan = deleteMealPlan(data.guests, data.meals, m.id);
      const r = await confirmDialog({
        title: t("guests.meal.deleteTitle", { label: m.label }),
        message: plan.affected ? plural(t, "guests.meal.deleteText", plan.affected) : t("guests.meal.deleteUnused"),
        confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true,
      });
      if (!r.confirmed) { focusKey(root, `del-meal:${m.id}`); return; }
      try {
        await applySteps(store, plan.steps);
        ctx.notify(t("guests.meal.deleted", { label: m.label }), "success");
        await reload("meal-input");
      } catch (e) { fail(e); }
    });
  }

  // ---- drawing
  function mealRow(m) {
    const used = data.guests.filter((g) => g.mealId === m.id).length;
    if (S.renaming === m.id) {
      const f = field({ label: t("guests.meal.renameLabel", { label: m.label }), value: m.label, maxlength: 24, autocomplete: "off" });
      f.input.dataset.key = `rename-input:${m.id}`;
      const err = f.element.querySelector(".field-error");
      const save = sm(button({ label: t("common.save"), variant: "primary", onClick: (e) => renameMeal(m, f.input, err, e) }));
      const stop = () => { S.renaming = null; draw(`rename:${m.id}`); };
      f.input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); stop(); }
        else if (e.key === "Enter") { e.preventDefault(); renameMeal(m, f.input, err, null); }
      });
      queueMicrotask(() => f.input.focus());
      return h("li", { class: "chip" }, h("div", { class: "grow" }, f.element), save, sm(button({ label: t("common.cancel"), onClick: stop })));
    }
    return h("li", { class: "chip" },
      h("span", { class: "chip-name" }, mealWithMark(m), " ", h("span", { class: "muted", text: `· ${used}` })),
      keyed(sm(button({ label: t("guests.meal.rename"), ariaLabel: t("guests.meal.renameAria", { label: m.label }), onClick: () => { S.renaming = m.id; draw(); } })), `rename:${m.id}`),
      keyed(sm(button({ label: t("common.delete"), ariaLabel: t("guests.meal.deleteAria", { label: m.label }), onClick: (e) => deleteMeal(m, e) })), `del-meal:${m.id}`));
  }

  function mealsCard() {
    const full = !canAddMeal(data.meals);
    const input = h("input", { id: "meal-new", type: "text", maxlength: 24, placeholder: t("guests.meal.placeholder"), autocomplete: "off", disabled: full, "data-key": "meal-input", "aria-describedby": "meal-new-err" });
    const err = h("p", { class: "field-error", id: "meal-new-err", role: "alert" });
    const add = button({ label: t("guests.meal.add"), disabled: full, onClick: (e) => addMeal(input, err, e) });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addMeal(input, err, null); } });
    return h("section", { class: "card", "aria-labelledby": "meals-h" },
      h("h3", { id: "meals-h" }, t("guests.meal.title"), " ", h("span", { class: "muted", text: t("guests.meal.count", { n: data.meals.length }) })),
      data.meals.length ? h("ul", { class: "chips" }, [...data.meals].sort((a, b) => a.slot - b.slot).map(mealRow)) : h("p", { class: "muted", text: t("guests.meal.empty") }),
      h("div", { class: "stack-top" },
        h("div", { class: "field" }, h("label", { for: "meal-new", text: t("guests.meal.addLabel") }),
          h("div", { class: "row" }, h("div", { class: "grow" }, input), add), err),
        full ? h("p", { class: "field-hint", text: t("guests.meal.max") }) : null));
  }

  function missingCard() {
    const list = missingMeals(data.guests, data.meals);
    if (!list.length) return null;
    return h("section", { class: "card card-warn", "aria-labelledby": "nomeal-h" },
      h("h3", { id: "nomeal-h" }, t("guests.nomeal.title"), " ", badge(list.length, "warn")),
      h("p", { class: "muted", text: t("guests.nomeal.text") }),
      h("ul", { class: "chips" }, list.map((g) => h("li", { class: "chip" },
        h("span", { class: "chip-name" }, h("bdi", { text: guestName(g) }), g.party ? h("span", { class: "chip-party" }, h("bdi", { text: g.party })) : null),
        keyed(sm(button({ label: t("guests.nomeal.choose"), ariaLabel: t("guests.nomeal.chooseAria", { name: guestName(g) }), onClick: () => openGuest(g, "meal") })), `choose:${g.id}`)))));
  }

  function strip() {
    const c = counts(data.guests);
    const li = (value, label) => h("li", { class: "stat" }, h("span", { class: "stat-value", text: String(value) }), h("span", { class: "stat-label", text: label }));
    const people = `${plural(t, "guests.strip.adults", c.adults)}, ${plural(t, "guests.strip.children", c.children)}`;
    return h("ul", { class: "stat-strip", "aria-label": t("guests.strip.label") },
      li(c.invited, t("guests.strip.guests")), li(c.attending, t("guests.strip.attending", { people })), li(c.pending, t("guests.strip.pending")), li(c.declined, t("guests.strip.declined")));
  }

  function filterBar() {
    const c = counts(data.guests);
    const n = { all: c.invited, yes: c.attending, pending: c.pending, no: c.declined };
    return h("fieldset", { class: "segmented" }, h("legend", { class: "visually-hidden", text: t("guests.filter.legend") }),
      FILTERS.map((f) => h("label", {}, h("input", { type: "radio", name: "guest-filter", value: f, checked: S.filter === f, "data-key": `filter:${f}`,
        on: { change: () => { S.filter = f; draw(`filter:${f}`); } } }), t(`guests.filter.${f}`, { n: n[f] }))));
  }

  function guestTable() {
    const shown = data.guests.filter(pass[S.filter]);
    if (!shown.length) return h("div", { class: "empty" }, h("p", { text: t(`guests.filter.none.${S.filter}`) }));
    const mealOf = new Map(data.meals.map((m) => [m.id, m]));
    const tableOf = new Map(data.tables.map((x) => [x.id, x]));
    const cell = (label, attrs, ...kids) => h("td", { "data-label": label, ...attrs }, ...kids);
    const rows = shown.map((g) => {
      const name = guestName(g);
      const meal = g.rsvp === "yes" ? mealOf.get(liveMealId(g, data.meals)) : null;
      const tb = tableOf.get(liveTableId(g, data.tables));
      const empty = (v) => (v ? "" : " cell-empty");
      const tr = h("tr", { "data-id": g.id },
        cell(t("guests.col.name"), {}, h("strong", {}, h("bdi", { text: name })), g.notes ? h("span", { class: "chip-party guest-note" }, h("bdi", { text: g.notes })) : null),
        cell(t("guests.col.party"), { class: `narrow-hide${empty(g.party)}` }, h("bdi", { text: g.party ?? "" })),
        cell(t("guests.col.rsvp"), { "data-col": "rsvp", class: "nowrap" }, rsvpLabel(t, g.rsvp)),
        cell(t("guests.col.meal"), { "data-col": "meal", class: g.rsvp === "yes" ? "" : "cell-empty" }, g.rsvp !== "yes" ? "" : meal ? mealWithMark(meal) : h("span", { class: "meal-none", text: t("guests.meal.none") })),
        cell(t("guests.col.age"), { class: "nowrap narrow-hide" }, t(`guests.age.${g.age === "child" ? "child" : "adult"}`)),
        cell(t("guests.col.table"), { "data-col": "table", class: "nowrap" }, tb ? t("guests.table.n", { n: tb.number }) : t("guests.table.none")),
        h("td", { class: "actions-col" }, h("div", { class: "row" },
          keyed(sm(button({ label: t("common.edit"), ariaLabel: t("guests.edit.aria", { name }), onClick: () => openGuest(g) })), `edit:${g.id}`),
          (() => { const b = sm(button({ label: t("common.delete"), ariaLabel: t("guests.delete.aria", { name }), onClick: () => deleteGuest(g, nextFocus(g)) })); b.classList.add("narrow-hide-btn"); return b; })())));
      if (S.target === g.id) flashTarget(tr);
      return tr;
    });
    S.target = null;
    const caption = t("guests.table.caption", { filter: t(`guests.filter.name.${S.filter}`), n: shown.length });
    return h("div", { class: "table-wrap" }, h("table", { class: "data-table guest-table" },
      h("caption", { text: caption }),
      h("thead", {}, h("tr", {}, ["name", "party", "rsvp", "meal", "age", "table"].map((c) => h("th", { scope: "col", class: c === "party" || c === "age" ? "narrow-hide" : "", text: t(`guests.col.${c}`) })), h("th", { scope: "col" }, h("span", { class: "visually-hidden", text: t("guests.col.actions") })))),
      h("tbody", {}, rows)));
  }

  function draw(focus) {
    if (S.wizard) return;
    const parts = [];
    if (hasSample(data)) parts.push(h("div", { class: "banner row" }, h("span", { text: t("guests.sample.banner") }), keyed(button({ label: t("guests.sample.removeBtn"), variant: "ghost", onClick: removeSample }), "remove-sample")));
    if (S.flash) {
      const msg = h("span", { tabindex: "-1", "data-key": "flash", text: plural(t, "guests.flash.imported", S.flash.count) });
      parts.push(h("div", { class: "banner row", role: "status" }, msg, button({ label: t("guests.flash.go"), variant: "primary", onClick: () => env.go("tables") })));
    }
    const actions = [
      keyed(button({ label: t("guests.action.paste"), variant: "primary", onClick: () => { if (gate()) startImport("paste"); } }), "paste"),
      keyed(button({ label: t("guests.action.csv"), onClick: importCsv }), "csv"),
      keyed(button({ label: t("guests.action.add"), onClick: () => openGuest(null) }), "add"),
    ];
    if (data.guests.length === 0) {
      parts.push(h("section", { class: "empty stack", "aria-labelledby": "empty-h" },
        h("h2", { id: "empty-h", text: t("guests.start.title") }),
        h("p", { text: t("guests.start.text") }),
        h("div", { class: "row" }, ...actions),
        h("p", { class: "muted" }, t("guests.start.looking"), " ", keyed(button({ label: t("guests.start.sample"), variant: "ghost", onClick: loadSample }), "load-sample"))));
    } else {
      parts.push(h("div", { class: "view-head" }, h("h2", { text: t("guests.tab.guests") }), h("div", { class: "row" }, ...actions)));
      parts.push(strip());
      parts.push(h("div", { class: "grid-2 grid-wide top" }, mealsCard(), missingCard()));
      parts.push(filterBar(), guestTable());
      if (!hasSample(data)) parts.push(h("p", { class: "muted stack-top" }, t("guests.start.looking"), " ", keyed(button({ label: t("guests.sample.loadBtn"), variant: "ghost", onClick: loadSample }), "load-sample")));
    }
    root.replaceChildren(...parts);
    if (focus) focusKey(root, focus);
  }

  draw(params.focus);
  return { onExternal: () => (S.wizard ? undefined : reload()) };
}
