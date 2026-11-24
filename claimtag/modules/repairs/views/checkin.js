// Cihaz teslim alma ekrani (Check in, spec 2.1). Musteri (telefon -> eslesme), cihaz, ariza, durum karti, test karti, fiyat; tek kayit,
// atomik yazma (musteri + cihaz + is + numara tek transactMany). Sifre / PIN / desen alani YOK. Kullanici verisi yalniz textContent.
import { todayIso } from "../../../core/dates.js";
import { guardWrite } from "../../../core/safe.js";
import { StoreError } from "../../../core/store.js";
import { button, confirmDialog, emptyState, field, focusFirstInvalid, h, nextId, select, showNotice } from "../../../core/ui.js";
import { parseAmount } from "../logic/calc.js";
import { imeiCheck, serialKey } from "../logic/imei.js";
import { AREAS, AREA_VALUES, ACCESSORIES, TEST_VALUES, createCustomer, createDevice, createJob, emptyTests, syncTests, validateCustomer, validateDevice, validateJob } from "../logic/schema.js";
import { buildIndex, searchCustomers } from "../logic/search.js";
import { printIntake } from "../print/receipt.js";
import { TYPES, capacity, deviceLine, disclosure, errText, fmtDate, loadAll, radioGroup } from "./common.js";

const ERR_FIELDS = { name: "name", phone: "phone", email: "email", address: "address", note: "cnote" };

export async function mountCheckin(ctx, root) {
  const { t } = ctx.i18n;
  const decimal = ctx.i18n.decimal;
  const ct = await ctx.ct.get();
  const guard = guardWrite((e) => ctx.fail(e));
  let data = await loadAll(ctx);
  let index = buildIndex(data);
  const cap = await capacity(ctx);
  const st = { customerId: null, deviceId: null, moveDevice: false, matches: [], tests: emptyTests("phone"), type: "phone" };

  // ---------- alanlar ----------
  const phone = field({ label: t("repairs.checkin.phone"), type: "tel", inputmode: "tel", autocomplete: "off", maxlength: 30 });
  const name = field({ label: t("repairs.checkin.name"), autocomplete: "off", maxlength: 80 });
  const email = field({ label: `${t("repairs.checkin.email")} (${t("repairs.common.optional")})`, type: "email", autocomplete: "off", maxlength: 120 });
  const address = field({ label: `${t("repairs.checkin.address")} (${t("repairs.common.optional")})`, multiline: true, maxlength: 200 });
  address.input.rows = 2;
  const cnote = field({ label: t("repairs.checkin.customerNote"), multiline: true, maxlength: 300, hint: t("repairs.common.passcodeWarning") });
  cnote.input.rows = 2;
  const model = field({ label: t("repairs.checkin.model"), autocomplete: "off", maxlength: 60 });
  const serial = field({ label: t("repairs.checkin.serial"), autocomplete: "off", maxlength: 40, inputmode: "text" });
  const color = field({ label: t("repairs.checkin.color"), autocomplete: "off", maxlength: 30 });
  const problem = field({ label: t("repairs.checkin.problem"), multiline: true, required: false, maxlength: 300, hint: t("repairs.common.passcodeWarning") });
  problem.input.rows = 3;
  const accOther = field({ label: t("repairs.acc.other"), maxlength: 120, hint: t("repairs.common.passcodeWarning") });
  const prior = field({ label: t("repairs.cond.priorDamage"), multiline: true, maxlength: 300, hint: t("repairs.common.passcodeWarning") });
  prior.input.rows = 2;
  const testNote = field({ label: t("repairs.tests.note"), maxlength: 120, hint: t("repairs.common.passcodeWarning") });
  const estimate = field({ label: t("repairs.checkin.estimate"), inputmode: "decimal", autocomplete: "off" });
  const fee = field({ label: t("repairs.checkin.diagnosisFee"), inputmode: "decimal", autocomplete: "off" });
  const deposit = field({ label: t("repairs.checkin.deposit"), inputmode: "decimal", autocomplete: "off" });
  const method = select({ label: t("repairs.x.method"), value: "cash", options: ["cash", "card", "transfer", "other"].map((m) => ({ value: m, label: t(`repairs.pay.method.${m}`) })) });

  const typeGroup = radioGroup({ legend: t("repairs.checkin.type"), name: "ci-type", value: "phone", options: TYPES.map((k, i) => ({ value: k, label: `${i + 1} ${t(`repairs.type.${k}`)}` })), onChange: (v) => setType(v) });
  typeGroup.element.addEventListener("keydown", (e) => {
    const i = Number(e.key);
    if (i >= 1 && i <= 5 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeGroup.set(TYPES[i - 1]); setType(TYPES[i - 1]); typeGroup.inputs[i - 1].focus(); }
  });

  // ---------- eslesen musteriler ----------
  const matchBox = h("ul", { class: "matches", id: "ci-matches", role: "listbox", "aria-label": t("repairs.checkin.matches"), hidden: true });
  const paintMatches = () => {
    matchBox.replaceChildren(...st.matches.map((c) => h("li", { role: "option" }, h("button", { type: "button", class: "match", text: `${c.name} · ${c.phone}`, on: { click: () => selectCustomer(c, true), keydown: matchKeys } }))));
    matchBox.hidden = st.matches.length === 0 || Boolean(st.customerId);
  };
  const matchKeys = (e) => {
    const btns = [...matchBox.querySelectorAll("button")];
    const i = btns.indexOf(e.currentTarget);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[Math.min(i + 1, btns.length - 1)].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? btns[i - 1] : phone.input).focus(); }
  };
  const refreshMatches = (q) => {
    st.matches = st.customerId ? [] : searchCustomers(index, q, 8);
    paintMatches();
  };

  // ---------- cihaz secimi ----------
  const deviceBox = h("div", { class: "stack", id: "ci-devices" });
  const serialBox = h("div", { class: "stack", id: "ci-serial-hit", "aria-live": "polite" });
  const serialNote = h("p", { class: "field-hint", id: "ci-imei-note", role: "status" });
  const fillDevice = (d) => {
    typeGroup.set(d.type); st.type = d.type; st.tests = syncTests(st.tests, d.type); paintTests();
    model.input.value = d.model; serial.input.value = d.serial; color.input.value = d.color;
  };
  const lockDevice = (locked) => { for (const f of [model, serial, color]) f.input.disabled = locked; for (const i of typeGroup.inputs) i.disabled = locked; };
  const chooseDevice = (id) => {
    st.deviceId = id === "new" ? null : id;
    st.moveDevice = false;
    if (st.deviceId) { fillDevice(data.dById.get(id)); lockDevice(true); } else { lockDevice(false); }
    serialBox.replaceChildren();
  };
  const paintDevices = () => {
    const c = st.customerId;
    const list = c ? data.devices.filter((d) => d.customerId === c) : [];
    if (!list.length) { deviceBox.replaceChildren(); return; }
    const g = radioGroup({ legend: t("repairs.checkin.device"), name: "ci-device", inline: false, value: st.deviceId ?? "new",
      options: [...list.map((d) => ({ value: d.id, label: deviceLine(ctx, d) })), { value: "new", label: t("repairs.checkin.newDevice") }], onChange: chooseDevice });
    deviceBox.replaceChildren(g.element);
    return g;
  };
  const selectCustomer = (c, focusDevice) => {
    st.customerId = c.id; st.deviceId = null; st.moveDevice = false;
    phone.input.value = c.phone; name.input.value = c.name; email.input.value = c.email ?? ""; address.input.value = c.address ?? ""; cnote.input.value = c.note ?? "";
    st.matches = []; paintMatches(); lockDevice(false);
    const g = paintDevices();
    if (focusDevice) (g ? g.inputs[g.inputs.length - 1] : model.input).focus();
  };
  const clearCustomer = () => { st.customerId = null; st.deviceId = null; st.moveDevice = false; deviceBox.replaceChildren(); lockDevice(false); };

  // seri / IMEI: gecersiz IMEI uyarisi (engellemez) + daha once gelen cihaz
  const checkSerial = () => {
    const raw = serial.input.value;
    serialNote.textContent = imeiCheck(raw).warn ? t("repairs.checkin.imeiCheck") : "";
    serialBox.replaceChildren();
    if (st.deviceId) return;
    const key = serialKey(raw);
    const hit = key ? data.devices.find((d) => d.serialKey === key) : null;
    if (!hit) return;
    const last = data.jobs.filter((j) => j.deviceId === hit.id).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))[0];
    const owner = data.cById.get(hit.customerId);
    const same = hit.customerId === st.customerId;
    const kids = [];
    if (last) kids.push(h("p", { class: "banner banner-info", text: t("repairs.checkin.seenBefore", { ticket: last.number, date: fmtDate(ctx, last.receivedDate) }) }));
    if (same) kids.push(button({ label: t("repairs.checkin.useDevice"), onClick: () => { chooseDevice(hit.id); paintDevices(); problem.input.focus(); } }));
    else {
      kids.push(h("p", { class: "muted", text: t("repairs.checkin.otherOwner", { name: owner?.name ?? "" }) }));
      kids.push(button({ label: t("repairs.checkin.moveDevice"), onClick: () => { st.deviceId = hit.id; st.moveDevice = true; fillDevice(hit); lockDevice(true); serialBox.replaceChildren(h("p", { class: "banner banner-info", text: `${t("repairs.checkin.moveDevice")}: ${deviceLine(ctx, hit)}` })); } }));
    }
    kids.push(button({ label: t("repairs.checkin.addAsNew"), onClick: () => serialBox.replaceChildren() }));
    serialBox.replaceChildren(...kids.map((k) => (k.tagName === "BUTTON" ? h("div", { class: "row" }, k) : k)));
  };

  // ---------- durum karti ----------
  const areaSelects = AREAS.map((a) => select({ label: t(`repairs.cond.${a}`), value: "not_checked", options: AREA_VALUES.map((v) => ({ value: v, label: t(`repairs.cond.val.${v}`) })) }));
  const yn = ["yes", "no", "unknown"].map((v) => ({ value: v, label: t(`repairs.yn.${v}`) }));
  const liquid = radioGroup({ legend: t("repairs.cond.liquid"), name: "ci-liquid", value: "unknown", options: yn });
  const powers = radioGroup({ legend: t("repairs.cond.powersOn"), name: "ci-powers", value: "unknown", options: yn });
  const accBoxes = ACCESSORIES.map((a) => { const id = nextId("acc"); return { a, input: h("input", { type: "checkbox", id }), label: t(`repairs.acc.${a}`), id }; });
  const accFieldset = h("fieldset", { class: "radios radios-inline" }, h("legend", { text: t("repairs.cond.accessories") }),
    accBoxes.map((b) => h("label", { class: "radio", for: b.id }, b.input, h("span", { text: b.label }))));

  // ---------- test karti ----------
  const testsBox = h("div", { class: "stack", id: "ci-tests" });
  function paintTests() {
    const items = st.tests.items;
    const rows = items.map((it) => {
      const g = radioGroup({ legend: t(`repairs.test.${it.key}`), name: `ci-t-${it.key}`, value: it.before, options: TEST_VALUES.map((v) => ({ value: v, label: t(`repairs.tests.val.${v}`) })), onChange: (v) => { it.before = v; } });
      g.element.classList.add("test-row");
      return g.element;
    });
    testsBox.replaceChildren(...(items.length ? [h("div", { class: "row" },
      button({ id: "ci-all-works", label: t("repairs.tests.allOk"), onClick: () => { for (const it of st.tests.items) if (!it.before) it.before = "works"; paintTests(); } }),
      button({ id: "ci-no-power", label: t("repairs.tests.noPower"), onClick: noPower }))] : []), ...rows);
  }
  async function noPower() {
    if (st.tests.items.some((i) => i.before)) {
      const { confirmed } = await confirmDialog({ title: t("repairs.tests.noPower"), message: t("repairs.tests.noPowerConfirm"), confirmLabel: t("repairs.tests.noPower"), cancelLabel: t("common.cancel") });
      if (!confirmed) return;
    }
    for (const it of st.tests.items) it.before = "untestable";
    powers.set("no");
    paintTests();
  }
  function setType(v) {
    st.type = v;
    st.tests = syncTests(st.tests, v);
    paintTests();
  }
  paintTests();

  // ---------- olaylar ----------
  phone.input.addEventListener("input", () => {
    const c = st.customerId ? data.cById.get(st.customerId) : null;
    if (c && c.phoneDigits !== phone.input.value.replace(/\D/g, "")) clearCustomer();
    refreshMatches(phone.input.value);
  });
  name.input.addEventListener("input", () => { if (!st.customerId && !phone.input.value.trim()) refreshMatches(name.input.value); });
  serial.input.addEventListener("input", checkSerial);

  const form = h("form", { class: "checkin-form", id: "checkin-form", novalidate: true, "aria-label": t("repairs.nav.checkin") });
  const next = (el) => {
    const all = [...form.querySelectorAll("input:not([type=radio]):not([type=checkbox]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button")].filter((x) => !x.hidden && x.offsetParent !== null);
    const i = all.indexOf(el);
    if (i >= 0 && all[i + 1]) all[i + 1].focus();
  };
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); form.requestSubmit(); return; }
    if (e.key === "ArrowDown" && e.target === phone.input && !matchBox.hidden) { e.preventDefault(); matchBox.querySelector("button")?.focus(); return; }
    if (e.key !== "Enter" || e.target.tagName !== "INPUT" || e.target.type === "radio" || e.target.type === "checkbox") return;
    e.preventDefault(); // tek satirli alanda Enter kaydetmez: sonraki alana gecer
    if (e.target === phone.input) {
      if (st.matches.length === 1 && !st.customerId) selectCustomer(st.matches[0], true); else name.input.focus();
    } else if (e.target === serial.input) { checkSerial(); problem.input.focus(); } else next(e.target);
  });

  // ---------- kaydet ----------
  const clearErrors = () => { for (const f of [phone, name, email, address, cnote, model, serial, color, problem, accOther, prior, testNote, estimate, fee, deposit]) f.setError(""); };
  const errorBox = h("div", { id: "ci-errors", role: "alert" });
  const money = (f) => {
    if (f.input.value.trim() === "") return { ok: true, minor: null };
    const r = parseAmount(f.input.value, { decimal });
    if (!r.ok) { f.setError(errText(ctx, r.error)); return { ok: false }; }
    return { ok: true, minor: r.minor };
  };

  async function save(e) {
    e.preventDefault();
    clearErrors();
    errorBox.replaceChildren();
    let bad = false;
    const fail = (f, code) => { f.setError(errText(ctx, code)); bad = true; };
    // musteri
    const cv = validateCustomer({ name: name.input.value, phone: phone.input.value, email: email.input.value, address: address.input.value, note: cnote.input.value });
    const fieldOf = { name, phone, email, address, note: cnote };
    for (const [k, code] of Object.entries(cv.errors)) fail(fieldOf[k], code);
    // cihaz
    const type = st.type;
    const dv = validateDevice({ customerId: "x", type, model: model.input.value, serial: serial.input.value, color: color.input.value });
    for (const [k, code] of Object.entries(dv.errors)) if (k !== "customerId") fail({ model, serial, color }[k] ?? model, code);
    // ariza + durum + test
    const pv = problem.input.value.trim();
    const condition = {
      areas: Object.fromEntries(AREAS.map((a, i) => [a, areaSelects[i].input.value])), liquid: liquid.value, powersOn: powers.value,
      accessories: accBoxes.filter((b) => b.input.checked).map((b) => b.a), accessoriesOther: accOther.input.value, priorDamage: prior.input.value,
    };
    const tests = { items: st.tests.items.map((i) => ({ key: i.key, before: i.before ?? null, after: null })), note: testNote.input.value };
    // fiyat
    const est = money(estimate); const fe = money(fee); const dep = money(deposit);
    if (!est.ok || !fe.ok || !dep.ok) bad = true;
    const today = todayIso();
    const now = new Date();
    const nowIso = now.toISOString();
    const lines = fe.minor ? [{ id: "l1", kind: "diagnosis", name: t("repairs.lines.kind.diagnosis"), qty: 1, unitMinor: fe.minor, taxRate: null, costMinor: null, supplier: "", partType: "unspecified", toldCustomer: false }] : [];
    const payments = dep.minor ? [{ id: "p1", kind: "deposit", amountMinor: dep.minor, date: today, method: method.input.value, note: "" }] : [];
    const jobBase = { number: "R-0000-0000", customerId: "x", deviceId: "x", status: "received", receivedAt: nowIso, receivedDate: today, problem: pv, condition, tests,
      customerTested: null, estimateMinor: est.minor, lines, payments, contacts: [], history: [{ at: nowIso, date: today, from: null, to: "received" }], statusDate: today,
      readyDate: null, handedOverDate: null, warrantyDays: null, warrantyEnd: null, internalNote: "", cancelReason: "", repairFlags: [], source: "manual" };
    const jv = validateJob(jobBase, { now, deviceType: type });
    if (jv.errors.problem) fail(problem, jv.errors.problem);
    if (jv.errors.priorDamage) fail(prior, jv.errors.priorDamage);
    if (jv.errors.accessoriesOther) fail(accOther, jv.errors.accessoriesOther);
    if (jv.errors.testNote) fail(testNote, jv.errors.testNote);
    if (bad) { focusFirstInvalid(form); return; }

    // sinirlar (spec 3.9)
    const c2 = await capacity(ctx);
    const stop = c2.stop.jobs ?? c2.stop.size ?? (!st.customerId ? c2.stop.customers : null) ?? (!st.deviceId ? c2.stop.devices : null);
    if (stop) { errorBox.replaceChildren(showNotice(`${t("repairs.checkin.notSaved")} ${stop}`, { kind: "error" })); errorBox.scrollIntoView({ block: "center" }); return; }

    try {
      const out = await ctx.store.transactMany(["customers", "devices", "jobs"], (tx) => {
        let customerId = st.customerId;
        if (customerId) {
          const cur = tx.get("customers", customerId);
          if (!cur) throw new StoreError("not_found", "customer");
          const v = cv.value;
          if (["name", "phone", "email", "address", "note"].some((k) => cur[k] !== v[k])) tx.update("customers", customerId, { name: v.name, phone: v.phone, phoneDigits: v.phoneDigits, email: v.email, address: v.address, note: v.note });
        } else customerId = tx.add("customers", createCustomer(cv.value)).id;
        let deviceId = st.deviceId;
        if (deviceId) {
          const dev = tx.get("devices", deviceId);
          if (!dev) throw new StoreError("not_found", "device");
          if (st.moveDevice && dev.customerId !== customerId) tx.update("devices", deviceId, { customerId });
        } else deviceId = tx.add("devices", createDevice({ ...dv.value, customerId })).id;
        const number = tx.nextNumber(ct.ticketPrefix, { year: now.getFullYear() });
        const job = tx.add("jobs", createJob({ ...jv.value, number, customerId, deviceId }, { now, deviceType: type }));
        return { job, customer: tx.get("customers", customerId), device: tx.get("devices", deviceId) };
      });
      showSaved(out);
    } catch (err) {
      errorBox.replaceChildren(showNotice(t("repairs.checkin.notSaved"), { kind: "error" }));
      throw err;
    }
  }

  // ---------- sonuc karti ----------
  function showSaved(out) {
    const card = h("div", { class: "card stack saved-card", id: "ci-saved", role: "status" },
      h("h3", { id: "ci-saved-title", tabindex: "-1", text: t("repairs.checkin.saved", { ticket: out.job.number }) }),
      h("div", { class: "row" },
        button({ id: "ci-print", label: t("repairs.checkin.printIntake"), variant: "primary", exportAction: true, onClick: guard(() => printIntake(ctx, out)) }),
        button({ id: "ci-open", label: t("repairs.checkin.openJob"), onClick: () => ctx.navigate(`pickup/${out.job.id}`) }),
        button({ id: "ci-new", label: t("repairs.checkin.new"), onClick: () => ctx.refresh() })));
    root.replaceChildren(h("h2", { text: t("repairs.nav.checkin") }), card);
    card.querySelector("#ci-print").focus();
  }

  form.addEventListener("submit", guard(save, "checkin-save"));

  // ---------- yerlesim ----------
  const sCustomer = h("section", { class: "card stack ci-customer", "aria-labelledby": "ci-h-customer" }, h("h3", { id: "ci-h-customer", text: t("repairs.checkin.customer") }), phone.element, matchBox, name.element, email.element, address.element, cnote.element);
  const sDevice = h("section", { class: "card stack ci-device", "aria-labelledby": "ci-h-device" }, h("h3", { id: "ci-h-device", text: t("repairs.checkin.device") }), deviceBox, typeGroup.element, model.element, serial.element, serialNote, serialBox, color.element);
  const sProblem = h("section", { class: "card stack ci-problem" }, problem.element);
  const sCond = h("section", { class: "card ci-cond" }, disclosure(t("repairs.cond.title"), h("div", { class: "grid-2" }, areaSelects.map((s) => s.element)), liquid.element, powers.element, accFieldset, accOther.element, prior.element));
  const sTests = h("section", { class: "card ci-tests" }, disclosure(t("repairs.tests.title"), h("p", { class: "muted", text: t("repairs.tests.noPasscodeNote") }), testsBox, testNote.element));
  const sPrice = h("section", { class: "card stack ci-price", "aria-labelledby": "ci-h-price" }, h("h3", { id: "ci-h-price", text: t("repairs.checkin.price") }), h("div", { class: "grid-2" }, estimate.element, fee.element), h("div", { class: "grid-2" }, deposit.element, method.element));
  const bar = h("div", { class: "save-bar" }, button({ id: "ci-save", label: t("common.save"), variant: "primary", type: "submit" }));
  form.append(h("div", { class: "ci-grid" }, sCustomer, sDevice, sProblem, sCond, sTests, sPrice), errorBox, bar);

  const top = [h("h2", { text: t("repairs.nav.checkin") })];
  for (const n of cap.near) top.push(showNotice(n, { kind: "warn" }));
  if (!data.customers.length && !data.jobs.length) top.push(h("p", { class: "banner banner-info", id: "ci-first", text: t("repairs.checkin.firstRun") }));
  root.replaceChildren(...top, form);
  phone.input.focus({ preventScroll: true });

  // baska sekmede veri degisti: eslesme dizini ve cihaz listesi yenilenir; yazilan form korunur
  ctx.onExternalChange(async () => { data = await loadAll(ctx); index = buildIndex(data); if (st.customerId && !data.cById.has(st.customerId)) clearCustomer(); refreshMatches(phone.input.value); });
}
