// Teslim ekrani (Pickup, spec 2.4): solda hazir isler (hazir gun azalan) + arama, sagda secili isin paneli:
// ozet ve kalan · is satirlari · odemeler · test karti (sonra) · garanti · haber / mesaj · teslim et / tamirsiz iade / geri al.
// Kapali isler ayni panelde sonuc karti (fis, hesap dokumu, yorum istegi, sonraki teslim) ile gorunur. Yazma yollari guardWrite + transactMany.
// Kullanici verisi yalniz h() / textContent. Hicbir mesaj kendiliginden gitmez: baglanti elle acilir, "Log as sent" elle basilir.
import { todayIso } from "../../../core/dates.js";
import { guardWrite } from "../../../core/safe.js";
import { StoreError } from "../../../core/store.js";
import { button, confirmDialog, emptyState, field, focusFirstInvalid, h, select, showNotice } from "../../../core/ui.js";
import { LINE_KINDS, PART_TYPES, PAYMENT_KINDS, PAYMENT_METHODS, calcJob, readLine, parseAmount, validatePayment } from "../logic/calc.js";
import { daysReady, needsUpdate, parseWarrantyDays, remindersSince, suggestedReminder, warrantyEnd } from "../logic/aging.js";
import { messageLinks } from "../logic/phone.js";
import { buildIndex, searchJobs } from "../logic/search.js";
import { LIMITS, CONTACT_TEMPLATES } from "../logic/schema.js";
import { applyTransition, isClosed, isOpen, isReady, nextStatuses, takeBackUnrepaired } from "../logic/status.js";
import { fillTemplate, templateValues } from "../logic/templates.js";
import { printInvoice, printSlip } from "../print/pickup-receipt.js";
import { TYPES, balanceText, contactDates, deviceLine, deviceTitle, errText, fmtDate, latestContact, loadAll, money, radioGroup, statusChip, typeNames } from "./common.js";

const TPL_KEYS = ["received", "approval", "part", "ready", "reminder", "reminder_later", "review"];

export async function mountPickup(ctx, root, param) {
  const { t, tn, formatDate } = ctx.i18n;
  const decimal = ctx.i18n.decimal;
  const ct = await ctx.ct.get();
  const guard = guardWrite((e) => ctx.fail(e));
  let data = await loadAll(ctx);
  const shopName = (await ctx.business.get()).name;
  const st = { id: param || null, query: "", focus: null };
  const drafts = new Map(); // isin yazilmamis girdileri (sonra testleri, denendi mi, garanti gunu) yeniden cizimde kalir
  const draftOf = (id) => { if (!drafts.has(id)) drafts.set(id, { tried: null, after: {}, warranty: undefined, tpl: null }); return drafts.get(id); };

  const jobById = (id) => data.jobs.find((j) => j.id === id);
  const readyJobs = () => data.jobs.filter((j) => isReady(j.status)).sort((a, b) => (daysReady(b.readyDate, new Date()) ?? 0) - (daysReady(a.readyDate, new Date()) ?? 0));

  // ---------- yazma yardimcisi: tek isi kilit icinde oku-degistir-yaz ----------
  async function mutate(id, fn) {
    try {
      await ctx.store.transactMany(["jobs"], (tx) => {
        const cur = tx.get("jobs", id);
        if (!cur) throw new StoreError("not_found", "job");
        const patch = fn(cur);
        if (patch) tx.update("jobs", id, patch);
      });
    } catch (e) {
      if (e && e.code === "stale_job") { ctx.notify(t("repairs.board.changedElsewhere"), "warn"); await reload(); return false; }
      throw e;
    }
    await reload();
    return true;
  }

  // ---------- sol: liste ----------
  const listBox = h("aside", { class: "pickup-list", "aria-label": t("repairs.pickup.list") });
  const panelBox = h("section", { class: "pickup-panel", "aria-live": "polite" });
  const wrap = h("div", { class: "pickup", "data-view": param ? "panel" : "list" }, listBox, panelBox);
  const search = field({ label: t("repairs.find.placeholder"), type: "search", autocomplete: "off" });
  search.input.placeholder = t("repairs.find.placeholder");
  search.element.querySelector("label").classList.add("sr-only");

  function item(job) {
    const c = data.cById.get(job.customerId);
    const d = data.dById.get(job.deviceId);
    const n = daysReady(job.readyDate, new Date()) ?? 0;
    const u = needsUpdate(job, contactDates(job), new Date(), ct.reminderDays);
    return h("a", { class: "pick-item", href: `#/pickup/${job.id}`, "aria-current": job.id === st.id ? "true" : "false" },
      h("span", { class: "job-ticket", text: job.number }),
      h("span", { class: "pick-name", text: c?.name ?? "" }),
      h("span", { class: "muted", text: d ? deviceTitle(ctx, d) : "" }),
      isReady(job.status) ? h("span", { class: "muted", text: n === 0 ? t("repairs.board.readyToday") : tn("repairs.board.readyDays", n) }) : statusChip(ctx, job.status),
      u.flag ? h("span", { class: "badge badge-warn", text: t("repairs.board.longWait", { n: u.flag.day }) }) : null);
  }

  function paintList() {
    const q = st.query.trim();
    let rows;
    if (q.length >= 2) {
      const open = data.jobs.filter((j) => isOpen(j.status));
      rows = searchJobs(buildIndex({ jobs: open, customers: data.customers, devices: data.devices }), q, { limit: 30 }).jobs;
    } else rows = readyJobs();
    const kids = [h("h3", { text: t("repairs.pickup.list") }), h("p", { class: "muted", text: t("repairs.note.unclaimed") }), search.element];
    if (!rows.length) kids.push(h("p", { class: "muted", id: "pickup-empty", text: q.length >= 2 ? t("repairs.find.noMatch", { q }) : t("repairs.pickup.empty") }));
    else kids.push(h("nav", { class: "pick-list", "aria-label": t("repairs.pickup.list") }, ...rows.map(item)));
    listBox.replaceChildren(...kids);
  }
  search.input.addEventListener("input", () => {
    st.query = search.input.value;
    const pos = search.input.selectionStart;
    paintList();
    const s = listBox.querySelector("input[type=search]");
    s.focus(); try { s.setSelectionRange(pos, pos); } catch { /* secim yok */ }
  });

  // ---------- sag: panel ----------
  function copyText(text, area) {
    const fallback = () => {
      area.focus(); area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ctx.notify(ok ? t("repairs.common.copy") : t("repairs.msg.copyManual"), ok ? "success" : "info");
    };
    if (globalThis.navigator?.clipboard?.writeText) globalThis.navigator.clipboard.writeText(text).then(() => ctx.notify(t("repairs.common.copy"), "success"), fallback);
    else fallback();
  }

  function messagesBlock(job, c, d, calc) {
    const d0 = draftOf(job.id);
    const days = isReady(job.status) ? daysReady(job.readyDate, new Date()) ?? 0 : 0;
    const suggested = isReady(job.status) ? (remindersSince(contactDates(job), job.readyDate).length > 0 ? suggestedReminder(days) : "ready") : job.status === "awaiting_approval" ? "approval" : job.status === "awaiting_part" ? "part" : job.status === "received" || job.status === "diagnosing" ? "received" : isClosed(job.status) ? "review" : "ready";
    if (!d0.tpl) d0.tpl = suggested;
    const tplSel = select({ id: "msg-tpl", label: t("repairs.set.templates"), value: d0.tpl, options: TPL_KEYS.map((k) => ({ value: k, label: `${t(`repairs.msg.title.${k}`)}${k === suggested ? ` · ${t("repairs.msg.suggested")}` : ""}` })), onChange: (v) => { d0.tpl = v; st.focus = "msg-tpl"; paintPanel(); } });
    const tplText = ct.templates[d0.tpl] ?? t(`repairs.msg.${d0.tpl}`);
    const values = templateValues({
      customer: c, device: d, job, shop: shopName, settings: ct, totalMinor: calc.totalMinor, balanceMinor: calc.balanceMinor,
      formatMoney: ctx.i18n.formatCurrency, formatDate, typeNames: typeNames(ctx), deviceFallback: t("repairs.type.fallback"),
    });
    const filled = fillTemplate(tplText, values);
    const area = h("textarea", { class: "msg-preview", id: "msg-text", rows: 4, readonly: true, "aria-label": t(`repairs.msg.title.${d0.tpl}`) });
    area.value = filled.text;
    const links = messageLinks(c?.phone ?? "", ct.countryCode, filled.text);
    const hint = [];
    const blocked = filled.blocked.length > 0 || !links.ok;
    if (filled.blocked.includes("estimate")) hint.push(t("repairs.msg.needEstimate"));
    if (filled.blocked.includes("review_link")) hint.push(t("repairs.msg.noReviewLink"));
    if (!links.ok) hint.push(links.reason === "need_country_code" ? t("repairs.msg.needCode") : t("repairs.job.fixPhone"));
    if (globalThis.navigator && globalThis.navigator.onLine === false) hint.push(t("repairs.msg.offline"));
    const logSent = (channel) => guard(async () => {
      const templ = CONTACT_TEMPLATES.includes(d0.tpl) ? d0.tpl : null;
      if ((job.contacts ?? []).length >= LIMITS.contacts) { ctx.notify(t("repairs.contact.max", { max: LIMITS.contacts }), "warn"); return; }
      await mutate(job.id, (cur) => ({ contacts: [...cur.contacts, { id: `c${Date.now().toString(36)}`, at: new Date().toISOString(), date: todayIso(), channel, template: templ, note: "" }] }));
    });
    const prompt = h("div", { class: "row", id: "msg-sent", hidden: true }, h("span", { text: t("repairs.msg.didSend") }),
      button({ id: "msg-log", label: t("repairs.msg.logSent"), variant: "primary", onClick: () => logSent(prompt.dataset.channel || "other")() }),
      button({ label: t("repairs.msg.notSent"), onClick: () => { prompt.hidden = true; } }));
    const open = (channel) => () => { prompt.dataset.channel = channel; prompt.hidden = false; };
    const channelBtn = (ch) => {
      if (ch === "sms") return links.ok && !blocked ? h("a", { class: "btn btn-secondary", id: "msg-sms", href: links.sms, text: t("repairs.msg.sms"), on: { click: open("sms") } }) : button({ label: t("repairs.msg.sms"), disabled: true });
      if (ch === "whatsapp") return links.ok && !blocked ? h("a", { class: "btn btn-secondary", id: "msg-wa", href: links.wa, target: "_blank", rel: "noopener noreferrer", text: t("repairs.msg.wa"), on: { click: open("whatsapp") } }) : button({ label: t("repairs.msg.wa"), disabled: true });
      return null; // arama / e-posta yalniz haber defterine elle yazilir
    };
    return h("div", { class: "card stack", id: "pk-messages" },
      h("h3", { text: t("repairs.job.tab.messages") }),
      tplSel.element,
      area,
      links.ok ? h("p", { class: "muted", text: t("repairs.msg.to", { number: links.to }) }) : null,
      ...hint.map((x) => h("p", { class: "field-hint", text: x })),
      h("div", { class: "row" }, ...ct.channelOrder.map(channelBtn), button({ id: "msg-copy", label: t("repairs.msg.copy"), disabled: filled.blocked.length > 0, onClick: () => { copyText(filled.text, area); prompt.dataset.channel = "other"; prompt.hidden = false; } })),
      prompt,
      h("p", { class: "muted", text: t("repairs.msg.smsNote") }),
      contactsBlock(job));
  }

  function contactsBlock(job) {
    const ch = select({ id: "ct-channel", label: t("repairs.contact.log"), value: "call", options: ["whatsapp", "sms", "call", "email", "in_person", "other"].map((k) => ({ value: k, label: t(`repairs.contact.channel.${k}`) })) });
    const note = field({ label: t("repairs.contact.note"), maxlength: 200, autocomplete: "off" });
    const date = field({ label: t("repairs.contact.date"), type: "date", value: todayIso() });
    date.input.max = todayIso();
    const rows = (job.contacts ?? []).slice().reverse().map((k) => h("li", { class: "log-row" },
      h("span", { text: `${fmtDate(ctx, k.date)} · ${t(`repairs.contact.channel.${k.channel}`)}${k.template ? ` · ${t(`repairs.msg.title.${k.template}`)}` : ""}${k.note ? ` · ${k.note}` : ""}` }),
      button({ label: t("common.remove"), onClick: guard(async () => {
        const { confirmed } = await confirmDialog({ title: t("common.remove"), message: t("repairs.contact.deleteConfirm"), confirmLabel: t("common.remove"), cancelLabel: t("common.cancel"), danger: true });
        if (confirmed) await mutate(job.id, (cur) => ({ contacts: cur.contacts.filter((x) => x.id !== k.id) }));
      }) })));
    const form = h("form", { class: "stack", id: "ct-form", novalidate: true, on: { submit: guard(async (e) => {
      e.preventDefault();
      date.setError("");
      if (date.input.value > todayIso()) { date.setError(t("repairs.err.futureDate")); date.input.focus(); return; }
      if ((job.contacts ?? []).length >= LIMITS.contacts) { ctx.notify(t("repairs.contact.max", { max: LIMITS.contacts }), "warn"); return; }
      await mutate(job.id, (cur) => ({ contacts: [...cur.contacts, { id: `c${Date.now().toString(36)}`, at: new Date().toISOString(), date: date.input.value || todayIso(), channel: ch.input.value, template: null, note: note.input.value.trim() }] }));
    }) } }, h("div", { class: "row" }, ch.element, date.element, note.element), h("div", { class: "row" }, button({ label: t("repairs.contact.log"), type: "submit" })));
    return h("div", { class: "stack" }, h("p", { class: "muted", text: latestContact(job) ? t("repairs.common.latestContact", { when: fmtDate(ctx, latestContact(job)) }) : t("repairs.common.noContact") }), rows.length ? h("ul", { class: "log" }, ...rows) : null, form);
  }

  function linesBlock(job, calc) {
    const closed = isClosed(job.status);
    const rows = (job.lines ?? []).map((l) => h("tr", {},
      h("td", { "data-label": t("repairs.lines.name"), text: l.kind === "part" && l.partType !== "unspecified" ? `${l.name} (${t(`repairs.part.${l.partType}`)})` : l.name }),
      h("td", { class: "num", "data-label": t("repairs.lines.qty"), text: ctx.i18n.formatNumber(l.qty, { maximumFractionDigits: 3 }) }),
      h("td", { class: "num", "data-label": t("repairs.lines.price"), text: money(ctx, l.unitMinor) }),
      h("td", { class: "num", "data-label": t("lineitems.lineTotal"), text: money(ctx, calcJob({ lines: [l] }).totalMinor) }),
      closed ? null : h("td", { class: "actions-col" }, button({ label: t("common.remove"), ariaLabel: `${t("common.remove")}: ${l.name}`, onClick: guard(async () => {
        const { confirmed } = await confirmDialog({ title: t("common.remove"), message: l.name, confirmLabel: t("common.remove"), cancelLabel: t("common.cancel"), danger: true });
        if (confirmed) await mutate(job.id, (cur) => ({ lines: cur.lines.filter((x) => x.id !== l.id) }));
      }) }))));
    const tbl = rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "data-table" }, h("caption", { text: t("repairs.job.tab.work") }),
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: t("repairs.lines.name") }), h("th", { scope: "col", class: "num", text: t("repairs.lines.qty") }), h("th", { scope: "col", class: "num", text: t("repairs.lines.price") }), h("th", { scope: "col", class: "num", text: t("lineitems.lineTotal") }), closed ? null : h("th", { scope: "col", class: "actions-col" }))),
      h("tbody", {}, ...rows))) : null;
    const totals = h("dl", { class: "totals", id: "pk-totals" },
      h("dt", { text: t("repairs.totals.subtotal") }), h("dd", { text: money(ctx, calc.subtotalMinor) }),
      calc.taxMinor ? [h("dt", { text: t("repairs.totals.tax") }), h("dd", { text: money(ctx, calc.taxMinor) })] : null,
      h("dt", { text: t("repairs.totals.total") }), h("dd", { text: money(ctx, calc.totalMinor) }),
      h("dt", { text: t("repairs.totals.paid") }), h("dd", { text: money(ctx, calc.paidMinor) }));
    const balance = h("p", { class: `balance${calc.balanceMinor > 0 ? " due" : ""}`, id: "pk-balance", text: balanceText(ctx, calc) });
    const profit = h("p", { class: "muted", id: "pk-profit", text: `${t("repairs.totals.profit")}: ${calc.profitMinor === null ? t("repairs.totals.profitMissing", { n: calc.partsWithoutCost }) : money(ctx, calc.profitMinor)}` });
    return h("div", { class: "card stack", id: "pk-work" },
      h("h3", { text: t("repairs.job.tab.work") }), tbl, totals, balance, profit, closed ? null : addLineForm(job));
  }

  function addLineForm(job) {
    const kind = select({ id: "ln-kind", label: t("repairs.x.kind"), value: "labor", options: LINE_KINDS.map((k) => ({ value: k, label: t(`repairs.lines.kind.${k}`) })) });
    const name = field({ label: t("repairs.lines.name"), maxlength: 80, autocomplete: "off" });
    const qty = field({ label: t("repairs.lines.qty"), value: "1", inputmode: "decimal", autocomplete: "off" });
    const price = field({ label: t("repairs.lines.price"), inputmode: "decimal", autocomplete: "off" });
    const tax = field({ label: t("repairs.lines.tax"), inputmode: "decimal", autocomplete: "off", hint: t("repairs.lines.taxHint") });
    const cost = field({ label: t("repairs.lines.cost"), inputmode: "decimal", autocomplete: "off" });
    const ptype = select({ id: "ln-ptype", label: t("repairs.lines.partType"), value: "unspecified", options: PART_TYPES.map((k) => ({ value: k, label: t(`repairs.part.${k}`) })) });
    const told = h("input", { type: "checkbox", id: "ln-told" });
    const toldRow = h("label", { class: "check", for: "ln-told" }, told, t("repairs.lines.told"));
    const partOnly = [ptype.element, toldRow];
    const costOnly = [cost.element];
    const sync = () => {
      const k = kind.input.value;
      for (const el of partOnly) el.hidden = k !== "part";
      for (const el of costOnly) el.hidden = !(k === "part" || k === "other");
    };
    kind.input.addEventListener("change", sync);
    sync();
    const errBox = h("p", { class: "field-error", role: "alert", id: "ln-error" });
    const form = h("form", { class: "stack", id: "ln-form", novalidate: true, on: { submit: guard(async (e) => {
      e.preventDefault();
      for (const f of [name, qty, price, tax, cost]) f.setError("");
      errBox.textContent = "";
      if ((job.lines ?? []).length >= LIMITS.lines) { errBox.textContent = t("repairs.lines.max", { max: LIMITS.lines }); return; }
      const r = readLine({ id: `l${Date.now().toString(36)}`, kind: kind.input.value, name: name.input.value, qty: qty.input.value, price: price.input.value, tax: tax.input.value, cost: cost.input.value, partType: ptype.input.value, toldCustomer: told.checked }, { decimal });
      if (!r.ok) {
        const map = { name, qty, price, tax, cost };
        for (const [k, code] of Object.entries(r.errors)) (map[k] ?? name).setError(k === "tax" ? t("repairs.err.tax") : k === "qty" ? t("repairs.err.qty", { max: 999 }) : errText(ctx, code));
        focusFirstInvalid(form);
        return;
      }
      st.focus = "ln-name";
      await mutate(job.id, (cur) => ({ lines: [...cur.lines, r.item] }));
    }) } },
      h("div", { class: "grid-2" }, kind.element, name.element), h("div", { class: "grid-2" }, qty.element, price.element), tax.element, ...costOnly, ...partOnly, errBox,
      h("div", { class: "row", "data-rapid": "1" }, button({ id: "ln-add", label: t("repairs.lines.add"), type: "submit" })));
    name.input.id = "ln-name";
    name.element.querySelector("label").setAttribute("for", "ln-name");
    return form;
  }

  function paymentsBlock(job, calc) {
    const closed = isClosed(job.status);
    const kind = select({ id: "pay-kind", label: t("repairs.x.kind"), value: "payment", options: PAYMENT_KINDS.map((k) => ({ value: k, label: t(`repairs.pay.kind.${k}`) })) });
    const amount = field({ label: t("repairs.x.amount"), inputmode: "decimal", autocomplete: "off" });
    const date = field({ label: t("repairs.contact.date"), type: "date", value: todayIso() });
    date.input.max = todayIso();
    const method = select({ id: "pay-method", label: t("repairs.x.method"), value: "cash", options: PAYMENT_METHODS.map((m) => ({ value: m, label: t(`repairs.pay.method.${m}`) })) });
    const list = (job.payments ?? []).map((p) => h("li", { class: "log-row" },
      h("span", { text: `${fmtDate(ctx, p.date)} · ${t(`repairs.pay.kind.${p.kind}`)} · ${t(`repairs.pay.method.${p.method}`)} · ${p.kind === "refund" ? "−" : ""}${money(ctx, p.amountMinor)}` }),
      closed ? null : button({ label: t("common.remove"), ariaLabel: `${t("common.remove")}: ${money(ctx, p.amountMinor)}`, onClick: guard(async () => {
        const { confirmed } = await confirmDialog({ title: t("common.remove"), message: t("repairs.pay.deleteConfirm"), confirmLabel: t("common.remove"), cancelLabel: t("common.cancel"), danger: true });
        if (confirmed) await mutate(job.id, (cur) => ({ payments: cur.payments.filter((x) => x.id !== p.id) }));
      }) })));
    const form = closed ? null : h("form", { class: "stack", id: "pay-form", novalidate: true, on: { submit: guard(async (e) => {
      e.preventDefault();
      amount.setError(""); date.setError("");
      const a = parseAmount(amount.input.value, { decimal });
      if (!a.ok || a.minor < 1) { amount.setError(a.ok ? t("repairs.err.amount") : errText(ctx, a.error)); amount.input.focus(); return; }
      const cand = { kind: kind.input.value, amountMinor: a.minor, date: date.input.value || todayIso(), method: method.input.value, note: "" };
      const v = validatePayment(job.payments ?? [], cand, { today: todayIso() });
      if (!v.ok) {
        if (v.errors.limit) { ctx.notify(t("repairs.pay.max", { max: LIMITS.payments }), "warn"); return; }
        if (v.errors.amount) amount.setError(errText(ctx, v.errors.amount, { amount: money(ctx, calc.paidMinor) }));
        if (v.errors.date) date.setError(errText(ctx, v.errors.date));
        focusFirstInvalid(form);
        return;
      }
      st.focus = "pay-amount";
      await mutate(job.id, (cur) => ({ payments: [...cur.payments, { id: `p${Date.now().toString(36)}`, ...cand }] }));
    }) } }, h("div", { class: "grid-2" }, kind.element, amount.element), h("div", { class: "grid-2" }, date.element, method.element), h("div", { class: "row" }, button({ id: "pay-add", label: t("repairs.pickup.recordPayment"), type: "submit" })));
    amount.input.id = "pay-amount";
    amount.element.querySelector("label").setAttribute("for", "pay-amount");
    return h("div", { class: "card stack", id: "pk-payments" }, h("h3", { text: t("repairs.pay.add") }), list.length ? h("ul", { class: "log" }, ...list) : null, form);
  }

  function testsBlock(job, d0) {
    const items = job.tests?.items ?? [];
    const closed = isClosed(job.status);
    if (!items.length) return null;
    const rows = items.map((it) => {
      const cur = closed ? it.after : d0.after[it.key] !== undefined ? d0.after[it.key] : it.after;
      const g = closed ? null : radioGroup({ legend: t(`repairs.test.${it.key}`), name: `pk-t-${it.key}`, value: cur, options: ["works", "fault", "untestable"].map((v) => ({ value: v, label: t(`repairs.tests.val.${v}`) })), onChange: (v) => { d0.after[it.key] = v; } });
      return h("div", { class: "test-compare" },
        g ? g.element : h("p", { text: `${t(`repairs.test.${it.key}`)}: ${it.after ? t(`repairs.tests.val.${it.after}`) : t("repairs.tests.notRecorded")}` }),
        h("p", { class: "muted", text: `${t("repairs.tests.before")}: ${it.before ? t(`repairs.tests.val.${it.before}`) : t("repairs.tests.notRecorded")}` }));
    });
    return h("div", { class: "card stack", id: "pk-tests" }, h("h3", { text: t("repairs.pickup.testsTitle") }), ...rows);
  }

  const answers = (job) => (job.status === "ready" || job.status === "ready_unrepaired");

  function actionsBlock(job, c, d, calc) {
    const d0 = draftOf(job.id);
    const err = h("p", { class: "field-error", id: "pk-error", role: "alert" });
    if (isClosed(job.status)) return closedBlock(job, c, d);
    const kids = [];
    let warrantyField = null;
    const tried = radioGroup({ legend: t("repairs.pickup.tried"), name: "pk-tried", value: d0.tried, options: [{ value: "yes", label: t("repairs.yn.yes") }, { value: "no", label: t("repairs.yn.no") }], onChange: (v) => { d0.tried = v; err.textContent = ""; } });
    if (answers(job)) kids.push(tried.element);
    if (job.status === "ready") {
      const def = d0.warranty !== undefined ? d0.warranty : ct.defaultWarrantyDays === null ? "" : String(ct.defaultWarrantyDays);
      warrantyField = field({ label: t("repairs.pickup.warrantyDays"), value: def, inputmode: "numeric", autocomplete: "off", hint: t("repairs.note.warranty") });
      const endLine = h("p", { class: "muted", id: "pk-warranty-end" });
      const upd = () => {
        d0.warranty = warrantyField.input.value;
        const w = parseWarrantyDays(warrantyField.input.value);
        endLine.textContent = w.ok && w.days ? t("repairs.pickup.warrantyEnds", { date: formatDate(warrantyEnd(todayIso(), w.days)) }) : "";
      };
      warrantyField.input.addEventListener("input", upd);
      upd();
      kids.push(warrantyField.element, endLine);
    }
    const doPickup = (to) => guard(async () => {
      err.textContent = "";
      warrantyField?.setError("");
      if (!d0.tried) { err.textContent = t("repairs.pickup.triedMissing"); tried.inputs[0].focus(); return; }
      let warrantyDays = null;
      if (to === "handed_over") {
        const w = parseWarrantyDays(warrantyField ? warrantyField.input.value : "");
        if (!w.ok) { warrantyField.setError(t("repairs.err.days", { max: LIMITS.warrantyDays })); warrantyField.input.focus(); return; }
        warrantyDays = w.days;
      }
      // uyarilar: kalan > 0, muadil / cikma parca musteriye soylenmemis
      const warns = [];
      if (calc.balanceMinor > 0) warns.push(t("repairs.pickup.balanceConfirm", { amount: money(ctx, calc.balanceMinor) }));
      for (const l of job.lines ?? []) if (l.kind === "part" && (l.partType === "aftermarket" || l.partType === "used") && !l.toldCustomer) warns.push(t("repairs.lines.notConfirmed", { item: l.name, type: t(`repairs.part.${l.partType}`) }));
      if (warns.length) {
        const { confirmed } = await confirmDialog({ title: t(to === "handed_over" ? "repairs.pickup.handOver" : "repairs.pickup.returnUnrepaired"), message: warns[0], notes: warns.slice(1), confirmLabel: t(to === "handed_over" ? "repairs.pickup.handOver" : "repairs.pickup.returnUnrepaired"), cancelLabel: t("common.cancel") });
        if (!confirmed) return;
      }
      st.focus = "pk-result";
      const ok = await mutate(job.id, (cur) => {
        if (cur.status !== job.status) throw new StoreError("stale_job", "changed elsewhere");
        const next = applyTransition(cur, to, { via: "pickup", now: new Date(), warrantyDays, customerTested: d0.tried });
        next.tests = { ...cur.tests, items: (cur.tests?.items ?? []).map((it) => ({ ...it, after: d0.after[it.key] !== undefined ? d0.after[it.key] : it.after })) };
        return next;
      });
      if (ok) drafts.delete(job.id);
    });
    const takeBack = guard(async () => {
      const { confirmed } = await confirmDialog({ title: t("repairs.pickup.takesBack"), message: job.number, confirmLabel: t("repairs.pickup.takesBack"), cancelLabel: t("common.cancel"), danger: true });
      if (!confirmed) return;
      st.focus = "pk-result";
      const ok = await mutate(job.id, (cur) => {
        if (cur.status !== job.status) throw new StoreError("stale_job", "changed elsewhere");
        return takeBackUnrepaired(cur, { now: new Date(), customerTested: d0.tried });
      });
      if (ok) drafts.delete(job.id);
    });
    const btns = [];
    if (job.status === "ready") btns.push(button({ id: "pk-handover", label: t("repairs.pickup.handOver"), variant: "primary", onClick: doPickup("handed_over") }));
    if (job.status === "ready_unrepaired") btns.push(button({ id: "pk-return", label: t("repairs.pickup.returnUnrepaired"), variant: "primary", onClick: doPickup("returned_unrepaired") }));
    if (!isReady(job.status)) btns.push(button({ id: "pk-takeback", label: t("repairs.pickup.takesBack"), onClick: takeBack }));
    // durum gecisleri (hazir degilken) Board'dan yapilir; burada yalniz Mark ready kisayolu
    const quick = nextStatuses(job.status).includes("ready") && !isReady(job.status)
      ? button({ id: "pk-mark-ready", label: t("repairs.job.ready"), onClick: guard(async () => { await mutate(job.id, (cur) => applyTransition(cur, "ready", { now: new Date() })); }) }) : null;
    return h("div", { class: "card stack", id: "pk-actions" }, ...kids, err, h("div", { class: "row" }, ...btns, quick));
  }

  function closedBlock(job, c, d) {
    const data1 = { job, customer: c, device: d };
    const rev = templateValues({ customer: c, device: d, job, shop: shopName, settings: ct, totalMinor: calcJob(job).totalMinor, balanceMinor: calcJob(job).balanceMinor, formatMoney: ctx.i18n.formatCurrency, formatDate, typeNames: typeNames(ctx), deviceFallback: t("repairs.type.fallback") });
    const review = fillTemplate(ct.templates.review ?? t("repairs.msg.review"), rev);
    const rl = messageLinks(c?.phone ?? "", ct.countryCode, review.text);
    const reviewBtns = review.blocked.length || !rl.ok ? [button({ label: t("repairs.pickup.review"), disabled: true }), h("p", { class: "field-hint", text: review.blocked.length ? t("repairs.msg.noReviewLink") : t("repairs.msg.needCode") })]
      : [h("a", { class: "btn btn-secondary", id: "pk-review-sms", href: rl.sms, text: `${t("repairs.pickup.review")} · ${t("repairs.msg.sms")}` }), h("a", { class: "btn btn-secondary", id: "pk-review-wa", href: rl.wa, target: "_blank", rel: "noopener noreferrer", text: `${t("repairs.pickup.review")} · ${t("repairs.msg.wa")}` })];
    const nextId = readyJobs().find((j) => j.id !== job.id)?.id;
    const reopen = nextStatuses(job.status).find((s) => s !== job.status);
    return h("div", { class: "card stack", id: "pk-result", tabindex: "-1" },
      h("h3", { text: t(`repairs.status.${job.status}`) }),
      job.handedOverDate ? h("p", { text: `${t("repairs.doc.pickedUp")}: ${fmtDate(ctx, job.handedOverDate)}` }) : null,
      job.warrantyEnd ? h("p", { id: "pk-warranty", text: t("repairs.doc.warranty", { n: job.warrantyDays, date: formatDate(job.warrantyEnd) }) }) : null,
      h("div", { class: "row" },
        button({ id: "pk-print-slip", label: t("repairs.pickup.printSlip"), exportAction: true, onClick: guard(() => printSlip(ctx, data1)) }),
        button({ id: "pk-print-invoice", label: t("repairs.pickup.printInvoice"), exportAction: true, onClick: guard(() => printInvoice(ctx, data1)) }),
        ...(job.status === "cancelled" ? [] : reviewBtns),
        button({ id: "pk-next", label: t("repairs.pickup.next"), disabled: !nextId, onClick: () => ctx.navigate(`pickup/${nextId}`) })),
      reopen ? h("div", { class: "row" }, button({ id: "pk-reopen", label: t("repairs.job.reopen"), onClick: guard(async () => {
        const { confirmed } = await confirmDialog({ title: t("repairs.job.reopen"), message: t("repairs.job.reopenConfirm", { ticket: job.number }), confirmLabel: t("repairs.job.reopen"), cancelLabel: t("common.cancel") });
        if (confirmed) await mutate(job.id, (cur) => applyTransition(cur, reopen, { now: new Date() }));
      }) })) : null);
  }

  function paintPanel() {
    const id = st.id ?? readyJobs()[0]?.id ?? null;
    const job = id ? jobById(id) : null;
    wrap.dataset.view = st.id ? "panel" : "list";
    if (!job) {
      panelBox.replaceChildren(st.id ? h("div", { class: "stack" }, showNotice(t("repairs.job.notFound"), { kind: "warn" }), h("div", { class: "row" }, button({ label: t("repairs.job.goToFind"), onClick: () => ctx.navigate("find") }))) : emptyState({ title: t("repairs.pickup.empty") }));
      return;
    }
    const c = data.cById.get(job.customerId);
    const d = data.dById.get(job.deviceId);
    const calc = calcJob(job);
    const d0 = draftOf(job.id);
    const head = h("div", { class: "card stack", id: "pk-summary" },
      h("div", { class: "row" }, button({ id: "pk-back", label: t("repairs.common.backToList"), icon: "back", onClick: () => ctx.navigate("pickup") })),
      h("div", { class: "job-head" }, h("h3", { class: "job-title", text: job.number }), statusChip(ctx, job.status)),
      h("p", { class: "job-name", text: c ? `${c.name} · ${c.phone}` : t("repairs.placeholder.missingCustomer") }),
      h("p", { class: "muted", text: d ? deviceLine(ctx, d) : t("repairs.placeholder.unknownDevice") }),
      h("p", { text: job.problem }),
      h("p", { class: "muted", text: t("repairs.common.daysInStatus", { n: Math.max(0, Math.round((Date.parse(todayIso()) - Date.parse(job.statusDate)) / 86400000)) }) }));
    const partsNote = (job.lines ?? []).filter((l) => l.kind === "part" && (l.partType === "aftermarket" || l.partType === "used") && !l.toldCustomer);
    panelBox.replaceChildren(...[head,
      ...partsNote.map((l) => showNotice(t("repairs.lines.notConfirmed", { item: l.name, type: t(`repairs.part.${l.partType}`) }), { kind: "warn" })),
      linesBlock(job, calc), paymentsBlock(job, calc), testsBlock(job, d0), actionsBlock(job, c, d, calc),
      isClosed(job.status) && job.status === "cancelled" ? null : messagesBlock(job, c, d, calc)].filter(Boolean)); // replaceChildren(null) 'null' metni yazar
    if (st.focus) { const el = document.getElementById(st.focus); if (el) el.focus({ preventScroll: false }); st.focus = null; }
  }

  async function reload() { data = await loadAll(ctx); paintList(); paintPanel(); }

  root.replaceChildren(h("h2", { text: t("repairs.nav.pickup") }), wrap);
  paintList();
  paintPanel();
  ctx.onExternalChange(reload);
}
