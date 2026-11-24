// Pet Business Tracker ekranlarinin ortak yardimcilari: veri yukleme, rozet / emoji, saat bicimi, iletisim baglantilari (tel, WhatsApp, SMS, e-posta),
// mesaj sablonlari, .ics takvim dosyasi, modal / form kabugu, randevu karti, randevu ayrintisi ve randevu formu.
// Kullanici verisi YALNIZ textContent / metin dugumu ile yazilir (core/ui.js h()). Disariya veri GONDERILMEZ: WhatsApp / SMS baglantilari
// yalniz kullanici tikladiginda cihazin kendi uygulamasini acar; .ics dosyasi cihazda uretilir ve indirilir.
import { isIsoDate, todayIso } from "../../../core/dates.js";
import { downloadText } from "../../../core/files.js";
import { localizeNumber, parseMoneyText } from "../../../core/number-input.js";
import { formatMinorPlain } from "../../../core/money.js";
import { guardWrite } from "../../../core/safe.js";
import { newRecordId } from "../../../core/store.js";
import { button, field, focusFirstInvalid, h, nextId, select } from "../../../core/ui.js";
import { hasConflict } from "../logic/appointments.js";
import { DEFAULT_DURATION, endTimeOf } from "../logic/calc.js";
import { vaccineStatus } from "../logic/pets.js";
import { MAX_OCCURRENCES, RECURRENCE_RULES, generateRecurring } from "../logic/recurrence.js";
import { REMINDER_STATUSES, isReminderSent, mailtoUrl } from "../logic/reminders.js";
import { LIMITS, PAYMENT_METHODS, SERVICES, cleanRecord, isPhotoDataUrl, validateAppointment } from "../logic/schema.js";
import { isActive, isClosed, nextStatuses, pathToCompleted } from "../logic/status.js";
import { printReceipt } from "../print/receipt.js";
import { icon as iconSvg } from "../../../core/icons.js";

// ---------- sabitler ve kucuk yardimcilar ----------
// Tur simgesi YALNIZ native <option> etiketlerinde kullanilir (oraya SVG konamaz); arayuzun geri kalani monokrom SVG ikon kullanir.
export const SPECIES_EMOJI = Object.freeze({ dog: "🐕", cat: "🐈", bird: "🐦", rabbit: "🐰", fish: "🐟", reptile: "🦎", other: "🐾" });
export const speciesEmoji = (species) => SPECIES_EMOJI[species] ?? SPECIES_EMOJI.other;
export const serviceName = (ctx, key) => (SERVICES.includes(key) ? ctx.i18n.t(`service.${key}`) : String(key ?? ""));
export const personName = (c, ctx) => (c && c.name ? c.name : ctx.i18n.t("common.unknown"));

// Yuvarlak pet resmi: fotograf varsa kucuk resim (yalniz dogrulanmis JPEG data-URL), yoksa adin bas harfi. size: "sm" | "md" | "lg".
// Resim sus amaclidir (alt bos): yaninda zaten pet adi yazar. src dogrudan atanir (h() data: adresini reddeder).
export function petAvatar(pet, { size = "sm" } = {}) {
  const cls = `pet-avatar pet-avatar-${size}`;
  if (pet && isPhotoDataUrl(pet.photo)) {
    const img = h("img", { class: cls, alt: "", "aria-hidden": "true", decoding: "async" });
    img.src = pet.photo;
    return img;
  }
  const first = [...String(pet?.name ?? "").trim()][0];
  return first
    ? h("span", { class: `${cls} pet-avatar-ph`, "aria-hidden": "true", text: first.toLocaleUpperCase() })
    : h("span", { class: `${cls} pet-avatar-ph pet-avatar-paw`, "aria-hidden": "true" }, iconSvg("paw", { size: 18 }));
}

// Asi rozeti: son tarih 30 gun icindeyse altin, gectiyse turuncu; tarih yoksa / uzaksa null.
export function vaccineBadge(ctx, pet, today = todayIso()) {
  const { tn, t } = ctx.i18n;
  const v = vaccineStatus(pet, today);
  if (v.state !== "soon" && v.state !== "overdue") return null;
  const text = v.state === "overdue" ? tn("vax.overdue", -v.days) : v.days === 0 ? t("vax.today") : tn("vax.soon", v.days);
  return h("span", { class: `badge vax-badge vax-${v.state}`, "data-vax": v.state }, iconSvg("shield", { size: 14, cls: "ico-badge" }), text);
}

// Saat "HH:MM" -> cihazin bicimi (12 / 24 saat).
export function fmtTime(ctx, hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(typeof hhmm === "string" ? hhmm : "");
  return m ? ctx.i18n.formatDate(new Date(2000, 0, 1, Number(m[1]), Number(m[2])), { timeStyle: "short" }) : "";
}

// Tum veri + isletme adi. cById / pById: kimlikten kayda.
export async function loadAll(ctx) {
  const [clients, pets, appointments, expenses] = await Promise.all(["clients", "pets", "appointments", "expenses"].map((n) => ctx.store.list(n)));
  const biz = ctx.business ? await ctx.business.get() : { name: "" };
  return {
    clients, pets, appointments, expenses,
    cById: new Map(clients.map((c) => [c.id, c])),
    pById: new Map(pets.map((p) => [p.id, p])),
    businessName: biz.name || ctx.i18n.t("app.title"),
  };
}

// Durum rozeti: renk CSS'te data-status ile verilir (mavi / mor / turuncu / yesil / gri / kirmizi).
export const statusChip = (ctx, status) => h("span", { class: "badge status-badge", "data-status": status, text: ctx.i18n.t(`status.${status}`) });

export const kv = (rows) => h("dl", { class: "kv" }, rows.filter(([, v]) => v !== "" && v !== null && v !== undefined).flatMap(([k, v]) => [h("dt", { text: k }), h("dd", {}, v)]));

// Yas: dogum tarihinden "2 yil 3 ay" (dile gore); gecersiz / gelecek -> "".
export function ageText(ctx, birthDate, today = todayIso()) {
  if (typeof birthDate !== "string" || !isIsoDate(birthDate) || birthDate > today) return "";
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const { tn } = ctx.i18n;
  const parts = [];
  if (years > 0) parts.push(tn("pet.ageYears", years));
  if (rest > 0 || years === 0) parts.push(tn("pet.ageMonths", rest));
  return parts.join(" ");
}

// Agirlik (gram) -> "4,5 kg"; 0 -> "".
export const weightText = (ctx, grams) => (Number.isFinite(grams) && grams > 0 ? ctx.i18n.t("pet.weightKg", { n: ctx.i18n.formatNumber(grams / 1000, { maximumFractionDigits: 1 }) }) : "");

// ---------- iletisim baglantilari ----------
const CALLING_CODE = { US: "1", CA: "1", GB: "44", AU: "61", ES: "34", MX: "52", FR: "33", DE: "49", CH: "41", TR: "90" };

// Telefonu uluslararasi bicime (yalniz rakam, "+" yok) cevirir; cevrilemezse "". "+..." ve "00..." oldugu gibi; ulusal numaralarda
// bicim ayarinin ulkesinin kodu eklenir (basindaki tek 0 atilir; ABD / Kanada'da 10 hane -> 1 eklenir).
export function toInternational(phone, locale = "en-US") {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return "";
  let out;
  if (raw.startsWith("+")) out = digits;
  else if (digits.startsWith("00")) out = digits.slice(2);
  else {
    const cc = CALLING_CODE[String(locale).split("-")[1]?.toUpperCase()] ?? "";
    if (!cc) out = digits.replace(/^0+/, "");
    else if (cc === "1") out = digits.length === 10 ? `1${digits}` : digits;
    else if (digits.startsWith("0")) out = cc + digits.replace(/^0+/, "");
    else out = digits.startsWith(cc) && digits.length >= cc.length + 9 ? digits : cc + digits;
  }
  return out.length >= 7 && out.length <= 15 ? out : "";
}

export const waUrl = (num, text) => `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
export const smsUrl = (num, text) => `sms:+${num}${text ? `?body=${encodeURIComponent(text)}` : ""}`;
export const telUrl = (num) => `tel:+${num}`;
// Guvenli yol: logic/reminders.js mailtoUrl (siki dogrulama + kodlama). Gecersiz adres -> "" (baglanti gosterilmez).
export const mailUrl = (email) => mailtoUrl(email);

// Baglanti dugmesi (a etiketi, dugme gorunumlu). Yeni sekmede acilir; opener verilmez.
export function linkButton({ href, label, glyph, cls = "", ariaLabel, external = false, onClick }) {
  return h("a", {
    class: `btn ${cls}`.trim(), href, "aria-label": ariaLabel,
    target: external ? "_blank" : undefined, rel: external ? "noopener noreferrer" : undefined,
    on: onClick ? { click: onClick } : undefined,
  }, glyph ? iconSvg(glyph, { size: 18 }) : null, label ? h("span", { text: label }) : null);
}

// ---------- mesaj sablonlari ----------
export const MESSAGE_KINDS = Object.freeze(["confirm", "reminder", "completed"]);

// Randevu durumuna uygun varsayilan mesaj: tamamlandi -> tesekkur, planli -> onay, digerleri -> hatirlatma.
export const defaultKind = (status) => (status === "completed" ? "completed" : status === "scheduled" ? "confirm" : "reminder");

export function messageFor(ctx, kind, { appt, client, pet, businessName }) {
  const { t, formatDate } = ctx.i18n;
  // "reminder" HER ZAMAN tarihli sablonu kullanir (sabit "yarin" metni yok); tur etiketleri (MESSAGE_KINDS) ayni kalir.
  const tpl = kind === "reminder" ? "reminderDate" : kind;
  return t(`msg.${tpl}Template`, {
    clientName: client?.name ?? "",
    petName: pet?.name ?? "",
    service: serviceName(ctx, appt.service),
    date: formatDate(appt.date, { dateStyle: "full" }),
    time: fmtTime(ctx, appt.time),
    price: ctx.money.format(Number.isSafeInteger(appt.price) ? appt.price : 0),
    businessName,
  });
}

// WhatsApp + SMS dugmeleri. Telefon uluslararasi bicime cevrilemezse bos dizi doner.
export function messageButtons(ctx, client, text, { compact = false } = {}) {
  const { t } = ctx.i18n;
  const num = toInternational(client?.phone, ctx.settings.locale);
  if (!num) return [];
  const wa = linkButton({
    href: waUrl(num, text), label: compact ? "" : t("msg.whatsapp"), glyph: "chat", cls: `btn-wa${compact ? " btn-icon" : ""}`,
    ariaLabel: `${t("msg.whatsapp")}: ${client?.name ?? ""}`, external: true,
    onClick: () => ctx.notify(t("msg.reminderSent"), "success"),
  });
  const sms = linkButton({ href: smsUrl(num, text), label: compact ? "" : t("msg.sms"), glyph: "sms", cls: compact ? "btn-icon" : "", ariaLabel: `${t("msg.sms")}: ${client?.name ?? ""}` });
  return [wa, sms];
}

// ---------- takvim (.ics) ----------
const icsEscape = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsFold = (line) => {
  const chars = Array.from(line);
  const out = [];
  for (let i = 0; i < chars.length; i += 60) out.push(chars.slice(i, i + 60).join(""));
  return out.join("\r\n ");
};
const utcStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

// RFC 5545 takvim metni (yerel / "yuzen" saat). labels: { client, pet, service } (dile gore etiketler).
export function buildIcs({ appt, client, pet, serviceLabel, labels, now = new Date() }) {
  const dur = Number.isInteger(appt.duration) && appt.duration > 0 ? appt.duration : DEFAULT_DURATION;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UNVERCO//Pet Business Tracker//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${icsEscape(appt.id ?? `${appt.date}-${appt.time}`)}@unvercopbt.local`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${appt.date.replaceAll("-", "")}T${appt.time.replace(":", "")}00`,
    `DURATION:PT${dur}M`,
    `SUMMARY:${icsEscape(`${serviceLabel} - ${pet?.name ?? ""}`)}`,
    `DESCRIPTION:${icsEscape(`${labels.client}: ${client?.name ?? ""}\n${labels.pet}: ${pet?.name ?? ""}\n${labels.service}: ${serviceLabel}`)}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

export function downloadIcs(ctx, appt, client, pet) {
  const { t } = ctx.i18n;
  const text = buildIcs({ appt, client, pet, serviceLabel: serviceName(ctx, appt.service), labels: { client: t("msg.ics.client"), pet: t("msg.ics.pet"), service: t("msg.ics.service") } });
  downloadText(`appointment-${appt.date}-${appt.time.replace(":", "")}.ics`, text, "text/calendar");
}

// ---------- modal / form kabugu ----------
// Yerel <dialog>: ustte baslik + kapat dugmesi; dar ekranda tam ekran (app.css .sheet).
export function openModal(ctx, { title, children, className = "" }) {
  const titleId = nextId("mt");
  const dlg = h("dialog", { class: `dialog sheet ${className}`.trim(), "aria-labelledby": titleId });
  dlg.append(
    h("div", { class: "sheet-head" },
      h("h2", { id: titleId, text: title }),
      h("button", { type: "button", class: "btn btn-icon sheet-close", "aria-label": ctx.i18n.t("common.close"), text: "×", on: { click: () => dlg.close() } })),
    ...children);
  const done = new Promise((resolve) => dlg.addEventListener("close", () => { dlg.remove(); resolve(); }));
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close: () => dlg.close(), done };
}

// Form penceresi. groups: [{ legend, nodes }]; onSave(form) -> true (kaydedildi, kapat) | false (dogrulama hatasi, acik kal).
// Doner: Promise<boolean> (kaydedildi mi).
export function openForm(ctx, { title, groups, onSave, saveLabel }) {
  const { t } = ctx.i18n;
  return new Promise((resolve) => {
    let saved = false;
    const guard = guardWrite((e) => ctx.fail(e));
    const form = h("form", { class: "form-sheet", novalidate: true },
      ...groups.map((g) => h("fieldset", { class: "form-group" }, h("legend", { text: g.legend }), ...g.nodes)),
      h("div", { class: "dialog-actions" },
        button({ label: t("common.cancel"), onClick: () => m.close() }),
        button({ id: "form-save", label: saveLabel ?? t("common.save"), variant: "primary", type: "submit" })));
    form.addEventListener("submit", guard(async () => {
      if (await onSave(form)) { saved = true; m.close(); } else focusFirstInvalid(form);
    }, "form-save"));
    const m = openModal(ctx, { title, children: [form], className: "form-dialog" });
    m.done.then(() => resolve(saved));
    form.querySelector("input:not([type=checkbox]), select, textarea")?.focus();
  });
}

// Secim alani + hata satiri (ui.select hata gostermez).
export function selectField(opts) {
  const s = select(opts);
  const err = h("p", { class: "field-error", role: "alert" });
  s.element.append(err);
  s.setError = (msg) => { err.textContent = msg || ""; s.input.setAttribute("aria-invalid", msg ? "true" : "false"); };
  return s;
}

// Dogrulama kodu -> metin (schema.js hata kodlari).
export function errText(ctx, code, max) {
  const { t } = ctx.i18n;
  switch (code) {
    case "required": return t("msg.required");
    case "too_long": return t("msg.tooLong", { max });
    case "email": return t("msg.invalidEmail");
    case "phone": return t("msg.invalidPhone");
    case "future": return t("msg.futureDate");
    case "range": return t("msg.outOfRange");
    default: return t("msg.invalidValue");
  }
}

// ---------- randevu karti ----------
// Ana alan tiklaninca ayrinti acilir (dugme); WhatsApp / Hatirla simgeleri ayri baglantidir (ic ice etkilesimli oge yok).
// onRemind(a): verilirse yaklasan, hatirlatilabilir randevuda "Hatirla" simgesi cikar.
export function appointmentCard(ctx, a, data, { onOpen, onRemind, showDate = false, wa = true } = {}) {
  const { t, formatDate } = ctx.i18n;
  const pet = data.pById.get(a.petId);
  const client = data.cById.get(a.clientId);
  const when = `${showDate ? `${formatDate(a.date, { weekday: "short", day: "numeric", month: "short" })} · ` : ""}${fmtTime(ctx, a.time)}${a.endTime ? ` – ${fmtTime(ctx, a.endTime)}` : ""}`;
  const vax = isActive(a.status) ? vaccineBadge(ctx, pet) : null;
  const summary = `${when}, ${pet?.name ?? ""}, ${serviceName(ctx, a.service)}, ${client?.name ?? ""}, ${t(`status.${a.status}`)}${vax ? `, ${vax.textContent.trim()}` : ""}`;
  const main = h("button", { type: "button", class: "appt-main", "aria-label": summary, on: { click: () => onOpen(a) } },
    h("span", { class: "appt-time", text: when }),
    h("span", { class: "appt-title" }, petAvatar(pet, { size: "sm" }), h("strong", { text: pet?.name ?? t("common.unknown") })),
    h("span", { class: "appt-service", text: serviceName(ctx, a.service) }),
    h("span", { class: "appt-client muted", text: client?.name ?? t("common.unknown") }),
    statusChip(ctx, a.status),
    vax);
  const waBtns = wa && client && isActive(a.status) ? messageButtons(ctx, client, messageFor(ctx, "reminderDate", { appt: a, client, pet, businessName: data.businessName }), { compact: true }).slice(0, 1) : [];
  const canRemind = typeof onRemind === "function" && client && REMINDER_STATUSES.includes(a.status) && a.date >= todayIso();
  const remindBtn = canRemind
    ? h("button", { type: "button", class: `btn btn-icon btn-remind${isReminderSent(a) ? " is-sent" : ""}`, "data-remind": a.id, "aria-label": `${t("rem.remind")}: ${client.name}${isReminderSent(a) ? ` (${t("rem.status.sent")})` : ""}`, on: { click: () => onRemind(a) } },
        iconSvg(isReminderSent(a) ? "sent" : "bell", { size: 20 }))
    : null;
  return h("article", { class: "appt-card", "data-status": a.status, "data-appt": a.id }, main, waBtns.length || remindBtn ? h("div", { class: "appt-actions" }, ...waBtns, remindBtn) : null);
}

// ---------- randevu ayrintisi ----------
// Her cizimde taze veri okunur; durum / odeme degisince ayni pencerede yeniden cizilir. onChange: arkadaki ekrani yenile.
export async function openAppointmentDetail(ctx, id, onChange) {
  const { t, formatDate } = ctx.i18n;
  const body = h("div", { class: "stack detail-body" });
  const m = openModal(ctx, { title: t("appt.detail"), children: [body], className: "detail-dialog" });
  const guard = guardWrite((e) => ctx.fail(e));
  let kind = null;

  const changed = () => { if (onChange) Promise.resolve(onChange()).catch((e) => ctx.fail(e)); };
  const mutate = (fn, key) => guard(async () => { await fn(); await paint(); changed(); }, key);

  async function paint() {
    const data = await loadAll(ctx);
    const a = data.appointments.find((x) => x.id === id);
    if (!a) { m.close(); return; }
    const client = data.cById.get(a.clientId);
    const pet = data.pById.get(a.petId);
    kind = kind ?? defaultKind(a.status);

    const info = kv([
      [t("appt.pet"), h("span", { class: "pet-line" }, petAvatar(pet, { size: "sm" }), pet?.name ?? t("common.unknown"))],
      [t("appt.client"), client?.name ?? t("common.unknown")],
      [t("appt.date"), formatDate(a.date, { dateStyle: "full" })],
      [t("appt.time"), `${fmtTime(ctx, a.time)} – ${fmtTime(ctx, a.endTime)} (${t("appt.minutes", { n: a.duration })})`],
      [t("appt.service"), serviceName(ctx, a.service)],
      [t("appt.serviceNote"), a.serviceNote],
      [t("appt.price"), ctx.money.format(a.price ?? 0)],
      [t("appt.payment"), a.paid ? `${t("payment.paid")}${a.paymentMethod ? ` · ${t(`payment.${a.paymentMethod}`)}` : ""}` : t("payment.pending")],
      [t("appt.recurrence"), a.recurrenceRule ? t(`appt.rec.${a.recurrenceRule}`) : ""],
      [t("appt.reminder"), isReminderSent(a) ? t("rem.sentAt", { when: formatDate(a.reminderSentAt, { dateStyle: "medium", timeStyle: "short" }) }) : ""],
      [t("appt.note"), a.note],
    ]);

    // durum gecisleri (kapali durumlar "Planlandi"ya geri alinabilir: gelir toplamlari kayitlardan yeniden hesaplanir)
    const moves = nextStatuses(a.status).map((to) => button({
      id: `move-${to}`, label: t(`appt.action.${to}`), variant: to === "cancelled" || to === "no_show" ? "danger" : to === "scheduled" ? "secondary" : "primary",
      onClick: mutate(async () => {
        if ((to === "cancelled" || to === "no_show") && !(await ctx.confirm({ title: t(`appt.action.${to}`), message: t("appt.confirmStatus", { status: t(`status.${to}`) }), confirmLabel: t(`appt.action.${to}`), danger: true }))) return;
        if (to === "scheduled" && isClosed(a.status)) {
          if (!(await ctx.confirm({ title: t("appt.reopenTitle"), message: t("appt.reopenText"), confirmLabel: t("appt.action.scheduled"), danger: false }))) return;
          if (hasConflict(data, a.date, a.time, a.duration, a.id) && !(await ctx.confirm({ title: t("appt.conflictTitle"), message: t("appt.conflictText", { n: 1 }), confirmLabel: t("appt.conflictKeep"), danger: false }))) return;
        }
        await ctx.store.update("appointments", a.id, { status: to });
      }, `move-${to}`),
    }));

    // Tek dokunusla "Tamamla": scheduled / confirmed durumunda da gorunur, zinciri (confirmed -> in_progress -> completed)
    // kendi icinde yurutur. Durum gecis kurali (TRANSITIONS) degismedi; yalniz kullaniciyi 3 dokunustan kurtarir.
    if (isActive(a.status) && a.status !== "in_progress") {
      moves.unshift(button({
        id: "move-completed", label: t("appt.action.completed"), variant: "primary",
        onClick: mutate(async () => { for (const step of pathToCompleted(a.status)) await ctx.store.update("appointments", a.id, { status: step }); }, "move-completed"),
      }));
    }

    // odeme: odendi <-> odenmedi ve tutar SONRADAN duzeltilebilir (gelir her seferinde randevulardan yeniden hesaplanir)
    const payRow = [];
    if (!a.paid && a.status !== "cancelled" && a.status !== "no_show") {
      const method = selectField({ id: `pay-method-${a.id}`, label: t("appt.paymentMethod"), value: "cash", options: PAYMENT_METHODS.map((p) => ({ value: p, label: t(`payment.${p}`) })) });
      payRow.push(h("div", { class: "row pay-row" }, method.element, button({ id: "mark-paid", label: t("btn.markPaid"), onClick: mutate(async () => {
        await ctx.store.update("appointments", a.id, { paid: true, paymentMethod: method.input.value });
        // Para alindi ve randevu gunu bugun ya da gecmis ise is bitmistir: durumu Tamamlandi'ya tasi.
        // Boylece tutar tek dokunusta "Tahsil edilen gelir"e girer (gelir = tamamlandi VE odendi).
        // Ileri tarihli (pesin odemeli) randevuya DOKUNULMAZ: isi yapilmadan gelir yazilmaz.
        if (isActive(a.status) && a.date <= todayIso()) for (const step of pathToCompleted(a.status)) await ctx.store.update("appointments", a.id, { status: step });
      }, "mark-paid") })));
    }
    if (a.paid) {
      payRow.push(h("div", { class: "row pay-row" }, button({ id: "mark-unpaid", label: t("btn.markUnpaid"), onClick: mutate(() => ctx.store.update("appointments", a.id, { paid: false, paymentMethod: "" }), "mark-unpaid") })));
    }
    const dec = ctx.i18n.decimal;
    const priceField = field({ label: t("appt.price"), value: localizeNumber(formatMinorPlain(a.price ?? 0), dec), inputmode: "decimal", autocomplete: "off" });
    priceField.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("update-price")?.click(); } });
    payRow.push(h("div", { class: "row pay-row" }, priceField.element, button({ id: "update-price", label: t("btn.updatePrice"), onClick: mutate(async () => {
      const minor = parseMoneyText(priceField.input.value.trim() === "" ? "0" : priceField.input.value, { decimal: dec });
      if (Number.isNaN(minor) || minor < 0 || minor > LIMITS.price) { priceField.setError(t("msg.invalidAmount")); return; }
      priceField.setError("");
      if (minor !== a.price) await ctx.store.update("appointments", a.id, { price: minor });
      ctx.notify(t("msg.saved"), "success");
    }, "update-price") })));

    // mesajlar: WhatsApp + SMS
    const msgBox = h("div", { class: "row msg-row" });
    const paintMsg = () => {
      const text = messageFor(ctx, kind, { appt: a, client, pet, businessName: data.businessName });
      const btns = messageButtons(ctx, client, text);
      msgBox.replaceChildren(...(btns.length ? btns : [h("p", { class: "muted", text: t("msg.noPhone") })]));
      preview.textContent = text;
    };
    const preview = h("p", { class: "msg-preview muted", id: "msg-preview" });
    const kindSel = selectField({ id: "msg-kind", label: t("msg.template"), value: kind, options: MESSAGE_KINDS.map((k) => ({ value: k, label: t(`msg.kind.${k}`) })), onChange: (v) => { kind = v; paintMsg(); } });
    paintMsg();

    const actions = h("div", { class: "row" },
      button({ id: "btn-edit", label: t("common.edit"), onClick: async () => { m.close(); if (await openAppointmentForm(ctx, { appointment: a })) changed(); } }),
      button({ id: "btn-calendar", glyph: "calendar", label: t("msg.addToCalendar"), onClick: () => downloadIcs(ctx, a, client, pet) }),
      button({ id: "btn-print", glyph: "print", label: t("btn.printReceipt"), exportAction: true, onClick: () => printReceipt(ctx, { appointment: a, client, pet, serviceLabel: serviceName(ctx, a.service) }) }),
      button({ id: "btn-delete", label: t("common.delete"), variant: "danger", onClick: async () => {
        if (!(await ctx.confirm({ title: t("appt.deleteTitle"), message: t("appt.deleteText") }))) return;
        try { await ctx.store.remove("appointments", a.id); } catch (e) { ctx.fail(e); return; }
        m.close(); changed();
      } }));

    body.replaceChildren(
      h("div", { class: "row detail-head" }, statusChip(ctx, a.status)),
      info,
      moves.length ? h("section", { class: "stack", "aria-label": t("appt.changeStatus") }, h("h3", { text: t("appt.changeStatus") }), h("div", { class: "row" }, ...moves)) : null,
      payRow.length ? h("section", { class: "stack pay-section", "aria-label": t("appt.payment") }, h("h3", { text: t("appt.payment") }), ...payRow) : null,
      h("section", { class: "stack", "aria-label": t("msg.section") }, h("h3", { text: t("msg.section") }), kindSel.element, preview, msgBox),
      actions);
  }
  await paint();
  return m.done;
}

// ---------- randevu formu ----------
// opts: { appointment? (duzenle), date?, clientId?, petId? } -> Promise<boolean> (kaydedildi mi)
export async function openAppointmentForm(ctx, opts = {}) {
  const { t } = ctx.i18n;
  const dec = ctx.i18n.decimal;
  const appt = opts.appointment ?? null;
  const data = await loadAll(ctx);
  if (!data.clients.length) { ctx.notify(t("msg.needClient"), "warn"); ctx.navigate("clients"); return false; }
  const pref = await ctx.pet.get();

  const byName = [...data.clients].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const startClient = appt?.clientId ?? opts.clientId ?? "";
  const clientSel = selectField({ label: t("appt.client"), value: startClient, options: [{ value: "", label: t("form.choose") }, ...byName.map((c) => ({ value: c.id, label: c.name }))], onChange: (v) => fillPets(v, "") });
  const petSel = selectField({ label: t("appt.pet"), value: "", options: [{ value: "", label: t("form.choose") }] });
  function fillPets(clientId, keep) {
    const pets = data.pets.filter((p) => p.clientId === clientId).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    petSel.input.replaceChildren(h("option", { value: "", text: pets.length || !clientId ? t("form.choose") : t("appt.noPets") }), ...pets.map((p) => h("option", { value: p.id, text: `${speciesEmoji(p.species)} ${p.name}` })));
    petSel.input.value = pets.some((p) => p.id === keep) ? keep : pets.length === 1 ? pets[0].id : "";
  }
  fillPets(startClient, appt?.petId ?? opts.petId ?? "");

  const date = field({ label: t("appt.date"), type: "date", value: appt?.date ?? opts.date ?? todayIso(), required: true });
  const time = field({ label: t("appt.time"), type: "time", value: appt?.time ?? pref.workStart, required: true });
  const duration = field({ label: t("appt.duration"), type: "number", value: String(appt?.duration ?? pref.defaultDurationMin ?? DEFAULT_DURATION), min: LIMITS.durationMin, max: LIMITS.durationMax, step: 5, inputmode: "numeric", required: true });
  const service = selectField({ label: t("appt.service"), value: appt?.service ?? "grooming", options: SERVICES.map((s) => ({ value: s, label: t(`service.${s}`) })) });
  const serviceNote = field({ label: t("appt.serviceNote"), value: appt?.serviceNote ?? "", multiline: true, maxlength: LIMITS.serviceNote });
  serviceNote.input.rows = 2;
  const price = field({ label: t("appt.price"), value: appt ? localizeNumber(formatMinorPlain(appt.price), dec) : "", inputmode: "decimal", autocomplete: "off", hint: t("form.moneyHint") });
  const paid = h("input", { type: "checkbox", id: nextId("paid"), checked: Boolean(appt?.paid) });
  const paidRow = h("label", { class: "check", for: paid.id }, paid, " ", t("payment.paid"));
  const method = selectField({ label: t("appt.paymentMethod"), value: appt?.paymentMethod || "cash", options: PAYMENT_METHODS.map((p) => ({ value: p, label: t(`payment.${p}`) })) });
  const note = field({ label: t("appt.note"), value: appt?.note ?? "", multiline: true, maxlength: LIMITS.note });
  note.input.rows = 3;

  const groups = [
    { legend: t("form.whoGroup"), nodes: [clientSel.element, petSel.element] },
    { legend: t("form.whenGroup"), nodes: [h("div", { class: "row time-row" }, date.element, time.element, duration.element)] },
    { legend: t("form.serviceGroup"), nodes: [service.element, serviceNote.element, price.element, paidRow, method.element] },
  ];
  let statusSel = null;
  if (appt) {
    statusSel = selectField({ label: t("appt.status"), value: appt.status, options: [appt.status, ...nextStatuses(appt.status)].map((s) => ({ value: s, label: t(`status.${s}`) })) });
    groups.push({ legend: t("form.statusGroup"), nodes: [statusSel.element] });
  }
  let recRule = null;
  let recCount = null;
  if (!appt) {
    recRule = selectField({ label: t("appt.recurrence"), value: "", options: [{ value: "", label: t("appt.rec.none") }, ...RECURRENCE_RULES.map((r) => ({ value: r, label: t(`appt.rec.${r}`) }))] });
    recCount = field({ label: t("appt.recCount"), type: "number", value: "4", min: 2, max: MAX_OCCURRENCES, inputmode: "numeric", hint: t("appt.recHint", { max: MAX_OCCURRENCES }) });
    groups.push({ legend: t("form.repeatGroup"), nodes: [recRule.element, recCount.element] });
  }
  groups.push({ legend: t("form.notesGroup"), nodes: [note.element] });

  return openForm(ctx, {
    title: appt ? t("appt.edit") : t("appt.new"),
    groups,
    onSave: async () => {
      const fresh = await loadAll(ctx);
      const fields = [["clientId", clientSel], ["petId", petSel], ["date", date], ["time", time], ["duration", duration], ["service", service], ["price", price], ["status", statusSel]];
      for (const [, f] of fields) f?.setError("");
      const dur = /^\d+$/.test(duration.input.value.trim()) ? Number(duration.input.value.trim()) : NaN;
      const priceText = price.input.value.trim();
      const minor = priceText === "" ? 0 : parseMoneyText(priceText, { decimal: dec });
      const rec = {
        ...(appt ?? {}),
        clientId: clientSel.input.value, petId: petSel.input.value, date: date.input.value, time: time.input.value,
        duration: dur, service: service.input.value, serviceNote: serviceNote.input.value,
        status: statusSel ? statusSel.input.value : "scheduled",
        price: Number.isNaN(minor) || minor < 0 ? -1 : minor,
        paid: paid.checked, paymentMethod: paid.checked ? method.input.value : "",
        note: note.input.value,
        // gun / saat degistiyse onceki hatirlatma artik gecersizdir
        reminderSentAt: appt && appt.date === date.input.value && appt.time === time.input.value ? appt.reminderSentAt ?? "" : "",
      };
      const v = validateAppointment(rec);
      const errs = { ...v.errors };
      if (rec.petId && !fresh.pById.get(rec.petId)) errs.petId = "required";
      if (rec.petId && rec.clientId && fresh.pById.get(rec.petId)?.clientId !== rec.clientId) errs.petId = "required";
      const show = { clientId: clientSel, petId: petSel, date, time, duration, service, price, status: statusSel };
      for (const [k, code] of Object.entries(errs)) {
        show[k]?.setError(k === "price" ? t("msg.invalidAmount") : k === "duration" ? t("msg.durationRange", { min: LIMITS.durationMin, max: LIMITS.durationMax }) : errText(ctx, code, LIMITS.note));
      }
      if (Object.keys(errs).length) return false;

      const clean = cleanRecord("appointments", rec, { keepMeta: false }).record;
      let recs = [clean];
      if (recRule && recRule.input.value) {
        const n = /^\d+$/.test(recCount.input.value.trim()) ? Number(recCount.input.value.trim()) : NaN;
        if (!(n >= 2 && n <= MAX_OCCURRENCES)) { recCount.setError(t("appt.recHint", { max: MAX_OCCURRENCES })); return false; }
        recCount.setError("");
        recs = generateRecurring({ ...clean, id: newRecordId() }, recRule.input.value, n);
      }
      // "Odendi" isaretli + randevu gunu bugun ya da gecmis -> durum Tamamlandi.
      // Yinelenen seride YALNIZ gunu gelmis olanlar tamamlanir; ileri tarihliler planli kalir.
      recs = recs.map((r) => (r.paid && isActive(r.status) && r.date <= todayIso() ? { ...r, status: "completed" } : r));
      const total = (await ctx.store.count("appointments")) + (appt ? 0 : recs.length);
      if (total > LIMITS.appointments) { ctx.notify(t("msg.limitReached", { max: LIMITS.appointments }), "error"); return false; }

      // cakisma: ayni gun, takvimde yer tutan baska randevuyla saat kesisimi -> onay iste
      if (isActive(recs[0].status)) {
        const clash = recs.filter((r) => hasConflict(fresh, r.date, r.time, r.duration, appt?.id));
        if (clash.length && !(await ctx.confirm({ title: t("appt.conflictTitle"), message: t("appt.conflictText", { n: clash.length }), confirmLabel: t("appt.conflictKeep"), danger: false }))) return false;
      }

      if (appt) await ctx.store.update("appointments", appt.id, recs[0]);
      else if (recs.length === 1) await ctx.store.add("appointments", recs[0]);
      else {
        await ctx.store.transact("appointments", (list) => {
          const ts = new Date().toISOString();
          for (const r of recs) list.push({ ...r, id: r.id ?? newRecordId(), createdAt: ts, updatedAt: ts });
          return { list, result: null };
        });
      }
      ctx.notify(t(appt ? "msg.saved" : "msg.created"), "success");
      return true;
    },
  });
}
