// ÜNVERCO App Tester kabugu: dil, tema, hash yonlendirme, kenar cubugu / alt sekme cubugu, ice aktarma, PWA bildirimleri.
// Kabuk ile ekranlar arasindaki sozlesme ctx nesnesidir. Dil degisince TUM kabuk ve acik ekran yeniden cizilir. Ag istegi yok.
import config from "./config.js";
import { LANGS, LANG_NAMES, createI18n, getMessages, loadMessages, matchLang } from "./core/i18n.js";
import { initPwa } from "./core/pwa.js";
import { errorKey } from "./core/safe.js";
import { parseRoute, keyOf } from "./core/route.js";
import { clearToasts, confirmDialog, h, toast } from "./core/ui.js";
import { icon } from "./core/icons.js";
import { createHistory, pickStorage } from "./modules/tester/logic/history.js";
import { validateResults } from "./modules/tester/logic/validate.js";
import { SAMPLES } from "./modules/tester/logic/sample.js";
import { mountHome } from "./modules/tester/views/home.js";
import { mountSetup } from "./modules/tester/views/setup.js";
import { mountResults } from "./modules/tester/views/results.js";
import { mountHistory } from "./modules/tester/views/history.js";
import { mountSettings } from "./modules/tester/views/settings.js";

const NAV = [
  { id: "home", icon: "today", key: "nav.home", mount: mountHome },
  { id: "setup", icon: "sparkle", key: "nav.setup", mount: mountSetup },
  { id: "results", icon: "list", key: "nav.results", mount: mountResults },
  { id: "history", icon: "history", key: "nav.history", mount: mountHistory },
  { id: "settings", icon: "palette", key: "nav.settings", mount: mountSettings },
];
const SETTINGS_KEY = `${config.storagePrefix}:settings`;

function loadSettings(storage) {
  let s = {};
  try { s = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}") || {}; } catch { s = {}; }
  return {
    lang: LANGS.includes(s.lang) ? s.lang : matchLang(globalThis.navigator?.language) ?? "en",
    theme: ["system", "light", "dark"].includes(s.theme) ? s.theme : "dark", // koyu varsayilan
  };
}

async function main() {
  const storage = pickStorage(globalThis);
  const panel = document.getElementById("panel");
  const nav = document.getElementById("side-nav");
  const tabbar = document.getElementById("tabbar");
  let settings = loadSettings(storage);
  try { await loadMessages(settings.lang); } catch (e) { console.error(e); settings = { ...settings, lang: "en" }; await loadMessages("en"); }
  let i18n = createI18n({ lang: settings.lang });
  let route = parseRoute(location.hash);
  let unmount = null;
  let shown = 0;
  let pwaBanner = null;
  const history = createHistory({ storage, prefix: config.storagePrefix });
  let afterNav = null; // ekran degisiminden SONRA gosterilecek bildirim (hashchange eski bildirimleri temizler)
  const flushAfterNav = () => { const f = afterNav; afterNav = null; if (f) f(); };

  const media = globalThis.matchMedia ? globalThis.matchMedia("(prefers-color-scheme: dark)") : null;
  const effectiveTheme = () => (settings.theme === "system" ? (media && !media.matches ? "light" : "dark") : settings.theme);
  const applyTheme = () => {
    const th = effectiveTheme();
    document.documentElement.dataset.theme = th;
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute("content", th === "dark" ? "#050816" : "#EEF3FF");
  };
  try { media?.addEventListener("change", () => { if (settings.theme === "system") applyTheme(); }); } catch { /* eski tarayici */ }

  const ctx = {
    config, history,
    get i18n() { return i18n; },
    get t() { return i18n.t; },
    get settings() { return settings; },
    navigate: async (to) => { if (location.hash === `#/${to}` || (to === "home" && !location.hash)) { await show(route); flushAfterNav(); } else location.hash = `#/${to}`; },
    refresh: () => show(route),
    notify: (message, kind = "info", opts = {}) => toast(message, { kind, ...opts, closeLabel: i18n.t("common.close") }),
    fail: (err) => { console.error(err); ctx.notify(i18n.t(errorKey(err)), "error"); }, // yalniz yerel konsol; hicbir yere gonderilmez
    confirm: async ({ title, message, confirmLabel }) => (await confirmDialog({ title, message, confirmLabel, cancelLabel: i18n.t("common.cancel"), danger: true })).confirmed,
    langOptions: () => LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })),
    /** Metin -> dogrula -> gecmise ekle -> ana sayfa. Doner { ok } | { ok: false, code, params }. Asla firlatmaz. */
    async importText(text, name, source) {
      const v = validateResults(text);
      if (!v.ok) return v;
      try {
        history.add(v.data, { name, source });
      } catch (e) { ctx.fail(e); return { ok: false, code: "storage", params: {} }; }
      afterNav = () => ctx.notify(i18n.t("import.ok", { name }), "success");
      await ctx.navigate("home");
      return { ok: true };
    },
    importSample(kind) { return ctx.importText(JSON.stringify(SAMPLES[kind]), kind === "ship" ? i18n.t("home.sample.ship") : i18n.t("home.sample.dontship"), "sample"); },
    async deleteAll() {
      history.clear();
      try { storage.removeItem(SETTINGS_KEY); } catch { /* depo kapali */ }
      settings = loadSettings(storage);
      await loadMessages(settings.lang);
      i18n = createI18n({ lang: settings.lang });
      applyTheme();
      await show(route);
    },
    async setSettings(next) {
      const focusId = document.activeElement?.id;
      settings = { ...settings, ...next };
      try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* depo kapali: yalniz bu oturum */ }
      await loadMessages(settings.lang);
      i18n = createI18n({ lang: settings.lang });
      applyTheme();
      await show(route);
      if (focusId) document.getElementById(focusId)?.focus();
    },
  };

  // ---- kabuk ----
  const logoSrc = document.getElementById("brand-logo-src");
  const logoBlueSrc = document.getElementById("brand-logo-blue-src");
  const iconSrc = document.getElementById("app-icon-src");
  const logo = (cls) => {
    const gold = h("img", { class: "logo-gold", alt: "ÜNVERCO" }); gold.src = logoSrc.src;
    const blue = h("img", { class: "logo-blue", alt: "ÜNVERCO" }); blue.src = logoBlueSrc.src;
    return h("span", { class: `brand-logo ${cls}` }, gold, blue);
  };
  const appIcon = (cls) => { const im = h("img", { class: cls, alt: "" }); im.src = iconSrc.src; return im; };
  // Alt sekme cubugu kisa etiket kullanir (tab.*); erisilebilir ad uzun etikettir.
  const navLink = (s, cls) => h("a", { class: cls, id: `${cls === "tab" ? "tab" : "nav"}-${s.id}`, href: `#/${s.id}`, "aria-current": route.name === s.id ? "page" : null, "aria-label": cls === "tab" ? i18n.t(s.key) : null }, icon(s.icon, { size: cls === "tab" ? 22 : 20 }), h("span", { text: i18n.t(cls === "tab" ? `tab.${s.id}` : s.key) }));

  function paintChrome() {
    const t = i18n.t;
    document.documentElement.lang = i18n.lang;
    document.title = `${t("app.name")} · ÜNVERCO`;
    document.querySelector(".skip-link").textContent = t("nav.skip");
    document.body.dataset.screen = route.name;
    const brand = h("div", { class: "brand" }, appIcon("brand-icon"), h("div", {}, h("b", { text: t("app.short") }), h("small", { text: "ÜNVERCO" })));
    const foot = h("div", { class: "side-foot", id: "side-foot" }, icon("shield", { size: 16, cls: "foot-ico" }), h("span", { text: t("side.stays") }));
    nav.setAttribute("aria-label", t("nav.main"));
    nav.replaceChildren(logo("side-logo"), brand, ...NAV.map((s) => navLink(s, "side-link")), foot);
    tabbar.setAttribute("aria-label", t("nav.main"));
    tabbar.replaceChildren(...NAV.map((s) => navLink(s, "tab")));
    const vol = document.getElementById("volatile-note");
    vol.hidden = !history.volatile;
    vol.textContent = t("storage.volatile");
    paintPwa();
  }

  const pwaBar = document.getElementById("pwa-bar");
  let pwa = null;
  function paintPwa() {
    const t = i18n.t;
    if (!pwaBanner || !pwa) { pwaBar.replaceChildren(); return; }
    const close = h("button", { class: "btn btn-ghost", type: "button", id: "pwa-dismiss", text: t("pwa.dismiss"), on: { click: () => { pwaBanner = null; paintPwa(); } } });
    if (pwaBanner === "update") pwaBar.replaceChildren(h("div", { class: "banner", role: "status" }, h("span", { text: t("pwa.update") }), h("button", { class: "btn btn-primary", type: "button", id: "pwa-refresh", text: t("pwa.refresh"), on: { click: () => pwa.applyUpdate() } }), close));
    else pwaBar.replaceChildren(h("div", { class: "banner", role: "status" }, h("span", { text: t("pwa.installText") }), h("button", { class: "btn btn-primary", type: "button", id: "pwa-install", text: t("pwa.install"), on: { click: async () => { await pwa.promptInstall(); pwaBanner = null; paintPwa(); } } }), close));
  }

  async function show(to) {
    const mine = ++shown;
    if (keyOf(to) !== keyOf(parseRoute(location.hash))) { try { history_replace(to); } catch { /* file:// */ } }
    route = to;
    if (unmount) { try { unmount(); } catch (e) { console.error(e); } unmount = null; }
    paintChrome();
    const root = h("div", { class: `screen screen-${to.name}` });
    panel.replaceChildren(root);
    try {
      const mount = (NAV.find((s) => s.id === to.name) ?? NAV[0]).mount;
      const cleanup = await mount(ctx, root, to.param);
      if (mine !== shown) { if (typeof cleanup === "function") cleanup(); return; }
      if (typeof cleanup === "function") unmount = cleanup;
    } catch (e) {
      if (mine !== shown) return;
      panel.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text: i18n.t("error.load") }));
      console.error(e);
    }
  }
  const history_replace = (to) => globalThis.history.replaceState(null, "", `#/${to.name}${to.param ? "/" + to.param : ""}`);

  window.addEventListener("hashchange", async () => {
    const next = parseRoute(location.hash);
    if (keyOf(next) === keyOf(route)) return;
    for (const d of document.querySelectorAll("dialog[open]")) d.close();
    clearToasts();
    await show(next);
    const a = document.activeElement;
    if (!a || a === document.body || panel.contains(a)) panel.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    flushAfterNav();
  });
  // Baska sekmede veri degisince (storage olayi) acik ekran yenilenir.
  window.addEventListener("storage", (e) => { if (e.key === history.key) show(route); });

  applyTheme();
  await show(route);
  if (globalThis.__unvercoBoot) globalThis.__unvercoBoot.ready();
  if (history.takeCorrupted()) ctx.notify(i18n.t("storage.corrupt"), "error");

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
