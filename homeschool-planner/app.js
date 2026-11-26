// Homeschool Planner uygulama baslangici: depo, ayarlar, dil, hash yonlendirici (#/today[/<tarih>], #/plan, #/records, #/library, #/kids[/<id>], #/settings),
// kabuk (masaustu: sol menu 5 ekran + Ayarlar, dil ve tema altta; telefon: ust cubuk dil / tema / Ayarlar, alt gezinme 5 ekran), dil ve tema degistirme, yedek hatirlatma seridi, PWA kurulum / guncelleme bildirimleri.
// Kabuk ile ekranlar arasindaki sozlesme ctx nesnesidir (store, i18n, money, prefs (okul yili), business, notify, confirm, print, navigate...).
import config from "./config.js";
import { StoreError, createDefaultAdapter, createStore } from "./core/store.js";
import { createEdition, storageNamespace } from "./core/edition.js";
import { CURRENCIES, LANGS, LANG_NAMES, createI18n, getMessages, loadMessages } from "./core/i18n.js";
import { setMoneyCurrency } from "./core/money.js";
import * as money from "./core/money.js";
import { applyLanguage, createPrefs, loadSettings, sanitizeSettings, saveSettings } from "./core/settings.js";
import { backupNow, rescaleStoreForCurrency, restoreNow } from "./core/data-actions.js";
import { renderSettings } from "./core/settings-screen.js";
import { createBusinessProfile } from "./core/business.js";
import { isLogoDataUrl } from "./core/logo.js";
import { needsFileDelivery, printDocument, printHeaderData } from "./core/print.js";
import { deliverPdf, docToPdf } from "./core/canvas-doc.js";
import { initPwa } from "./core/pwa.js";
import { errorKey } from "./core/safe.js";
import { createSync } from "./core/sync.js";
import { keyOf, parseRoute } from "./core/route.js";
import { button, clearToasts, confirmDialog, h, toast } from "./core/ui.js";
import { mountToday } from "./modules/homeschool/views/today.js";
import { mountPlan } from "./modules/homeschool/views/plan.js";
import { mountRecords } from "./modules/homeschool/views/records.js";
import { mountLibrary } from "./modules/homeschool/views/library.js";
import { mountKids } from "./modules/homeschool/views/kids.js";
import { MIGRATIONS } from "./modules/homeschool/logic/migrations.js";
import { icon as iconSvg } from "./core/icons.js";

// Ana ekranlar (gezinme sirasi). Ayarlar (#/settings) cekirdek ekrandir; gezinmenin son simgesidir.
const SCREENS = [
  { id: "today", icon: "today", labelKey: "hs.nav.today", mount: mountToday },
  { id: "plan", icon: "grid", labelKey: "hs.nav.plan", mount: mountPlan },
  { id: "records", icon: "chart", labelKey: "hs.nav.records", mount: mountRecords },
  { id: "library", icon: "book", labelKey: "hs.nav.library", mount: mountLibrary },
  { id: "kids", icon: "kids", labelKey: "hs.nav.kids", mount: mountKids },
];
// Alt gezinme KISA etiket kullanir (nav.short.<id>); yoksa uzun etiket. Sayfa basliklari uzun halini korur.
const navLabel = (t, s) => { const k = `hs.nav.short.${s.id}`; const v = t(k); return v && v !== k ? v : t(s.labelKey); };
const NAV = [...SCREENS, { id: "settings", icon: "settings", labelKey: "nav.settings" }];
const DEFAULT_SCREEN = "today";

const safeLocalStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

async function main() {
  const ns = storageNamespace(config);
  const settingsKey = `${ns}:settings`;
  const ls = safeLocalStorage();
  const edition = createEdition({ mode: config.mode, demoLimits: config.demoLimits });
  const panel = document.getElementById("panel");
  const screenIds = SCREENS.map((s) => s.id);

  let ctx = null;
  let route = parseRoute(location.hash, screenIds, DEFAULT_SCREEN);
  let unmount = null; // acik ekranin temizlik islevi (varsa)
  let reload = null; // baska sekmede veri degisince cagrilacak yenileme islevi
  let shown = 0; // hizli gezinmede eski cizim yeniyi ezmesin
  let volatile = false; // depolama calismiyor: veri yalniz bu oturumda bellekte
  let backupDismissed = false; // "Later": yalniz bu oturum

  const build = (settings) => {
    const old = ctx;
    const i18n = createI18n({ lang: settings.lang, locale: settings.locale, currency: settings.currency });
    setMoneyCurrency(settings.currency); // en kucuk para birimi birimi (USD 2, JPY 0)
    ctx = {
      config,
      edition,
      settings,
      i18n,
      dir: i18n.dir,
      money: { ...money, format: i18n.formatCurrency },
      store: old ? old.store : null,
      storageKind: old ? old.storageKind : null,
      business: old ? old.business : null, // { get(), save(patch) }
      prefs: old ? old.prefs : null, // okul yili ayarlari: { get, save, invalidate }
      refresh: () => show(route),
      navigate: (to) => { location.hash = to ? `#/${to}` : `#/${DEFAULT_SCREEN}`; },
      // Adresi gecmise kayit eklemeden ve ekrani yeniden kurmadan degistirir (hashchange olmaz). "Yeni" rotasi (#/kids/new) pencereyi
      // actiktan sonra liste rotasina cekilir: yenilemede / ctx.refresh'te bos pencere kendiliginden yeniden acilmaz.
      replaceRoute: (to) => {
        try { history.replaceState(history.state, "", `#/${to}`); } catch { /* file:// kisitliysa adres kalir; rota durumu yine guncellenir */ }
        route = parseRoute(`#/${to}`, screenIds, DEFAULT_SCREEN);
        paintChrome();
      },
      notify: (message, kind = "info", opts = {}) => toast(message, { kind, ...opts, closeLabel: ctx.i18n.t("common.close") }),
      fail: (err) => {
        console.error(err); // yalniz yerel konsol; hicbir yere gonderilmez
        ctx.notify(ctx.i18n.t(errorKey(err)), "error");
        if (err && err.code === "stale_currency") reconcileCurrency().then((changed) => (changed ? show(route) : undefined)).catch(console.error);
      },
      // Onay penceresi: { title, message, confirmLabel?, danger? } -> Promise<boolean>
      confirm: async ({ title, message, confirmLabel, danger = true }) => {
        const { confirmed } = await confirmDialog({ title, message, confirmLabel: confirmLabel ?? ctx.i18n.t("common.delete"), cancelLabel: ctx.i18n.t("common.cancel"), danger });
        return confirmed;
      },
      // Yazdir: { title, node, paper } -> isletme basligi (musteri logosu dahil) eklenir, yazdirma penceresi acilir.
      // UNVERCO markasi yalniz Ayarlar'daki anahtar ACIKSA ve yalniz altbilgide TEK SATIR METIN olarak gider (varsayilan KAPALI).
      // iPhone ana ekran uygulamasinda (window.print() orada calismaz) ayni belge PDF olarak uretilir ve paylasim sayfasina verilir.
      print: async ({ title, node, business, paper, doc }) => {
        try {
          const mark = (await ctx.prefs.get()).brandMark === true ? ctx.i18n.t("print.brandMark") : "";
          const biz = business ?? (await ctx.business.get());
          if (doc && needsFileDelivery(window)) {
            const bytes = await docToPdf({ doc, header: printHeaderData(biz), mark, paper, title });
            await deliverPdf({ bytes, filename: `${config.fileSlug}-${doc.id || "document"}`, title });
            return;
          }
          printDocument({ title, node, business: biz, paper, mark });
        } catch (e) {
          console.error(e);
          ctx.notify(ctx.i18n.t("print.error"), "error");
        }
      },
      onExternalChange: (fn) => { reload = fn; },
      // Ayari veriyi olceklemeden uygular (veri zaten o para biriminde: yedek geri yukleme, baska sekmedeki degisim).
      adoptSettings: async (next) => {
        build(saveSettings(ls, settingsKey, next));
        paintChrome();
        await show(route);
      },
      updateSettings: async (next) => {
        const focusId = document.activeElement && document.activeElement.id;
        try {
          await loadMessages(next.lang);
        } catch (e) {
          console.error(e);
          ctx.notify(ctx.i18n.t("error.generic"), "error");
          paintChrome();
          return;
        }
        // Para birimi degisince kayitli tutarlar yeniden olceklenir; olcekleme + damga deponun TEK kilidinde yapilir.
        const clean = sanitizeSettings(next);
        if (ctx.store && clean.currency !== ctx.settings.currency) {
          try {
            await rescaleStoreForCurrency(ctx.store, ctx.settings.currency, clean.currency);
          } catch (e) {
            ctx.fail(e);
            paintChrome();
            await show(route);
            return;
          }
        }
        const saved = saveSettings(ls, settingsKey, next);
        build(saved);
        paintChrome();
        await show(route);
        if (focusId) document.getElementById(focusId)?.focus();
      },
    };
    document.documentElement.lang = settings.lang;
    document.documentElement.dir = i18n.dir;
    document.documentElement.dataset.theme = settings.theme;
  };

  // ---- sabit kabuk: baslik, dil secici, alt gezinme ----
  const langSel = document.getElementById("lang-select");
  for (const l of LANGS) langSel.append(h("option", { value: l, lang: l, text: LANG_NAMES[l] })); // her dil kendi adiyla
  langSel.onchange = () => ctx.updateSettings(applyLanguage(ctx.settings, langSel.value)); // para birimi DEGISMEZ
  document.getElementById("lang-ico").append(iconSvg("globe", { size: 20 }));
  const nav = document.getElementById("main-nav");
  const themeBtn = document.getElementById("theme-toggle");
  // Gorunen tema: "system" ayari cihazin tercihine gore. Dugme TEK dokunusla acik <-> koyu degistirir (Ayarlar'daki tema secicisiyle ayni ayar anahtari).
  const effectiveTheme = () => (ctx.settings.theme === "system" ? (globalThis.matchMedia && globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : ctx.settings.theme);
  try { globalThis.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => paintChrome()); } catch { /* eski tarayici: cihaz temasi degisince dugme bir sonraki cizimde guncellenir */ }
  themeBtn.onclick = () => ctx.updateSettings({ ...ctx.settings, theme: effectiveTheme() === "dark" ? "light" : "dark" });

  const paintChrome = () => {
    const { t, lang } = ctx.i18n;
    document.title = `${t("app.title")} · ${t("app.subtitle")}`;
    document.getElementById("app-title-text").textContent = t("app.title");
    document.getElementById("app-subtitle").textContent = t("app.subtitle");
    document.querySelector(".skip-link").textContent = t("nav.skip");
    langSel.value = lang;
    langSel.setAttribute("aria-label", t("settings.language"));
    nav.setAttribute("aria-label", t("nav.menu"));
    nav.replaceChildren(...NAV.map((s) => h("a", { class: "nav-link", id: `nav-${s.id}`, href: `#/${s.id}`, "aria-current": route.name === s.id ? "page" : "false", "aria-label": s.id === "settings" ? t(s.labelKey) : undefined },
      h("span", { class: "nav-icon" }, iconSvg(s.icon, { size: 20 })),
      h("span", { class: "nav-text nav-text-short", text: navLabel(t, s) }), h("span", { class: "nav-text nav-text-long", text: t(s.labelKey) }))));
    const toDark = effectiveTheme() !== "dark"; // dugme gidilecek temayi gosterir (acikken Dark / koyuyken Light)
    const target = t(toDark ? "settings.theme.dark" : "settings.theme.light");
    const themeLabel = `${t("settings.theme")}: ${target}`;
    themeBtn.replaceChildren(iconSvg(toDark ? "moon" : "sun", { size: 20 }), h("span", { class: "theme-text", text: target }));
    themeBtn.setAttribute("aria-label", themeLabel);
    themeBtn.title = themeLabel;
    const vol = document.getElementById("volatile-note");
    vol.hidden = !volatile;
    vol.textContent = t("storage.volatile");
    paintBrandLogo();
  };

  // Musterinin kendi logosu: baslik sag ust kose. Logo yoksa oge GIZLI kalir (bos cerceve / yer tutucu yok).
  // src dogrudan ozellik atamasiyla verilir (h() data: adresini reddeder); alt metni isletme adidir.
  const paintBrandLogo = async () => {
    const img = document.getElementById("brand-logo");
    if (!img) return;
    try {
      const biz = ctx && ctx.business ? await ctx.business.get() : null;
      const logo = biz && isLogoDataUrl(biz.logo) ? biz.logo : "";
      if (logo) {
        img.src = logo;
        img.alt = biz.name || "";
        img.hidden = false;
      } else {
        img.removeAttribute("src");
        img.alt = "";
        img.hidden = true;
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Yedek hatirlatma seridi: son yedek ayardaki gunden eskiyse ve kayit varsa.
  const paintBackupBar = async () => {
    const bar = document.getElementById("backup-bar");
    if (!ctx.store || !ctx.prefs || backupDismissed) { bar.replaceChildren(); return; }
    try {
      const pref = await ctx.prefs.get();
      const n = (await ctx.store.count("logs")) + (await ctx.store.count("students"));
      const last = pref.lastBackupAt ? Date.parse(pref.lastBackupAt) : null;
      const due = last === null || (Date.now() - last) / 86400000 >= pref.backupEveryDays;
      if (!n || !due) { bar.replaceChildren(); return; }
      const { t, formatDate } = ctx.i18n;
      const text = last === null ? t("backup.never") : t("backup.reminder", { when: formatDate(new Date(last)) });
      bar.replaceChildren(h("div", { class: "banner row", role: "status", id: "backup-strip" },
        h("span", { text }),
        button({ id: "backup-now", label: t("hs.backup.download"), variant: "primary", exportAction: true, onClick: async () => { if (await backupNow(ctx)) await paintBackupBar(); } }),
        button({ id: "backup-later", label: t("backup.later"), onClick: () => { backupDismissed = true; bar.replaceChildren(); } })));
    } catch (e) {
      console.error(e);
    }
  };

  const show = async (to) => {
    const mine = ++shown;
    route = to;
    reload = null;
    panel.dataset.screen = to.name;
    if (unmount) {
      try { unmount(); } catch (e) { console.error(e); }
      unmount = null;
    }
    paintChrome();
    try {
      if (to.name === "settings") {
        const stage = h("div");
        await renderSettings(stage, ctx);
        if (mine !== shown) return;
        panel.replaceChildren(...stage.childNodes);
      } else {
        const root = h("div", { class: "module-root" });
        panel.replaceChildren(root);
        const screen = SCREENS.find((s) => s.id === to.name) ?? SCREENS[0];
        const cleanup = await screen.mount(ctx, root, to.param);
        if (mine !== shown) { if (typeof cleanup === "function") cleanup(); return; }
        if (typeof cleanup === "function") unmount = cleanup;
      }
      paintBackupBar();
    } catch (e) {
      if (mine !== shown) return;
      // Bozuk kayit uygulamayi kilitlemesin: hata bandi + yedekten donme yolu.
      panel.replaceChildren(
        h("p", { class: "banner banner-error", role: "alert", text: ctx.i18n.t("error.load") }),
        h("p", { class: "muted", text: ctx.i18n.t("error.loadHint") }),
        h("div", { class: "row" },
          button({ id: "btn-load-restore", label: ctx.i18n.t("error.restoreBackup"), variant: "primary", onClick: () => restoreNow(ctx) }),
          button({ label: ctx.i18n.t("nav.settings"), onClick: () => ctx.navigate("settings") })));
      ctx.fail(e);
    }
  };

  // Para birimi damgasi (deponun meta'si) bu sekmenin ayarindan farkliysa ayari damgaya cek. true: degisti.
  const reconcileCurrency = async () => {
    if (!ctx.store) return false;
    const extra = await ctx.store.getExtra();
    if (!CURRENCIES.includes(extra.currency) || extra.currency === ctx.settings.currency) return false;
    build(saveSettings(ls, settingsKey, { ...ctx.settings, currency: extra.currency }));
    paintChrome();
    ctx.notify(ctx.i18n.t("settings.currencyChangedElsewhere", { currency: extra.currency }), "warn");
    return true;
  };

  let settings0 = loadSettings(ls, settingsKey);
  try {
    await loadMessages(settings0.lang);
  } catch (e) {
    console.error(e); // dil dosyasi yuklenemedi: Ingilizceyle ac
    settings0 = { ...settings0, lang: "en" };
    await loadMessages("en");
  }
  build(settings0);
  if (ls && ls.getItem(settingsKey) === null) saveSettings(ls, settingsKey, settings0); // ilk acilista varsayilanlar kalici olur
  paintChrome();

  let adapter;
  try {
    adapter = await createDefaultAdapter(globalThis, ns);
    volatile = adapter.volatile === true;
    paintChrome();
    const sync = createSync({ name: ns });
    const locks = globalThis.navigator && globalThis.navigator.locks ? globalThis.navigator.locks : null; // Web Locks varsa yazma kilit altinda
    ctx.store = createStore({
      adapter, prefix: ns, schemaVersion: config.schemaVersion, migrations: MIGRATIONS, locks, sync,
      // Baska sekme para birimini degistirdiyse bu sekme ESKI birimle yazamaz (tutar 100 kat kayardi).
      writeGuard: (extra) => { if (CURRENCIES.includes(extra.currency) && extra.currency !== ctx.settings.currency) throw new StoreError("stale_currency", "The currency was changed in another tab."); },
    });
    ctx.storageKind = adapter.kind;
    await ctx.store.init();
    const stamp = (await ctx.store.getExtra()).currency;
    if (CURRENCIES.includes(stamp)) { if (stamp !== ctx.settings.currency) { build(saveSettings(ls, settingsKey, { ...ctx.settings, currency: stamp })); paintChrome(); } } // veri damgali birimde
    else await ctx.store.setExtra({ currency: ctx.settings.currency }); // bos depo: damga = ayar
    ctx.business = createBusinessProfile(ctx.store);
    ctx.prefs = createPrefs(ctx.store, () => ctx.settings.lang);
    await ctx.prefs.get(); // ilk kurulumda varsayilan okul yili ayarlari kaydedilir

    // Baska sekmede veri degisince acik ekran yeniden yuklenir (art arda gelenler birlestirilir).
    let busy = false;
    let again = false;
    const onExternal = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        if (await reconcileCurrency()) await show(route);
        else if (reload) await reload();
        paintBackupBar();
      } catch (e) {
        ctx.fail(e);
      }
      busy = false;
      if (again) { again = false; onExternal(); }
    };
    sync.subscribe(onExternal);
  } catch (e) {
    panel.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text: ctx.i18n.t(e && e.code === "newer_schema" ? "backup.error.newer_schema" : "storage.error") }));
    return;
  }

  window.addEventListener("hashchange", async () => {
    const next = parseRoute(location.hash, screenIds, DEFAULT_SCREEN);
    if (keyOf(next) === keyOf(route)) return;
    clearToasts(); // baska ekranin bildirimi yeni ekrana tasinmaz
    await show(next);
    // Odak yalniz govdede, eski panelin icinde ya da gizlenen bir denetimdeyse panele tasinir.
    const a = document.activeElement;
    if (!a || a === document.body || panel.contains(a) || a.hidden || a.closest("[hidden]")) panel.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });

  await show(route);
  if (adapter.takeCorrupted && adapter.takeCorrupted().length) ctx.notify(ctx.i18n.t("storage.corrupt"), "error");

  // PWA: kurulum ve guncelleme bildirimleri (dosyadan acilan tek dosya paketinde servis calisani yoktur)
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
  // Son care: yuklenmis dil varsa onun, yoksa sabit Ingilizce metin.
  const text = getMessages(document.documentElement.lang)["error.start"] ?? "Something went wrong while starting the app. Reload the page and try again.";
  document.getElementById("panel")?.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text }));
});
