// Plan ekrani (#/plan): cocuk secici ("Hepsi" dahil), hafta ileri / geri, haftalik izgara (gun -> haftalik dersler + loop sirasi),
// loop listesi (sira yukari / asagi, "next" isareti, gunluk loop sayisi), "Print weekly plan" (secili cocuk ya da hepsi).
import { addDays, startOfWeek, todayIso } from "../../../core/dates.js";
import { button, h } from "../../../core/ui.js";
import { loopSubjects, nextLoopId, weekPlan } from "../logic/calc.js";
import { printWeek } from "../print/screens.js";
import { colorIndex, dur, kidDot, kidPicker, loadAll, noKids, fill } from "./common.js";
import { icon as iconSvg } from "../../../core/icons.js";

export async function mountPlan(ctx, root, param) {
  const { t, formatDate } = ctx.i18n;
  const today = todayIso();
  let { data, prefs } = await loadAll(ctx);
  let sel = data.students.some((s) => s.id === param) ? param : "";
  let monday = startOfWeek(today, 0);
  let busy = false;
  const reload = async () => { ({ data, prefs } = await loadAll(ctx)); paint(); };
  ctx.onExternalChange(reload);

  // Loop sirasi: iki dersin loopOrder degerini TEK atomik yazmada degistirir (sira 0..n-1 olarak yeniden numaralanir).
  const move = (kid, id, dir) => async () => {
    if (busy) return;
    busy = true;
    try {
      const ids = loopSubjects(data, kid.id).map((s) => s.id);
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await ctx.store.transactMany(["subjects"], (tx) => { ids.forEach((sid, n) => tx.update("subjects", sid, { loopOrder: n })); });
      await reload();
      document.getElementById(`loop-${dir < 0 ? "up" : "down"}-${id}`)?.focus();
    } catch (e) { ctx.fail(e); } finally { busy = false; }
  };

  // Gun sutunlari (masaustunde yan yana, telefonda alt alta); sutun sayisi CSS degiskeni --n (CSSOM, CSP'ye uygun).
  function weekGrid(kid, days) {
    const grid = h("div", { class: "week-grid", id: `week-${kid.id}` }, ...days.map((d) => h("div", { class: `week-day${d.date === today ? " is-today" : ""}`, "data-date": d.date },
      h("h4", { text: formatDate(d.date, { weekday: "short", day: "numeric" }) }),
      h("ul", {}, ...d.weekly.map((s) => h("li", { text: s.name })), ...d.loop.map((s) => h("li", { class: "is-loop" }, h("span", { text: s.name }), h("span", { class: "loop-ico", role: "img", "aria-label": t("hs.plan.loopTag"), title: t("hs.plan.loopTag") }, iconSvg("repeat", { size: 14 }))))),
      !d.weekly.length && !d.loop.length ? h("p", { class: "muted", text: "—" }) : null)));
    grid.style.setProperty("--n", String(Math.min(7, days.length)));
    return grid;
  }

  function kidWeek(kid) {
    const days = weekPlan(data, kid, monday, prefs).filter((d) => d.school || d.weekly.length);
    const loop = loopSubjects(data, kid.id);
    const next = nextLoopId(data, kid, today);
    return h("section", { class: `card kid-card kid-c${colorIndex(kid.color)}`, "data-kid": kid.id },
      h("div", { class: "kid-head" }, h("h3", {}, h("span", { class: "kid-name" }, kidDot(kid), h("span", { text: kid.name })), kid.grade ? h("span", { class: "muted kid-grade", text: kid.grade }) : null),
        h("a", { class: "btn btn-ghost", href: `#/kids/${encodeURIComponent(kid.id)}`, id: `plan-edit-${kid.id}` }, iconSvg("pencil", { size: 18, sw: 2 }), h("span", { text: t("hs.plan.editSubjects") }))),
      days.length
        ? weekGrid(kid, days)
        : h("p", { class: "muted pad", text: t("hs.plan.noSchoolDays") }),
      h("div", { class: "loop-head" }, h("h4", { text: t("hs.plan.loopOrder") }),
        h("p", { class: "muted", text: loop.length ? t("hs.plan.loopHint", { n: kid.loopPerDay }) : t("hs.plan.loopEmpty") })),
      loop.length ? h("ol", { class: "loop-list", id: `loop-${kid.id}` }, ...loop.map((s, i) => h("li", { "data-subject": s.id, class: s.id === next ? "is-next" : undefined },
        h("span", { class: "loop-name" }, h("span", { text: s.name }), s.id === next ? h("span", { class: "tag tag-next", text: t("hs.plan.next") }) : null, h("span", { class: "muted", text: dur(ctx, s.minutes) })),
        h("span", { class: "loop-move" },
          button({ id: `loop-up-${s.id}`, glyph: "up", ariaLabel: t("hs.plan.moveUp", { name: s.name }), disabled: i === 0, onClick: move(kid, s.id, -1) }),
          button({ id: `loop-down-${s.id}`, glyph: "down", ariaLabel: t("hs.plan.moveDown", { name: s.name }), disabled: i === loop.length - 1, onClick: move(kid, s.id, 1) }))))) : null);
  }

  function paint() {
    const head = h("div", { class: "page-head" }, h("div", {}, h("h2", { text: t("hs.nav.plan") }),
      h("p", { class: "page-date", id: "plan-week", text: t("hs.doc.week.period", { from: formatDate(monday, { month: "short", day: "numeric" }), to: formatDate(addDays(monday, 6), { month: "short", day: "numeric", year: "numeric" }) }) })));
    if (!data.students.length) { fill(root, head, noKids(ctx)); return; }
    const kids = sel ? data.students.filter((s) => s.id === sel) : data.students;
    fill(root, head,
      kidPicker(ctx, { students: data.students, selected: sel, allLabel: t("hs.allKids"), onPick: (id) => { sel = id; paint(); } }),
      h("div", { class: "row toolbar" },
        button({ id: "plan-prev", icon: "prev", label: "", ariaLabel: t("hs.plan.prevWeek"), onClick: () => { monday = addDays(monday, -7); paint(); } }),
        button({ id: "plan-this", label: t("hs.plan.thisWeek"), onClick: () => { monday = startOfWeek(today, 0); paint(); } }),
        button({ id: "plan-next", icon: "next", label: "", ariaLabel: t("hs.plan.nextWeek"), onClick: () => { monday = addDays(monday, 7); paint(); } }),
        button({ id: "plan-print", label: t("hs.plan.print"), glyph: "print", variant: "primary", exportAction: true, onClick: () => printWeek(ctx, { data, prefs, students: kids, monday }) })),
      ...kids.map(kidWeek));
  }
  paint();
}
