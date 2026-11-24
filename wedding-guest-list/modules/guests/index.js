// Misafir modulu: Planner kabugu. Dort ic gorunum (Guests, Tables, Check, Print); her gorunum bir islev:
//   render(panel, env, params) -> Promise<{ onExternal?() } | void>
// env = { ctx, t, store, edition, go(view, params) }. Print henuz bos durum gosterir; kendi gorevleri
// ayni sozlesmeyle bu tabloya baglanir (VIEWS). Print (U6, U7) gercek gorunum; Caterer ve Changes bolumleri sonraki gorevlerde. Sozlesme: { id, titleKey, messages, render(container, ctx) }
import { button, createTabs, h } from "../../core/ui.js";
import messages from "./messages.js";
import config from "../../config.js";
import { setRestorePreparer } from "../../core/backup.js";
import { createEdition } from "../../core/edition.js";
import { prepareRestore, repairSaved, seedIfEmpty } from "./data.js";
import { sampleLoadPlan } from "./logic/sample.js";
import { plural } from "./parts.js";
import { renderCheck } from "./view-check.js";
import { renderGuests } from "./view-guests.js";
import { renderPrint, removePrintRoot } from "./view-print.js";
import { renderTables } from "./view-tables.js";

const NAMES = ["guests", "tables", "check", "print"];
const PANEL_ID = "guests-panel";

const VIEWS = { guests: renderGuests, tables: renderTables, check: renderCheck, print: renderPrint };

let lastView = "guests"; // secili gorunum oturum icinde hatirlanir (Settings'e gidip donunce ayni yer)
let repairNotice = null; // acilista onarilan kayit sayisi; kullanici kapatana kadar (Settings'e gidip donunce de) gorunur

// Demo: ilk acilista (depo bos ve daha once tohumlanmamis) 40 kisilik ornek liste yuklenir. Kullanici silebilir; tekrar gelmez.
// Bos mu karari yazmayla ayni kilitte verilir (seedIfEmpty): demo iki sekmede birden ilk kez acilsa da tek kopya kalir.
async function seedSample(ctx) {
  if (!ctx.edition.isDemo) return;
  const flag = `${ctx.config.storagePrefix}:seeded`;
  let ls = null;
  try { ls = globalThis.localStorage; } catch { /* depolama kapali: her acilista tohumlanir */ }
  try {
    if (ls && ls.getItem(flag)) return;
    await seedIfEmpty(ctx.store, sampleLoadPlan({}).steps); // false: veri vardi ya da baska sekme tohumladi
    if (ls) ls.setItem(flag, "1");
  } catch (e) {
    ctx.fail(e);
  }
}

// Yedek geri yukleme: veri yazilmadan once sanitize'dan gecer, demoda sinir uygulanir (data.js prepareRestore). Onarim olduysa
// geri yukleme bitince Planner'in acilistaki bildirimi gosterilir. Uygulama acilirken (render) kaydedilir; Settings'ten yapilan
// geri yukleme de bu islevden gecer.
function registerRestore() {
  setRestorePreparer(
    (data) => {
      const edition = createEdition(config);
      return prepareRestore(data, { limits: { guests: edition.limitFor("guests"), tables: edition.limitFor("tables") } });
    },
    (report) => { repairNotice = report; },
  );
}

// Acilista kayitli veri sanitize'dan gecer (spec 3). Onarim olduysa tek bildirim; hicbir misafir sessizce atilmaz.
async function repairOnOpen(ctx) {
  try {
    const r = await repairSaved(ctx.store);
    if (r) repairNotice = r;
  } catch (e) {
    ctx.fail(e);
  }
}

export default {
  id: "guests",
  titleKey: "guests.title",
  messages,

  async render(container, ctx) {
    const { t } = ctx.i18n;
    registerRestore();
    await repairOnOpen(ctx);
    await seedSample(ctx);
    if (!document.getElementById("print-fallback")) document.body.append(h("p", { id: "print-fallback", class: "print-fallback", text: t("guests.print.elsewhere") }));
    const panel = h("div", { id: PANEL_ID, role: "tabpanel", tabindex: "0" });
    let current = null; // { view, handle }
    let pending = null;
    let token = 0;

    const showView = async (view, params) => {
      const mine = ++token;
      lastView = view;
      panel.setAttribute("aria-labelledby", `tab-view-${view}`);
      ctx.onExternalChange(null);
      removePrintRoot(); // the print target lives only while the Print view is open
      const holder = h("div", {});
      panel.replaceChildren(holder);
      try {
        const handle = await VIEWS[view](holder, env, params);
        if (mine !== token) return;
        holder.dataset.view = view;
        current = { view, handle };
        ctx.onExternalChange(async () => { if (current && current.handle && current.handle.onExternal) await current.handle.onExternal(); else await showView(view); });
      } catch (e) {
        if (mine === token) { panel.replaceChildren(h("p", { class: "banner banner-error", role: "alert", text: t("error.load") })); ctx.fail(e); }
      }
    };

    // Sekme kimlikleri ust gezinmeyle (tab-guests) cakismasin diye "view-" onekli.
    const tabs = createTabs({
      items: NAMES.map((v) => ({ id: `view-${v}`, label: t(`guests.tab.${v}`) })),
      selected: `view-${lastView}`,
      label: t("guests.tabs.label"),
      onSelect: (id) => { ctx.clearTransient(); const p = pending; pending = null; return showView(id.slice("view-".length), p ?? undefined); },
    });
    tabs.element.classList.add("planner-tabs");
    for (const b of tabs.element.querySelectorAll('[role="tab"]')) b.setAttribute("aria-controls", PANEL_ID);

    const env = {
      ctx, t, store: ctx.store, edition: ctx.edition,
      go: (view, params) => { pending = params ?? null; tabs.select(`view-${view}`); },
    };

    const notice = () => {
      if (!repairNotice) return null;
      const { records, guestsLost } = repairNotice;
      const el = h("div", { class: "banner row repair-notice", role: "status" },
        h("span", { text: [plural(t, "guests.repair.notice", records), guestsLost ? plural(t, "guests.repair.lost", guestsLost) : t("guests.repair.noneLost"), t("guests.repair.look")].join(" ") }),
        button({ label: t("guests.repair.dismiss"), variant: "ghost", onClick: () => {
          repairNotice = null;
          el.remove();
          tabs.element.querySelector('[aria-selected="true"]')?.focus();
        } }));
      return el;
    };
    container.replaceChildren(...[notice(), tabs.element, panel].filter(Boolean));
    await showView(lastView);
  },
};
