// E1 Welcome (ilk kurulum): 10 sablon cipi (3'u hazir secili), "Add my own", hafta baslangici, iPhone ana ekran uyarisi,
// "Start with N habits" (tek dokunus -> Today), "Load sample year", dil secici, altta kucuk UNVERCO logosu.
import { h } from "../../../core/ui.js";
import { icon } from "../../../core/icons.js";
import { DEFAULT_PICKS, TEMPLATES, templateHabit } from "../logic/schema.js";
import { loadSample, restoreNow } from "./data-actions.js";
import { openHabitEditor } from "./habit-editor.js";

let picks = null; // dil degisiminde secim korunur (ekran yeniden cizilir)
let weekStart = null;

export async function mountWelcome(ctx, root) {
  const { t, i18n } = ctx;
  const prefs = await ctx.repo.getPrefs();
  if (!picks) picks = new Set(DEFAULT_PICKS);
  if (weekStart === null) weekStart = prefs.weekStart;

  const count = h("p", { class: "hint", id: "w-count" });
  const start = h("button", { type: "button", class: "btn btn--gold btn--xl", id: "w-start" });
  const paint = () => {
    count.textContent = i18n.tn("welcome.selected", picks.size);
    start.textContent = picks.size ? i18n.tn("welcome.start", picks.size) : t("welcome.pickOne");
    start.disabled = picks.size === 0;
  };
  const chips = h("div", { class: "chips", role: "group", "aria-labelledby": "w-choose" }, TEMPLATES.map((tp) => {
    const b = h("button", { type: "button", class: "chip", id: `tpl-${tp.id}`, "aria-pressed": picks.has(tp.id) ? "true" : "false" });
    const face = () => b.replaceChildren(icon(picks.has(tp.id) ? "check" : tp.icon, { size: 18 }), h("span", { text: t(tp.nameKey) }));
    face();
    b.addEventListener("click", () => {
      if (picks.has(tp.id)) picks.delete(tp.id); else picks.add(tp.id);
      b.setAttribute("aria-pressed", picks.has(tp.id) ? "true" : "false");
      face(); paint();
    });
    return b;
  }));
  const seg = h("div", { class: "seg", role: "group", "aria-label": t("welcome.weekStart") }, [1, 0].map((d) => {
    const b = h("button", { type: "button", id: `w-week-${d}`, "aria-pressed": weekStart === d ? "true" : "false", text: i18n.weekdayLong[d] });
    b.addEventListener("click", () => { weekStart = d; for (const x of seg.children) x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    return b;
  }));
  const finish = async () => {
    const list = TEMPLATES.filter((x) => picks.has(x.id)).map((x) => templateHabit(x, t));
    if (list.length) await ctx.repo.addHabits(list, ctx.today());
    await ctx.repo.savePrefs({ onboarded: true, weekStart });
    picks = null; weekStart = null;
  };
  start.addEventListener("click", async () => {
    start.disabled = true;
    try { await finish(); ctx.navigate("today"); } catch (e) { ctx.fail(e); start.disabled = false; }
  });
  const own = h("button", { type: "button", class: "linkbtn", id: "w-own" }, icon("plus", { size: 18 }), h("span", { text: t("welcome.addOwn") }));
  own.addEventListener("click", async () => {
    try { await finish(); ctx.navigate("habits"); setTimeout(() => openHabitEditor(ctx, null, () => ctx.refresh()), 50); } catch (e) { ctx.fail(e); }
  });
  const sample = h("button", { type: "button", class: "linkbtn", id: "w-sample", text: t("welcome.sample") });
  sample.addEventListener("click", async () => {
    sample.disabled = true;
    try { await loadSample(ctx, weekStart); picks = null; weekStart = null; ctx.navigate("today"); } catch (e) { ctx.fail(e); sample.disabled = false; }
  });
  const restore = h("button", { type: "button", class: "linkbtn", id: "w-restore", text: t("welcome.restore") });
  restore.addEventListener("click", async () => { if (await restoreNow(ctx)) { picks = null; weekStart = null; } });
  const lang = h("select", { id: "w-lang", class: "select-native", "aria-label": t("set.language") }, ctx.langOptions().map((o) => h("option", { value: o.value, text: o.label })));
  lang.value = ctx.settings.lang;
  lang.addEventListener("change", () => ctx.setSettings({ lang: lang.value }));
  const ios = ctx.isIos() && !ctx.standalone()
    ? h("div", { class: "ios", id: "w-ios" }, icon("share", { size: 22 }), h("div", {}, h("b", { text: t("welcome.iosLead") }), " ", t("welcome.ios")))
    : null;
  paint();
  root.replaceChildren(h("div", { class: "welcome" },
    h("div", { class: "w-hero" },
      h("div", { class: "w-lang" }, icon("globe", { size: 18 }), h("label", { class: "select" }, lang, icon("down", { size: 16 }))),
      ctx.appIcon("w-icon", t("app.name")),
      h("h1", { id: "screen-title", text: t("welcome.title") }),
      h("p", { text: t("welcome.lead") }),
      h("div", { class: "w-steps" }, [1, 2, 3].map((n) => h("div", {}, h("b", { text: String(n) }), t(`welcome.step${n}`))))),
    h("div", { class: "w-main" },
      h("section", { class: "w-card glass", "aria-labelledby": "w-choose" },
        h("h2", { id: "w-choose", text: t("welcome.choose") }), count, chips, own,
        h("div", { class: "seg-row" }, h("span", { class: "seg-label", text: t("welcome.weekStart") }), seg),
        ios),
      h("div", { class: "w-dock glass glass--strong" }, start, h("div", { class: "w-dock-row" }, sample, restore))),
    h("div", { class: "w-brand" }, ctx.logo("w-logo"))));
  return null;
}
