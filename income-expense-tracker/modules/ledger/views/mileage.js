// Kilometre (mil) kaydi: yolculuk ekle / duzenle / sil (tarih, amac, mesafe, not), yil toplami, kullanicinin girdigi oranla tutar.
// Oran yalniz KULLANICIDAN gelir; uygulama oran onermez ve oran olmadan tutar gostermez.
import { todayIso } from "../../../core/dates.js";
import { downloadText } from "../../../core/files.js";
import { guardWrite } from "../../../core/safe.js";
import { button, emptyState, field, h } from "../../../core/ui.js";
import { yearsOf, yearRange } from "../logic/calc.js";
import { tripsCsv } from "../logic/csv.js";
import { mileageSummary, milesText, parseMiles, parseRate, rateText, tripAmount } from "../logic/mileage.js";
import { RECORD_LIMITS, TEXT_LIMITS, cleanRecord, validateTrip } from "../logic/schema.js";
import { disclaimer, errText, loadData, openForm, selectField, withId, fill } from "./common.js";

let chosenYear = null;

export async function openTripForm(ctx, { trip = null, unit = "mi" } = {}) {
  const { t } = ctx.i18n;
  const data = await loadData(ctx);
  const u = t(`unit.${unit}`);
  const date = withId(field({ label: t("entry.date"), type: "date", value: trip?.date ?? todayIso(), required: true }), "trip-date");
  const purpose = withId(field({ label: t("trip.purpose"), value: trip?.purpose ?? "", maxlength: TEXT_LIMITS.purpose, required: true, hint: t("trip.purposeHint") }), "trip-purpose");
  const purposes = h("datalist", { id: "trip-purpose-list" }, ...[...new Set(data.trips.map((x) => x.purpose))].slice(0, 100).map((p) => h("option", { value: p })));
  purpose.input.setAttribute("list", "trip-purpose-list");
  const miles = withId(field({ label: t("trip.distanceUnit", { unit: u }), value: trip ? milesText(trip.miles10) : "", inputmode: "decimal", autocomplete: "off", required: true }), "trip-miles");
  const note = withId(field({ label: t("entry.note"), value: trip?.note ?? "", maxlength: TEXT_LIMITS.note, hint: t("trip.noteHint") }), "trip-note");
  const remove = (close) => button({ id: "trip-delete", label: t("common.delete"), variant: "danger", onClick: async () => {
    if (!(await ctx.confirm({ title: t("trip.deleteTitle"), message: t("trip.deleteText") }))) return;
    try { await ctx.store.remove("trips", trip.id); ctx.notify(t("trip.deleted"), "success"); close(); } catch (e) { ctx.fail(e); }
  } });
  return openForm(ctx, {
    title: trip ? t("trip.edit") : t("trip.add"),
    groups: [{ legend: "", nodes: [date.element, purpose.element, purposes, miles.element, note.element] }],
    extraActions: trip ? [remove] : [],
    onSave: async () => {
      for (const f of [date, purpose, miles, note]) f.setError("");
      const rec = { businessId: trip?.businessId ?? data.business.id, date: date.input.value, purpose: purpose.input.value, miles10: parseMiles(miles.input.value), note: note.input.value, source: trip?.source ?? "" };
      const v = validateTrip(rec);
      if (v.errors.date) date.setError(t("msg.required"));
      if (v.errors.purpose) purpose.setError(errText(ctx, v.errors.purpose, TEXT_LIMITS.purpose));
      if (v.errors.miles10) miles.setError(miles.input.value.trim() ? t("trip.milesInvalid") : t("msg.required"));
      if (v.errors.note) note.setError(errText(ctx, v.errors.note, TEXT_LIMITS.note));
      if (!v.valid) return false;
      const clean = cleanRecord("trips", rec, { keepMeta: false }).record;
      if (trip) await ctx.store.update("trips", trip.id, clean);
      else await ctx.store.add("trips", clean, { check: (n) => { if (n >= RECORD_LIMITS.trips) throw Object.assign(new Error("limit"), { code: "limit_reached" }); } });
      ctx.notify(t(trip ? "msg.saved" : "msg.created"), "success");
      return true;
    },
  });
}

export async function mountMileage(ctx, root) {
  const { t, formatDate, formatNumber } = ctx.i18n;
  const fmt = ctx.money.format;
  const guard = guardWrite((e) => ctx.fail(e));

  const draw = async (focusSel) => {
    const data = await loadData(ctx);
    const y = Number(todayIso().slice(0, 4));
    const years = yearsOf([data.trips], y);
    const year = years.includes(chosenYear) ? chosenYear : y;
    const unit = data.ledger.distanceUnit;
    const u = t(`unit.${unit}`);
    const rate = data.ledger.rateMilli;
    const s = mileageSummary(data.trips, yearRange(year), rate, ctx.i18n.digits);
    const rows = [...s.rows].reverse();

    const rateField = withId(field({ label: t("trip.rateLabel", { unit: u, currency: ctx.i18n.currency }), value: rate === null ? "" : rateText(rate), inputmode: "decimal", autocomplete: "off", hint: t("trip.rateHint") }), "mileage-rate");
    const rateForm = h("form", { class: "card stack", id: "mileage-rate-form", novalidate: true },
      h("h3", { text: t("trip.rate") }), rateField.element,
      h("div", { class: "row" }, button({ label: t("common.save"), type: "submit" })));
    rateForm.addEventListener("submit", guard(async () => {
      const r = parseRate(rateField.input.value);
      if (Number.isNaN(r)) { rateField.setError(t("trip.rateInvalid")); rateField.input.focus(); return; }
      rateField.setError("");
      await ctx.ledger.save({ rateMilli: r });
      ctx.notify(t("msg.saved"), "success");
      await draw("#mileage-rate");
    }));

    const yearSel = selectField({ id: "mileage-year", label: t("dash.year"), value: String(year), options: years.map((v) => ({ value: String(v), label: String(v) })), onChange: (v) => { chosenYear = Number(v); draw("#mileage-year"); } });
    const csv = () => {
      if (!rows.length) { ctx.notify(t("csv.empty"), "warn"); return; }
      const text = tripsCsv(s.rows, {
        headers: { date: t("entry.date"), purpose: t("trip.purpose"), miles: t("trip.distanceUnit", { unit: u }), note: t("entry.note"), amount: t("trip.amountCol", { currency: ctx.i18n.currency }) },
        delimiter: ctx.i18n.csv.delimiter,
        milesText: (m) => (ctx.i18n.csv.decimal === "," ? milesText(m).replace(".", ",") : milesText(m)),
        amountText: (tr) => { const a = tripAmount(tr.miles10, rate, ctx.i18n.digits); if (a === null) return ""; const d = ctx.i18n.digits; const v = d ? `${Math.floor(a / 10 ** d)}.${String(a % 10 ** d).padStart(d, "0")}` : String(a); return ctx.i18n.csv.decimal === "," ? v.replace(".", ",") : v; },
      });
      if (downloadText(`${ctx.config.fileSlug}-mileage-${year}.csv`, text, "text/csv")) ctx.notify(t("csv.done"), "success");
    };

    fill(root, 
      h("div", { class: "screen-head" }, h("h2", { text: t("mileage.title") }), h("p", { class: "muted biz-chip", text: data.business.name })),
      h("div", { class: "row action-row" },
        button({ id: "trip-add", label: t("trip.add"), variant: "primary", glyph: "plus", onClick: async () => { if (await openTripForm(ctx, { unit })) await draw("#trip-add"); } }),
        button({ id: "mileage-print", label: t("report.printMileage"), glyph: "print", onClick: () => ctx.navigate("reports/mileage") }),
        button({ id: "mileage-csv", label: t("csv.export"), exportAction: true, onClick: csv })),
      h("div", { class: "row year-row" }, yearSel.element),
      h("dl", { class: "card sum-strip", id: "mileage-sum" },
        h("div", {}, h("dt", { text: t("trip.count") }), h("dd", { id: "mileage-count", text: formatNumber(s.trips) })),
        h("div", {}, h("dt", { text: t("trip.totalDistance") }), h("dd", { id: "mileage-total", text: `${formatNumber(s.miles10 / 10, { maximumFractionDigits: 1 })} ${u}` })),
        h("div", {}, h("dt", { text: t("trip.amount") }), h("dd", { id: "mileage-amount", text: s.amountMinor === null ? t("trip.noRateShort") : fmt(s.amountMinor) }))),
      rows.length ? h("ul", { class: "entry-list", id: "trip-list", "aria-label": t("report.trips") }, ...rows.map((tr) => h("li", { class: "entry-item" },
        h("button", { type: "button", class: "entry-btn", "data-trip": tr.id, on: { click: async () => { if (await openTripForm(ctx, { trip: tr, unit })) await draw(); } } },
          h("span", { class: "entry-main" }, h("span", { class: "entry-cat", text: tr.purpose }), h("span", { class: "entry-sub", text: [formatDate(tr.date), tr.note].filter(Boolean).join(" · ") })),
          h("span", { class: "entry-amt", text: `${formatNumber(tr.miles10 / 10, { maximumFractionDigits: 1 })} ${u}` })))))
        : emptyState({ title: t("mileage.empty"), text: t("mileage.emptyHint") }),
      rateForm,
      h("p", { class: "muted", text: t("trip.rateNote") }),
      disclaimer(ctx));
    if (focusSel) root.querySelector(focusSel)?.focus();
  };
  await draw();
  ctx.onExternalChange(() => draw());
}
