// Yazdirilabilir belge MODELLERI (saf veri): her ekranin belgesi burada duz nesne olarak kurulur; DOM yok, ag yok.
// Cizim print/render.js'te; yazdirma tetigi core/print.js requestPrint'tedir. Boylece belge icerigi DOM'suz test edilir.
// L (etiket yardimcilari): { t, tn, formatDate, formatCurrency, formatNumber, formatPercent, time(hhmm), service(k), category(k), method(k) }.
// Belge: { id, title, period, sections[], notes[], empty }.
//   section: { kind:"table", heading?, columns:[{ key, label, num?, primary?, amount? }], rows:[{ key: metin }], total?:{ label, value } }
//          | { kind:"kv", heading?, rows:[[etiket, deger, guclu?]] } | { kind:"note", text } | { kind:"empty", text }
// Sutun bayraklari 80 mm rulo duzeni icindir: primary = ust satirda " · " ile birlesir, amount = ust satirin sagi, digerleri "etiket: deger" satiri.
import { addDays, startOfWeek } from "../../../core/dates.js";
import { cashSummary, expensesByCategory, expensesInRange } from "../logic/expenses.js";
import { revenueByService, revenueForRange } from "../logic/calc.js";
import { transactionRows } from "../logic/report.js";
import { getAppointmentsForDate, getAppointmentsForMonth, getAppointmentsForWeek } from "../logic/appointments.js";
import { getReminders, filterReminders, isReminderSent, REMINDER_DAYS } from "../logic/reminders.js";
import { vaccinesDue } from "../logic/pets.js";

const NOT_BILLED = ["cancelled", "no_show"];
const num = (v) => (Number.isSafeInteger(v) ? v : 0);
const byName = (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" });

const emptyDoc = (L, { id, title, period, notes = [] }) => ({ id, title, period, sections: [{ kind: "empty", text: L.t("pl.empty") }], notes, empty: true });
const stamp = (L, now) => L.t("income.report.generated", { date: L.formatDate(now, { dateStyle: "long" }) });

/** Donem metni: "Bu ay: 1 Kas 2026 - 30 Kas 2026" ("Tum zamanlar" ise yalniz etiket). */
export function periodText(L, range, periodLabel) {
  if (range.from <= "0000-01-01") return periodLabel;
  const span = range.from === range.to
    ? L.formatDate(range.from, { dateStyle: "long" })
    : `${L.formatDate(range.from, { dateStyle: "long" })} – ${L.formatDate(range.to, { dateStyle: "long" })}`;
  return periodLabel ? `${periodLabel}: ${span}` : span;
}

const apptRows = (L, data, list, withDate = false) => list.map((a) => ({
  date: withDate ? L.formatDate(a.date) : "",
  time: L.time(a.time),
  client: data.cById?.get(a.clientId)?.name ?? L.t("common.unknown"),
  pet: data.pById?.get(a.petId)?.name ?? L.t("common.unknown"),
  service: L.service(a.service),
  status: L.t(`status.${a.status}`),
  amount: L.formatCurrency(num(a.price)),
}));

// ---- 1. Today ----
function buildTodayDoc_(L, { data, today, now = new Date() }) {
  const title = L.t("pl.today.title");
  const period = L.formatDate(today, { dateStyle: "full" });
  const list = getAppointmentsForDate(data, today);
  const vax = vaccinesDue(data, today).slice(0, 20);
  if (!list.length && !vax.length) return emptyDoc(L, { id: "today", title, period, notes: [stamp(L, now)] });
  const sections = [];
  if (list.length) {
    const billed = list.filter((a) => !NOT_BILLED.includes(a.status));
    sections.push({
      kind: "table", heading: L.tn("today.count", list.length),
      columns: [
        { key: "time", label: L.t("appt.time"), primary: true }, { key: "client", label: L.t("appt.client"), primary: true }, { key: "pet", label: L.t("appt.pet"), primary: true },
        { key: "service", label: L.t("appt.service") }, { key: "status", label: L.t("appt.status") }, { key: "amount", label: L.t("appt.price"), num: true, amount: true },
      ],
      rows: apptRows(L, data, list),
      total: { label: L.t("pl.dayTotal"), value: L.formatCurrency(billed.reduce((s, a) => s + num(a.price), 0)) },
    });
  } else sections.push({ kind: "note", text: L.t("pl.today.none") });
  if (vax.length) {
    sections.push({
      kind: "table", heading: L.t("vax.title"),
      columns: [
        { key: "pet", label: L.t("appt.pet"), primary: true }, { key: "client", label: L.t("appt.client"), primary: true },
        { key: "due", label: L.t("pet.vaccineDue") }, { key: "state", label: L.t("appt.status") },
      ],
      rows: vax.map(({ pet, client, state, days }) => ({
        pet: pet.name, client: client?.name ?? "", due: L.formatDate(pet.vaccineDue),
        state: state === "overdue" ? L.tn("vax.overdue", -days) : days === 0 ? L.t("vax.today") : L.tn("vax.soon", days),
      })),
    });
  }
  return { id: "today", title, period, sections, notes: [stamp(L, now)], empty: false };
}

// ---- 2. Takvim (ay ya da hafta; gun gun, saat sirali) ----
export function calendarRange(sel, mode) {
  if (mode === "week") { const from = startOfWeek(sel, 0); return { from, to: addDays(from, 6) }; }
  const [y, m] = sel.split("-").map(Number);
  const from = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${String(y + 1).padStart(4, "0")}-01-01` : `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1) };
}

function buildCalendarDoc_(L, { data, sel, mode, now = new Date() }) {
  const week = mode === "week";
  const range = calendarRange(sel, mode);
  const title = L.t(week ? "pl.calendar.week" : "pl.calendar.month");
  const period = week
    ? `${L.formatDate(range.from, { dateStyle: "long" })} – ${L.formatDate(range.to, { dateStyle: "long" })}`
    : L.formatDate(range.from, { month: "long", year: "numeric" });
  const [y, m] = sel.split("-").map(Number);
  const list = week ? getAppointmentsForWeek(data, range.from) : getAppointmentsForMonth(data, y, m);
  if (!list.length) return emptyDoc(L, { id: "calendar", title, period, notes: [stamp(L, now)] });
  const days = [...new Set(list.map((a) => a.date))].sort();
  const columns = [
    { key: "time", label: L.t("appt.time"), primary: true }, { key: "client", label: L.t("appt.client"), primary: true }, { key: "pet", label: L.t("appt.pet"), primary: true },
    { key: "service", label: L.t("appt.service") }, { key: "status", label: L.t("appt.status") },
  ];
  const sections = days.map((d) => ({
    kind: "table", heading: L.formatDate(d, { dateStyle: "full" }), columns,
    rows: apptRows(L, data, list.filter((a) => a.date === d)),
  }));
  return { id: "calendar", title, period, sections, notes: [L.tn("today.count", list.length), stamp(L, now)], empty: false };
}

// ---- 3. Musteriler ----
function buildClientsDoc_(L, { data, clients, query = "", now = new Date() }) {
  const title = L.t("pl.clients.title");
  const q = String(query ?? "").trim();
  const period = q ? L.t("pl.clients.filtered", { q }) : L.t("pl.clients.all");
  const list = [...clients].sort(byName);
  if (!list.length) return emptyDoc(L, { id: "clients", title, period, notes: [stamp(L, now)] });
  const pets = new Map();
  for (const p of data.pets ?? []) { const a = pets.get(p.clientId) ?? []; a.push(p.name); pets.set(p.clientId, a); }
  return {
    id: "clients", title, period, empty: false, notes: [stamp(L, now)],
    sections: [{
      kind: "table",
      columns: [
        { key: "name", label: L.t("client.name"), primary: true }, { key: "phone", label: L.t("client.phone") },
        { key: "count", label: L.t("pl.col.petCount"), num: true }, { key: "pets", label: L.t("client.pets") },
      ],
      rows: list.map((c) => ({ name: c.name, phone: c.phone ?? "", count: L.formatNumber((pets.get(c.id) ?? []).length), pets: (pets.get(c.id) ?? []).join(", ") })),
      total: { label: L.t("pl.clients.total", { n: L.formatNumber(list.length) }), value: "" },
    }],
  };
}

// ---- 4. Hatirlatmalar (onumuzdeki 14 gun; ekrandaki suzgece uyar) ----
function buildRemindersDoc_(L, { data, today, filter = "all", now = new Date() }) {
  const title = L.t("pl.reminders.title", { days: REMINDER_DAYS });
  const to = addDays(today, REMINDER_DAYS);
  const period = `${L.formatDate(today, { dateStyle: "long" })} – ${L.formatDate(to, { dateStyle: "long" })} · ${L.t(`rem.filter.${filter}`)}`;
  const list = filterReminders(getReminders(data, { today }), filter);
  if (!list.length) return emptyDoc(L, { id: "reminders", title, period, notes: [stamp(L, now)] });
  return {
    id: "reminders", title, period, empty: false, notes: [stamp(L, now)],
    sections: [{
      kind: "table",
      columns: [
        { key: "date", label: L.t("appt.date"), primary: true }, { key: "client", label: L.t("appt.client"), primary: true }, { key: "pet", label: L.t("appt.pet"), primary: true },
        { key: "service", label: L.t("appt.service") }, { key: "sent", label: L.t("pl.col.sent"), amount: true },
      ],
      rows: list.map((a) => ({
        date: `${L.formatDate(a.date)} ${L.time(a.time)}`, client: data.cById?.get(a.clientId)?.name ?? L.t("common.unknown"),
        pet: data.pById?.get(a.petId)?.name ?? L.t("common.unknown"), service: L.service(a.service),
        sent: L.t(isReminderSent(a) ? "rem.status.sent" : "rem.status.pending"),
      })),
      total: { label: L.tn("today.count", list.length), value: "" },
    }],
  };
}

// ---- 5. Gelir raporu (ozet + hizmete gore + islemler + giderler + net kasa) ----
function buildIncomeDoc_(L, { data, range, periodLabel, now = new Date() }) {
  const title = L.t("income.report.title");
  const period = periodText(L, range, periodLabel);
  const sum = revenueForRange(data.appointments, range.from, range.to);
  const cash = cashSummary(data.appointments, data.expenses, range.from, range.to);
  const rows = transactionRows(data, range.from, range.to);
  const exp = expensesInRange(data.expenses, range.from, range.to);
  if (!rows.length && !exp.length && sum.earnedMinor === 0 && sum.outstandingMinor === 0 && sum.bookedMinor === 0) {
    return emptyDoc(L, { id: "income", title, period, notes: [stamp(L, now)] });
  }
  const services = revenueByService(data.appointments, range);
  const sections = [{
    kind: "kv", heading: L.t("income.report.summary"),
    rows: [
      [L.t("income.total"), L.formatCurrency(sum.earnedMinor), true], [L.t("income.pending"), L.formatCurrency(sum.outstandingMinor)],
      [L.t("income.booked"), L.formatCurrency(sum.bookedMinor)], [L.t("exp.total"), L.formatCurrency(cash.expensesMinor)],
      [L.t("cash.net"), L.formatCurrency(cash.netMinor), true], [L.t("income.report.completed"), L.formatNumber(sum.completed)],
      [L.t("income.report.cancelled"), L.formatNumber(sum.cancelled)], [L.t("income.report.noShow"), L.formatNumber(sum.noShow)],
    ],
  }];
  if (services.length) {
    sections.push({
      kind: "table", heading: L.t("income.byService"),
      columns: [
        { key: "service", label: L.t("appt.service"), primary: true }, { key: "count", label: "#", num: true },
        { key: "amount", label: L.t("income.csv.amount"), num: true, amount: true }, { key: "share", label: "%", num: true },
      ],
      rows: services.map((r) => ({ service: L.service(r.service), count: L.formatNumber(r.count), amount: L.formatCurrency(r.revenueMinor), share: L.formatPercent(Math.round(r.share * 1000) / 10) })),
    });
  }
  sections.push(rows.length ? {
    kind: "table", heading: L.t("income.report.transactions"),
    columns: [
      { key: "date", label: L.t("appt.date"), primary: true }, { key: "client", label: L.t("appt.client"), primary: true }, { key: "pet", label: L.t("appt.pet"), primary: true },
      { key: "service", label: L.t("appt.service") }, { key: "amount", label: L.t("income.csv.amount"), num: true, amount: true }, { key: "paid", label: L.t("appt.payment") },
    ],
    rows: rows.map((r) => ({
      date: L.formatDate(r.date), client: r.client, pet: r.pet, service: L.service(r.service), amount: L.formatCurrency(r.price),
      paid: r.paid ? `${L.t("payment.paid")}${r.method ? ` · ${L.method(r.method)}` : ""}` : L.t("payment.pending"),
    })),
    total: { label: `${L.t("income.total")} / ${L.t("income.pending")}`, value: `${L.formatCurrency(sum.earnedMinor)} / ${L.formatCurrency(sum.outstandingMinor)}` },
  } : { kind: "note", heading: L.t("income.report.transactions"), text: L.t("income.noTransactions") });
  sections.push(expenseSection(L, exp, cash.expensesMinor, L.t("fin.tab.expenses")));
  return { id: "income", title, period, sections, notes: [L.t("cash.pendingNote"), stamp(L, now)], empty: false };
}

function expenseSection(L, exp, totalMinor, heading) {
  if (!exp.length) return { kind: "note", heading, text: L.t("exp.empty") };
  const sorted = exp.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id).localeCompare(String(b.id))));
  return {
    kind: "table", heading,
    columns: [
      { key: "date", label: L.t("appt.date"), primary: true }, { key: "category", label: L.t("exp.category"), primary: true },
      { key: "description", label: L.t("exp.description") }, { key: "method", label: L.t("appt.paymentMethod") }, { key: "amount", label: L.t("exp.amount"), num: true, amount: true },
    ],
    rows: sorted.map((e) => ({ date: L.formatDate(e.date), category: L.category(e.category), description: e.description ?? "", method: L.method(e.paymentMethod), amount: L.formatCurrency(num(e.amount)) })),
    total: { label: L.t("exp.total"), value: L.formatCurrency(totalMinor) },
  };
}

const categorySection = (L, cats, heading) => ({
  kind: "table", heading,
  columns: [{ key: "category", label: L.t("exp.category"), primary: true }, { key: "amount", label: L.t("exp.amount"), num: true, amount: true }, { key: "share", label: "%", num: true }],
  rows: cats.map((c) => ({ category: L.category(c.category), amount: L.formatCurrency(c.totalMinor), share: L.formatPercent(Math.round(c.share * 1000) / 10) })),
});

// ---- 6. Giderler ----
function buildExpensesDoc_(L, { data, range, periodLabel, now = new Date() }) {
  const title = L.t("pl.expenses.title");
  const period = periodText(L, range, periodLabel);
  const exp = expensesInRange(data.expenses, range.from, range.to);
  if (!exp.length) return emptyDoc(L, { id: "expenses", title, period, notes: [stamp(L, now)] });
  const total = cashSummary(data.appointments, data.expenses, range.from, range.to).expensesMinor;
  return {
    id: "expenses", title, period, empty: false, notes: [stamp(L, now)],
    sections: [expenseSection(L, exp, total, ""), categorySection(L, expensesByCategory(data.expenses, range.from, range.to), L.t("cash.byCategory"))],
  };
}

// ---- 7. Kasa (net kasa; bekleyen AYRI, neta girmez) ----
function buildCashDoc_(L, { data, range, periodLabel, now = new Date() }) {
  const title = L.t("pl.cash.title");
  const period = periodText(L, range, periodLabel);
  const cash = cashSummary(data.appointments, data.expenses, range.from, range.to);
  if (cash.collectedMinor === 0 && cash.expensesMinor === 0 && cash.pendingMinor === 0) return emptyDoc(L, { id: "cash", title, period, notes: [stamp(L, now)] });
  const cats = expensesByCategory(data.expenses, range.from, range.to);
  const status = cash.netMinor < 0 ? "negative" : cash.netMinor === 0 ? "even" : "positive";
  const sections = [
    { kind: "kv", heading: L.t("cash.net"), rows: [[L.t("income.total"), L.formatCurrency(cash.collectedMinor)], [L.t("exp.total"), L.formatCurrency(cash.expensesMinor)], [L.t("cash.net"), L.formatCurrency(cash.netMinor), true]] },
    { kind: "note", text: L.t(`cash.status.${status}`) },
    { kind: "kv", heading: L.t("cash.pendingLabel"), rows: [[L.t("income.pending"), L.formatCurrency(cash.pendingMinor)]] },
  ];
  if (cats.length) sections.push(categorySection(L, cats, L.t("cash.byCategory")));
  return { id: "cash", title, period, sections, notes: [L.t("cash.formula"), L.t("cash.pendingNote"), stamp(L, now)], empty: false };
}

// Her belgenin ikinci satiri "Donem: ..." olur (secili donem / gorunum her cikti basinda yazar).
const withPeriod = (fn) => (L, args) => { const d = fn(L, args); return { ...d, period: `${L.t("pl.period")}: ${d.period}` }; };
export const buildTodayDoc = withPeriod(buildTodayDoc_);
export const buildCalendarDoc = withPeriod(buildCalendarDoc_);
export const buildClientsDoc = withPeriod(buildClientsDoc_);
export const buildRemindersDoc = withPeriod(buildRemindersDoc_);
export const buildIncomeDoc = withPeriod(buildIncomeDoc_);
export const buildExpensesDoc = withPeriod(buildExpensesDoc_);
export const buildCashDoc = withPeriod(buildCashDoc_);
