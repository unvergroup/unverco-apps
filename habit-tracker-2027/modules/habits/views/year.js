// E4 Year: yil secici, aliskanlik secici, isi haritasi (telefonda 3 sutunlu ay bloklari, >=768 px'te 12 x 31), 5 duzey (renk + ic kare
// boyutu), istatistik kartlari, aliskanlik tablosu, "Print my year" (D1). Gun karesine / ay blogunda tiklama o ayin Month gorunumune gider.
import { h } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { daysInMonth, isoOf, weekday } from "../logic/dates.js";
import { dayScore, dayStatus, defaultYear, habitDays, heatLevel, yearRange, yearStats } from "../logic/calc.js";
import { durationText, habitSelect, iconBtn, ring, sectionH, textBtn, tile, topbar } from "./common.js";
import { myYearDoc } from "../print/docs.js";
import { docLabels } from "./doc-labels.js";
import { canvasMeasure } from "../../../core/canvas-doc.js";

const pad = (n) => String(n).padStart(2, "0");

/** Bir gunun haritadaki sinifi: "l0".."l4" (hepsi) ya da tek aliskanlikta l0 / l2 (partial) / l4 (done) / rest. */
export function levelsFor(habits, idx, year, sel) {
  const out = new Map();
  for (let m = 0; m < 12; m++) for (let d = 1; d <= daysInMonth(year, m); d++) {
    const iso = isoOf(year, m, d);
    if (sel) {
      const st = dayStatus(sel, habitDays(idx, sel).get(iso));
      out.set(iso, st === "done" ? 4 : st === "partial" ? 2 : st === "rest" ? "rest" : 0);
    } else out.set(iso, heatLevel(dayScore(habits, idx, iso).pct));
  }
  return out;
}

export async function mountYear(ctx, root, param) {
  const render = async () => {
    const { t, i18n } = ctx;
    const today = ctx.today();
    const { active, idx, prefs, habits, entries } = await ctx.data();
    const ws = prefs.weekStart;
    const range = yearRange(habits, entries, today);
    const year = Math.min(range.max, Math.max(range.min, param ? +param : defaultYear(today, prefs.viewYear)));
    if (ctx.yearHabit && !active.some((x) => x.id === ctx.yearHabit)) ctx.yearHabit = "";
    const sel = active.find((x) => x.id === ctx.yearHabit) ?? null;
    const list = sel ? [sel] : active;
    const st = yearStats(list, idx, year, today, ws);
    const levels = levelsFor(active, idx, year, sel);
    const cls = (iso) => { const l = levels.get(iso); return iso > today ? "fut" : l === "rest" ? "rest" : `l${l}`; };

    const prev = iconBtn("left", t("year.prev"), () => ctx.navigate(`year/${year - 1}`), { id: "y-prev" });
    const next = iconBtn("right", t("year.next"), () => ctx.navigate(`year/${year + 1}`), { id: "y-next" });
    prev.disabled = year <= range.min; next.disabled = year >= range.max;
    const head = topbar(t("year.eyebrow"), t("year.title", { year }), h("div", { class: "pager" }, prev, next));
    const toolbar = h("div", { class: "toolbar" },
      habitSelect(i18n, active, ctx.yearHabit, (v) => { ctx.yearHabit = v; render(); }, "y-habit"),
      textBtn("printer", t("year.print"), () => printYear(ctx, year, sel), { id: "y-print", cls: "push-right" }));

    const scorePct = st.score === null ? null : Math.round(st.score);
    const bestTxt = durationText(i18n, st.best.n, st.best.unit);
    const curTxt = durationText(i18n, st.current.n, st.current.unit);
    const num = (s, n) => [String(n), h("small", { text: ` ${s.replace(String(n), "").trim()}` })];
    // telefon ozeti
    const top = h("section", { class: "yr-top glass", "aria-label": t("year.summary") },
      h("div", { class: "ring-wrap ring-glow" }, ring(scorePct ?? 0, { cls: "ring-yr" }), h("div", { class: "ring-label" }, h("div", {}, h("div", { class: "yr-pct", text: i18n.pct(st.score) }), h("div", { class: "yr-lbl", text: t("stat.yearScore") })))),
      h("div", { class: "yr-mini" },
        h("div", {}, t("stat.best"), h("b", { text: bestTxt })), h("div", {}, t("stat.currentShort"), h("b", { text: curTxt })),
        h("div", {}, t("stat.comebacks"), h("b", { text: String(st.comebacks) })), h("div", {}, t("stat.rest"), h("b", { text: String(st.restDays) }))));
    // masaustu kartlari
    const stat = (id, ic, label, val) => h("div", { class: "stat glass", id }, h("div", { class: "lbl" }, icon(ic, { size: 16 }), label), h("div", { class: "val" }, ...[].concat(val)));
    const stats5 = h("div", { class: "stats5" },
      h("div", { class: "stat glass glass--gold", id: "ys-score" }, h("div", { class: "ring-wrap ring-glow" }, ring(scorePct ?? 0, { cls: "ring-stat" })), h("div", {}, h("div", { class: "lbl", text: t("stat.yearScore") }), h("div", { class: "val val-xl", text: i18n.pct(st.score) }))),
      stat("ys-best", "trophy", t("stat.best"), num(bestTxt, st.best.n)),
      stat("ys-current", "flame", t("stat.current"), num(curTxt, st.current.n)),
      stat("ys-comebacks", "comeback", t("stat.comebacks"), String(st.comebacks)),
      stat("ys-rest", "moon", t("stat.rest"), String(st.restDays)));

    // telefon: ay bloklari (dokununca Month)
    const blocks = h("div", { class: "months", id: "y-months" }, i18n.monthsShort.map((mn, m) => {
      const lead = (weekday(isoOf(year, m, 1)) - ws + 7) % 7;
      const cells = [];
      for (let i = 0; i < lead; i++) cells.push(h("div", { class: "cell blank" }));
      let dn = 0, dd = 0;
      for (let d = 1; d <= daysInMonth(year, m); d++) {
        const iso = isoOf(year, m, d);
        cells.push(h("div", { class: `cell ${cls(iso)}${iso === today ? " today" : ""}` }));
        if (iso <= today) { const s = sel ? null : dayScore(active, idx, iso); if (s && s.total) { dn += s.done; dd += s.total; } }
      }
      const pct = !sel && dd ? i18n.pct((dn * 100) / dd) : "–";
      return h("button", { type: "button", class: "mblock glass", id: `mb-${m + 1}`, "aria-label": t("year.monthCell", { month: i18n.monthsLong[m], year, pct }), on: { click: () => ctx.navigate(`month/${year}-${pad(m + 1)}`) } },
        h("div", { class: "mh", "aria-hidden": "true" }, mn, h("span", { text: pct })), h("div", { class: "mgrid", "aria-hidden": "true" }, cells));
    }));

    // >=768 px: 12 x 31 (gun kareleri dokunma istisnasi; tiklama o ayin Month gorunumune gider, klavye ay etiketini kullanir)
    const rows = [h("div", { class: "hrow hd", "aria-hidden": "true" }, h("div"), Array.from({ length: 31 }, (_, i) => h("div", { text: i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : "" })))];
    for (let m = 0; m < 12; m++) {
      const r = [h("a", { class: "ml", id: `hm-${m + 1}`, href: `#/month/${year}-${pad(m + 1)}`, "aria-label": `${i18n.monthsLong[m]} ${year}`, text: i18n.monthsShort[m] })];
      for (let d = 1; d <= 31; d++) {
        if (d > daysInMonth(year, m)) { r.push(h("div", { class: "cell na", "aria-hidden": "true" })); continue; }
        const iso = isoOf(year, m, d);
        r.push(h("div", { class: `cell ${cls(iso)}${iso === today ? " today" : ""}`, "data-date": iso, title: i18n.formatDate(iso) }));
      }
      rows.push(h("div", { class: "hrow" }, r));
    }
    const heat = h("section", { class: "heat glass", id: "heat", "aria-label": t("year.heat", { year }) }, rows);
    heat.addEventListener("click", (e) => { const c = e.target.closest(".cell[data-date]"); if (c) ctx.navigate(`month/${c.dataset.date.slice(0, 7)}`); });
    const legend = () => h("div", { class: "heat-legend" }, t("year.less"), [0, 1, 2, 3, 4].map((l) => h("span", { class: `cell l${l}` })), t("year.more"), h("span", { class: "cell na lg-gap" }), t("year.noDay"));

    const table = h("table", { class: "yr-table", id: "y-table" },
      h("thead", {}, h("tr", {}, [t("year.colHabit"), t("year.colRate"), t("year.colBest"), t("year.colComebacks")].map((x) => h("th", { scope: "col", text: x })))),
      h("tbody", {}, st.rows.map((r) => h("tr", {},
        h("td", {}, h("div", { class: "nmcell" }, tile(r.habit, "tile--xs"), h("span", { text: r.habit.name }))),
        h("td", { class: "num", "data-label": t("year.colRate"), text: i18n.pct(r.rate) }),
        h("td", { class: "num", "data-label": t("year.colBest"), text: durationText(i18n, r.best, r.unit) }),
        h("td", { class: "num", "data-label": t("year.colComebacks"), text: String(r.comebacks) })))));
    heat.append(legend());
    root.replaceChildren(head, toolbar, top, stats5,
      h("div", { class: "phone-year" }, sectionH(t("year.every", { year }), t("year.tapMonth")), blocks, legend()),
      h("div", { class: "year-desk" }, heat),
      h("section", { class: "glass yr-table-wrap", "aria-label": t("year.tableHint") }, table));
  };
  await render();
  ctx.onExternalChange(render);
  return null;
}

export async function printYear(ctx, year, sel) {
  const { t, i18n } = ctx;
  const { active, idx, prefs } = await ctx.data();
  const today = ctx.today();
  const list = sel ? [sel] : active;
  const st = yearStats(list, idx, year, today, prefs.weekStart);
  const lv = levelsFor(active, idx, year, sel);
  const levels = new Map([...lv].map(([k, v]) => [k, v === "rest" ? 1 : v]));
  const data = {
    year, today, levels, subtitle: sel ? sel.name : t("doc.allHabits"),
    stats: [[t("stat.yearScore"), i18n.pct(st.score)], [t("stat.best"), durationText(i18n, st.best.n, st.best.unit)], [t("stat.current"), durationText(i18n, st.current.n, st.current.unit)], [t("stat.comebacks"), String(st.comebacks)], [t("stat.rest"), String(st.restDays)]],
    rows: st.rows.map((r) => [r.habit.name, i18n.pct(r.rate), durationText(i18n, r.best, r.unit), String(r.comebacks)]),
  };
  const L = docLabels(ctx, year);
  await ctx.print({ filename: `year-${year}`, title: L.myYearTitle, build: (paper, logo) => myYearDoc(data, { ...L, logo }, canvasMeasure(), paper) });
}
