// Uygulama baslangici: depo, surum, ayarlar, gezinme, PWA.
import config from "./config.js";
import { createDefaultAdapter, createStore } from "./core/store.js";
import { createEdition } from "./core/edition.js";
import { createI18n, langOf } from "./core/i18n.js";
import { loadSettings, saveSettings } from "./core/settings.js";
import { renderSettings } from "./core/settings-screen.js";
import { initPwa } from "./core/pwa.js";
import { fileWarning, isFileProtocol, probeStorage } from "./core/boot-file.js";
import { backupNow } from "./core/data-actions.js";
import { errorKey } from "./core/safe.js";
import { installClickGuard } from "./core/click-guard.js";
import { createSync } from "./core/sync.js";
import { button, clearNotice, clearToasts, createTabs, h, showNotice, toast } from "./core/ui.js";
import guests from "./modules/guests/index.js";

// Urun modulleri buraya eklenir (README: "Yeni urun modulu").
const modules = [guests];

const safeLocalStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

async function main() {
  installClickGuard(document);
  const settingsKey = `${config.storagePrefix}:settings`;
  const ls = safeLocalStorage();
  const extra = { en: Object.assign({}, ...modules.map((m) => m.messages?.en ?? {})) };
  const edition = createEdition({ mode: config.mode, demoLimits: config.demoLimits });
  const panel = document.getElementById("panel");
  const nav = document.getElementById("nav");
  document.title = config.appName;

  let ctx = null;
  let currentId = modules[0].id;
  let reload = null; // acik ekranin, baska sekmede veri degisince cagrilacak yenileme islevi
  let missed = false; // ekran yuklenirken (reload bos) gelen dis degisiklik: ekran baglaninca bir kez yenilenir
  let runExternal = null;

  const applyTheme = () => {
    document.documentElement.dataset.theme = ctx.settings.theme;
  };

  const build = (settings) => {
    ctx = {
      config,
      store: ctx ? ctx.store : null,
      edition,
      settings,
      i18n: createI18n({ locale: settings.locale, currency: settings.currency, extra }),
      refresh: () => show(currentId),
      // Bildirim ve hata gosterimi (hata bildirimi kendiliginden kaybolmaz, kapat dugmesi vardir).
      // Warnings stay in the view as an in-page strip (not in the toast layer); everything else is a toast (core/ui.js).
      notify: (message, kind = "info") => (kind === "warn"
        ? showNotice(panel, message, { closeLabel: ctx.i18n.t("common.close") })
        : toast(message, { kind, closeLabel: ctx.i18n.t("common.close") })),
      clearTransient: () => { clearToasts(); clearNotice(); }, // the person changed the view: success toasts and the warning strip go
      fail: (err) => {
        console.error(err); // yalniz yerel konsol; hicbir yere gonderilmez
        ctx.notify(ctx.i18n.t(errorKey(err)), "error");
      },
      onExternalChange: (fn) => { reload = fn; if (fn && missed) { missed = false; if (runExternal) runExternal(); } },
      updateSettings: async (next) => {
        const focusId = document.activeElement && document.activeElement.id; // ayni denetime don
        const saved = saveSettings(ls, settingsKey, next);
        build(saved);
        renderNav();
        await show(currentId);
        if (focusId) document.getElementById(focusId)?.focus();
      },
    };
    // Interface language and number / date format both follow settings.locale (en, es, fr, de, tr).
    document.documentElement.lang = langOf(settings.locale);
    applyTheme();
  };

  const show = async (id) => {
    currentId = id;
    panel.setAttribute("aria-labelledby", `tab-${id}`);
    reload = null;
    if (id === "settings") return renderSettings(panel, ctx);
    const mod = modules.find((m) => m.id === id);
    try {
      await mod.render(panel, ctx);
    } catch (e) {
      panel.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text: ctx.i18n.t("error.load") }));
      ctx.fail(e);
    }
  };

  const renderNav = () => {
    const items = [
      ...modules.map((m) => ({ id: m.id, label: ctx.i18n.t(m.titleKey) })),
      { id: "settings", label: ctx.i18n.t("nav.settings") },
    ];
    nav.replaceChildren(createTabs({ items, selected: currentId, label: ctx.i18n.t("nav.label"), onSelect: (id) => { ctx.clearTransient(); return show(id); } }).element);
  };

  build(loadSettings(ls, settingsKey));
  document.getElementById("app-title").textContent = config.appName;

  let adapter;
  try {
    adapter = await createDefaultAdapter(globalThis, config.storagePrefix);
    const sync = createSync({ name: config.storagePrefix });
    const locks = globalThis.navigator && globalThis.navigator.locks ? globalThis.navigator.locks : null; // Web Locks varsa yazma kilit altinda
    ctx.store = createStore({ adapter, prefix: config.storagePrefix, schemaVersion: config.schemaVersion, locks, sync });
    await ctx.store.init();

    // Baska sekmede veri degisince acik ekran yeniden yuklenir (art arda gelenler birlestirilir).
    let busy = false;
    let again = false;
    const onExternal = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        if (reload) await reload();
        else missed = true; // gorunum henuz yuklenmedi: bildirim atilmaz, gorunum baglaninca yenilenir
      } catch (e) {
        ctx.fail(e);
      }
      busy = false;
      if (again) { again = false; onExternal(); }
    };
    runExternal = onExternal;
    sync.subscribe(onExternal);
  } catch (e) {
    panel.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text: ctx.i18n.t(e && e.code === "newer_schema" ? "backup.error.newer_schema" : "storage.error") }));
    return;
  }

  // Hosted copy: when the browser could not keep the data on disk, a strip stays until the page is closed (the file:// strip is below).
  const warnVolatile = () => {
    if (isFileProtocol() || document.getElementById("volatile-warning")) return;
    document.getElementById("pwa-bar").before(
      h("div", { class: "banner banner-error row no-print", id: "volatile-warning", role: "alert" },
        h("span", { text: ctx.i18n.t("storage.volatile") }),
        button({ label: ctx.i18n.t("settings.backup"), variant: "primary", onClick: () => backupNow(ctx) })));
  };
  if (ctx.store.volatile) warnVolatile();
  ctx.store.onVolatile(warnVolatile);

  renderNav();
  await show(currentId);
  if (adapter.takeCorrupted && adapter.takeCorrupted().length) ctx.notify(ctx.i18n.t("storage.corrupt"), "error");

  // Opened straight from disk (single-file build): check that data persists; no service worker, no install bar.
  if (isFileProtocol()) {
    if (!(await probeStorage(adapter))) document.getElementById("pwa-bar").before(fileWarning({ onBackup: () => backupNow(ctx) }));
    return;
  }

  // PWA: kurulum ve guncelleme bildirimleri
  const bar = document.getElementById("pwa-bar");
  const say = (text, ...actions) => bar.replaceChildren(h("div", { class: "banner row", role: "status" }, h("span", { text }), ...actions));
  const pwa = initPwa({
    onUpdate: () => {
      const { t } = ctx.i18n;
      say(t("pwa.updateAvailable"), button({ label: t("pwa.refresh"), variant: "primary", onClick: () => pwa.applyUpdate() }), button({ label: t("pwa.dismiss"), onClick: () => bar.replaceChildren() }));
    },
    onInstallAvailable: () => {
      const { t } = ctx.i18n;
      say(t("pwa.install"), button({ label: t("pwa.install"), variant: "primary", onClick: async () => { await pwa.promptInstall(); bar.replaceChildren(); } }), button({ label: t("pwa.dismiss"), onClick: () => bar.replaceChildren() }));
    },
  });
  if (pwa.ios && !pwa.standalone) {
    const { t } = ctx.i18n;
    say(t("pwa.installIos"), button({ label: t("pwa.dismiss"), onClick: () => bar.replaceChildren() }));
  }
}

main().catch((e) => {
  console.error(e);
  document.getElementById("panel")?.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text: "Something went wrong while starting the app. Reload the page and try again." }));
});
