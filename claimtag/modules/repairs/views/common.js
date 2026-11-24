// Ekranlarin ortak yardimcilari: veri yukleme, durum rozeti, cihaz adi, sinir denetimi, radyo grubu. Kullanici verisi yalniz textContent.
import { diffDays, todayIso } from "../../../core/dates.js";
import { SIZE_STOP_BYTES, SIZE_WARN_BYTES, COUNT_WARN, usage } from "../../../core/data-actions.js";
import { h, nextId } from "../../../core/ui.js";
import { LIMITS } from "../logic/schema.js";
import { isClosed, isReady } from "../logic/status.js";
import { deviceName } from "../logic/templates.js";

export const TYPES = ["phone", "tablet", "laptop", "desktop", "other"];

export async function loadAll(ctx) {
  const [customers, devices, jobs] = await Promise.all(["customers", "devices", "jobs"].map((n) => ctx.store.list(n)));
  return { customers, devices, jobs, cById: new Map(customers.map((c) => [c.id, c])), dById: new Map(devices.map((d) => [d.id, d])) };
}

export const typeNames = (ctx) => Object.fromEntries(TYPES.map((k) => [k, ctx.i18n.t(`repairs.type.${k}`)]));
export const deviceTitle = (ctx, device) => deviceName(device, typeNames(ctx), ctx.i18n.t("repairs.type.fallback"));
// Kisa cihaz satiri: "Phone · Phone A · 3540…"
export const deviceLine = (ctx, d) => (d ? [ctx.i18n.t(`repairs.type.${d.type}`), d.model, d.serial].filter(Boolean).join(" · ") : "");

export const money = (ctx, minor) => ctx.i18n.formatCurrency(minor);
export const fmtDate = (ctx, iso) => (iso ? ctx.i18n.formatDate(iso) : "");

// Durum rozeti: acik isler mavi, bekleyenler sari, hazir yesil, kapali gri.
export function statusChip(ctx, status) {
  const cls = isReady(status) ? "badge-ok" : isClosed(status) ? "badge-muted" : status === "awaiting_approval" || status === "awaiting_part" ? "badge-warn" : "";
  return h("span", { class: `badge ${cls}`.trim(), "data-status": status, text: ctx.i18n.t(`repairs.status.${status}`) });
}

export const contactDates = (job) => (Array.isArray(job.contacts) ? job.contacts.map((c) => c.date) : []);
export const latestContact = (job) => contactDates(job).filter(Boolean).sort().pop() ?? null;
export const daysIn = (iso) => (iso ? Math.max(0, diffDays(iso, todayIso())) : 0);

// Kisa aciklama satirlari ("2 gun once", "bugun").
export function ago(ctx, iso) {
  const n = daysIn(iso);
  return n === 0 ? ctx.i18n.t("repairs.common.today") : ctx.i18n.tn("repairs.common.daysAgo", n);
}

export const errText = (ctx, code, p = {}) => {
  const { t } = ctx.i18n;
  switch (code) {
    case "required": return t("repairs.err.required");
    case "phone": return t("repairs.err.phone");
    case "phone_chars": return t("repairs.err.phoneChars");
    case "email": return t("repairs.err.email");
    case "empty": return t("repairs.err.priceEmpty");
    case "negative": return t("repairs.err.negative");
    case "too_large": return t("repairs.err.tooLarge");
    case "future": return t("repairs.err.futureDate");
    case "refund_exceeds_paid": return t("repairs.err.refund", p);
    case "qty": case "range": case "decimals": return p.kind === "tax" ? t("repairs.err.tax") : t("repairs.err.qty", { max: 999 });
    case "too_long": return t("repairs.x.tooLong");
    default: return t("repairs.err.amount");
  }
};

// Sinirlar (spec 3.9): kayit sayisi, boyut esikleri; localStorage'da daha dar sinirlar. { limits, usage, stop: ilet anahtari | null, near: [iletiler] }
export async function capacity(ctx) {
  const small = ctx.storageKind === "localStorage";
  const limits = small ? { jobs: 1200, customers: 1200, devices: 1200 } : { jobs: LIMITS.jobs, customers: LIMITS.customers, devices: LIMITS.devices };
  const u = await usage(ctx.store);
  const { t } = ctx.i18n;
  const stop = { jobs: null, customers: null, devices: null, size: null };
  if (u.jobs >= limits.jobs) stop.jobs = t("repairs.limit.jobs", { max: limits.jobs });
  if (u.customers >= limits.customers) stop.customers = t("repairs.limit.customers", { max: limits.customers });
  if (u.devices >= limits.devices) stop.devices = t("repairs.limit.devices", { max: limits.devices });
  if (u.bytes >= (small ? 4_500_000 : SIZE_STOP_BYTES)) stop.size = t("repairs.limit.size", { max: 10 });
  const near = [];
  if (small) near.push(t("repairs.storage.small", { max: limits.jobs }));
  if (u.jobs >= (small ? 1000 : COUNT_WARN)) near.push(t("repairs.limit.near", { n: u.jobs, max: limits.jobs }));
  if (u.bytes >= (small ? 3_500_000 : SIZE_WARN_BYTES)) near.push(t("repairs.limit.sizeNear", { mb: (u.bytes / 1048576).toFixed(2), max: 10 }));
  return { limits, usage: u, stop, near };
}

// Radyo grubu: { element, value (okur), set(v) }. Yerel <input type=radio>; etiket tiklanabilir.
export function radioGroup({ legend, name, options, value, onChange, hint, inline = true }) {
  const fs = h("fieldset", { class: `radios${inline ? " radios-inline" : ""}` }, h("legend", { text: legend }));
  const inputs = [];
  for (const o of options) {
    const id = nextId("r");
    const input = h("input", { type: "radio", name, id, value: o.value, checked: o.value === value, on: { change: () => { if (input.checked && onChange) onChange(o.value); } } });
    fs.append(h("label", { class: "radio", for: id }, input, h("span", { text: o.label })));
    inputs.push(input);
  }
  if (hint) fs.append(h("p", { class: "field-hint", text: hint }));
  return {
    element: fs,
    inputs,
    get value() { return inputs.find((i) => i.checked)?.value ?? null; },
    set(v) { for (const i of inputs) i.checked = i.value === v; },
  };
}

// Kisa gorunumde (<= 560 px) kapali, genis gorunumde acik <details>.
export function disclosure(title, ...children) {
  const d = h("details", { class: "disclosure" }, h("summary", { text: title }), h("div", { class: "stack" }, ...children));
  d.open = !(globalThis.matchMedia && globalThis.matchMedia("(max-width: 560px)").matches);
  return d;
}

// Is hesabi gosterimi: "Balance due: X" / "Overpaid: X" / "Deposit on file: X".
export function balanceText(ctx, calc) {
  const { t } = ctx.i18n;
  const a = money(ctx, calc.display.amountMinor);
  return calc.display.kind === "overpaid" ? t("repairs.totals.overpaid", { amount: a }) : calc.display.kind === "deposit" ? t("repairs.totals.depositOnFile", { amount: a }) : t("repairs.totals.balanceDue", { amount: a });
}

// Mutlak URL olmayan baglanti yardimcisi: iç adres (#/...)
export const link = (href, text, cls = "") => h("a", { href, class: cls || undefined, text });
