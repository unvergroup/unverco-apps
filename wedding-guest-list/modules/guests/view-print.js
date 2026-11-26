// Print view (U6, U7): what to print (Sign, Place cards, Caterer sheet later), options, scaled preview, print actions.
// Two copies of every printout: the real-size one in #print-root (a child of <body>, hidden on screen, the only thing the print dialog
// shows) and a scaled preview in the panel. Both come from the same builders, so what is measured is what is printed.
// Slots: [data-slot="changes"] holds the "Changes since printed" panel (print-diff.js, Sign and Place cards); [data-slot="caterer"] holds
// the options of the caterer sheet (print-caterer.js; hidden for the other outputs).
// iPhone / iPad Home Screen app: window.print() does nothing there, so the same printouts are laid out as a PDF (print-pdf.js) and given to
// the share sheet (core/canvas-doc.js); the user taps Print there. Computers, Android and Safari tabs keep window.print().
// Writes go through store.transact (savePlan, prints). Text: messages.js guests.print.*. User text only via h() / textContent.
import { button, field, h, nextId, select } from "../../core/ui.js";
import { needsFileDelivery, printDocument } from "../../core/print.js";
import { deliverPdf, layoutToPdf } from "../../core/canvas-doc.js";
import { liveMealId, PLAN_DEFAULTS } from "./logic/schema.js";
import { resolveCard } from "./logic/cardlayout.js";
import { catererSheet, missingMeals } from "./logic/counts.js";
import { optionsOf, snapshotOf } from "./logic/printdiff.js";
import { cardOrder } from "./logic/signsort.js";
import { loadData, loadPlan, newId, now, savePlan } from "./data.js";
import { plural, statusBox } from "./parts.js";
import { createAlignPanel, cardName } from "./print-align.js";
import { buildCaterer, DOC_PAGE, tablesCount } from "./print-caterer.js";
import { barMmFor, buildSheets, buildTestSheets, fitSheets, fontsReady } from "./print-cards.js";
import { createChangesPanel } from "./print-diff.js";
import { buildSign, judgeSign, signGroupsOf, SIGN_PAGE, SIGN_SIZES } from "./print-sign.js";
import { fitSign, layoutCards, layoutCaterer, layoutTestSheet } from "./print-pdf.js";

export const ROOT_ID = "print-root";
const OUTPUTS = ["sign", "cards", "caterer"];
let lastOutput = "sign"; // chosen output is remembered for the session

// Anything printed from another screen must not print a stale target: it is removed before the print dialog opens.
if (typeof window !== "undefined") {
  window.addEventListener("beforeprint", () => {
    const root = document.getElementById(ROOT_ID);
    if (root && !document.querySelector('#guests-panel [data-view="print"]')) root.remove();
  });
}

// The sticky button bar covers whatever sits behind it, so its height is measured and written to --print-bar-space (app.css adds it to
// scroll-padding-bottom): a control reached with Tab is scrolled above the bar (WCAG 2.4.11). 0 when the bar is not sticky or is gone.
const BAR_VAR = "--print-bar-space";
let barEl = null, barWatch = null;
function measureBar() {
  const sticky = barEl && barEl.isConnected && getComputedStyle(barEl).position === "sticky";
  document.documentElement.style.setProperty(BAR_VAR, sticky ? `${Math.ceil(barEl.getBoundingClientRect().height)}px` : "0px");
}
function watchBar(bar) {
  barEl = bar;
  if (typeof ResizeObserver === "undefined") return measureBar();
  if (!barWatch) { barWatch = new ResizeObserver(measureBar); window.addEventListener("resize", measureBar); }
  barWatch.disconnect();
  barWatch.observe(bar);
  measureBar();
}

export function removePrintRoot() {
  document.getElementById(ROOT_ID)?.remove();
  barEl = null;
  if (barWatch) barWatch.disconnect();
  document.documentElement.style.setProperty(BAR_VAR, "0px");
}

// root: the panel holder; env: { ctx, t, store, edition, go }; params: { section: "cards" | "changes" (sign) | "cardsChanges" (place cards, Changes panel) }
export async function renderPrint(root, env, params = {}) {
  const { ctx, t, store, edition } = env;
  let data = await loadData(store);
  let plan = await loadPlan(store);
  const attending = () => data.guests.some((g) => g.rsvp === "yes");
  const seated = () => signGroupsOf(data.guests, data.tables).length > 0;
  const S = {
    // Nothing seated but guests attending: only the caterer sheet can be printed.
    output: !seated() ? "caterer" : params.section === "cards" || params.section === "cardsChanges" ? "cards" : params.section === "changes" ? "sign" : params.section === "caterer" ? "caterer" : OUTPUTS.includes(lastOutput) ? lastOutput : "sign",
    runId: 0, timer: null, mode: "main", main: [], pending: null, after: null,
    blocked: false, invalid: new Set(), align: null, signFit: null, cardSizes: null, pdfBusy: false, prints: await store.list("prints"), changes: null, reprint: [],
  };
  const demoText = edition.isDemo ? t("guests.print.demo") : null;
  const tableLabel = (n) => t("guests.table.n", { n });
  const unnamed = t("guests.print.unnamed");

  removePrintRoot();
  const printRoot = h("div", { id: ROOT_ID, class: "print-target" });
  document.body.append(printRoot);

  const layoutEl = h("div", { class: "print-layout", "data-state": "measuring" });
  const controls = h("div", { class: "stack print-controls" });
  const previewCol = h("div", { class: "print-preview-col" });
  const holder = h("div", { class: "planner-wide" }, layoutEl);
  layoutEl.append(controls, previewCol);

  const setState = (s) => { layoutEl.dataset.state = s; syncButtons(); };
  const live = () => printRoot.isConnected && root.isConnected;

  // ---- empty
  if (!seated() && !attending()) {
    printRoot.remove();
    root.replaceChildren(h("section", { class: "empty stack", "aria-labelledby": "print-empty-h" },
      h("h2", { id: "print-empty-h", text: t("guests.print.empty.title") }),
      h("p", { text: t("guests.print.empty.text") }),
      h("div", { class: "row" }, button({ label: t("guests.print.empty.go"), variant: "primary", onClick: () => env.go("tables") }))));
    return { onExternal: () => renderPrint(root, env, params) };
  }

  // ---- saving
  const save = async (patch) => {
    plan = { ...plan, ...patch };
    setState("measuring");
    try { await savePlan(store, patch); } catch (e) { ctx.fail(e); }
    schedule();
  };
  const schedule = () => {
    clearTimeout(S.timer);
    S.timer = setTimeout(refresh, 120);
  };

  // ---- the two printouts
  const frame = (node, wPx, hPx, label) => {
    const fr = h("div", { class: "preview-frame" }, h("div", { class: "preview-sheet" }, node));
    fr.style.setProperty("--pw-px", String(Math.round(wPx * 1000) / 1000));
    fr.style.setProperty("--ph-px", String(Math.round(hPx * 1000) / 1000));
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => fr.style.setProperty("--k", String(fr.clientWidth / wPx))).observe(fr);
    return h("div", { class: "preview-one", role: "img", "aria-label": label }, fr);
  };
  const caption = h("p", { class: "preview-caption" });
  const statusHolder = h("div", { class: "stack" });
  const warnHolder = h("div", { class: "stack" });
  const afterHolder = h("div", {});

  function signOutput() {
    const groups = signGroupsOf(data.guests, data.tables);
    const names = groups.reduce((n, g) => n + g.entries.length, 0);
    const base = { title: plan.signTitle, couple: plan.coupleNames, date: plan.eventDate, groups, tableLabel, unnamed, demoText };
    const measuring = (size) => {
      const el = buildSign({ ...base, size });
      printRoot.replaceChildren(el);
      return { el, done() {} };
    };
    printRoot.classList.add("is-measuring");
    const res = judgeSign({ size: plan.signSize, cols: plan.signColumns, buildAt: measuring });
    const finalEl = buildSign({ ...base, size: plan.signSize, body: res.body ?? 6, cols: res.cols });
    printRoot.classList.remove("is-measuring");
    S.main = [finalEl];
    S.blocked = res.verdict.code === "tooMany";
    const size = plan.signSize;
    const pg = SIGN_PAGE[size];
    previewCol.replaceChildren(
      h("div", { class: "preview" }, frame(buildSign({ ...base, size, body: res.body ?? 6, cols: res.cols, heading: "div" }), pg.w, pg.h, t("guests.print.preview.sign", { size: t(`guests.print.size.${size}`) }))),
      caption);
    caption.textContent = t("guests.print.caption.sign", { size: t(`guests.print.size.${size}`), names: plural(t, "guests.print.names", names), pages: plural(t, "guests.print.pages", 1) });
    // legibility
    const v = res.verdict;
    warnHolder.replaceChildren();
    if (v.code === "tooMany") {
      statusHolder.replaceChildren(withClass(statusBox("danger", h("p", { text: t("guests.print.tooMany") }), { role: "status" }), "print-status"));
      warnHolder.append(h("p", { class: "field-hint", text: t("guests.print.split") }));
    } else {
      const line = t("guests.print.legibility", { pt: String(res.body), columns: plural(t, "guests.print.columns", res.cols), verdict: t(`guests.print.verdict.${v.code}`) });
      statusHolder.replaceChildren(withClass(statusBox(v.code === "ok" ? "ok" : v.code === "small" ? "warn" : "danger", h("p", { text: line }), { role: "status" }), "print-status"));
      if (v.code === "small") warnHolder.append(h("p", { class: "field-hint", text: t("guests.print.smallHelp") }));
      if (v.code === "tooSmall" && v.suggest) {
        warnHolder.append(h("p", { class: "field-hint", text: t("guests.print.suggest", { pt: String(v.altPt) }) }),
          button({ label: t("guests.print.switch"), onClick: () => { board24.checked = true; save({ signSize: "24x36" }); } }));
      } else if (v.code === "tooSmall") warnHolder.append(h("p", { class: "field-hint", text: t("guests.print.split") }));
    }
    S.signFit = { body: res.body ?? 6, cols: res.cols };
    printRoot.dataset.body = String(res.body);
    printRoot.dataset.cols = String(res.cols);
  }

  const cardSpec = () => resolveCard(plan.cardPreset, plan.customCard) ?? resolveCard(PLAN_DEFAULTS.cardPreset);
  const cardEntries = () => {
    const byId = new Map(data.guests.map((g) => [g.id, g]));
    const slotOf = new Map(data.meals.map((m) => [m.id, m.slot]));
    return cardOrder(data.guests, data.tables).map((e) => {
      const mealId = liveMealId(byId.get(e.id), data.meals);
      return { id: e.id, name: e.name, tableNumber: e.tableNumber, slot: plan.showMealOnCards && mealId ? slotOf.get(mealId) : null };
    });
  };

  function cardsOutput() {
    const spec = cardSpec();
    const off = { x: plan.offX100, y: plan.offY100 };
    const entries = cardEntries();
    const opts = { showMeal: plan.showMealOnCards, tableLabel, unnamed, demoText };
    printRoot.classList.add("is-measuring");
    const built = buildSheets(spec, off, entries, opts);
    printRoot.replaceChildren(...built.sheets);
    const fit = fitSheets(built.sheets, spec);
    printRoot.classList.remove("is-measuring");
    S.main = built.sheets;
    S.cardSizes = fit.sizes;
    S.blocked = false;
    printRoot.dataset.tooLong = String(fit.tooLong.length);
    printRoot.dataset.estimate = String(fit.estimate.length);
    const total = built.sheets.length;
    const shown = buildSheets(spec, off, entries.slice(0, 2 * built.perSheet), { ...opts, sizes: fit.sizes }).sheets;
    const px = (pt) => (pt * 96) / 72;
    const page = built.layout.paper;
    previewCol.replaceChildren(
      h("div", { class: "preview" }, shown.map((s, i) => frame(s, px(page.w), px(page.h), t("guests.print.preview.cards", { n: i + 1, total })))),
      ...(total > 2 ? [h("p", { class: "preview-caption", text: plural(t, "guests.print.more", total - 2) })] : []),
      caption);
    caption.textContent = t("guests.print.caption.cards", { total, cards: plural(t, "guests.print.cardsCount", entries.length), paper: page.name });
    statusHolder.replaceChildren();
    warnHolder.replaceChildren();
    if (fit.tooLong.length) {
      warnHolder.append(statusBox("warn", [h("p", { text: plural(t, "guests.print.tooLong", fit.tooLong.length) }),
        button({ label: t("guests.print.openCheck"), onClick: () => env.go("check") })]));
    }
  }

  // ---- caterer sheet (U8)
  const docPaper = () => (DOC_PAGE[plan.paper] ? plan.paper : "letter");
  function catererOutput() {
    const sheet = catererSheet(data.guests, data.tables, data.meals);
    warnHolder.replaceChildren();
    statusHolder.replaceChildren();
    if (sheet.attending === 0) {
      S.main = []; S.blocked = true;
      printRoot.replaceChildren();
      previewCol.replaceChildren();
      statusHolder.replaceChildren(h("section", { class: "empty stack", "aria-labelledby": "cat-empty-h" },
        h("h3", { id: "cat-empty-h", text: t("guests.print.caterer.empty.title") }),
        h("div", { class: "row" }, button({ label: t("guests.print.caterer.empty.go"), variant: "primary", onClick: () => env.go("guests") }))));
      return;
    }
    S.blocked = false;
    const base = { paper: docPaper(), couple: plan.coupleNames, date: plan.eventDate, printed: t("guests.print.caterer.printed", { date: ctx.i18n.formatDate(now()) }), sheet, t, tableLabel, demoText };
    S.main = [buildCaterer(base)];
    const pg = DOC_PAGE[docPaper()];
    previewCol.replaceChildren(
      h("div", { class: "preview" }, frame(buildCaterer({ ...base, heading: "div" }), pg.w, pg.h, t("guests.print.preview.caterer"))),
      caption);
    caption.textContent = t("guests.print.caption.caterer", { paper: pg.name, tables: tablesCount(t, sheet.rows.length), n: sheet.attending });
    const missing = missingMeals(data.guests, data.meals).length;
    if (missing) {
      warnHolder.append(statusBox("warn", [h("p", { text: plural(t, "guests.print.caterer.noMeal", missing) }),
        button({ label: t("guests.print.openCheck"), onClick: () => env.go("check") })]));
    }
  }

  // "Print changed cards only": the cards of the guests in `ids`, same layout and nudge, drawn when printed (like the test sheet).
  function prepareChanged(ids) {
    const spec = cardSpec();
    const want = new Set(ids);
    const entries = cardEntries().filter((e) => want.has(e.id));
    printRoot.classList.add("is-measuring");
    const built = buildSheets(spec, { x: plan.offX100, y: plan.offY100 }, entries, { showMeal: plan.showMealOnCards, tableLabel, unnamed, demoText });
    printRoot.replaceChildren(...built.sheets);
    fitSheets(built.sheets, spec);
    printRoot.classList.remove("is-measuring");
    S.mode = "changed";
  }

  // The test sheet is drawn only when it is printed (then the root shows it until the dialog closes).
  function prepareTest() {
    const spec = cardSpec();
    printRoot.classList.add("is-measuring");
    const built = buildTestSheets(spec, { x: plan.offX100, y: plan.offY100 }, {
      t, layoutName: cardName(t, plan), meals: data.meals.map((m) => ({ label: m.label, slot: m.slot })), demoText,
      nudge: { x: plan.offX100, y: plan.offY100 },
    });
    printRoot.replaceChildren(...built.sheets);
    fitSheets(built.sheets, spec);
    printRoot.classList.remove("is-measuring");
    S.mode = "test";
  }
  const showMain = () => { printRoot.replaceChildren(...S.main); S.mode = "main"; };

  async function refresh() {
    const my = ++S.runId;
    setState("measuring");
    await fontsReady();
    if (my !== S.runId || !live()) return;
    try {
      S.mode = "main";
      if (S.output === "sign") signOutput(); else if (S.output === "cards") cardsOutput(); else catererOutput();
    } catch (e) { ctx.fail(e); }
    if (my !== S.runId) return;
    printRoot.replaceChildren(...S.main);
    drawChanges();
    setState("ready");
  }

  // ---- actions
  const btnPrint = button({ label: t("guests.print.act.print"), variant: "primary", onClick: () => doPrint("main") });
  const btnMark = button({ label: t("guests.print.act.mark"), onClick: () => markPrinted() });
  const btnTest = button({ label: t("guests.print.act.test"), onClick: () => doPrint("test") });
  function syncButtons() {
    const busy = layoutEl.dataset.state !== "ready";
    btnPrint.disabled = busy || S.pdfBusy || S.blocked || S.invalid.size > 0;
    btnMark.disabled = busy || S.blocked || S.invalid.size > 0;
    btnTest.disabled = busy || S.pdfBusy;
    if (S.changes) S.changes.setBusy(busy || S.blocked || S.invalid.size > 0);
  }

  const docTitle = (kind) => (kind === "test" ? t("guests.print.doc.test") : kind === "changed" ? t("guests.print.doc.changed")
    : S.output === "sign" ? `${t("guests.print.doc.sign")} (${t(`guests.print.size.${plan.signSize}`)})` : S.output === "caterer" ? t("guests.print.doc.caterer") : t("guests.print.doc.cards"));

  // What was just printed (or handed to the share sheet): the "Mark as printed" offer and the alignment step, same as after the print dialog.
  const afterPrinted = (kind) => {
    if ((kind === "main" || kind === "changed") && S.output !== "caterer") { S.after = S.output; drawAfter(); }
    if (kind === "test" && S.align) S.align.testPrinted();
  };

  // The page layout of one printout for the PDF path (print-pdf.js; the measure function is the canvas of the phone).
  function pdfLayout(kind, ids) {
    const locale = ctx.i18n.locale;
    const off = { x: plan.offX100, y: plan.offY100 };
    if (S.output === "sign" && kind === "main") {
      const o = { size: plan.signSize, title: plan.signTitle, couple: plan.coupleNames, date: plan.eventDate, groups: signGroupsOf(data.guests, data.tables),
        tableLabel, unnamed, demoText, body: S.signFit?.body ?? 18, cols: S.signFit?.cols ?? 3 };
      return (measure) => fitSign(o, measure);
    }
    if (S.output === "caterer" && kind === "main") {
      const o = { paper: docPaper(), couple: plan.coupleNames, date: plan.eventDate, printed: t("guests.print.caterer.printed", { date: ctx.i18n.formatDate(now()) }),
        sheet: catererSheet(data.guests, data.tables, data.meals), t, tableLabel, demoText };
      return (measure) => layoutCaterer(o, measure);
    }
    if (kind === "test") {
      const o = { spec: cardSpec(), off, t, layoutName: cardName(t, plan), meals: data.meals.map((m) => ({ label: m.label, slot: m.slot })), nudge: off, demoText, locale };
      return (measure) => layoutTestSheet(o, measure);
    }
    const want = kind === "changed" ? new Set(ids) : null;
    const all = cardEntries();
    const entries = want ? all.filter((e) => want.has(e.id)) : all;
    const o = { spec: cardSpec(), off, entries, sizes: want ? undefined : S.cardSizes ?? undefined, showMeal: plan.showMealOnCards, tableLabel, unnamed, demoText, locale };
    return (measure) => layoutCards(o, measure);
  }

  // iPhone Home Screen app: lay the printout out as a PDF (actual size, cut marks and nudge included) and open the share sheet.
  async function pdfPrint(kind, ids) {
    if (S.pdfBusy) return;
    S.pdfBusy = true;
    syncButtons();
    try {
      await fontsReady();
      const title = docTitle(kind);
      const bytes = await layoutToPdf(pdfLayout(kind, ids), { title });
      const result = await deliverPdf({ bytes, filename: title.replace(/[\\/:*?"<>|]+/g, "-"), title });
      if (result === "downloaded") ctx.notify(t("guests.print.ios.saved"), "info");
      if (result !== "cancelled" && live()) afterPrinted(kind);
    } catch (e) { ctx.fail(e); } finally { S.pdfBusy = false; if (live()) syncButtons(); }
  }

  // kind: "main" | "test" | "changed" (ids = the guests of the changed-only print)
  function doPrint(kind, ids) {
    if (needsFileDelivery()) { pdfPrint(kind, ids); return; }
    if (kind === "test") prepareTest(); else if (kind === "changed") prepareChanged(ids); else showMain();
    S.pending = kind;
    printDocument({ title: docTitle(kind) });
  }

  const onAfter = () => {
    if (!live()) { window.removeEventListener("afterprint", onAfter); window.removeEventListener("beforeprint", onBefore); return; }
    const kind = S.pending;
    S.pending = null;
    showMain();
    afterPrinted(kind);
  };
  const onBefore = () => { if (live() && !S.pending && S.mode !== "main") showMain(); };
  window.addEventListener("afterprint", onAfter);
  window.addEventListener("beforeprint", onBefore);

  function drawAfter() {
    afterHolder.replaceChildren();
    if (!S.after) return;
    afterHolder.append(statusBox("info", [h("p", { text: t("guests.print.after.text") }), h("div", { class: "print-actions" },
      button({ label: t("guests.print.act.mark"), onClick: () => markPrinted() }),
      button({ label: t("guests.print.after.notNow"), variant: "ghost", onClick: () => { S.after = null; drawAfter(); } }))]));
  }

  async function markPrinted() {
    if (S.output === "caterer") return;
    const kind = S.output === "sign" ? "sign" : "placecards";
    try {
      const fresh = { guests: data.guests, tables: data.tables, meals: data.meals };
      const at = now();
      const rec = { id: newId(), kind, at, entries: snapshotOf(fresh.guests, fresh.tables), options: optionsOf(plan, fresh.meals), createdAt: at, updatedAt: at };
      await store.transact("prints", (list) => ({ list: [...list.filter((p) => !(p && p.kind === kind)), rec], result: null }));
      S.prints = await store.list("prints");
      S.after = null; drawAfter(); drawChanges();
      ctx.notify(t(kind === "sign" ? "guests.print.marked.sign" : "guests.print.marked.cards", { date: ctx.i18n.formatDate(at) }), "success");
    } catch (e) { ctx.fail(e); }
  }

  // ---- Changes since printed (U9)
  function changesSlot(kind) {
    S.changes = createChangesPanel({ t, formatDate: ctx.i18n.formatDate, kind, onPrintChanged: (ids) => { if (layoutEl.dataset.state === "ready" && !S.blocked) doPrint("changed", ids); } });
    const slot = h("div", { "data-slot": "changes" }, S.changes.element);
    drawChanges();
    return slot;
  }
  function drawChanges() {
    if (!S.changes) return;
    S.reprint = S.changes.update({ prints: S.prints, data, plan }).reprintIds;
    S.changes.setBusy(layoutEl.dataset.state !== "ready" || S.blocked || S.invalid.size > 0);
  }

  // ---- controls
  const withClass = (el, c) => { el.classList.add(c); return el; };
  let board24 = null;

  function signControls() {
    const sizeName = nextId("size");
    const sizes = SIGN_SIZES.map((v) => ({ value: v, label: t(`guests.print.size.${v}`) }));
    const group = h("fieldset", { class: "segmented" }, h("legend", { text: t("guests.print.board") }),
      sizes.map((it) => {
        const input = h("input", { type: "radio", name: sizeName, value: it.value, checked: it.value === plan.signSize });
        input.addEventListener("change", () => { if (input.checked) save({ signSize: it.value }); });
        if (it.value === "24x36") board24 = input;
        return h("label", {}, input, it.label);
      }));
    const validate = (key, input, f, msg) => {
      input.input.addEventListener("input", () => {
        const text = input.input.value;
        const problem = msg(text);
        input.setError(problem);
        if (problem) S.invalid.add(key); else S.invalid.delete(key);
        if (problem) { syncButtons(); return; }
        save({ [f]: text });
      });
    };
    const len = (s) => Array.from(s).length;
    const title = field({ label: t("guests.print.signTitle"), value: plan.signTitle, autocomplete: "off" });
    validate("title", title, "signTitle", (s) => (s.trim() === "" ? t("guests.print.signTitle.empty") : len(s) > 40 ? t("guests.print.signTitle.long") : ""));
    const couple = field({ label: t("guests.print.couple"), value: plan.coupleNames, autocomplete: "off" });
    validate("couple", couple, "coupleNames", (s) => (len(s) > 60 ? t("guests.print.couple.long") : ""));
    const date = field({ label: t("guests.print.date"), type: "date", value: plan.eventDate });
    validate("date", date, "eventDate", () => "");
    const cols = select({
      label: t("guests.print.columns"), value: String(plan.signColumns),
      options: [{ value: "auto", label: t("guests.print.columns.auto") }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))],
      onChange: (v) => save({ signColumns: v === "auto" ? "auto" : Number(v) }),
    });
    return [group, title.element, h("div", { class: "grid-2 top" }, couple.element, date.element), cols.element,
      statusHolder, warnHolder, changesSlot("sign")];
  }

  function cardsControls() {
    S.align = createAlignPanel({
      t, plan: () => plan, save, printTest: () => doPrint("test"),
      barMm: () => { try { return barMmFor(cardSpec(), { x: plan.offX100, y: plan.offY100 }); } catch { return 100; } },
    });
    const meal = h("input", { type: "checkbox", checked: plan.showMealOnCards });
    meal.addEventListener("change", () => save({ showMealOnCards: meal.checked }));
    return [S.align.element, h("label", { class: "check" }, meal, h("span", { text: t("guests.print.showMeal") })),
      warnHolder, changesSlot("cards")];
  }

  // Caterer sheet options (design 5.5): the paper; the Changes panel and Mark as printed do not exist here (prints.kind is sign / placecards).
  function catererControls() {
    const name = nextId("paper");
    const group = h("fieldset", { class: "segmented" }, h("legend", { text: t("guests.print.caterer.paper") }),
      ["letter", "a4"].map((v) => {
        const input = h("input", { type: "radio", name, value: v, checked: v === docPaper() });
        input.addEventListener("change", () => { if (input.checked) save({ paper: v }); });
        return h("label", {}, input, t(`guests.print.caterer.${v}`));
      }));
    return [group, statusHolder, warnHolder];
  }

  // The output picker is built once (the focused radio stays while the options below it change).
  const optionsHolder = h("div", { class: "stack" });
  const outName = nextId("out");
  const picker = h("fieldset", { class: "segmented" }, h("legend", { text: t("guests.print.what") }),
    OUTPUTS.map((o) => {
      const input = h("input", { type: "radio", name: outName, value: o, checked: o === S.output, disabled: o !== "caterer" && !seated() });
      input.addEventListener("change", () => {
        if (!input.checked) return;
        S.output = o; lastOutput = o; S.after = null; S.invalid.clear(); S.blocked = false;
        drawOptions(); refresh();
      });
      return h("label", {}, input, t(`guests.print.out.${o}`));
    }));

  const catererSlot = h("div", { "data-slot": "caterer", hidden: true });
  function drawOptions() {
    S.align = null; S.changes = null;
    const caterer = S.output === "caterer";
    optionsHolder.replaceChildren(...(S.output === "sign" ? signControls() : S.output === "cards" ? cardsControls() : []));
    catererSlot.replaceChildren(...(caterer ? catererControls() : []));
    catererSlot.hidden = !caterer;
    btnTest.hidden = S.output !== "cards";
    btnMark.hidden = caterer;
    drawAfter();
    syncButtons();
  }

  function drawControls() {
    const bar = h("div", { class: "print-actions print-actions-bar" }, btnPrint, btnMark, btnTest);
    controls.replaceChildren(...[picker, seated() ? null : h("p", { class: "field-hint", text: t("guests.print.needSeats") }), optionsHolder, catererSlot, afterHolder,
      bar, h("p", { class: "field-hint", text: t(needsFileDelivery() ? "guests.print.ios.hint" : "guests.print.browserNote") })].filter(Boolean));
    drawOptions();
    watchBar(bar);
  }

  root.replaceChildren(holder);
  drawControls();
  setState("measuring");
  await refresh();
  if ((params.section === "changes" || params.section === "cardsChanges") && S.changes) S.changes.focusHeading();
  return { onExternal: () => renderPrint(root, env, { section: S.output === "cards" ? "cards" : S.output === "caterer" ? "caterer" : undefined }) };
}
