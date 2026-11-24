// Pet Business Tracker alan modulu (evcil hayvan bakim isletmesi takibi): Today · Calendar · Clients · Reminders · Income.
// Workbench modul sozlesmesi: ekran listesi, mesajlar, varsayilan ekran ve koleksiyonlar. Metinler locales/ dosyalarindadir (messages bos);
// ekran cizimi (mount) gorunum katmaninin isidir, bu dosya yalniz sozlesmeyi disa aktarir.
import { COLLECTIONS } from "./logic/schema.js";

export const id = "petcare";
export const screens = Object.freeze([{ id: "today" }, { id: "calendar" }, { id: "clients" }, { id: "reminders" }, { id: "income" }]);
export const messages = Object.freeze({});
export const defaultScreen = "today";
export const collections = COLLECTIONS;

export default { id, screens, messages, defaultScreen, collections };
