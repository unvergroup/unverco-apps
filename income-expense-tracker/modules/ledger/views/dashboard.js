// Pano: bu ay / bu yil gelir, gider, net; kategori dagilimi (basit cubuk); aylik tablo; hizli ekle; ornek veri.
// Yalniz isletme kayitlari kara girer; kisisel kayitlar ayri satirda gosterilir.
import { todayIso } from "../../../core/dates.js";
import { guardWrite } from "../../../core/safe.js";
import { button, emptyState, h } from "../../../core/ui.js";
import { byCategory, monthRange, monthlyTable, totals, yearRange, yearsOf } from "../logic/calc.js";
import { buildSample } from "../logic/sample.js";
import { bar, disclaimer, labels, loadData, selectField, fill } from "./common.js";
import { openEntryForm } from "./entries.js";

let chosenYear = null;

export async function mountDashboard(ctx, root) {
  const { t, formatNumber, formatPercent } = ctx.i18n;
  const fmt = ctx.money.format;
  const guard = guardWrite((e) => ctx.fail(e));

  const draw = async (focusSel) => {
    const data = await loadData(ctx);
    const today = todayIso();
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    const years = yearsOf([data.entries], y);
    const year = years.includes(chosenYear) ? chosenYear : y;
    const L = labels(ctx, data);
    const tm = totals(data.entries, monthRange(y, m));
    const ty = totals(data.entries, yearRange(year));

    const card = (id, title, tot) => h("section", { class: "card kpi-card", id, "aria-label": title },
      h("h3", { class: "kpi-title", text: title }),
      h("dl", { class: "kpi" },
        h("div", { class: "kpi-row" }, h("dt", { text: t("dash.income") }), h("dd", { class: "is-income", "data-k": "income", text: fmt(tot.incomeMinor) })),
        h("div", { class: "kpi-row" }, h("dt", { text: t("dash.expenses") }), h("dd", { class: "is-expense", "data-k": "expense", text: fmt(tot.expenseMinor) })),
        h("div", { class: "kpi-row kpi-net" }, h("dt", { text: t("dash.net") }), h("dd", { class: tot.netMinor < 0 ? "is-expense" : "is-net", "data-k": "net", text: fmt(tot.netMinor) }))),
      tot.personalIncomeMinor || tot.personalExpenseMinor ? h("p", { class: "muted kpi-personal", text: t("dash.personal", { income: fmt(tot.personalIncomeMinor), expense: fmt(tot.personalExpenseMinor) }) }) : null);

    const bars = (type, id) => {
      const rows = byCategory(data.entries, type, yearRange(year)).slice(0, 8);
      return h("section", { class: "card stack", id, "aria-label": t(`dash.byCat.${type}`, { year }) },
        h("h3", { text: t(`dash.byCat.${type}`, { year }) }),
        rows.length ? h("ul", { class: "bars" }, ...rows.map((r) => h("li", { class: "bar-row" },
          h("span", { class: "bar-label", text: L.category(r.categoryId) }),
          bar(r.share * 100, type === "income" ? "is-income" : ""),
          h("span", { class: "bar-value", text: `${fmt(r.totalMinor)} · ${formatPercent(Math.round(r.share * 1000) / 10)}` }))))
          : h("p", { class: "muted", text: t("dash.noData") }));
    };

    const months = monthlyTable(data.entries, year);
    // Dar ekranda da tablo kalir (kart listesine donmez): 4 kisa sutun, sayilar saga yasli.
    const th = (text, cls = "") => h("th", { scope: "col", class: cls || undefined, text });
    const monthTable = h("div", { class: "mini-wrap" }, h("table", { class: "mini-table", id: "dash-months" },
      h("caption", { text: t("dash.monthly", { year }) }),
      h("thead", {}, h("tr", {}, th(t("report.month")), th(t("dash.income"), "num"), th(t("dash.expenses"), "num"), th(t("dash.net"), "num"))),
      // mt-*: 400 px altinda satir iki satirlik karta doner (ay + net ustte; gelir, gider altta data-label ile) - app.css.
      h("tbody", {}, ...months.map((r) => h("tr", { class: r.count ? undefined : "is-zero" },
        h("th", { scope: "row", class: "mt-month", text: L.monthName(r.month) }),
        h("td", { class: "num mt-inc", "data-label": t("dash.income"), text: fmt(r.incomeMinor) }), h("td", { class: "num mt-exp", "data-label": t("dash.expenses"), text: fmt(r.expenseMinor) }),
        h("td", { class: `num mt-net${r.netMinor < 0 ? " is-expense" : ""}`, text: fmt(r.netMinor) })))),
      h("tfoot", {}, h("tr", {}, h("th", { scope: "row", class: "mt-month", text: t("report.yearTotal") }), h("td", { class: "num mt-inc", "data-label": t("dash.income"), text: fmt(ty.incomeMinor) }),
        h("td", { class: "num mt-exp", "data-label": t("dash.expenses"), text: fmt(ty.expenseMinor) }), h("td", { class: "num mt-net", text: fmt(ty.netMinor) })))));

    const yearSel = selectField({ id: "dash-year", label: t("dash.year"), value: String(year), options: years.map((v) => ({ value: String(v), label: String(v) })), onChange: (v) => { chosenYear = Number(v); draw("#dash-year"); } });

    const sample = guard(async () => {
      const s = buildSample(today, t, data.business.id);
      await ctx.store.transactMany(["entries", "trips"], (tx) => {
        for (const e of s.entries) tx.add("entries", e);
        for (const tr of s.trips) tx.add("trips", tr);
      });
      // Isletme adi hic degistirilmemisse (varsayilan "My business") ornek isletmenin uydurma adi verilir; ornek veri kalkinca geri alinir.
      if (data.business.name === t("biz.defaultName")) await ctx.business.update(data.business.id, { name: t("sample.businessName"), line1: t("sample.businessLine"), line2: "" });
      ctx.notify(t("sample.loaded", { n: formatNumber(s.entries.length) }), "success");
      await draw("#dash-kpi-month");
    });
    const hasSample = data.entries.some((e) => e.source === "sample") || data.trips.some((tr) => tr.source === "sample");
    const removeSample = guard(async () => {
      if (!(await ctx.confirm({ title: t("sample.removeTitle"), message: t("sample.removeText") }))) return;
      await ctx.store.transactMany(["entries", "trips"], (tx) => {
        for (const e of tx.list("entries").filter((x) => x.source === "sample" && x.businessId === data.business.id)) tx.remove("entries", e.id);
        for (const tr of tx.list("trips").filter((x) => x.source === "sample" && x.businessId === data.business.id)) tx.remove("trips", tr.id);
      });
      if (data.business.name === t("sample.businessName")) await ctx.business.update(data.business.id, { name: t("biz.defaultName"), line1: "", line2: "" });
      ctx.notify(t("sample.removed"), "success");
      await draw();
    });

    fill(root, 
      h("div", { class: "screen-head" }, h("h2", { text: t("dash.title") }), h("p", { class: "muted biz-chip", id: "dash-biz", text: data.business.name })),
      h("div", { class: "row action-row" },
        button({ id: "dash-add-income", label: t("entry.addIncome"), variant: "primary", glyph: "plus", onClick: async () => { if (await openEntryForm(ctx, { type: "income" })) await draw("#dash-add-income"); } }),
        button({ id: "dash-add-expense", label: t("entry.addExpense"), variant: "primary", glyph: "plus", onClick: async () => { if (await openEntryForm(ctx, { type: "expense" })) await draw("#dash-add-expense"); } })),
      data.entries.length ? null : h("section", { class: "card stack", id: "dash-empty" },
        emptyState({ title: t("dash.emptyTitle"), text: t("dash.emptyText") }),
        h("div", { class: "row" }, button({ id: "sample-load", label: t("sample.load"), onClick: sample })),
        h("p", { class: "muted", text: t("sample.hint") })),
      h("div", { class: "kpi-grid" },
        card("dash-kpi-month", t("dash.thisMonth", { month: `${L.monthName(m)} ${y}` }), tm),
        card("dash-kpi-year", t("dash.thisYear", { year }), ty)),
      h("div", { class: "row year-row" }, yearSel.element),
      h("div", { class: "kpi-grid" }, bars("expense", "dash-cat-expense"), bars("income", "dash-cat-income")),
      h("section", { class: "stack" }, monthTable),
      hasSample ? h("div", { class: "row" }, button({ id: "sample-remove", label: t("sample.remove"), onClick: removeSample })) : null,
      disclaimer(ctx, "dash-disclaimer"));
    if (focusSel) root.querySelector(focusSel)?.focus();
  };
  await draw();
  ctx.onExternalChange(() => draw());
}
