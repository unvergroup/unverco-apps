// Repairs modulu (Claimtag): Check in · Board · Find · Pickup. Workbench modul sozlesmesi: { id, titleKey, collections, mount }.
// Claimtag tek modulludur; ekranlar (screens) kabuktaki ana gezinmeyi olusturur. Metinler locales/ dosyalarinda ("repairs." onekli);
// yalniz locales/'ta olmayan kisa etiketler messages.js'tedir.
import { mountBoard } from "./views/board.js";
import { mountCheckin } from "./views/checkin.js";
import { mountFind } from "./views/find.js";
import { mountPickup } from "./views/pickup.js";
import { printBlankForm } from "./print/receipt.js";
import messages from "./messages.js";

export default {
  id: "repairs",
  titleKey: "app.title",
  collections: ["customers", "devices", "jobs", "ctSettings", "sequences", "business"],
  messages,
  defaultScreen: "checkin",
  screens: [
    { id: "checkin", labelKey: "repairs.nav.checkin", mount: mountCheckin },
    { id: "board", labelKey: "repairs.nav.board", mount: mountBoard },
    { id: "find", labelKey: "repairs.nav.find", mount: mountFind },
    { id: "pickup", labelKey: "repairs.nav.pickup", mount: mountPickup },
  ],
  // ust cubuk eylemleri (kabuk cizer)
  topActions: [{ id: "blank-form", labelKey: "repairs.top.blankForm", run: (ctx) => printBlankForm(ctx) }],
  // Ekrani cizer: ctx (kabuk), root (bos kap), screen kimligi, param (#/pickup/<id> -> id). Doner: temizlik islevi (varsa).
  async mount(ctx, root, screen, param) {
    const s = this.screens.find((x) => x.id === screen) ?? this.screens[0];
    root.dataset.screen = s.id;
    return s.mount(ctx, root, param);
  },
};
