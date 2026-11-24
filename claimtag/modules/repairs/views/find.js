// Arama ekrani (Find, spec 2.3): tek arama kutusu (fis no, ad, telefon, IMEI / seri), suzgec All / Open / Ready / Closed / Under warranty.
// Sonuclar cihaza gore gruplu liste: cihaz basligi + o cihazin isleri yeniden eskiye; ayni musterinin oteki cihaz gruplari ardindan gelir.
// Altta CSV disa aktarimi (Excel kacisli, UTF-8 BOM). Kullanici verisi yalniz textContent.
import { guardWrite } from "../../../core/safe.js";
import { currencyDigits } from "../../../core/money.js";
import { downloadText } from "../../../core/files.js";
import { button, emptyState, field, h, table } from "../../../core/ui.js";
import { calcJob } from "../logic/calc.js";
import { remindersSince, warrantyStatus } from "../logic/aging.js";
import { buildIndex, normalizeText, searchJobs } from "../logic/search.js";
import { isClosed, isOpen, isReady } from "../logic/status.js";
import { contactDates, deviceTitle, fmtDate, latestContact, loadAll, money, statusChip } from "./common.js";

const FILTERS = ["all", "open", "ready", "closed", "warranty"];
const PAGE = 50;

const passes = (job, f) => (f === "all" ? true : f === "open" ? isOpen(job.status) : f === "ready" ? isReady(job.status) : f === "closed" ? isClosed(job.status) : Boolean(warrantyStatus(job.warrantyEnd, new Date())?.active));

// ---- CSV (spec 9): ayrac / ondalik arayuz dilinden; formul enjeksiyonuna karsi ' oneki; sayilar oneksiz ----
export function csvCell(value, delimiter) {
  if (value === null || value === undefined) return "";
  let s;
  if (typeof value === "object" && "n" in value) s = String(value.n); // sayi: oneksiz
  else {
    s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(ctx, jobs, data) {
  const { t, csv } = ctx.i18n;
  const dig = currencyDigits(ctx.settings.currency);
  const num = (minor) => (minor === null || minor === undefined ? "" : { n: (minor / 10 ** dig).toFixed(dig).replace(".", csv.decimal) });
  const cols = ["ticket", "status", "checkedIn", "ready", "pickedUp", "customer", "phone", "email", "address", "deviceType", "model", "serial", "problem", "workDone", "partTypes", "subtotal", "tax", "total", "paid", "balance", "partsCost", "profit", "warrantyDays", "warrantyUntil", "latestContact", "reminders"];
  const rows = jobs.map((j) => {
    const c = data.cById.get(j.customerId);
    const d = data.dById.get(j.deviceId);
    const k = calcJob(j);
    const lines = j.lines ?? [];
    return [
      j.number, t(`repairs.status.${j.status}`), j.receivedDate, j.readyDate ?? "", j.handedOverDate ?? "", c?.name ?? "", c?.phone ?? "", c?.email ?? "", c?.address ?? "",
      d ? t(`repairs.type.${d.type}`) : "", d?.model ?? "", d?.serial ?? "", j.problem,
      lines.map((l) => l.name).join("; "), lines.filter((l) => l.kind === "part").map((l) => t(`repairs.part.${l.partType}`)).join("; "),
      num(k.subtotalMinor), num(k.taxMinor), num(k.totalMinor), num(k.paidMinor), num(k.balanceMinor), num(k.costMinor), k.profitMinor === null ? "" : num(k.profitMinor),
      j.warrantyDays ?? "", j.warrantyEnd ?? "", latestContact(j) ?? "", { n: remindersSince(contactDates(j), j.readyDate).length },
    ];
  });
  const head = cols.map((k) => csvCell(t(`repairs.csv.${k}`), csv.delimiter)).join(csv.delimiter);
  return `﻿${[head, ...rows.map((r) => r.map((v) => csvCell(v, csv.delimiter)).join(csv.delimiter))].join("\r\n")}\r\n`;
}

export async function mountFind(ctx, root) {
  const { t } = ctx.i18n;
  const guard = guardWrite((e) => ctx.fail(e));
  let data = await loadAll(ctx);
  let index = buildIndex(data);
  const state = { q: "", filter: "all", results: [], total: 0 };

  const search = field({ label: t("repairs.nav.find"), type: "search", autocomplete: "off", inputmode: "search" });
  search.input.placeholder = t("repairs.find.placeholder");
  search.element.classList.add("find-search");
  const chips = h("div", { class: "chips", role: "group", "aria-label": t("repairs.nav.find") });
  const out = h("div", { class: "stack", id: "find-results", "aria-live": "polite" });
  const exportRow = h("div", { class: "row" });
  const plain = h("p", { class: "muted", text: t("repairs.common.plainTextFile") });

  function groups(jobs) {
    // eslesen islerin cihazlari + ayni musterinin oteki cihaz gruplari
    const byDevice = new Map();
    for (const j of data.jobs) { if (!byDevice.has(j.deviceId)) byDevice.set(j.deviceId, []); byDevice.get(j.deviceId).push(j); }
    const seenDevices = [];
    const order = [];
    for (const j of jobs) { if (!seenDevices.includes(j.deviceId)) seenDevices.push(j.deviceId); }
    const customers = [];
    for (const dId of seenDevices) { const cId = data.dById.get(dId)?.customerId ?? ""; if (!customers.includes(cId)) customers.push(cId); }
    for (const cId of customers) {
      const mine = seenDevices.filter((d) => (data.dById.get(d)?.customerId ?? "") === cId);
      const others = data.devices.filter((d) => d.customerId === cId && !seenDevices.includes(d.id) && byDevice.has(d.id)).map((d) => d.id);
      for (const dId of [...mine, ...others]) order.push(dId);
    }
    return order.map((dId) => ({ device: data.dById.get(dId), jobs: (byDevice.get(dId) ?? []).filter((j) => passes(j, state.filter) || !jobs.length).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)) })).filter((g) => g.jobs.length);
  }

  const workText = (j) => (j.lines ?? []).map((l) => (l.kind === "part" && l.partType !== "unspecified" ? `${l.name} (${t(`repairs.part.${l.partType}`)})` : l.name)).join(", ");
  const groupView = (g) => {
    const d = g.device;
    const c = d ? data.cById.get(d.customerId) : null;
    const title = d ? [deviceTitle(ctx, d), d.serial].filter(Boolean).join(" · ") : t("repairs.placeholder.unknownDevice");
    const cols = [
      { key: "number", label: t("repairs.find.col.ticket"), nowrap: true, render: (j) => h("a", { href: `#/pickup/${j.id}`, class: "find-link", text: j.number }) },
      { key: "date", label: t("repairs.find.col.date"), nowrap: true, render: (j) => fmtDate(ctx, j.receivedDate) },
      { key: "problem", label: t("repairs.find.col.problem"), render: (j) => [...j.problem].slice(0, 60).join("") },
      { key: "work", label: t("repairs.find.col.work"), narrowHide: false, render: (j) => workText(j) },
      { key: "total", label: t("repairs.find.col.total"), align: "num", render: (j) => money(ctx, calcJob(j).totalMinor) },
      { key: "status", label: t("repairs.find.col.status"), render: (j) => statusChip(ctx, j.status) },
      { key: "warranty", label: t("repairs.find.col.warranty"), nowrap: true, render: (j) => (j.warrantyEnd ? fmtDate(ctx, j.warrantyEnd) : "") },
    ];
    return h("section", { class: "card stack find-group", "data-device": d?.id ?? "" },
      h("h3", { text: title }),
      c ? h("p", { class: "muted", text: t("repairs.find.groupOwner", { name: c.name, phone: c.phone }) }) : null,
      table({ caption: title, columns: cols, rows: g.jobs }));
  };

  function run() {
    const r = searchJobs(index, state.q, { limit: 500 });
    const q = normalizeText(state.q);
    out.replaceChildren();
    exportRow.replaceChildren();
    if (r.tooShort) { out.append(h("p", { class: "muted", text: t("repairs.err.tooShort") })); return; }
    const matched = r.jobs.filter((j) => passes(j, state.filter));
    if (!data.jobs.length) { out.append(emptyState({ title: t("repairs.find.noJobs") })); return; }
    if (!matched.length) { out.append(h("p", { class: "muted", id: "find-nomatch", text: t("repairs.find.noMatch", { q: state.q.trim() }) })); }
    const shown = matched.slice(0, PAGE);
    state.results = matched;
    const gs = groups(shown);
    out.append(...gs.map(groupView));
    if (r.total > shown.length || (q && matched.length > PAGE)) out.append(h("p", { class: "muted", text: t("repairs.find.showing", { shown: shown.length, total: matched.length }) }));
    exportRow.append(
      button({ id: "find-csv-all", label: t("repairs.find.exportAll"), exportAction: true, onClick: guard(() => download(data.jobs)) }),
      button({ id: "find-csv-results", label: t("repairs.find.exportResults"), exportAction: true, onClick: guard(() => download(state.results)) }));
  }

  async function download(jobs) {
    const sorted = [...jobs].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
    downloadText(`${ctx.config.appId}-jobs-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(ctx, sorted, data), "text/csv");
  }

  const paintChips = () => chips.replaceChildren(...FILTERS.map((f) => h("button", { type: "button", class: "chip", "aria-pressed": String(state.filter === f), text: t(`repairs.find.filter.${f}`), on: { click: () => { state.filter = f; paintChips(); run(); } } })));

  let timer = null;
  search.input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.input.value; run(); }, 120); });
  search.input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { const a = out.querySelector("a.find-link"); if (a) { e.preventDefault(); a.focus(); } }
    else if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); state.q = search.input.value; run(); const first = state.results[0]; if (first) ctx.navigate(`pickup/${first.id}`); }
  });

  root.replaceChildren(h("h2", { text: t("repairs.nav.find") }), search.element, chips, out, exportRow, plain);
  paintChips();
  run();
  search.input.focus({ preventScroll: true });
  ctx.onExternalChange(async () => { data = await loadAll(ctx); index = buildIndex(data); run(); });
  return () => clearTimeout(timer);
}
