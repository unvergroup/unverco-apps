// Belge MODELLERI (saf veri, DOM yok): kabul formu (iki nusha), bos form, teslim fisi, hesap dokumu.
// DOM belgeleri (receipt.js, pickup-receipt.js) ile AYNI veriyi tasir; iPhone / iPad ana ekran uygulamasinda PDF bunlardan uretilir
// (core/canvas-doc.js layoutDoc). Kural: ic not, maliyet, kar, tedarikci, haber notu, gecmis HICBIR belgede yoktur.
// Belge: { id, title, sections[] }; bolum turleri core/canvas-doc.js basinda: top, kv, text, list, grid, checks, fields, writelines, table, sign, strip, terms, small, pagebreak.
import { AREAS, ACCESSORIES, TEST_KEYS } from "../logic/schema.js";
import { calcJob } from "../logic/calc.js";
import { lineNetMinor, lineTaxMinor } from "../../../core/line-items.js";
import { deviceName } from "../logic/templates.js";

const TYPES = ["phone", "tablet", "laptop", "desktop", "other"];
export const lastFour = (customer) => {
  const d = String(customer?.phoneDigits || customer?.phone || "").replace(/\D/g, "");
  return d ? `…${d.slice(-4)}` : "";
};
const deviceTitle = (ctx, device) => deviceName(device, Object.fromEntries(TYPES.map((k) => [k, ctx.i18n.t(`repairs.type.${k}`)])), ctx.i18n.t("repairs.type.fallback"));
const rows = (list) => list.filter(([, v]) => v !== "" && v !== null && v !== undefined);
const partName = (t, l) => (l.kind === "part" && l.partType !== "unspecified" ? `${l.name} (${t(`repairs.part.${l.partType}`)})` : l.name);
const blankKv = (t, keys) => ({ kind: "fields", rows: keys.map((k) => t(k)) });

function intakeCopy(ctx, { data, ct, shop, blank }) {
  const { t, formatCurrency, formatDate } = ctx.i18n;
  const job = data?.job;
  const c = data?.customer;
  const d = data?.device;
  const s = [];
  s.push({ kind: "top", title: t("repairs.doc.intake"), ticket: job ? job.number : t("repairs.doc.ticketBlank"), badge: shop ? t("repairs.doc.shopCopy") : t("repairs.doc.customerCopy"), date: job ? `${t("repairs.doc.received")}: ${formatDate(job.receivedDate)}` : `${t("repairs.doc.date")}: ________` });

  // Musteri
  if (job) s.push({ kind: "kv", heading: t("repairs.checkin.customer"), rows: rows([[t("repairs.checkin.name"), c?.name], [t("repairs.checkin.phone"), c?.phone], [t("repairs.checkin.email"), c?.email], [t("repairs.checkin.address"), c?.address]]) });
  else s.push({ kind: "fields", heading: t("repairs.checkin.customer"), rows: ["repairs.checkin.name", "repairs.checkin.phone", "repairs.checkin.email", "repairs.checkin.address"].map((k) => t(k)) });

  // Cihaz
  if (job) {
    const acc = [...(job.condition.accessories ?? []).map((a) => t(`repairs.acc.${a}`)), job.condition.accessoriesOther].filter(Boolean).join(", ");
    s.push({ kind: "kv", heading: t("repairs.checkin.device"), rows: rows([[t("repairs.checkin.type"), t(`repairs.type.${d?.type ?? "other"}`)], [t("repairs.checkin.model"), d?.model], [t("repairs.checkin.serial"), d?.serial], [t("repairs.checkin.color"), d?.color], [t("repairs.cond.accessories"), acc]]) });
  } else {
    s.push({ kind: "checks", heading: t("repairs.checkin.device"), rows: [{ label: "", options: ["phone", "tablet", "laptop", "desktop", "other"].map((k) => t(`repairs.type.${k}`)) }] });
    s.push({ kind: "fields", rows: ["repairs.checkin.model", "repairs.checkin.serial", "repairs.checkin.color"].map((k) => t(k)) });
    s.push({ kind: "checks", rows: [{ label: t("repairs.cond.accessories"), options: [...ACCESSORIES.map((a) => t(`repairs.acc.${a}`)), t("repairs.doc.other")] }] });
  }

  // Sorun
  s.push(job ? { kind: "text", heading: t("repairs.doc.problem"), text: job.problem } : { kind: "writelines", heading: t("repairs.doc.problem"), n: 3 });

  // Durum
  if (job) {
    const cond = job.condition;
    const r = AREAS.map((a) => [t(`repairs.cond.${a}`), t(`repairs.cond.val.${cond.areas[a]}`)]);
    r.push([t("repairs.cond.liquid"), t(`repairs.yn.${cond.liquid}`)], [t("repairs.cond.powersOn"), t(`repairs.yn.${cond.powersOn}`)]);
    s.push({ kind: "kv", heading: t("repairs.cond.title"), cols: 2, rows: r });
    if (cond.priorDamage) s.push({ kind: "text", text: `${t("repairs.cond.priorDamage")}: ${cond.priorDamage}`, tight: true });
  } else {
    s.push({ kind: "checks", cols: 2, heading: t("repairs.cond.title"), rows: [
      ...AREAS.map((a) => ({ label: t(`repairs.cond.${a}`), options: ["ok", "scratches", "dents", "cracked"].map((k) => t(`repairs.cond.val.${k}`)) })),
      { label: t("repairs.cond.liquid"), options: [t("repairs.yn.yes"), t("repairs.yn.no")] },
      { label: t("repairs.cond.powersOn"), options: [t("repairs.yn.yes"), t("repairs.yn.no")] }] });
    s.push({ kind: "text", text: `${t("repairs.cond.priorDamage")}:`, tight: true }, { kind: "writelines", n: 2 });
  }

  // Testler
  if (job) {
    const items = job.tests.items ?? [];
    if (items.length || job.tests.note) {
      s.push({ kind: "grid", heading: t("repairs.tests.title"), cols: 3, small: true, items: items.map((i) => `${t(`repairs.test.${i.key}`)}: ${i.before ? t(`repairs.tests.val.${i.before}`) : t("repairs.tests.notRecorded")}`) });
      if (items.some((i) => i.before === "untestable")) s.push({ kind: "small", text: t("repairs.doc.untestableSentence") });
      if (job.tests.note) s.push({ kind: "small", text: `${t("repairs.tests.note")}: ${job.tests.note}` });
      if (items.some((i) => i.before) && ct.printPasscodeLine) s.push({ kind: "small", text: t("repairs.doc.passcodeLine") });
    }
  } else {
    const keys = TEST_KEYS[blank === "computer" ? "laptop" : "phone"];
    s.push({ kind: "checks", cols: 2, heading: t("repairs.tests.title"), rows: [
      ...keys.map((k) => ({ label: t(`repairs.test.${k}`), options: [t("repairs.tests.val.works"), t("repairs.tests.val.fault"), t("repairs.tests.val.untestable")] })),
      { label: t("repairs.doc.other"), options: [t("repairs.tests.val.works"), t("repairs.tests.val.fault"), t("repairs.tests.val.untestable")] }] });
    s.push({ kind: "small", text: t("repairs.doc.blankPasscode") });
  }

  // Fiyat
  if (job) {
    const calc = calcJob(job);
    const fee = (job.lines ?? []).filter((l) => l.kind === "diagnosis").reduce((a, l) => a + Math.round(l.unitMinor * l.qty), 0);
    const r = [[t("repairs.checkin.estimate"), job.estimateMinor ? formatCurrency(job.estimateMinor) : ""], [t("repairs.checkin.diagnosisFee"), fee ? formatCurrency(fee) : ""], [t("repairs.checkin.deposit"), calc.paidMinor ? formatCurrency(calc.paidMinor) : ""]];
    if (r.some(([, x]) => x)) s.push({ kind: "kv", heading: t("repairs.checkin.price"), rows: rows(r) });
  } else s.push({ kind: "fields", heading: t("repairs.checkin.price"), rows: ["repairs.checkin.estimate", "repairs.checkin.diagnosisFee", "repairs.checkin.deposit"].map((k) => t(k)) });

  const terms = [ct.termsIntake, ct.termsStorage].filter(Boolean).join("\n\n");
  if (terms) s.push({ kind: "terms", heading: t("repairs.doc.terms"), text: terms });
  s.push({ kind: "sign", labels: [t("repairs.doc.sigCustomer"), t("repairs.doc.sigReceived"), t("repairs.doc.date")] });

  if (shop) {
    s.push(job
      ? { kind: "strip", cut: t("repairs.doc.stripCut"), ticket: job.number, lines: [c?.name ?? "", [lastFour(c) && `${t("repairs.checkin.phone")} ${lastFour(c)}`, d ? deviceTitle(ctx, d) : ""].filter(Boolean).join(" · "), formatDate(job.receivedDate)] }
      : { kind: "strip", cut: t("repairs.doc.stripCut"), ticket: t("repairs.doc.ticketBlank"), lines: [`${t("repairs.checkin.name")}: ________`, `${t("repairs.checkin.model")}: ________`, `${t("repairs.doc.date")}: ________`] });
  }
  return s;
}

/** Dolu kabul formu: iki nusha (dukkan nushasi etiket seridiyle, musteri nushasi); her nusha yeni sayfada. */
export function intakeDoc(ctx, data, ct) {
  return { id: "intake", title: "", sections: [...intakeCopy(ctx, { data, ct, shop: true }), { kind: "pagebreak" }, ...intakeCopy(ctx, { data, ct, shop: false })], notes: [] };
}
/** Bos kabul formu (kind: "phone" | "computer"). */
export function blankDoc(ctx, kind, ct) {
  return { id: `blank-${kind}`, title: "", sections: [...intakeCopy(ctx, { data: null, ct, shop: true, blank: kind }), { kind: "pagebreak" }, ...intakeCopy(ctx, { data: null, ct, shop: false, blank: kind })], notes: [] };
}

const balanceText = (ctx, calc) => {
  const { t, formatCurrency } = ctx.i18n;
  const a = formatCurrency(calc.display.amountMinor);
  return calc.display.kind === "overpaid" ? t("repairs.totals.overpaid", { amount: a }) : calc.display.kind === "deposit" ? t("repairs.totals.depositOnFile", { amount: a }) : t("repairs.totals.balanceDue", { amount: a });
};

function docTop(ctx, title, job) {
  const { t, formatDate } = ctx.i18n;
  return { kind: "top", title, ticket: job.number, dates: [`${t("repairs.doc.received")}: ${formatDate(job.receivedDate)}`, job.handedOverDate ? `${t("repairs.doc.pickedUp")}: ${formatDate(job.handedOverDate)}` : ""].filter(Boolean) };
}
const customerKv = (ctx, { customer, device }) => {
  const { t } = ctx.i18n;
  return { kind: "kv", rows: rows([[t("repairs.checkin.customer"), customer?.name], [t("repairs.checkin.phone"), customer?.phone], [t("repairs.checkin.device"), device ? `${deviceTitle(ctx, device)}${device.serial ? ` · ${device.serial}` : ""}` : ""]]) };
};

/** Teslim fisi (tek nusha). */
export function slipDoc(ctx, data, ct) {
  const { t, formatCurrency, formatDate } = ctx.i18n;
  const { job } = data;
  const calc = calcJob(job);
  const warranty = job.warrantyDays > 0 && job.warrantyEnd;
  const s = [docTop(ctx, t(warranty ? "repairs.doc.slipWarranty" : "repairs.doc.slip"), job), customerKv(ctx, data)];
  s.push((job.lines ?? []).length ? { kind: "list", heading: t("repairs.doc.workDone"), items: job.lines.map((l) => partName(t, l)) } : { kind: "text", heading: t("repairs.doc.workDone"), text: t("repairs.tests.notRecorded") });
  s.push({ kind: "kv", rows: [[t("repairs.totals.total"), formatCurrency(calc.totalMinor), true], [t("repairs.totals.paid"), formatCurrency(calc.paidMinor)], [balanceText(ctx, calc), "", true]].map(([k, v, b]) => (v === "" ? [k, "", b] : [k, v, b])) });
  const items = job.tests?.items ?? [];
  const tried = job.customerTested ? { kind: "small", text: t("repairs.doc.tried", { answer: t(`repairs.yn.${job.customerTested}`) }) } : null;
  if (items.length) {
    s.push({ kind: "table", heading: t("repairs.pickup.testsTitle"), columns: [{ key: "n", label: "", primary: true }, { key: "b", label: t("repairs.tests.before") }, { key: "a", label: t("repairs.tests.after") }],
      rows: items.map((i) => ({ n: t(`repairs.test.${i.key}`), b: i.before ? t(`repairs.tests.val.${i.before}`) : t("repairs.tests.notRecorded"), a: i.after ? t(`repairs.tests.val.${i.after}`) : t("repairs.tests.notRecorded") })) });
  }
  if (tried) s.push(tried);
  if (warranty) s.push({ kind: "text", text: t("repairs.doc.warranty", { n: job.warrantyDays, date: formatDate(job.warrantyEnd) }) });
  if (ct.termsWarranty) s.push({ kind: "terms", heading: t("repairs.doc.terms"), text: ct.termsWarranty });
  s.push({ kind: "sign", labels: [t("repairs.doc.sigCustomer"), t("repairs.doc.date")] });
  return { id: "slip", title: "", sections: s, notes: [] };
}

/** Hesap dokumu (invoice-stili; resmi fatura degildir notuyla). */
export function invoiceDoc(ctx, data, ct) {
  const { t, formatCurrency, formatPercent, formatNumber } = ctx.i18n;
  const { job } = data;
  const calc = calcJob(job);
  const trows = (job.lines ?? []).map((l) => ({
    name: partName(t, l), qty: formatNumber(l.qty, { maximumFractionDigits: 3 }), unit: formatCurrency(l.unitMinor),
    tax: l.taxRate === null ? "" : formatPercent(l.taxRate), total: formatCurrency(lineNetMinor(l) + lineTaxMinor(l)),
  }));
  const kvr = [[t("repairs.totals.subtotal"), formatCurrency(calc.subtotalMinor)]];
  if (calc.taxMinor) kvr.push([t("repairs.totals.tax"), formatCurrency(calc.taxMinor)]);
  kvr.push([t("repairs.totals.total"), formatCurrency(calc.totalMinor), true]);
  if (calc.paidMinor) kvr.push([t("repairs.totals.paid"), formatCurrency(calc.paidMinor)]);
  return { id: "invoice", title: "", notes: [], sections: [
    docTop(ctx, t("repairs.doc.invoice"), job), customerKv(ctx, data),
    { kind: "table", columns: [{ key: "name", label: t("repairs.lines.name"), primary: true }, { key: "qty", label: t("repairs.lines.qty"), num: true }, { key: "unit", label: t("lineitems.unitPrice"), num: true }, { key: "tax", label: t("repairs.lines.tax"), num: true }, { key: "total", label: t("lineitems.lineTotal"), num: true, amount: true }], rows: trows },
    { kind: "kv", rows: kvr },
    { kind: "text", text: balanceText(ctx, calc), bold: true, align: "right", tight: true },
    { kind: "small", text: t("repairs.doc.invoiceNote") },
  ] };
}
