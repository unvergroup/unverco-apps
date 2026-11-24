// Bugun ekrani (varsayilan): bugunun tarihi + randevu sayisi, 08:00-20:00 zaman cizelgesi, randevu kartlari (saat, hayvan + emoji, hizmet,
// musteri, durum rozeti, asi rozeti, WhatsApp / Hatirla simgeleri), karta tiklayinca ayrinti, sag altta "+" butonu. Bos gunde "Schedule one" baglantisi.
// Altta "Yaklasan asilar" karti: son tarihi 30 gun icinde olan ya da gecen hayvanlar.
import { todayIso } from "../../../core/dates.js";
import { button, emptyState, h } from "../../../core/ui.js";
import { getAppointmentsForDate } from "../logic/appointments.js";
import { vaccinesDue } from "../logic/pets.js";
import { appointmentCard, fmtTime, loadAll, openAppointmentDetail, openAppointmentForm, petAvatar, vaccineBadge } from "./common.js";
import { printToday } from "../print/screens.js";
import { openReminderSheet } from "./reminders.js";

const DAY_START = 8;
const DAY_END = 20;

export async function mountToday(ctx, root) {
  const { t, tn, formatDate } = ctx.i18n;
  const today = todayIso();
  let data = await loadAll(ctx);

  const head = h("div", { class: "page-head" });
  const body = h("div", { class: "today-body" });
  const vax = h("section", { class: "card stack vax-card", "aria-label": t("vax.title") });
  const create = async () => { if (await openAppointmentForm(ctx, { date: today })) await reload(); };
  const open = (a) => openAppointmentDetail(ctx, a.id, reload);
  const remind = (a) => openReminderSheet(ctx, a.id, reload);

  // Yaklasan / gecmis asilar (tum hayvanlar); yoksa kart hic gorunmez.
  function paintVaccines() {
    const due = vaccinesDue(data, today);
    vax.hidden = !due.length;
    if (!due.length) { vax.replaceChildren(); return; }
    vax.replaceChildren(
      h("h3", { text: t("vax.title") }),
      h("p", { class: "muted", text: t("vax.hint") }),
      h("ul", { class: "vax-list" }, ...due.slice(0, 5).map(({ pet, client }) => h("li", { "data-pet": pet.id },
        h("a", { class: "vax-row", href: `#/clients/${encodeURIComponent(pet.clientId)}`, "aria-label": `${pet.name}, ${client?.name ?? ""}` },
          petAvatar(pet, { size: "sm" }),
          h("span", { class: "vax-who" }, h("strong", { text: pet.name }), h("span", { class: "muted", text: client?.name ?? "" })),
          vaccineBadge(ctx, pet, today))))));
  }

  function paint() {
    paintVaccines();
    const list = getAppointmentsForDate(data, today);
    head.replaceChildren(
      h("div", {},
        h("h2", { text: t("today.title") }),
        h("p", { class: "page-date", text: formatDate(today, { dateStyle: "full" }) })),
      h("p", { class: "count-pill", role: "status", text: tn("today.count", list.length) }));
    if (!list.length) {
      body.replaceChildren(emptyState({ title: t("today.empty"), text: t("today.emptyHint") }),
        h("p", { class: "center" }, button({ id: "today-schedule", label: t("today.schedule"), variant: "primary", onClick: create })));
      return;
    }
    const hours = list.map((a) => Number(a.time.slice(0, 2)));
    const first = Math.min(DAY_START, ...hours);
    const last = Math.max(DAY_END, ...hours);
    const rows = [];
    for (let hr = first; hr <= last; hr += 1) {
      const slot = list.filter((a) => Number(a.time.slice(0, 2)) === hr);
      const label = fmtTime(ctx, `${String(hr).padStart(2, "0")}:00`);
      rows.push(h("li", { class: `slot${slot.length ? "" : " slot-empty"}`, "data-hour": hr },
        h("span", { class: "slot-time", text: label }),
        h("div", { class: "slot-cards" }, ...slot.map((a) => appointmentCard(ctx, a, data, { onOpen: open, onRemind: remind })))));
    }
    body.replaceChildren(h("ol", { class: "timeline", "aria-label": t("today.timeline") }, ...rows));
  }

  async function reload() { data = await loadAll(ctx); paint(); }
  ctx.onExternalChange(reload);
  const printBtn = button({ id: "today-print", glyph: "print", label: t("pl.btn.today"), exportAction: true, onClick: () => printToday(ctx, { data, today }) });
  root.replaceChildren(head, h("div", { class: "row print-row" }, printBtn), vax, body, h("button", { type: "button", class: "fab", id: "fab-new", "aria-label": t("today.new"), text: "+", on: { click: create } }));
  paint();
}
