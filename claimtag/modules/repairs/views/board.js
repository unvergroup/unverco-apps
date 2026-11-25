// Is panosu (Board, spec 2.2): acik isler dort sutunda: New (Checked in + Diagnosing) · Waiting (approval + part) · In repair · Ready for pickup.
// Suzgec All / Needs an update (n); arama; kartta durum cipi, durumda gecen gun, son haber, hazirda gun + hatirlatma sayisi + vurgu.
// "Move to..." yalniz izinli hedefleri gosterir; iptal onay ister; teslim yalniz Pickup'ta. Dar ekranda sayili sekme seridi.
import { todayIso } from "../../../core/dates.js";
import { guardWrite } from "../../../core/safe.js";
import { StoreError } from "../../../core/store.js";
import { button, confirmDialog, createTabs, emptyState, field, h, select } from "../../../core/ui.js";
import { daysReady, needsUpdate, remindersSince } from "../logic/aging.js";
import { buildIndex, searchJobs } from "../logic/search.js";
import { applyTransition, isReady, nextStatuses, transitionKind } from "../logic/status.js";
import { contactDates, daysIn, deviceTitle, fmtDate, latestContact, loadAll, statusChip } from "./common.js";

const COLUMNS = [
  { id: "new", statuses: ["received", "diagnosing"] },
  { id: "waiting", statuses: ["awaiting_approval", "awaiting_part"] },
  { id: "repair", statuses: ["in_repair"] },
  { id: "ready", statuses: ["ready", "ready_unrepaired"] },
];
const NARROW = "(max-width: 560px)";

export async function mountBoard(ctx, root) {
  const { t, tn } = ctx.i18n;
  const ct = await ctx.ct.get();
  const guard = guardWrite((e) => ctx.fail(e));
  const state = { filter: "all", query: "", tab: "new" };
  let data = await loadAll(ctx);
  const mq = globalThis.matchMedia ? globalThis.matchMedia(NARROW) : { matches: false, addEventListener() {}, removeEventListener() {} };

  const open = () => data.jobs.filter((j) => COLUMNS.some((c) => c.statuses.includes(j.status)));
  const upd = (j) => needsUpdate(j, contactDates(j), new Date(), ct.reminderDays);

  async function move(job, to) {
    const kind = transitionKind(job.status, to);
    const cancelReason = undefined;
    if (kind === "cancel") {
      const { confirmed } = await confirmDialog({ title: t("repairs.job.cancel"), message: t("repairs.job.cancelConfirm", { ticket: job.number }), confirmLabel: t("repairs.job.cancel"), cancelLabel: t("common.cancel"), danger: true });
      if (!confirmed) { paint(); return; }
    }
    try {
      await ctx.store.transactMany(["jobs"], (tx) => {
        const cur = tx.get("jobs", job.id);
        if (!cur) throw new StoreError("not_found", "job");
        if (cur.status !== job.status) throw new StoreError("stale_job", "changed elsewhere");
        tx.update("jobs", job.id, applyTransition(cur, to, { now: new Date(), cancelReason }));
      });
    } catch (e) {
      if (e && e.code === "stale_job") { ctx.notify(t("repairs.board.changedElsewhere"), "warn"); await reload(); return; }
      throw e;
    }
    await reload();
  }

  const card = (job) => {
    const c = data.cById.get(job.customerId);
    const d = data.dById.get(job.deviceId);
    const ready = isReady(job.status);
    const u = upd(job);
    const last = latestContact(job);
    const targets = nextStatuses(job.status).filter((s) => transitionKind(job.status, s) !== "reopen");
    const kids = [
      h("div", { class: "job-head" }, h("a", { class: "job-ticket", href: `#/pickup/${job.id}`, text: job.number }), statusChip(ctx, job.status)),
      h("p", { class: "job-name", text: c?.name ?? t("repairs.placeholder.missingCustomer") }),
      h("p", { class: "job-device muted", text: d ? deviceTitle(ctx, d) : t("repairs.placeholder.unknownDevice") }),
      h("p", { class: "muted", text: t("repairs.common.daysInStatus", { n: daysIn(job.statusDate) }) }),
      h("p", { class: "muted", text: last ? t("repairs.common.latestContact", { when: fmtDate(ctx, last) }) : t("repairs.common.noContact") }),
    ];
    if (ready) {
      const n = daysReady(job.readyDate, new Date()) ?? 0;
      const reminders = remindersSince(contactDates(job), job.readyDate).length;
      kids.push(h("p", { class: "job-ready", text: `${n === 0 ? t("repairs.board.readyToday") : tn("repairs.board.readyDays", n)} · ${t("repairs.board.reminders", { n: reminders })}` }));
    }
    if (u.flag) kids.push(h("p", {}, h("span", { class: "badge badge-warn", text: t("repairs.board.longWait", { n: u.flag.day }) })));
    const moveSel = select({
      label: t("repairs.board.moveTo"), value: "", options: [{ value: "", label: t("repairs.board.moveTo") }, ...targets.map((s) => ({ value: s, label: t(`repairs.status.${s}`) }))],
      onChange: guard(async (v) => { if (v) await move(job, v); }, `move-${job.id}`),
    });
    moveSel.element.classList.add("move-field");
    moveSel.element.querySelector("label").classList.add("sr-only");
    const actions = [moveSel.element];
    if (ready) actions.push(button({ label: t("repairs.job.handOverLink"), onClick: () => ctx.navigate(`pickup/${job.id}`) }));
    return h("article", { class: `job-card${u.needs ? " needs-update" : ""}`, "data-job": job.id }, ...kids, h("div", { class: "row" }, ...actions));
  };

  const sortKey = (j) => (isReady(j.status) ? daysReady(j.readyDate, new Date()) ?? 0 : daysIn(j.statusDate));

  const body = h("div", { class: "board-cols", id: "board-cols" });
  const tabsHost = h("div", { class: "board-tabs" });
  const toolbar = h("div", { class: "toolbar" });
  const search = field({ label: t("repairs.find.placeholder"), type: "search", autocomplete: "off" });
  search.element.classList.add("board-search");
  search.input.placeholder = t("repairs.find.placeholder");
  search.element.querySelector("label").classList.add("sr-only");
  let tabs = null;

  function visibleJobs() {
    let jobs = open();
    if (state.query.trim().length >= 2) {
      const ix = buildIndex({ jobs, customers: data.customers, devices: data.devices });
      const ids = new Set(searchJobs(ix, state.query, { limit: 500 }).jobs.map((j) => j.id));
      jobs = jobs.filter((j) => ids.has(j.id));
    }
    return jobs;
  }

  function paint() {
    const all = open();
    const jobs = visibleJobs();
    const nUpdate = all.filter((j) => upd(j).needs).length;
    toolbar.replaceChildren(
      h("div", { class: "chips", role: "group", "aria-label": t("repairs.nav.board") },
        ...[["all", t("repairs.board.filter.all")], ["update", `${t("repairs.board.filter.update")} (${nUpdate})`]].map(([k, label]) =>
          h("button", { type: "button", class: "chip", "aria-pressed": String(state.filter === k), text: label, on: { click: () => { state.filter = k; paint(); } } }))),
      search.element);
    if (!all.length) {
      body.replaceChildren(emptyState({ title: t("repairs.board.empty") }), h("div", { class: "row" }, button({ id: "board-checkin", label: t("repairs.board.checkInDevice"), variant: "primary", onClick: () => ctx.navigate("checkin") })));
      tabsHost.replaceChildren();
      return;
    }
    const shownJobs = state.filter === "update" ? jobs.filter((j) => upd(j).needs) : jobs;
    if (state.filter === "update" && !shownJobs.length) { body.replaceChildren(emptyState({ title: t("repairs.board.emptyFilter") })); tabsHost.replaceChildren(); return; }
    const cols = COLUMNS.map((col) => {
      const list = shownJobs.filter((j) => col.statuses.includes(j.status)).sort((a, b) => sortKey(b) - sortKey(a));
      return { col, list };
    });
    if (mq.matches) {
      // dar ekran: sayili sekme seridi (role=tablist); yalniz secili sutun gorunur
      if (!cols.some((c) => c.col.id === state.tab)) state.tab = cols[0].col.id;
      tabs = createTabs({ label: t("repairs.nav.board"), selected: state.tab, items: cols.map(({ col, list }) => ({ id: col.id, label: `${t(`repairs.board.col.${col.id}`)} (${list.length})` })), onSelect: (id) => { state.tab = id; paint(); const b = tabsHost.querySelector(`#tab-${id}`); b?.focus(); } });
      tabs.element.classList.add("tabs-grid"); // dort sekme yan yana, uzun etiket satira sarilir (kesilmez / bitisik gorunmez)
      tabsHost.replaceChildren(tabs.element);
    } else tabsHost.replaceChildren();
    body.replaceChildren(...cols.filter(({ col }) => !mq.matches || col.id === state.tab).map(({ col, list }) =>
      h("section", { class: "board-col", "data-col": col.id, "aria-labelledby": `bc-${col.id}` },
        h("h3", { id: `bc-${col.id}` }, t(`repairs.board.col.${col.id}`), h("span", { class: "count", text: ` ${list.length}` })),
        ...list.map(card))));
  }

  search.input.addEventListener("input", () => { state.query = search.input.value; const pos = search.input.selectionStart; paint(); const s = root.querySelector(".board-search input"); s.focus(); try { s.setSelectionRange(pos, pos); } catch { /* secim yok */ } });

  async function reload() { data = await loadAll(ctx); paint(); }
  const onMq = () => paint();
  mq.addEventListener?.("change", onMq);
  root.replaceChildren(h("h2", { text: t("repairs.nav.board") }), toolbar, tabsHost, body);
  paint();
  ctx.onExternalChange(reload);
  return () => mq.removeEventListener?.("change", onMq);
}
