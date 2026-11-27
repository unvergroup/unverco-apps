// Today: tek sayi ("Spendable today"), neden satiri + dokum, maas onayi, yaklasan 3 fatura, bugunku harcamalar.
import { h, btn, field } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { addDays } from "../../../core/dates.js";
import { confirmPay, markBillPaid, savePlan } from "../logic/actions.js";
import { isFreeSpend, periodBills } from "../logic/engine.js";
import { payTimeline } from "../logic/schedule.js";
import { reasonText } from "../print/plan.js";
import { dateChip, disclaimerNote, envIcon, envName, findEnv, hello, md, money, plainMoney, readMoney, wmd } from "./common.js";
import { openTxEdit } from "./txedit.js";
import { backupNow } from "./settings.js";
import { backupDue } from "../logic/data.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, String(attrs[k])); for (const c of kids) n.append(c); return n; };
let backupLater = false; // "Later": yalniz bu oturum

/** Para tutarini simge + sayi olarak boler (simge ust simge olarak gosterilir). */
export function moneyParts(ctx, minor) {
  try {
    const parts = new Intl.NumberFormat(`${ctx.i18n.locale}-u-nu-latn`, { style: "currency", currency: ctx.i18n.currency }).formatToParts(minor / 100);
    const sym = parts.filter((p) => p.type === "currency").map((p) => p.value).join("");
    const num = parts.filter((p) => p.type !== "currency").map((p) => p.value).join("").trim();
    return { sym, num, symFirst: parts.findIndex((p) => p.type === "currency") < parts.findIndex((p) => p.type === "integer") };
  } catch { return { sym: "", num: ctx.i18n.formatCurrency(minor), symFirst: true }; }
}

/** Uzun tutar halkaya / tus takimina sigsin: karakter sayisina gore kucuk punto sinifi. */
export const sizeCls = (p) => { const n = (p.sym + p.num).length; return n >= 11 ? " s2" : n >= 8 ? " s1" : ""; };

function ring(res) {
  const days = Math.max(1, Math.min(31, res.daysLeft));
  const C = 2 * Math.PI * 132;
  const seg = C / days;
  const s = svg("svg", { viewBox: "0 0 272 272", "aria-hidden": "true" },
    svg("defs", {},
      svg("linearGradient", { id: "mg", x1: 0, y1: 0, x2: 1, y2: 1 }, svg("stop", { offset: 0, "stop-color": "#9dfde0" }), svg("stop", { offset: ".5", "stop-color": "var(--mint)" }), svg("stop", { offset: 1, "stop-color": "var(--mint-2)" })),
      svg("linearGradient", { id: "gg", x1: 0, y1: 0, x2: 1, y2: 1 }, svg("stop", { offset: 0, "stop-color": "var(--gold-hi)" }), svg("stop", { offset: 1, "stop-color": "var(--gold-lo)" })),
      svg("filter", { id: "glow", x: "-20%", y: "-20%", width: "140%", height: "140%" }, svg("feGaussianBlur", { stdDeviation: 5, result: "b" }), svg("feMerge", {}, svg("feMergeNode", { in: "b" }), svg("feMergeNode", { in: "SourceGraphic" })))));
  for (let i = 0; i < days; i += 1) {
    s.append(svg("circle", { cx: 136, cy: 136, r: 132, fill: "none", stroke: i === 0 ? "url(#gg)" : "var(--day-seg)", "stroke-width": 5, "stroke-linecap": "round", "stroke-dasharray": `${Math.max(2, seg - 6).toFixed(2)} ${C.toFixed(2)}`, "stroke-dashoffset": `${(-(i * seg) - 3).toFixed(2)}` }));
  }
  const r2 = 2 * Math.PI * 118;
  const frac = res.dailyMinor > 0 ? Math.max(0, Math.min(1, res.leftTodayMinor / res.dailyMinor)) : 0;
  s.append(svg("circle", { class: "track", cx: 136, cy: 136, r: 118, fill: "none", "stroke-width": 14 }));
  if (frac > 0) s.append(svg("circle", { cx: 136, cy: 136, r: 118, fill: "none", stroke: "url(#mg)", "stroke-width": 14, "stroke-linecap": "round", "stroke-dasharray": `${(r2 * frac).toFixed(1)} ${r2.toFixed(1)}`, filter: "url(#glow)" }));
  return s;
}

export async function mountToday(ctx, root, { state, result: res, today }) {
  const { t, formatDate } = ctx.i18n;
  const plan = state.payPlan;
  ctx.setActions(
    h("a", { class: "btn ghost", href: "#/print/plan", id: "today-print", "aria-label": t("today.printPlan") }, icon("printer"), h("span", { class: "hide-sm", text: t("today.printPlan") })),
    h("a", { class: "iconbtn show-sm", href: "#/settings", id: "top-settings", "aria-label": t("nav.settings") }, icon("settings")));
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? "today.morning" : hour < 18 ? "today.afternoon" : "today.evening");
  root.append(hello(greet, `${formatDate(today, { weekday: "long", month: "long", day: "numeric" })} · ${t("today.period", { from: md(ctx, res.periodStart), to: md(ctx, addDays(res.nextPay, -1)) })}`));

  const left = h("div");
  const right = h("div");
  root.append(h("div", { class: "cols" }, left, right));

  // ---- Maas onayi (gecikme durumu) ----
  if (res.late) {
    const amt = field({ label: t("pay.amount"), id: "pay-amount", value: plainMoney(plan.amountMinor), attrs: { inputmode: "decimal", autocomplete: "off" } });
    const yes = btn({ label: t("pay.yes", { amount: money(ctx, plan.amountMinor) }), cls: "primary", id: "pay-yes", onClick: async () => {
      const v = readMoney(amt.input.value);
      if (!(Number.isInteger(v) && v > 0)) { amt.setError(t("setup.err.amount")); return; }
      try { await ctx.change(() => confirmPay(ctx.store, { payFor: res.nextPay, amountMinor: v, today }), t("pay.done")); ctx.refresh(); } catch (e) { ctx.fail(e); }
    } });
    amt.input.addEventListener("input", () => { const v = readMoney(amt.input.value); yes.querySelector("span").textContent = t("pay.yes", { amount: Number.isInteger(v) && v > 0 ? money(ctx, v) : "…" }); });
    const card = h("section", { class: "paycard glass", id: "pay-card", "aria-labelledby": "pay-h" },
      h("h2", { class: "sr", id: "pay-h", text: t("pay.title") }),
      h("p", {}, h("b", { text: t("pay.title") }), " ", t("pay.expected", { date: wmd(ctx, res.nextPay) })),
      h("details", {}, h("summary", { class: "linklike", text: t("pay.different") }), amt.el),
      h("div", { class: "row2" }, yes, btn({ label: t("pay.notYet"), id: "pay-notyet", onClick: () => { card.remove(); ctx.notify(t("pay.notYetNote")); } })));
    left.append(card);
  }
  // ---- Duzensiz maas: sonraki tarih bilinmiyor ----
  if (plan.frequency === "irregular" && !(plan.nextOverride && plan.nextOverride > res.periodStart)) {
    const f = field({ label: t("irregular.ask"), id: "irr-next", type: "date", value: res.nextPay });
    left.append(h("section", { class: "paycard glass" }, f.el, btn({ label: t("common.save"), cls: "primary", id: "irr-save", onClick: async () => {
      if (!(f.input.value > res.periodStart)) { f.setError(t("setup.err.next")); return; }
      try { await ctx.change(() => savePlan(ctx.store, { ...plan, nextOverride: f.input.value }), t("set.saved")); ctx.refresh(); } catch (e) { ctx.fail(e); }
    } })));
  }
  // ---- Yedek hatirlatma ----
  if (!backupLater && backupDue(state, new Date())) {
    left.append(h("div", { class: "banner-card glass", id: "backup-strip", role: "status" }, icon("download"), h("p", { text: state.prefs.lastBackupAt ? t("backup.reminder", { date: formatDate(state.prefs.lastBackupAt.slice(0, 10)) }) : t("backup.never") }),
      btn({ label: t("backup.now"), cls: "primary sm", id: "backup-now", onClick: async () => { if (await backupNow(ctx)) ctx.refresh(); } }),
      btn({ label: t("backup.later"), cls: "ghost sm", id: "backup-later", onClick: (e) => { backupLater = true; e.currentTarget.closest(".banner-card").remove(); } })));
  }

  // ---- Buyuk sayi ----
  const parts = moneyParts(ctx, res.dailyMinor);
  const big = h("span", { class: `big num${sizeCls(parts)}`, id: "spendable" }, parts.symFirst ? h("sup", { text: parts.sym }) : null, parts.num, parts.symFirst ? null : h("sup", { text: parts.sym }));
  big.setAttribute("aria-label", money(ctx, res.dailyMinor));
  const over = res.leftTodayMinor < 0;
  const leftLine = h("span", { class: `left num${over ? " over" : ""}`, id: "left-today" }, ...(over
    ? [h("b", { text: t("today.overBy", { amount: money(ctx, -res.leftTodayMinor) }) })]
    : splitB(t("today.leftToday", { amount: "\u0000" }), money(ctx, res.leftTodayMinor))));
  const pill = h("span", { class: "pill num", id: "days-pill" }, icon("calendar"), h("span", {}, ...(res.late
    ? [t("today.payWas", { date: wmd(ctx, res.nextPay) })]
    : splitGold(t(res.daysLeft === 1 ? "today.daysToPay.one" : "today.daysToPay", { n: "\u0000", date: wmd(ctx, res.nextPay) }), t(res.daysLeft === 1 ? "today.days.one" : "today.days", { n: res.daysLeft })))));

  const kind = res.reason.key;
  const reasonStr = reasonText(res.reason, ctx.i18n);
  const amountStr = kind === "reserve" || kind === "short" ? money(ctx, res.reason.params.amount) : kind === "ok" ? money(ctx, res.reason.params.amount) : "";
  const how = mathBlock(ctx, res);
  how.hidden = true;
  const toggle = () => { const open = how.hidden; how.hidden = !open; for (const b of [reasonBtn, disclose]) b.setAttribute("aria-expanded", String(open)); disclose.replaceChildren(t("today.how"), icon(open ? "up" : "down")); };
  const reasonBtn = h("button", { type: "button", class: `reason reason-btn ${kind}`, id: "reason", "aria-expanded": "false", "aria-controls": "how", on: { click: toggle } },
    h("span", { class: "ico" }, icon(kind === "ok" ? "check" : kind === "reserve" ? "lock" : "alert")),
    h("p", {}, ...(amountStr && reasonStr.includes(amountStr) ? splitB(reasonStr.replace(amountStr, "\u0000"), amountStr) : [reasonStr])));
  const disclose = h("button", { type: "button", class: "disclose", id: "how-toggle", "aria-expanded": "false", "aria-controls": "how", on: { click: toggle } }, t("today.how"), icon("down"));
  left.append(h("section", { class: "card glass hero", "aria-labelledby": "h-today" },
    h("h2", { class: "sr", id: "h-today", text: t("nav.today") }),
    h("div", { class: "ring" }, ring(res), h("div", { class: "inner" }, h("span", { class: "lbl", text: t("today.spendable") }), big, leftLine)),
    pill, reasonBtn, disclose, how));

  // ---- Yaklasan faturalar ----
  const tl = payTimeline(plan, state.transactions, today);
  const { occurrences } = periodBills(state, tl);
  const upcoming = occurrences.filter((o) => !o.paid && o.due >= plan.startDate).slice(0, 3);
  const fromDate = (o) => [tl.periodStart, tl.next, ...tl.after][o.idx];
  right.append(h("section", { class: "card glass", "aria-labelledby": "h-up" },
    h("h2", { id: "h-up" }, t("today.comingUp"), h("a", { href: "#/bills", id: "all-bills", text: t("today.allBills") })),
    upcoming.length ? h("ul", { class: "list", id: "upcoming" }, upcoming.map((o) => {
      const tags = [];
      if (o.bill.kind === "debtMin") tags.push(h("span", { class: "tag gold", text: t("bills.minimum") }));
      if (res.reason.key === "reserve" && res.reason.params.bill === o.bill.name && res.reason.params.due === o.due) tags.push(h("span", { class: "tag coral", text: t("today.setAsideTag", { amount: money(ctx, res.reserveMinor) }) }));
      const sub = o.idx === 0 ? `${formatDate(o.due, { weekday: "short" })} · ${o.due < today ? t("bills.overdue") : t("today.held")}` : t("bills.fromPay", { date: md(ctx, fromDate(o)) });
      return h("li", { class: "item bill" }, dateChip(ctx, o.due),
        h("span", { class: "tx" }, h("span", { class: "l1" }, h("b", { text: o.bill.name }), h("span", { class: "amt num", text: money(ctx, o.amountMinor) })), tags.length ? h("span", { class: "meta" }, ...tags) : h("small", { text: sub })),
        h("button", { type: "button", class: "paid", id: `paid-${o.bill.id}-${o.due}`, "aria-pressed": "false", "aria-label": t("bills.markPaidNamed", { name: o.bill.name }), on: { click: async () => {
          try {
            await ctx.change(() => markBillPaid(ctx.store, o.bill.id, o.due, today), t("bills.paidToast", { name: o.bill.name }));
            ctx.refresh();
          } catch (e) { ctx.fail(e); }
        } } }, icon("check")));
    })) : h("p", { class: "listempty", text: t("today.noBills") })));

  // ---- Bugunku harcamalar ----
  const spent = state.transactions.filter((tx) => tx.date === today && isFreeSpend(tx)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const total = spent.reduce((n, x) => n + x.amountMinor, 0);
  right.append(h("section", { class: "card glass", "aria-labelledby": "h-spent" },
    h("h2", { id: "h-spent" }, t("today.spentToday"), h("span", { class: "num spent-total", text: money(ctx, total) })),
    spent.length ? h("ul", { class: "list", id: "spent-list" }, spent.map((x) => {
      const env = findEnv(state, x.envelopeId);
      const time = x.createdAt ? new Intl.DateTimeFormat(`${ctx.i18n.locale}-u-nu-latn`, { hour: "numeric", minute: "2-digit" }).format(new Date(x.createdAt)) : "";
      return h("li", { class: "item" },
        h("span", { class: "chipico" }, icon(envIcon(state, x.envelopeId))),
        h("span", { class: "tx" }, h("button", { type: "button", class: "linklike", id: `tx-${x.id}`, "aria-label": t("tx.editNamed", { name: x.note || envName(ctx, env) }), on: { click: () => openTxEdit(ctx, state, x) } }, h("b", { text: x.note || envName(ctx, env) })), h("small", { text: [envName(ctx, env), time].filter(Boolean).join(" · ") })),
        h("span", { class: "amt num", text: money(ctx, x.amountMinor) }));
    })) : h("p", { class: "listempty", text: t("today.nothingSpent") })),
    disclaimerNote(ctx));
}

/** "\0" yer tutucusunu kalin tutarla degistirir (cevirilerde tutarin yeri dile gore). */
function splitB(tpl, value) { const [a, b = ""] = tpl.split("\u0000"); return [a, h("b", { text: value }), b]; }
function splitGold(tpl, value) { const [a, b = ""] = tpl.split("\u0000"); return [a, h("span", { class: "gold", text: value }), b]; }

function mathBlock(ctx, res) {
  const { t } = ctx.i18n;
  const row = (cls, label, amount, id) => h("div", { class: `row ${cls}`, id }, h("span", { text: label }), h("span", { class: "amt num", text: amount }));
  const rows = [row("", t("math.balance"), money(ctx, res.startOfDayMinor), "m-balance"),
    row("minus", t("math.bills", { date: md(ctx, res.nextPay), n: res.billsDueCount }), money(ctx, -res.billsDueMinor), "m-bills")];
  if (res.reserveMinor > 0) rows.push(row("res", res.reason.key === "reserve" && res.reason.params.bill ? t("math.reserveFor", { bill: res.reason.params.bill, date: md(ctx, res.reason.params.due) }) : t("math.reserve"), money(ctx, -res.reserveMinor), "m-reserve"));
  rows.push(row("minus", t("math.funds"), money(ctx, -res.earmarkedMinor), "m-funds"));
  rows.push(row("total", t("math.available"), money(ctx, res.availableMinor), "m-available"));
  rows.push(row("final", t(res.daysLeft === 1 ? "math.perDay.one" : "math.perDay", { n: res.daysLeft }), res.availableMinor >= 0 ? t("math.aDay", { amount: money(ctx, res.dailyMinor) }) : t("math.shortBy", { amount: money(ctx, res.shortMinor) }), "m-daily"));
  if (res.availableMinor < 0) rows[rows.length - 1].classList.add("short"); // "Short by" mercan
  return h("div", { class: "math", id: "how", dataset: { start: res.startOfDayMinor, bills: res.billsDueMinor, reserve: res.reserveMinor, funds: res.earmarkedMinor, available: res.availableMinor, days: res.daysLeft, daily: res.dailyMinor } }, rows);
}
