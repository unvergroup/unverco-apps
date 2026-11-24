// Hatirlatmalar ekrani (#/reminders) ve "Hatirla" penceresi. Yaklasan (bugun + 14 gun) randevular gun gun listelenir; her satirda
// WhatsApp / SMS / e-posta dugmesi (mesaj hazir acilir) ve "gonderildi" isareti. Durum randevu kaydinda (reminderSentAt) cihazda durur.
// Sunucu, abonelik ya da otomatik gonderim YOKTUR: baglantilar yalniz kullanici dokununca cihazin kendi uygulamasini acar.
import { todayIso } from "../../../core/dates.js";
import { guardWrite } from "../../../core/safe.js";
import { button, emptyState, field, h } from "../../../core/ui.js";
import { REMINDER_DAYS, filterReminders, getReminders, isReminderSent, mailtoUrl, reminderCounts } from "../logic/reminders.js";
import { fmtTime, linkButton, loadAll, messageFor, openAppointmentDetail, openModal, petAvatar, serviceName, smsUrl, statusChip, toInternational, vaccineBadge, waUrl } from "./common.js";

const FILTERS = ["pending", "sent", "all"];

// Bir randevu icin mesaj metni ve uc kanalin baglantilari (telefon / e-posta yoksa ilgili baglanti bos).
export function reminderLinks(ctx, { appt, client, pet, businessName, text }) {
  const body = text ?? messageFor(ctx, "reminderDate", { appt, client, pet, businessName });
  const num = toInternational(client?.phone, ctx.settings.locale);
  const subject = ctx.i18n.t("rem.emailSubject", { petName: pet?.name ?? "", businessName });
  return { text: body, wa: num ? waUrl(num, body) : "", sms: num ? smsUrl(num, body) : "", mail: mailtoUrl(client?.email, subject, body), subject, num };
}

// WhatsApp / SMS / E-posta baglanti dugmeleri; { nodes, update(text) } (update: duzenlenen mesajla baglantilari yeniler).
export function channelButtons(ctx, ctxData, { text } = {}) {
  const { t } = ctx.i18n;
  const { client } = ctxData;
  const links = reminderLinks(ctx, { ...ctxData, text });
  const who = client?.name ?? "";
  const wa = links.wa ? linkButton({ href: links.wa, label: t("msg.whatsapp"), glyph: "chat", cls: "btn-wa", ariaLabel: `${t("msg.whatsapp")}: ${who}`, external: true }) : null;
  const sms = links.sms ? linkButton({ href: links.sms, label: t("msg.sms"), glyph: "sms", ariaLabel: `${t("msg.sms")}: ${who}` }) : null;
  const mail = links.mail ? linkButton({ href: links.mail, label: t("rem.email"), glyph: "mail", ariaLabel: `${t("rem.email")}: ${who}` }) : null;
  const update = (next) => {
    const l = reminderLinks(ctx, { ...ctxData, text: next });
    if (wa) wa.href = l.wa;
    if (sms) sms.href = l.sms;
    if (mail) mail.href = l.mail;
  };
  for (const [a, k] of [[wa, "wa"], [sms, "sms"], [mail, "mail"]]) if (a) a.dataset.channel = k;
  return { nodes: [wa, sms, mail].filter(Boolean), update };
}

// Gonderildi / gonderilmedi isareti (depoya yazar).
export const setReminderSent = (ctx, id, sent) => ctx.store.update("appointments", id, { reminderSentAt: sent ? new Date().toISOString() : "" });

const sentBadge = (ctx, a) => h("span", { class: `badge ${isReminderSent(a) ? "badge-ok" : "badge-warn"} rem-badge`, "data-sent": String(isReminderSent(a)), text: ctx.i18n.t(isReminderSent(a) ? "rem.status.sent" : "rem.status.pending") });

// ---------- "Hatirla" penceresi ----------
export async function openReminderSheet(ctx, id, onChange) {
  const { t, formatDate } = ctx.i18n;
  const body = h("div", { class: "stack detail-body" });
  const m = openModal(ctx, { title: t("rem.sheetTitle"), children: [body], className: "detail-dialog" });
  const guard = guardWrite((e) => ctx.fail(e));
  let custom = null; // kullanicinin duzenledigi metin (yeniden cizimde korunur)
  const changed = () => { if (onChange) Promise.resolve(onChange()).catch((e) => ctx.fail(e)); };

  async function paint() {
    const data = await loadAll(ctx);
    const a = data.appointments.find((x) => x.id === id);
    if (!a) { m.close(); return; }
    const client = data.cById.get(a.clientId);
    const pet = data.pById.get(a.petId);
    const ctxData = { appt: a, client, pet, businessName: data.businessName };
    const first = reminderLinks(ctx, { ...ctxData, text: custom ?? undefined }).text;
    const box = field({ label: t("rem.message"), value: first, multiline: true, hint: t("rem.messageHint"), maxlength: 1000 });
    box.input.rows = 5;
    const ch = channelButtons(ctx, ctxData, { text: first });
    box.input.addEventListener("input", () => { custom = box.input.value; ch.update(custom); });
    const sent = isReminderSent(a);
    body.replaceChildren(
      h("p", { class: "rem-who" }, petAvatar(pet, { size: "md" }),
        h("span", {}, h("strong", { text: `${pet?.name ?? t("common.unknown")} · ${client?.name ?? t("common.unknown")}` }), h("br"),
          h("span", { class: "muted", text: `${formatDate(a.date, { dateStyle: "full" })} · ${fmtTime(ctx, a.time)} · ${serviceName(ctx, a.service)}` }))),
      h("div", { class: "row" }, sentBadge(ctx, a), sent ? h("span", { class: "muted", text: t("rem.sentAt", { when: formatDate(a.reminderSentAt, { dateStyle: "medium", timeStyle: "short" }) }) }) : null),
      box.element,
      ch.nodes.length ? h("div", { class: "row rem-channels" }, ...ch.nodes) : h("p", { class: "banner banner-warn", role: "status", text: t("rem.noContact") }),
      ch.nodes.length && !sent ? h("p", { class: "muted", text: t("rem.hint") }) : null,
      h("div", { class: "row" },
        button({ id: "rem-toggle", label: t(sent ? "rem.markUnsent" : "rem.markSent"), variant: sent ? "secondary" : "primary",
          onClick: guard(async () => { await setReminderSent(ctx, a.id, !sent); ctx.notify(t(sent ? "rem.markedUnsent" : "rem.markedSent"), "success"); await paint(); changed(); }, "rem-toggle") }),
        button({ id: "rem-close", label: t("common.close"), onClick: () => m.close() })));
  }
  await paint();
  return m.done;
}

// ---------- ekran ----------
export async function mountReminders(ctx, root) {
  const { t, formatDate, formatNumber } = ctx.i18n;
  const guard = guardWrite((e) => ctx.fail(e));
  const state = { filter: "pending" };
  let data = await loadAll(ctx);
  const head = h("div", { class: "page-head" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": t("rem.filter") });
  const body = h("div", { class: "stack rem-body" });

  const row = (a) => {
    const client = data.cById.get(a.clientId);
    const pet = data.pById.get(a.petId);
    const sent = isReminderSent(a);
    const vax = vaccineBadge(ctx, pet);
    const ch = channelButtons(ctx, { appt: a, client, pet, businessName: data.businessName });
    const info = h("button", { type: "button", class: "rem-info", "aria-label": `${fmtTime(ctx, a.time)}, ${pet?.name ?? ""}, ${client?.name ?? ""}, ${serviceName(ctx, a.service)}`, on: { click: () => openAppointmentDetail(ctx, a.id, reload) } },
      h("span", { class: "appt-time", text: fmtTime(ctx, a.time) }),
      h("span", { class: "appt-title" }, petAvatar(pet, { size: "sm" }), h("strong", { text: pet?.name ?? t("common.unknown") })),
      h("span", { class: "appt-service", text: serviceName(ctx, a.service) }),
      h("span", { class: "appt-client muted", text: client?.name ?? t("common.unknown") }),
      h("span", { class: "rem-badges" }, sentBadge(ctx, a), statusChip(ctx, a.status), vax));
    const mark = button({
      id: `rem-mark-${a.id}`, label: t(sent ? "rem.markUnsent" : "rem.markSent"), variant: sent ? "secondary" : "primary",
      onClick: guard(async () => { await setReminderSent(ctx, a.id, !sent); ctx.notify(t(sent ? "rem.markedUnsent" : "rem.markedSent"), "success"); await reload(true); }, `mark-${a.id}`),
    });
    return h("article", { class: "rem-card", "data-appt": a.id, "data-sent": String(sent), "data-status": a.status },
      info,
      sent ? h("p", { class: "muted rem-sent-at", text: t("rem.sentAt", { when: formatDate(a.reminderSentAt, { dateStyle: "medium", timeStyle: "short" }) }) }) : null,
      h("div", { class: "rem-actions" }, ...ch.nodes, mark),
      ch.nodes.length ? null : h("p", { class: "muted rem-nocontact", text: t("rem.noContact") }));
  };

  function paint() {
    const all = getReminders(data);
    const counts = reminderCounts(all);
    const shown = filterReminders(all, state.filter);
    head.replaceChildren(
      h("h2", { text: t("rem.title") }),
      h("p", { class: "count-pill", role: "status", id: "rem-count", text: t("rem.pendingCount", { n: formatNumber(counts.pending) }) }));
    chips.replaceChildren(...FILTERS.map((f) => h("button", {
      type: "button", class: "chip", id: `rem-filter-${f}`, "aria-pressed": String(state.filter === f),
      text: `${t(`rem.filter.${f}`)} (${formatNumber(f === "all" ? counts.total : counts[f])})`,
      on: { click: () => { state.filter = f; paint(); document.getElementById(`rem-filter-${f}`)?.focus(); } },
    })));
    const intro = h("p", { class: "muted rem-intro", text: t("rem.intro", { days: REMINDER_DAYS }) });
    if (!shown.length) {
      const key = !all.length ? "rem.emptyNone" : state.filter === "sent" ? "rem.emptySent" : "rem.emptyPending";
      body.replaceChildren(intro, emptyState({ title: t(key), text: !all.length ? t("rem.emptyNoneHint", { days: REMINDER_DAYS }) : undefined }));
      return;
    }
    const days = [...new Set(shown.map((a) => a.date))];
    const today = todayIso();
    body.replaceChildren(intro, ...days.map((d) => h("section", { class: "stack rem-day", "data-day": d },
      h("h3", { text: `${formatDate(d, { dateStyle: "full" })}${d === today ? ` · ${t("common.today")}` : ""}` }),
      h("div", { class: "appt-list" }, ...shown.filter((a) => a.date === d).map(row)))));
  }

  async function reload(refocus = false) {
    data = await loadAll(ctx);
    paint();
    if (refocus) body.querySelector(".rem-card button, .rem-card a")?.focus({ preventScroll: true });
  }
  ctx.onExternalChange(reload);
  root.replaceChildren(head, chips, body);
  paint();
}
