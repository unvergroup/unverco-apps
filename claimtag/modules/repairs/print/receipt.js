// Teslim alma fisi (spec 5): iki nusha (Shop copy / Customer copy), dukkan nushasinin sonunda kesilip cihaza iliştirilen etiket seridi.
// Bos form (CT-20): ayni dizen, kutular ve cizgiler bos. Kullanici verisi yalniz h() / textContent; hicbir baskida ic not, maliyet, kar,
// durum gecmisi ya da haber notu cikmaz. Sayfa numarasi / olcumle kisa-uzun dizen K0'da yok (bilinen eksik): her nusha yeni sayfada baslar.
import { button, h } from "../../../core/ui.js";
import { AREAS, ACCESSORIES, TEST_KEYS } from "../logic/schema.js";
import { calcJob } from "../logic/calc.js";
import { deviceTitle } from "../views/common.js";

// ---- ortak parcalar (pickup-receipt.js de kullanir) ----
export const sec = (title, ...kids) => h("section", { class: "rc-sec" }, title ? h("h3", { text: title }) : null, ...kids);
export const kv = (rows) => h("dl", { class: "rc-kv" }, rows.filter(([, v]) => v !== "" && v !== null && v !== undefined).flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })]));
export const blankLine = () => h("span", { class: "rc-line" });
export const writeLines = (n) => Array.from({ length: n }, () => h("div", { class: "rc-writeline" }));
export const lastFour = (customer) => {
  const d = String(customer?.phoneDigits || customer?.phone || "").replace(/\D/g, "");
  return d ? `…${d.slice(-4)}` : "";
};
export const signBlock = (t) => h("div", { class: "rc-sign" }, h("div", { text: t("repairs.doc.sigCustomer") }), h("div", { text: t("repairs.doc.sigReceived") }), h("div", { text: t("repairs.doc.date") }));

// Test listesi: [{ key, label, value }] -> iki sutunlu liste. value: "works" | "fault" | "untestable" | null
export function testsGrid(ctx, items, pick = (i) => i.before) {
  const { t } = ctx.i18n;
  return h("div", { class: "rc-two" }, items.map((i) => h("p", { class: "rc-row", text: `${t(`repairs.test.${i.key}`)}: ${pick(i) ? t(`repairs.tests.val.${pick(i)}`) : t("repairs.tests.notRecorded")}` })));
}

const boxItem = (label) => h("span", { class: "rc-opt" }, h("span", { class: "rc-box" }), label);

function copyHeader(ctx, copyName, ticket, dateText) {
  const { t } = ctx.i18n;
  return [
    h("div", { class: "rc-top" },
      h("div", {}, h("p", { class: "rc-title", text: t("repairs.doc.intake") }), h("p", { class: "rc-ticket", text: ticket })),
      h("div", { class: "rc-right" }, h("p", { class: "rc-copyname", text: copyName }), h("p", { class: "rc-date", text: dateText }))),
  ];
}

// data: { job, customer, device } (dolu) ya da null (bos form; kind "phone" | "computer")
function copy(ctx, { data, ct, shop, blank }) {
  const { t, formatCurrency } = ctx.i18n;
  const job = data?.job;
  const c = data?.customer;
  const d = data?.device;
  const dateText = job ? `${t("repairs.doc.received")}: ${ctx.i18n.formatDate(job.receivedDate)}` : `${t("repairs.doc.date")}: ________`;
  const ticket = job ? job.number : t("repairs.doc.ticketBlank");
  const copyName = shop ? t("repairs.doc.shopCopy") : t("repairs.doc.customerCopy");
  const out = h("div", { class: "rc-copy" }, ...copyHeader(ctx, copyName, ticket, dateText));
  const v = (text) => (text ? text : blankLine());

  // Customer
  out.append(sec(t("repairs.checkin.customer"), job
    ? kv([[t("repairs.checkin.name"), c?.name], [t("repairs.checkin.phone"), c?.phone], [t("repairs.checkin.email"), c?.email], [t("repairs.checkin.address"), c?.address]])
    : h("dl", { class: "rc-kv" }, ...[["repairs.checkin.name"], ["repairs.checkin.phone"], ["repairs.checkin.email"], ["repairs.checkin.address"]].flatMap(([k]) => [h("dt", { text: t(k) }), h("dd", {}, blankLine())]))));

  // Device
  const accNames = job ? [...(job.condition.accessories ?? []).map((a) => t(`repairs.acc.${a}`)), job.condition.accessoriesOther].filter(Boolean).join(", ") : "";
  out.append(sec(t("repairs.checkin.device"), job
    ? kv([[t("repairs.checkin.type"), t(`repairs.type.${d?.type ?? "other"}`)], [t("repairs.checkin.model"), d?.model], [t("repairs.checkin.serial"), d?.serial], [t("repairs.checkin.color"), d?.color], [t("repairs.cond.accessories"), accNames]])
    : h("div", { class: "stack-print" },
      h("p", {}, ...["phone", "tablet", "laptop", "desktop", "other"].map((k) => boxItem(t(`repairs.type.${k}`)))),
      h("dl", { class: "rc-kv" }, ...["repairs.checkin.model", "repairs.checkin.serial", "repairs.checkin.color"].flatMap((k) => [h("dt", { text: t(k) }), h("dd", {}, blankLine())])),
      h("p", {}, t("repairs.cond.accessories"), ": ", ...ACCESSORIES.map((a) => boxItem(t(`repairs.acc.${a}`))), boxItem(t("repairs.doc.other"))))));

  // Problem
  out.append(sec(t("repairs.doc.problem"), job ? h("p", { class: "rc-text", text: job.problem }) : h("div", {}, ...writeLines(4))));

  // Condition
  if (job) {
    const cond = job.condition;
    const rows = AREAS.map((a) => [t(`repairs.cond.${a}`), t(`repairs.cond.val.${cond.areas[a]}`)]);
    rows.push([t("repairs.cond.liquid"), t(`repairs.yn.${cond.liquid}`)], [t("repairs.cond.powersOn"), t(`repairs.yn.${cond.powersOn}`)], [t("repairs.cond.priorDamage"), cond.priorDamage]);
    out.append(sec(t("repairs.cond.title"), kv(rows)));
  } else {
    out.append(sec(t("repairs.cond.title"),
      ...AREAS.map((a) => h("p", { class: "rc-row" }, `${t(`repairs.cond.${a}`)}: `, ...["ok", "scratches", "dents", "cracked"].map((k) => boxItem(t(`repairs.cond.val.${k}`))))),
      h("p", { class: "rc-row" }, `${t("repairs.cond.liquid")}: `, boxItem(t("repairs.yn.yes")), boxItem(t("repairs.yn.no")), ` ${t("repairs.cond.powersOn")}: `, boxItem(t("repairs.yn.yes")), boxItem(t("repairs.yn.no"))),
      h("p", { class: "rc-row", text: `${t("repairs.cond.priorDamage")}:` }), ...writeLines(3)));
  }

  // Tests
  if (job) {
    const items = job.tests.items ?? [];
    const any = items.some((i) => i.before) ;
    if (items.length || job.tests.note) {
      const kids = [testsGrid(ctx, items)];
      if (items.some((i) => i.before === "untestable")) kids.push(h("p", { class: "rc-note", text: t("repairs.doc.untestableSentence") }));
      if (job.tests.note) kids.push(h("p", { class: "rc-note", text: `${t("repairs.tests.note")}: ${job.tests.note}` }));
      if (any && ct.printPasscodeLine) kids.push(h("p", { class: "rc-note", text: t("repairs.doc.passcodeLine") }));
      out.append(sec(t("repairs.tests.title"), ...kids));
    }
  } else {
    const keys = TEST_KEYS[blank === "computer" ? "laptop" : "phone"];
    out.append(sec(t("repairs.tests.title"),
      h("div", { class: "rc-two" }, keys.map((k) => h("p", { class: "rc-row" }, `${t(`repairs.test.${k}`)}: `, boxItem(t("repairs.tests.val.works")), boxItem(t("repairs.tests.val.fault")), boxItem(t("repairs.tests.val.untestable"))))),
      h("p", { class: "rc-row", text: t("repairs.doc.other") }), h("p", { class: "rc-row", text: t("repairs.doc.other") }),
      h("p", { class: "rc-note", text: t("repairs.doc.blankPasscode") })));
  }

  // Price
  if (job) {
    const calc = calcJob(job);
    const fee = (job.lines ?? []).filter((l) => l.kind === "diagnosis").reduce((s, l) => s + Math.round(l.unitMinor * l.qty), 0);
    const dep = calc.paidMinor;
    const rows = [[t("repairs.checkin.estimate"), job.estimateMinor ? formatCurrency(job.estimateMinor) : ""], [t("repairs.checkin.diagnosisFee"), fee ? formatCurrency(fee) : ""], [t("repairs.checkin.deposit"), dep ? formatCurrency(dep) : ""]];
    if (rows.some(([, x]) => x)) out.append(sec(t("repairs.checkin.price"), kv(rows)));
  } else {
    out.append(sec(t("repairs.checkin.price"), h("dl", { class: "rc-kv" }, ...["repairs.checkin.estimate", "repairs.checkin.diagnosisFee", "repairs.checkin.deposit"].flatMap((k) => [h("dt", { text: t(k) }), h("dd", {}, blankLine())]))));
  }

  // Terms (bossa hic yok)
  const terms = [ct.termsIntake, ct.termsStorage].filter(Boolean).join("\n\n");
  if (terms) out.append(sec(t("repairs.doc.terms"), h("p", { class: "rc-terms", text: terms })));

  out.append(signBlock(t));

  // Etiket seridi: yalniz dukkan nushasi
  if (shop) {
    out.append(h("div", { class: "rc-strip" },
      h("p", { class: "rc-strip-cut", text: t("repairs.doc.stripCut") }),
      job
        ? [h("p", { class: "rc-strip-ticket", text: job.number }), h("p", { class: "rc-strip-name", text: c?.name ?? "" }), h("p", { text: [lastFour(c) && `${t("repairs.checkin.phone")} ${lastFour(c)}`, d ? deviceTitle(ctx, d) : ""].filter(Boolean).join(" · ") }), h("p", { text: ctx.i18n.formatDate(job.receivedDate) })]
        : [h("p", { class: "rc-strip-ticket", text: t("repairs.doc.ticketBlank") }), h("p", {}, t("repairs.checkin.name"), ": ", blankLine()), h("p", {}, t("repairs.checkin.model"), ": ", blankLine()), h("p", {}, t("repairs.doc.date"), ": ", blankLine())]));
  }
  return out;
}

export function buildIntake(ctx, data, ct) {
  return h("div", { class: "rc-doc" }, copy(ctx, { data, ct, shop: true }), copy(ctx, { data, ct, shop: false }));
}

export function buildBlank(ctx, kind, ct) {
  return h("div", { class: "rc-doc" }, copy(ctx, { data: null, ct, shop: true, blank: kind }), copy(ctx, { data: null, ct, shop: false, blank: kind }));
}

export async function printIntake(ctx, data) {
  const ct = await ctx.ct.get();
  await ctx.print({ title: data.job.number, node: buildIntake(ctx, data, ct), paper: ct.paper });
}

// Bos form: once liste secilir ("Phone / tablet" ya da "Computer"), sonra basilir.
export function printBlankForm(ctx) {
  const { t } = ctx.i18n;
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "dialog", "aria-labelledby": "blank-title" });
    const done = (kind) => { dlg.close(); dlg.remove(); resolve(kind); };
    dlg.append(h("form", { method: "dialog" },
      h("h2", { id: "blank-title", text: t("repairs.doc.blankChoose") }),
      h("div", { class: "dialog-actions" },
        button({ label: t("common.cancel"), onClick: () => done(null) }),
        button({ id: "blank-phone", label: t("repairs.doc.blankChoice.phone"), variant: "primary", onClick: () => done("phone") }),
        button({ id: "blank-computer", label: t("repairs.doc.blankChoice.computer"), variant: "primary", onClick: () => done("computer") }))));
    dlg.addEventListener("cancel", () => resolve(null));
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector("button").focus();
  }).then(async (kind) => {
    if (!kind) return;
    const ct = await ctx.ct.get();
    await ctx.print({ title: t("repairs.top.blankForm"), node: buildBlank(ctx, kind, ct), paper: ct.paper });
  });
}
