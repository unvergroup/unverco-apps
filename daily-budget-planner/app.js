// Uygulama kabugu: depo, dil, tema, yonlendirici (#/setup, #/today, #/bills, #/budget, #/activity, #/settings, #/print/<plan|blank>),
// kenar cubugu (masaustu) ve alt gezinme (telefon). Ekranlar ile sozlesme ctx nesnesidir. Hicbir veri cihaz disina gitmez.
import config from "./config.js";
import { createDefaultAdapter, createStore } from "./core/store.js";
import { createI18n, getMessages, loadMessages, matchLang, LANG_DEFAULTS } from "./core/i18n.js";
import { setMoneyCurrency } from "./core/money.js";
import { createSync } from "./core/sync.js";
import { initPwa } from "./core/pwa.js";
import { todayIso } from "./core/dates.js";
import { h, toast, confirmDialog, btn } from "./core/ui.js";
import { icon } from "./core/icons.js";
import { requestPrint } from "./core/print.js";
import { ensureSeed, loadState, savePrefs, relocalizeSample } from "./modules/budget/logic/actions.js";
import { dailyAmount, periodBills } from "./modules/budget/logic/engine.js";
import { payTimeline } from "./modules/budget/logic/schedule.js";
import { buildPlanModel } from "./modules/budget/print/plan.js";
import { envName } from "./modules/budget/views/common.js";
import { mountSetup } from "./modules/budget/views/setup.js";
import { mountToday } from "./modules/budget/views/today.js";
import { mountBills } from "./modules/budget/views/bills.js";
import { mountBudget } from "./modules/budget/views/budget.js";
import { mountActivity } from "./modules/budget/views/activity.js";
import { mountSettings } from "./modules/budget/views/settings.js";
import { mountPrint } from "./modules/budget/views/print.js";
import { openQuickAdd } from "./modules/budget/views/quickadd.js";

const NAV = [
  { id: "today", icon: "sun", key: "nav.today" },
  { id: "bills", icon: "receipt", key: "nav.bills" },
  { id: "budget", icon: "wallet", key: "nav.budget" },
  { id: "activity", icon: "activity", key: "nav.activity" },
  { id: "settings", icon: "settings", key: "nav.settings" },
];
const SCREENS = { setup: mountSetup, today: mountToday, bills: mountBills, budget: mountBudget, activity: mountActivity, settings: mountSettings, print: mountPrint };

function parseRoute(hash) {
  const [name, param] = String(hash || "").replace(/^#\/?/, "").split("/");
  return SCREENS[name] ? { name, param: param || "" } : { name: "today", param: "" };
}

async function main() {
  const adapter = await createDefaultAdapter(globalThis, config.storagePrefix);
  const sync = createSync({ name: config.storagePrefix });
  const locks = globalThis.navigator && globalThis.navigator.locks ? globalThis.navigator.locks : null;
  const store = createStore({ adapter, prefix: config.storagePrefix, schemaVersion: config.schemaVersion, locks, sync });
  await store.init();
  const lang0 = matchLang(globalThis.navigator && globalThis.navigator.language) || "en";
  await ensureSeed(store, { lang: lang0, locale: LANG_DEFAULTS[lang0].locale, currency: LANG_DEFAULTS[lang0].currency });

  const screen = document.getElementById("screen");
  const topbar = document.getElementById("topbar");
  const sidebar = document.getElementById("sidebar");
  const bottomnav = document.getElementById("bottomnav");
  const banners = document.getElementById("banners");
  let route = parseRoute(location.hash);
  let shown = 0;

  const ctx = {
    config, store, sync,
    // Orijinal ÜNVERCO logosu (ABD'ye donuk urun: ® isaretsiz takim). Koyu tema: altin; acik tema ve beyaz kagit: mavi.
    logoSrc: (on = document.documentElement.dataset.theme) => document.getElementById(on === "light" || on === "paper" ? "logo-blue" : "logo-gold").src,
    appIconSrc: () => document.getElementById("appicon-src").src,
    today: () => todayIso(new Date()),
    navigate: (to) => { if (location.hash === `#/${to}`) show(parseRoute(location.hash)); else location.hash = `#/${to}`; },
    refresh: () => show(route, { keepFocus: true }),
    notify: (msg, kind = "info", opts = {}) => toast(msg, { kind, closeLabel: ctx.i18n.t("common.close"), ...opts }),
    fail: (e) => {
      const k = `err.${e && e.code}`;
      if (ctx.i18n.t(k) === k) console.error(e); // beklenmeyen hata: yalniz yerel konsol; hicbir yere gonderilmez
      ctx.notify(ctx.i18n.t(k) !== k ? ctx.i18n.t(k) : ctx.i18n.t("err.generic"), "error");
    },
    confirm: ({ title, message, confirmLabel, danger = true }) => confirmDialog({ title, message, confirmLabel: confirmLabel ?? ctx.i18n.t("common.delete"), cancelLabel: ctx.i18n.t("common.cancel"), danger, closeLabel: ctx.i18n.t("common.close") }),
    setPrefs: async (patch) => {
      const langChanged = patch.lang && patch.lang !== ctx.prefs.lang;
      if (patch.lang) await loadMessages(patch.lang);
      if (langChanged) await relocalizeSample(store, getMessages(ctx.prefs.lang), getMessages(patch.lang)); // ornek veri yeni dilde
      await savePrefs(store, patch);
      await show(route, { keepFocus: !langChanged });
    },
    quickAdd: () => openQuickAdd(ctx),
    // Veri degistiren her islem: once tum verinin anlik goruntusu, sonra islem, sonra "Geri al"li bildirim (tek atomik geri yukleme).
    change: async (fn, message) => {
      const snap = await store.exportAll();
      const out = await fn();
      const msg = typeof message === "function" ? message(out) : message;
      document.getElementById("undo-last")?.closest(".toast")?.remove(); // yalniz SON degisiklik geri alinir (eski anlik goruntu yeni isi silmesin)
      ctx.notify(msg || ctx.i18n.t("done.saved"), "info", { timeout: 6000, action: { label: ctx.i18n.t("common.undo"), id: "undo-last", run: async () => {
        try { await store.importAll(snap); ctx.notify(ctx.i18n.t("common.undone")); await show(route, { keepFocus: true }); } catch (e) { ctx.fail(e); }
      } } });
      return out;
    },
    // Tek yazdirma kapisi: dokuman modeli kurulur, core/print.js cizer ve teslim eder.
    print: async (kind = "plan", paperOverride) => {
      try {
        const st = await loadState(store);
        const today = ctx.today();
        const res = st.payPlan ? dailyAmount(st, today) : null;
        const occ = st.payPlan ? periodBills(st, payTimeline(st.payPlan, st.transactions, today)).occurrences : [];
        const blank = kind === "blank" || !res;
        const model = buildPlanModel({ state: st, result: res, occurrences: occ, envelopes: st.envelopes, today, i18n: ctx.i18n, blank, envName: (e) => envName(ctx, e) });
        const paper = paperOverride || st.prefs.paper;
        const out = await requestPrint({ model, paper, title: model.title, filename: `${config.fileSlug}-${blank ? "blank" : "plan"}-${today}`, logoSrc: ctx.logoSrc("paper") });
        if (out === "downloaded") ctx.notify(ctx.i18n.t("print.downloaded"));
      } catch (e) {
        console.error(e);
        ctx.notify(ctx.i18n.t("print.error"), "error");
      }
    },
  };

  const brand = (cls = "") => h("div", { class: `brand ${cls}` },
    h("img", { class: "appicon", src: ctx.appIconSrc(), alt: "" }),
    h("div", {}, h("img", { src: ctx.logoSrc(), alt: "ÜNVERCO", class: "brandlogo" }), h("span", { text: ctx.i18n.t("app.product") })));

  const paintChrome = (st, res) => {
    const { t, formatDate, formatCurrency } = ctx.i18n;
    document.documentElement.lang = ctx.i18n.lang;
    document.title = `${t("app.name")}`;
    document.querySelector(".skip-link").textContent = t("nav.skip");
    const bare = route.name === "setup";
    document.body.classList.toggle("bare", bare);
    // Alt gezinme KISA etiket kullanir (320 px'te 5 dilde sigar); erisilebilir ad her zaman tam addir.
    const link = (n, extra = {}) => h("a", { href: `#/${n.id}`, id: `${extra.prefix || "nav"}-${n.id}`, "aria-current": route.name === n.id ? "page" : undefined, "aria-label": extra.prefix ? t(n.key) : undefined }, icon(n.icon), h("span", { text: extra.prefix ? t(`nav.short.${n.id}`) : t(n.key) }));
    const foot = st.payPlan && st.payPlan.setupDone && res
      ? h("div", { class: "foot" }, h("b", { text: t("side.nextPay", { date: formatDate(res.nextPay, { weekday: "short", month: "short", day: "numeric" }) }) }), t("side.expected", { freq: t(`freq.${st.payPlan.frequency}`), amount: formatCurrency(st.payPlan.amountMinor) }))
      : null;
    sidebar.setAttribute("aria-label", t("nav.main"));
    sidebar.replaceChildren(brand(), h("nav", { "aria-label": t("nav.main") }, NAV.map((n) => link(n))),
      btn({ label: t("today.addExpense"), cls: "primary add", icon: "plus", id: "side-add", onClick: () => ctx.quickAdd() }), foot);
    bottomnav.setAttribute("aria-label", t("nav.main"));
    const bn = [NAV[0], NAV[1], null, NAV[2], NAV[3]];
    bottomnav.replaceChildren(...bn.map((n) => (n ? link(n, { prefix: "bn", wrap: true }) : h("button", { type: "button", class: "fab", id: "fab-add", "aria-label": t("today.addExpense"), on: { click: () => ctx.quickAdd() } }, icon("plus")))));
  };

  /** Ekranin sag ust eylemleri (telefonda marka yaninda). */
  ctx.setActions = (...nodes) => topbar.replaceChildren(brand("top"), h("div", { class: "actions" }, ...nodes));

  const show = async (to, { keepFocus = false } = {}) => {
    const mine = ++shown;
    route = to;
    const st = await loadState(store);
    if (mine !== shown) return;
    const p = st.prefs;
    await loadMessages(p.lang);
    ctx.prefs = p;
    ctx.i18n = createI18n({ lang: p.lang, locale: p.locale, currency: p.currency });
    setMoneyCurrency(p.currency);
    const theme = p.theme === "system" ? (globalThis.matchMedia && globalThis.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : p.theme;
    document.documentElement.dataset.theme = theme;
    const ready = st.payPlan && st.payPlan.setupDone;
    if (!ready && to.name !== "setup" && to.name !== "settings") { route = { name: "setup", param: "" }; history.replaceState(null, "", "#/setup"); }
    const today = ctx.today();
    const res = ready ? dailyAmount(st, today) : null;
    const focusId = keepFocus && document.activeElement ? document.activeElement.id : "";
    paintChrome(st, res);
    ctx.setActions();
    banners.replaceChildren();
    const stage = h("div", { class: "stage" });
    try {
      await SCREENS[route.name](ctx, stage, { state: st, result: res, today, param: route.param, banners });
    } catch (e) {
      console.error(e);
      stage.replaceChildren(h("p", { class: "banner-card glass", role: "alert", text: ctx.i18n.t("err.load") }));
    }
    if (mine !== shown) return;
    screen.replaceChildren(stage);
    if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus({ preventScroll: true });
  };
  ctx.show = show;

  window.addEventListener("hashchange", async () => {
    const next = parseRoute(location.hash);
    await show(next); // bildirimler (Geri al dahil) ekran degisince de kalir; kendiliginden kapanir
    document.getElementById("main").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
  // Baska sekmede veri degisince acik ekran yenilenir (pencere aciksa dokunulmaz).
  sync.subscribe(() => { if (!document.querySelector("dialog[open]")) show(route, { keepFocus: true }); });
  try { globalThis.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (ctx.prefs && ctx.prefs.theme === "system") show(route, { keepFocus: true }); }); } catch { /* eski tarayici */ }

  await show(route);
  if (adapter.volatile) ctx.notify(ctx.i18n.t("storage.volatile"), "error");
  // Tek dosya paketi (paketleyici config'e "edition" ekler) servis calisani kaydetmez: yaninda sw.js yoktur, http'de de sessizce atlanir.
  if (!config.edition) initPwa({ onUpdate: () => ctx.notify(ctx.i18n.t("pwa.update"), "info", { timeout: 0, action: { label: ctx.i18n.t("pwa.refresh"), run: () => location.reload() } }) });
}

main().catch((e) => {
  console.error(e);
  const text = getMessages(document.documentElement.lang)["err.start"] ?? "Something went wrong while starting the app. Reload the page and try again.";
  document.getElementById("screen")?.replaceChildren(h("p", { class: "banner-card glass", role: "alert", text }));
});
