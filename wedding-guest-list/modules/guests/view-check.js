// Check view (U4): the eight items of the pre-print check (logic/checks.js). It warns and never blocks. A record button opens the
// view that fixes it and puts the focus on the record. Text: messages.js. User text only via h() / textContent.
import { button, h } from "../../core/ui.js";
import { runChecks } from "./logic/checks.js";
import { resolveCard } from "./logic/cardlayout.js";
import { diff, signStaleCount, snapshotOf } from "./logic/printdiff.js";
import { cardOrder } from "./logic/signsort.js";
import { PLAN_DEFAULTS } from "./logic/schema.js";
import { loadData, loadPlan } from "./data.js";
import { changeModel } from "./print-diff.js";
import { badge, flashKeyWhenReady, guestName, plural } from "./parts.js";
import { fontsReady, measureTooLong } from "./print-cards.js";

const MAX_RECORDS = 10;

// Ids of the guests whose name does not fit a place card (Print's decision: logic/cardfit.js first size, then the drawn name is measured
// and shrunk; below 12 pt or still overflowing = too long). Check measures the same way, on a hidden copy of the cards
// (print-cards.js measureTooLong), so the two views always agree. Cards are made for seated guests who have not declined.
async function tooLongIds(guests, tables, plan, t) {
  try {
    const card = resolveCard(plan.cardPreset, plan.customCard) ?? resolveCard(PLAN_DEFAULTS.cardPreset);
    const order = cardOrder(guests, tables);
    if (!order.length) return [];
    await fontsReady();
    const entries = order.map((e) => ({ name: e.name, tableNumber: e.tableNumber, slot: null }));
    const bad = measureTooLong(card, { x: plan.offX100, y: plan.offY100 }, entries, { showMeal: false, tableLabel: (n) => t("guests.table.n", { n }), unnamed: t("guests.print.unnamed"), demoText: null });
    return bad.map((i) => order[i].id);
  } catch {
    return [];
  }
}

// root: the panel holder; env: { ctx, t, store, edition, go }
export async function renderCheck(root, env) {
  const { ctx, t, store } = env;
  const draw = async () => {
    const [data, plan, prints] = [await loadData(store), await loadPlan(store), await store.list("prints")];
    if (data.guests.length === 0) {
      root.replaceChildren(h("section", { class: "empty stack", "aria-labelledby": "chk-empty-h" },
        h("h2", { id: "chk-empty-h", text: t("guests.empty.checkNone.title") }),
        h("p", { text: t("guests.empty.checkNone.text") })));
      return;
    }
    const byId = new Map(data.guests.map((g) => [g.id, g]));
    const tableById = new Map(data.tables.map((x) => [x.id, x]));
    const sign = (Array.isArray(prints) ? prints : []).filter((p) => p && p.kind === "sign").at(-1);
    const stale = signStaleCount(sign ? diff(sign.entries, snapshotOf(data.guests, data.tables)) : null);
    // Item 8 counts BOTH printed items: the sign and the place cards (same comparison as Print > Place cards > Changes since printed).
    const cardsModel = changeModel("cards", prints, data, plan);
    const cardsStale = cardsModel.state === "stale" ? cardsModel.count || cardsModel.set?.print.length || 1 : 0;
    const result = runChecks({ guests: data.guests, tables: data.tables, meals: data.meals, tooLong: await tooLongIds(data.guests, data.tables, plan, t), staleCount: stale + cardsStale });

    const name = (id) => guestName(byId.get(id) ?? {});
    const withParty = (id) => { const p = (byId.get(id) ?? {}).party; return p ? t("guests.check.partyLabel", { name: name(id), party: p }) : name(id); };
    const goMove = (id) => () => env.go("tables", { focus: `move:${id}`, target: id });
    const goTable = (id) => () => env.go("tables", { focus: `table:${id}`, target: id });
    const goEdit = (id) => () => { env.go("guests", { focus: `edit:${id}` }); flashKeyWhenReady(`edit:${id}`); };
    const goPrint = (section) => () => env.go("print", { section });
    const rec = (label, go) => ({ label, go });

    // One entry per record; an entry is a list of buttons (a group of same-name guests holds one button per guest).
    const entries = {
      1: (c) => c.items.map((i) => [rec(name(i.guestId), goMove(i.guestId))]),
      2: (c) => c.items.map((i) => [rec(t("guests.check.overLabel", { n: i.number, seated: i.seated, cap: i.capacity }), goTable(i.tableId))]),
      3: (c) => c.items.map((i) => i.guestIds.map((id, k) => rec(t("guests.check.dupOf", { label: withParty(id), i: k + 1, n: i.guestIds.length }), goEdit(id)))),
      4: (c) => c.items.map((i) => [rec(name(i.guestId), goEdit(i.guestId))]),
      5: (c) => c.items.map((i) => i.guestIds.map((id) => rec(withParty(id), goEdit(id)))),
      6: (c) => c.items.map((i) => {
        if (i.type === "duplicate") return [rec(i.tableIds.length === 2 ? t("guests.check.numTwice", { n: i.number }) : t("guests.check.numMany", { n: i.number, c: i.tableIds.length }), goTable(i.tableIds[0]))];
        const after = data.tables.find((x) => x.number === i.to + 1);
        return [rec(i.from === i.to ? t("guests.check.gapOne", { a: i.from }) : t("guests.check.gapMany", { a: i.from, b: i.to }), after ? goTable(after.id) : () => env.go("tables"))];
      }),
      7: (c) => c.items.map((i) => {
        const n = (tableById.get((byId.get(i.guestId) ?? {}).tableId) ?? {}).number;
        if (i.kind === "seatedDeclined") return [rec(t("guests.check.declinedAt", { name: name(i.guestId), n }), goMove(i.guestId))];
        if (i.kind === "seatedPending") return [rec(t("guests.check.pendingAt", { name: name(i.guestId), n }), goMove(i.guestId))];
        if (i.kind === "nameTooLong") return [rec(t("guests.check.tooLong", { name: name(i.guestId) }), goPrint("cards"))];
        return [rec(name(i.guestId), goEdit(i.guestId))];
      }),
      8: () => [
        ...(stale ? [[rec(plural(t, "guests.check.stale", stale, { date: ctx.i18n.formatDate(sign.at) }), goPrint("changes"))]] : []),
        ...(cardsStale ? [[rec(plural(t, "guests.check.staleCards", cardsStale, { date: ctx.i18n.formatDate(cardsModel.at) }), goPrint("cardsChanges"))]] : []),
      ],
    };

    const goButton = (r) => {
      const b = button({ label: r.label, ariaLabel: t("guests.check.go", { label: r.label }), onClick: r.go });
      b.classList.add("btn-sm");
      return b;
    };
    const item = (c) => {
      const title = t(`guests.check.t${c.id}`);
      const kind = c.count === 0 ? "ok" : c.id === 2 ? "danger" : "warn";
      const list = entries[c.id](c);
      const shown = list.slice(0, MAX_RECORDS);
      const more = list.length - shown.length;
      const unnamed = c.id === 7 && c.items.some((i) => i.kind === "unnamedGuest");
      return h("li", { class: `status status-${kind}` }, h("div", {},
        h("h3", { class: "check-h" }, h("span", { class: "check-title", text: title }), badge(c.count, kind === "ok" ? undefined : kind)), // title and badge in one flex row: a long title wraps inside its own box, the badge stays on its first line
        c.count === 0
          ? h("p", { class: "muted", text: t("guests.check.clear") })
          : h("ul", { class: "records", "aria-label": title },
            shown.map((g) => h("li", { class: g.length > 1 ? "record-group" : null }, g.map(goButton))),
            more > 0 ? h("li", {}, (() => { const b = button({ label: t("guests.check.more", { n: more }), ariaLabel: t("guests.check.moreAria", { n: more }), variant: "ghost", onClick: () => env.go("guests") }); b.classList.add("btn-sm"); return b; })()) : null),
        unnamed ? h("p", { class: "muted", text: t("guests.check.unnamedGuest") }) : null));
    };

    const looks = result.checks.filter((c) => c.count > 0).length;
    root.replaceChildren(...[
      h("div", { class: "view-head" }, h("h2", { text: t("guests.check.title") }),
        h("span", { class: "muted", text: looks ? plural(t, "guests.check.sub", looks) : t("guests.check.sub.none") })),
      h("p", { text: t("guests.check.intro") }),
      looks === 0
        ? h("div", { class: "status status-ok stack-bottom" }, h("div", {}, h("p", { text: t("guests.check.allGood") }), button({ label: t("guests.check.goPrint"), variant: "primary", onClick: () => env.go("print") })))
        : null,
      h("ol", { class: "checklist" }, result.checks.map(item)),
    ].filter(Boolean));
  };

  await draw();
  return { onExternal: draw };
}
