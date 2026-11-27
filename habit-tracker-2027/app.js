// 2027 Habit Tracker kabugu: depo, dil, tema, hash yonlendirme, kenar cubugu / alt sekme cubugu, gun degisimi denetimi, PWA bildirimleri.
// Kabuk ile ekranlar arasindaki sozlesme ctx nesnesidir. Dil degisince TUM kabuk (bantlar dahil) ve acik ekran yeniden cizilir.
import config from "./config.js";
import { createDefaultAdapter, createStore } from "./core/store.js";
import { LANGS, LANG_NAMES, createI18n, defaultWeekStart, getMessages, loadMessages, matchLang } from "./core/i18n.js";
import { createSync } from "./core/sync.js";
import { initPwa, isIos } from "./core/pwa.js";
import { errorKey } from "./core/safe.js";
import { parseRoute, keyOf } from "./core/route.js";
import { clearToasts, confirmDialog, h, toast } from "./core/ui.js";
import { icon } from "./core/icons.js";
import { requestPrint } from "./core/print.js";
import { createRepo } from "./modules/habits/logic/repo.js";
import { indexEntries } from "./modules/habits/logic/calc.js";
import { localIso } from "./modules/habits/logic/dates.js";
import { mountWelcome } from "./modules/habits/views/welcome.js";
import { mountToday } from "./modules/habits/views/today.js";
import { mountMonth } from "./modules/habits/views/month.js";
import { mountYear } from "./modules/habits/views/year.js";
import { mountHabits } from "./modules/habits/views/habits.js";
import { mountMore } from "./modules/habits/views/more.js";
import { backupStatus } from "./modules/habits/views/common.js";

const NAV = [
  { id: "today", icon: "today", key: "nav.today", mount: mountToday },
  { id: "month", icon: "cal", key: "nav.month", mount: mountMonth },
  { id: "year", icon: "grid", key: "nav.year", mount: mountYear },
  { id: "habits", icon: "list", key: "nav.habits", mount: mountHabits },
  { id: "more", icon: "more", key: "nav.more", mount: mountMore },
];
const SETTINGS_KEY = `${config.storagePrefix}:settings`;
const safeLs = () => { try { return globalThis.localStorage; } catch { return null; } };

function loadSettings(ls) {
  let s = {};
  try { s = JSON.parse(ls?.getItem(SETTINGS_KEY) ?? "{}") || {}; } catch { s = {}; }
  return {
    lang: LANGS.includes(s.lang) ? s.lang : matchLang(globalThis.navigator?.language) ?? "en",
    theme: ["system", "light", "dark"].includes(s.theme) ? s.theme : "system",
  };
}

async function main() {
  const ls = safeLs();
  const panel = document.getElementById("panel");
  const nav = document.getElementById("side-nav");
  const tabbar = document.getElementById("tabbar");
  let settings = loadSettings(ls);
  try { await loadMessages(settings.lang); } catch (e) { console.error(e); settings = { ...settings, lang: "en" }; await loadMessages("en"); }
  let i18n = createI18n({ lang: settings.lang });
  let route = parseRoute(location.hash);
  let unmount = null;
  let reload = null;
  let shown = 0;
  let volatile = false;
  let pwaBanner = null; // "update" | "install" | null: dil degisince ayni bant yeni dilde yeniden cizilir
  let today = localIso();

  const media = globalThis.matchMedia ? globalThis.matchMedia("(prefers-color-scheme: dark)") : null;
  const effectiveTheme = () => (settings.theme === "system" ? (media && !media.matches ? "light" : "dark") : settings.theme);
  const applyTheme = () => {
    const th = effectiveTheme();
    document.documentElement.dataset.theme = th;
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute("content", th === "dark" ? "#070A1F" : "#F3F1FB");
  };
  try { media?.addEventListener("change", () => { if (settings.theme === "system") applyTheme(); }); } catch { /* eski tarayici */ }

  const adapter = await createDefaultAdapter(globalThis, config.storagePrefix);
  volatile = adapter.volatile === true;
  const sync = createSync({ name: config.storagePrefix });
  const store = createStore({ adapter, prefix: config.storagePrefix, schemaVersion: config.schemaVersion, locks: globalThis.navigator?.locks ?? null, sync });
  try { await store.init(); } catch (e) {
    panel.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text: i18n.t(e && e.code === "newer_schema" ? "backup.err.newer_schema" : "error.storage") }));
    return;
  }
  const repo = createRepo(store, { weekStartDefault: defaultWeekStart() });

  const ctx = {
    config, repo, store,
    get i18n() { return i18n; },
    get t() { return i18n.t; },
    get settings() { return settings; },
    today: () => today,
    isIos: () => isIos(navigator.userAgent, navigator.maxTouchPoints),
    standalone: () => navigator.standalone === true || Boolean(globalThis.matchMedia && globalThis.matchMedia("(display-mode: standalone)").matches),
    async data() {
      const d = await repo.load();
      return { ...d, idx: indexEntries(d.entries), active: d.habits.filter((x) => !x.archived) };
    },
    navigate: (to) => { location.hash = `#/${to}`; },
    refresh: () => show(route),
    notify: (message, kind = "info", opts = {}) => toast(message, { kind, ...opts, closeLabel: i18n.t("common.close") }),
    fail: (err) => {
      if (err && (err.name === "BackupError" || err.name === "HabitError")) console.info(err.message); // beklenen kullanici durumu: hata degil
      else console.error(err); // yalniz yerel konsol; hicbir yere gonderilmez
      ctx.notify(i18n.t(errorKey(err)), "error");
    },
    // Her degisiklikten sonra Undo dugmeli bildirim (spec F07). after: geri alindiktan sonra ekrani yenileyen islev (yoksa acik ekran).
    undoToast: (message, after) => ctx.notify(message, "success", { ms: 6000, action: { id: "toast-undo", label: i18n.t("common.undo"), onClick: async () => {
      try { if (await repo.undo()) ctx.notify(i18n.t("toast.undone"), "success"); if (after) await after(); else await show(route); } catch (e) { ctx.fail(e); }
    } } }),
    confirm: async ({ title, message, confirmLabel, danger = true }) => (await confirmDialog({ title, message, confirmLabel: confirmLabel ?? i18n.t("common.delete"), cancelLabel: i18n.t("common.cancel"), danger })).confirmed,
    print: async ({ build, filename, title }) => {
      try {
        const prefs = await repo.getPrefs();
        await requestPrint({ build, paper: prefs.paper, filename: `${config.fileSlug}-${filename}`, title });
      } catch (e) { console.error(e); ctx.notify(i18n.t("print.error"), "error"); }
    },
    onExternalChange: (fn) => { reload = fn; },
    async setSettings(next) {
      const focusId = document.activeElement?.id;
      settings = { ...settings, ...next };
      try { ls?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* depo kapali: yalniz bu oturum */ }
      await loadMessages(settings.lang);
      i18n = createI18n({ lang: settings.lang });
      applyTheme();
      await show(route);
      if (focusId) document.getElementById(focusId)?.focus();
    },
    paintChrome: () => paintChrome(),
    langOptions: () => LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })),
  };

  // ---- kabuk ----
  const logoSrc = document.getElementById("brand-logo-src");
  const logoBlueSrc = document.getElementById("brand-logo-blue-src");
  const iconSrc = document.getElementById("app-icon-src");
  // Logo (orijinal, ®'siz takim; yalniz olceklenmis): koyu temada altin, acik temada mavi, dogrudan cam uzerinde (kutu yok).
  ctx.logo = (cls) => {
    const gold = h("img", { class: "logo-gold", alt: "ÜNVERCO" }); gold.src = logoSrc.src;
    const blue = h("img", { class: "logo-blue", alt: "ÜNVERCO" }); blue.src = logoBlueSrc.src;
    return h("span", { class: `brand-logo ${cls}` }, gold, blue);
  };
  ctx.appIcon = (cls, alt = "") => { const im = h("img", { class: cls, alt }); im.src = iconSrc.src; return im; };

  // Alt sekme cubugu kisa etiket kullanir (tab.*; dar ekranda Almanca / Fransizca kesilmesin); erisilebilir ad uzun etikettir.
  const navLink = (s, cls) => h("a", { class: cls, id: `${cls === "tab" ? "tab" : "nav"}-${s.id}`, href: `#/${s.id}`, "aria-current": route.name === s.id ? "page" : null, "aria-label": cls === "tab" ? i18n.t(s.key) : null }, icon(s.icon, { size: cls === "tab" ? 22 : 20 }), h("span", { text: i18n.t(cls === "tab" ? `tab.${s.id}` : s.key) }));

  async function paintChrome() {
    const t = i18n.t;
    document.documentElement.lang = i18n.lang;
    document.title = `${t("app.name")} · ÜNVERCO`;
    document.querySelector(".skip-link").textContent = t("nav.skip");
    document.body.dataset.screen = route.name;
    const brand = h("div", { class: "brand" }, ctx.appIcon("brand-icon"), h("div", {}, h("b", { text: t("app.short") }), h("small", { text: "ÜNVERCO" })));
    let foot = null;
    try {
      const prefs = await repo.getPrefs();
      const st = backupStatus(prefs, today, i18n);
      foot = h("div", { class: "side-foot", id: "side-foot" }, h("b", {}, icon("shield", { size: 16, cls: "foot-ico" }), st), h("span", { text: t("side.stays") }));
    } catch (e) { console.error(e); }
    nav.setAttribute("aria-label", t("nav.main"));
    nav.replaceChildren(ctx.logo("side-logo"), brand, ...NAV.map((s) => navLink(s, "side-link")), foot);
    tabbar.setAttribute("aria-label", t("nav.main"));
    tabbar.replaceChildren(...NAV.map((s) => navLink(s, "tab")));
    const vol = document.getElementById("volatile-note");
    vol.hidden = !volatile;
    vol.textContent = t("storage.volatile");
    paintPwa();
  }

  const pwaBar = document.getElementById("pwa-bar");
  let pwa = null;
  function paintPwa() {
    const t = i18n.t;
    if (!pwaBanner || !pwa) { pwaBar.replaceChildren(); return; }
    const close = h("button", { class: "btn btn--ghost", type: "button", id: "pwa-dismiss", text: t("pwa.dismiss"), on: { click: () => { pwaBanner = null; paintPwa(); } } });
    if (pwaBanner === "update") pwaBar.replaceChildren(h("div", { class: "banner glass", role: "status" }, h("span", { text: t("pwa.update") }), h("button", { class: "btn btn--gold", type: "button", id: "pwa-refresh", text: t("pwa.refresh"), on: { click: () => pwa.applyUpdate() } }), close));
    else pwaBar.replaceChildren(h("div", { class: "banner glass", role: "status" }, h("span", { text: t("pwa.installText") }), h("button", { class: "btn btn--gold", type: "button", id: "pwa-install", text: t("pwa.install"), on: { click: async () => { await pwa.promptInstall(); pwaBanner = null; paintPwa(); } } }), close));
  }

  async function show(to) {
    const mine = ++shown;
    const prefs = await repo.getPrefs();
    if (!prefs.onboarded && to.name !== "welcome") to = { name: "welcome" };
    if (prefs.onboarded && to.name === "welcome") to = { name: "today" };
    if (keyOf(to) !== keyOf(parseRoute(location.hash))) { try { history.replaceState(null, "", `#/${to.name}${to.param ? "/" + to.param : ""}`); } catch { /* file:// */ } }
    route = to;
    reload = null;
    if (unmount) { try { unmount(); } catch (e) { console.error(e); } unmount = null; }
    await paintChrome();
    if (mine !== shown) return;
    const root = h("div", { class: `screen screen-${to.name}` });
    panel.replaceChildren(root);
    try {
      const mount = to.name === "welcome" ? mountWelcome : (NAV.find((s) => s.id === to.name) ?? NAV[0]).mount;
      const cleanup = await mount(ctx, root, to.param);
      if (mine !== shown) { if (typeof cleanup === "function") cleanup(); return; }
      if (typeof cleanup === "function") unmount = cleanup;
    } catch (e) {
      if (mine !== shown) return;
      panel.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text: i18n.t("error.load") }));
      ctx.fail(e);
    }
  }

  window.addEventListener("hashchange", async () => {
    const next = parseRoute(location.hash);
    if (keyOf(next) === keyOf(route)) return;
    for (const d of document.querySelectorAll("dialog[open]")) d.close();
    clearToasts();
    await show(next);
    const a = document.activeElement;
    if (!a || a === document.body || panel.contains(a)) panel.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });

  // Gun siniri gece yarisi (yerel): sayfa gorunur olunca ve her dakika denetlenir; gun degistiyse acik ekran yenilenir.
  const checkDay = () => { const now = localIso(); if (now !== today) { today = now; ctx.repo.clearUndo(); show(route); } };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkDay(); });
  setInterval(checkDay, 60000);

  // Baska sekmede veri degisince acik ekran yeniden yuklenir.
  let busy = false, again = false;
  sync.subscribe(async () => {
    if (busy) { again = true; return; }
    busy = true;
    try { if (reload) await reload(); else await show(route); } catch (e) { console.error(e); }
    busy = false;
    if (again) { again = false; show(route); }
  });

  applyTheme();
  await show(route);
  if (globalThis.__unvercoBoot) globalThis.__unvercoBoot.ready();
  if (adapter.takeCorrupted && adapter.takeCorrupted().length) ctx.notify(i18n.t("storage.corrupt"), "error");

  pwa = initPwa({
    onUpdate: () => { pwaBanner = "update"; paintPwa(); },
    onInstallAvailable: () => { pwaBanner = "install"; paintPwa(); },
  });
}

main().catch((e) => {
  console.error(e);
  if (globalThis.__unvercoBoot) globalThis.__unvercoBoot.fail();
  const text = getMessages(document.documentElement.lang)["error.start"] ?? "Something went wrong while starting the app. Reload the page and try again.";
  document.getElementById("panel")?.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text }));
});
