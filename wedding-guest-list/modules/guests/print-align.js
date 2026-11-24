// Print > Place cards: "Line up with your blank cards" (G30, G31; design ekranlar.md 5.4). Five steps; only the active step is open.
// Kept in the plan: cardPreset, customCard, offX100, offY100. The step itself is not kept (it starts from the nudge: none -> step 1).
// The panel never writes the sheet: it reports valid changes through `save(patch)` and asks the view to print the test sheet.
import { button, h, nextId } from "../../core/ui.js";
import { nudgeWords, svgNode } from "./parts.js";
import { PRESET_IDS, resolveCard, validateCustom, validateOffset } from "./logic/cardlayout.js";

const CUSTOM_DEFAULTS = { paper: "letter", w100: 8890, h100: 10160, cols: 2, rows: 2, left100: 1905, top100: 3810, gapX100: 0, gapY100: 0, tent: true };
const MM_FIELDS = ["w100", "h100", "left100", "top100", "gapX100", "gapY100"];
const COUNT_FIELDS = ["cols", "rows"];
const MINUS = "−";
const INCHES = { 100: "3 15/16", 50: "1 31/32" }; // the two bar lengths of the test sheet, in inches

const mmText = (v100) => String(Math.round(v100) / 100);
const num = (text) => {
  const s = String(text ?? "").trim().replace(",", ".");
  return /^[+-]?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
};

// A card error / warning { code, field?, ... } -> text, by the key rule at the top of messages.js.
export function cardMessage(t, e) {
  const params = { label: e.field ? t(`guests.card.field.${e.field}`) : "", min: e.min, max: e.max, byMm: e.byMm === undefined ? "" : e.byMm.toFixed(1) };
  const warn = `guests.card.warn.${e.code}`; // warnings carry only a code (no field); the codes of errors and warnings never overlap
  if (t(warn) !== warn) return t(warn, params);
  const specific = `guests.card.err.${e.code}.${e.field}`;
  const probe = t(specific);
  if (probe !== specific) return t(specific, params);
  if (e.code === "range" && e.unit === "mm") return t("guests.card.err.rangeMm", params);
  return t(`guests.card.err.${e.code}`, params);
}

export function cardName(t, plan) {
  if (plan.cardPreset !== "custom") return t(`guests.card.preset.${plan.cardPreset}`);
  const c = plan.customCard || CUSTOM_DEFAULTS;
  return t("guests.print.custom.layoutName", { w: mmText(c.w100), h: mmText(c.h100) });
}


// api: { t, plan (live object, read at every use), save(patch) -> Promise, printTest(), barMm() (length of the scale bar of the chosen layout) }
// -> { element, testPrinted() (afterprint of the test sheet: opens step 3), planChanged() }
export function createAlignPanel(api) {
  const { t } = api;
  const S = {
    step: api.plan().offX100 !== 0 || api.plan().offY100 !== 0 ? 5 : 1,
    scaleBad: false,
    custom: null, // text values of the custom form while it is open
    customErr: null,
  };
  const root = h("section", { class: "card", "aria-labelledby": "align-h" });

  const customSpec = () => {
    const v = S.custom;
    const spec = { paper: v.paper, tent: v.tent };
    for (const f of MM_FIELDS) spec[f] = Math.round(num(v[f]) * 100);
    for (const f of COUNT_FIELDS) spec[f] = num(v[f]);
    return spec;
  };

  function openCustom() {
    const p = api.plan();
    const c = p.customCard || CUSTOM_DEFAULTS;
    S.custom = { paper: c.paper, tent: c.tent };
    for (const f of MM_FIELDS) S.custom[f] = mmText(c[f]);
    for (const f of COUNT_FIELDS) S.custom[f] = String(c[f]);
  }

  // ---- step 1
  function stepOne() {
    const p = api.plan();
    const group = h("fieldset", { class: "stack align-choice" }, h("legend", { class: "visually-hidden", text: t("guests.print.align.choose") }));
    const options = [...PRESET_IDS.map((id) => ({ value: id, label: t(`guests.card.preset.${id}`) })), { value: "custom", label: t("guests.print.align.custom") }];
    const name = nextId("card");
    for (const o of options) {
      const input = h("input", { type: "radio", name, value: o.value, checked: p.cardPreset === o.value });
      input.addEventListener("change", async () => {
        if (o.value === "custom") { if (!S.custom) openCustom(); await applyCustom(); return; }
        S.custom = null;
        await api.save({ cardPreset: o.value });
        draw(false);
      });
      group.append(h("label", { class: "check" }, input, h("span", { text: o.label })));
    }
    const body = [group, h("p", { class: "field-hint", text: t("guests.print.align.s1.hint") })];
    let cont;
    if (p.cardPreset === "custom") {
      if (!S.custom) openCustom();
      body.push(customForm((ok) => { cont.disabled = !ok; }));
    }
    cont = button({ label: t("guests.print.align.continue"), variant: "primary", onClick: () => go(2) });
    body.push(h("div", { class: "print-actions" }, cont));
    return body;
  }

  // The custom form: values stay as typed; a valid set is saved (and the sheet redraws), an invalid one is explained and not saved.
  function customForm(setContinue) {
    const alertBox = h("div", { class: "field-error", role: "alert", id: nextId("ce") });
    const warnBox = h("div", { class: "stack-top" });
    const inputs = {};
    const fieldErr = {}; // the error text of each field sits right under it (the summary below the form stays)
    const field = (key, label, extra = {}) => {
      const id = nextId("cf");
      const err = h("p", { class: "field-error", id: `${id}-err` });
      const input = h("input", { id, type: "text", inputmode: "decimal", value: S.custom[key], "aria-describedby": err.id, ...extra });
      inputs[key] = input;
      fieldErr[key] = err;
      input.addEventListener("input", () => { S.custom[key] = input.value; evaluate(true); });
      return h("div", { class: "field" }, h("label", { for: id, text: label }), input, err);
    };
    const paperId = nextId("cf");
    const paper = h("select", { id: paperId }, [["letter", t("guests.print.custom.letter")], ["a4", t("guests.print.custom.a4")]].map(([v, l]) => h("option", { value: v, text: l, selected: S.custom.paper === v })));
    paper.addEventListener("change", () => { S.custom.paper = paper.value; evaluate(true); });
    const tentBox = h("input", { type: "checkbox", checked: S.custom.tent });
    tentBox.addEventListener("change", () => { S.custom.tent = tentBox.checked; evaluate(true); });

    function evaluate(save) {
      const bad = [...MM_FIELDS, ...COUNT_FIELDS].filter((f) => Number.isNaN(num(S.custom[f])));
      for (const el of Object.values(inputs)) el.setAttribute("aria-invalid", "false");
      for (const el of Object.values(fieldErr)) el.textContent = "";
      alertBox.textContent = "";
      warnBox.replaceChildren();
      if (bad.length) {
        for (const f of bad) { inputs[f].setAttribute("aria-invalid", "true"); fieldErr[f].textContent = t("guests.print.custom.bad"); }
        alertBox.textContent = t("guests.print.custom.bad");
        setContinue(false);
        return;
      }
      const spec = customSpec();
      const r = validateCustom(spec, { x: api.plan().offX100, y: api.plan().offY100 });
      if (!r.ok) {
        alertBox.textContent = r.errors.map((e) => cardMessage(t, e)).join(" ");
        const said = (f, text) => { if (!fieldErr[f].textContent) fieldErr[f].textContent = text; };
        for (const e of r.errors) {
          if (e.field && inputs[e.field]) { inputs[e.field].setAttribute("aria-invalid", "true"); said(e.field, cardMessage(t, e)); }
        }
        // "does not fit" involves several fields (width, count, margin, gap): it is marked and explained on the first of them, right under it
        for (const [code, f] of [["tooWide", "w100"], ["tooTall", "h100"]]) {
          const e = r.errors.find((x) => x.code === code);
          if (!e) continue;
          inputs[f].setAttribute("aria-invalid", "true");
          said(f, cardMessage(t, e));
        }
        setContinue(false);
        return;
      }
      setContinue(true);
      for (const w of r.warnings) warnBox.append(h("div", { class: "status status-warn" }, h("div", {}, h("p", { text: cardMessage(t, w) }))));
      if (save) api.save({ cardPreset: "custom", customCard: spec });
    }
    const form = h("div", { class: "stack" },
      h("div", { class: "grid-2" },
        h("div", { class: "field" }, h("label", { for: paperId, text: t("guests.print.custom.paper") }), paper),
        field("w100", t("guests.print.custom.w100")), field("h100", t("guests.print.custom.h100")),
        field("cols", t("guests.print.custom.cols")), field("rows", t("guests.print.custom.rows")),
        field("left100", t("guests.print.custom.left100")), field("top100", t("guests.print.custom.top100")),
        field("gapX100", t("guests.print.custom.gapX100")), field("gapY100", t("guests.print.custom.gapY100"))),
      h("label", { class: "check" }, tentBox, h("span", { text: t("guests.print.custom.tent") })),
      alertBox, warnBox);
    queueMicrotask(() => evaluate(false));
    return form;
  }

  async function applyCustom() {
    const bad = [...MM_FIELDS, ...COUNT_FIELDS].some((f) => Number.isNaN(num(S.custom[f])));
    if (!bad && validateCustom(customSpec(), { x: api.plan().offX100, y: api.plan().offY100 }).ok) await api.save({ cardPreset: "custom", customCard: customSpec() });
    draw(false);
  }

  // ---- step 2 / 3
  const stepTwo = () => [
    h("p", { text: t("guests.print.align.s2.text") }),
    h("div", { class: "print-actions" },
      button({ label: t("guests.print.act.test"), variant: "primary", onClick: () => api.printTest() }),
      button({ label: t("guests.print.align.s2.done"), variant: "ghost", onClick: () => go(3) })),
  ];

  const stepThree = () => [
    h("p", { text: t("guests.print.align.s3.text", { mm: api.barMm(), inch: INCHES[api.barMm()] ?? String(Math.round(api.barMm() / 25.4 * 100) / 100) }) }),
    S.scaleBad ? h("div", { class: "status status-warn" }, h("div", {}, h("p", { text: t("guests.print.align.s3.warn") }),
      button({ label: t("guests.print.align.testAgain"), onClick: () => api.printTest() }))) : null,
    h("div", { class: "print-actions" },
      button({ label: t("guests.print.align.s3.yes", { mm: api.barMm() }), variant: "primary", onClick: () => go(4) }),
      button({ label: t("guests.print.align.s3.no"), onClick: () => { S.scaleBad = true; draw(true); } })),
  ];

  // ---- step 4: nudge
  function stepFour() {
    const p = api.plan();
    const cardOf = () => { const q = api.plan(); return q.cardPreset === "custom" ? resolveCard("custom", q.customCard) : q.cardPreset; };
    const errX = h("p", { class: "field-error", role: "alert" }), errY = h("p", { class: "field-error", role: "alert" });
    const warn = h("div", {});
    const cur = { x: p.offX100, y: p.offY100 };
    const make = (axis, labelKey, hintKey, err, minusKey, plusKey) => {
      const label = t(labelKey);
      const id = nextId("nd"), hintId = `${id}-h`;
      const input = h("input", { id, type: "text", inputmode: "decimal", value: mmText(cur[axis]), "aria-describedby": `${hintId} ${err.id || ""}`.trim() });
      const step = (d) => { // next multiple of 0.5 mm in that direction (a typed 0.3 goes to 0.5 or 0)
        const v = num(input.value); const base = Number.isNaN(v) ? cur[axis] / 100 : v;
        const next = d > 0 ? Math.floor(base * 2 + 1e-9) / 2 + 0.5 : Math.ceil(base * 2 - 1e-9) / 2 - 0.5;
        input.value = String(next); evaluate();
      };
      const btn = (d, key, sign) => { const b = h("button", { type: "button", class: "btn", "aria-label": t(key), text: sign }); b.addEventListener("click", () => step(d)); return b; };
      input.addEventListener("input", evaluate);
      function evaluate() {
        const x = num(inputs.x.value), y = num(inputs.y.value);
        errX.textContent = ""; errY.textContent = ""; warn.replaceChildren();
        inputs.x.setAttribute("aria-invalid", "false"); inputs.y.setAttribute("aria-invalid", "false");
        const off = { x: Math.round(x * 100), y: Math.round(y * 100) };
        const r = validateOffset(cardOf(), { x: Number.isNaN(x) ? NaN : off.x, y: Number.isNaN(y) ? NaN : off.y });
        const mark = (field, text) => { const e = field === "x" ? errX : errY; if (!e.textContent) e.textContent = text; inputs[field].setAttribute("aria-invalid", "true"); };
        for (const e of r.errors) {
          if (e.field === "x" || e.field === "y") mark(e.field, t("guests.print.align.nudgeBad"));
          else { mark("x", t("guests.print.align.nudgeOff")); }
        }
        if (r.errors.length) return;
        for (const w of r.warnings) warn.append(h("div", { class: "status status-warn" }, h("div", {}, h("p", { text: cardMessage(t, w) }))));
        if (off.x !== cur.x || off.y !== cur.y) { cur.x = off.x; cur.y = off.y; api.save({ offX100: off.x, offY100: off.y }); }
      }
      const el = h("div", { class: "field" }, h("label", { for: id, text: label }),
        h("div", { class: "nudge" }, btn(-0.5, minusKey, MINUS), input, btn(0.5, plusKey, "+")),
        h("p", { class: "field-hint", id: hintId, text: t(hintKey) }), err);
      return { el, input };
    };
    const inputs = {};
    errX.id = nextId("ex"); errY.id = nextId("ey");
    const mx = make("x", "guests.print.align.right", "guests.print.align.rightHint", errX, "guests.print.align.left", "guests.print.align.rightBtn"); inputs.x = mx.input;
    const my = make("y", "guests.print.align.down", "guests.print.align.downHint", errY, "guests.print.align.up", "guests.print.align.downBtn"); inputs.y = my.input;
    return [
      h("p", { text: t("guests.print.align.s4.text") }),
      diagram(t),
      h("div", { class: "nudge-pair" }, mx.el, my.el), warn,
      h("div", { class: "print-actions" },
        button({ label: t("guests.print.align.testAgain"), onClick: () => api.printTest() }),
        button({ label: t("guests.print.align.s4.go"), variant: "primary", onClick: () => go(5) })),
    ];
  }

  const stepFive = () => [h("p", { text: t("guests.print.align.s5.text") }), h("p", { class: "field-hint", text: t("guests.print.align.s5.use") })];

  const summaries = () => {
    const p = api.plan();
    const x = p.offX100, y = p.offY100;
    return {
      1: cardName(t, p),
      2: t("guests.print.align.s2.sum"),
      3: t("guests.print.align.s3.sum", { mm: api.barMm() }),
      4: x === 0 && y === 0 ? t("guests.print.align.s4.none") : t("guests.print.align.s4.sum", { x: nudgeWords(t, x, y)[0], y: nudgeWords(t, x, y)[1] }),
    };
  };

  function go(step) {
    if (step === 3) S.scaleBad = false;
    S.step = step;
    draw(true);
  }

  function draw(focusHeading) {
    const sum = summaries();
    const bodies = { 1: stepOne, 2: stepTwo, 3: stepThree, 4: stepFour, 5: stepFive };
    const items = [1, 2, 3, 4, 5].map((n) => {
      const active = S.step === n, done = n < S.step;
      const title = t(`guests.print.align.s${n}`, { mm: api.barMm() });
      const head = h("h4", { text: title, tabindex: "-1", "data-step": n });
      const li = h("li", { class: `align-step${done ? " done" : ""}`, "aria-current": active ? "step" : null }, head);
      if (done && n <= 4) li.append(h("button", { type: "button", class: "btn btn-ghost btn-sm align-summary", "aria-label": t("guests.print.align.reopen", { step: title }), text: sum[n], on: { click: () => go(n) } }));
      if (active) li.append(h("div", { class: "align-body stack" }, ...bodies[n]().flat()));
      return li;
    });
    root.replaceChildren(
      h("h3", { id: "align-h", text: t("guests.print.align.title") }),
      h("p", { class: "muted", text: t("guests.print.align.intro") }),
      h("ol", { class: "align-steps" }, items));
    if (focusHeading) root.querySelector(`h4[data-step="${S.step}"]`)?.focus();
  }

  draw(false);
  return {
    element: root,
    testPrinted() { if (S.step === 2) go(3); },
    planChanged() { /* values live in the form; nothing to redraw */ },
  };
}

// Design 5.4: the solid frame is the card edge, the dashed frame is the print; the arrow spans the gap (the print is LEFT of the card, so
// the number to enter is positive: Nudge right +2). The note says it in one line.
function diagram(t) {
  const el = (name, attrs, text) => {
    const n = svgNode(name, attrs);
    if (text) n.textContent = text;
    return n;
  };
  // Text is 13 user units in a 210-unit-wide drawing (>= 13 px down to a 320 px screen, where the drawing is 210 px wide); a long line
  // is split at the space nearest its middle (the first half keeps its trailing space, so the text reads the same joined).
  const lines = (text, y, extra = {}) => {
    const mid = text.length / 2;
    let cut = -1;
    // A line never starts with a separator or an arrow: the space in front of "\u00B7" / "\u2192" is not a place to cut.
    for (let i = 0; i < text.length; i++) if (text[i] === " " && !/[\u00B7\u2192]/.test(text[i + 1] ?? "") && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
    const parts = cut < 0 ? [text] : [text.slice(0, cut + 1), text.slice(cut + 1)];
    return parts.map((p, k) => el("text", { x: 4, y: y + k * 16, "font-size": 13, fill: "currentColor", ...extra }, p));
  };
  const svg = el("svg", { class: "nudge-diagram", viewBox: "0 0 210 136", role: "img", "aria-label": t("guests.print.align.diagram") });
  svg.append(
    ...lines(t("guests.print.align.diagram.top"), 13),
    el("rect", { x: 40, y: 40, width: 120, height: 40, fill: "none", stroke: "currentColor", "stroke-width": 2 }),
    el("rect", { x: 28, y: 40, width: 120, height: 40, fill: "none", stroke: "currentColor", "stroke-width": 1.25, "stroke-dasharray": "4 3" }),
    el("path", { d: "M29 90 H39 M33 86 L29 90 L33 94 M35 86 L39 90 L35 94", fill: "none", stroke: "currentColor", "stroke-width": 1.5 }),
    ...lines(t("guests.print.align.diagram.note"), 108, { "font-weight": 700 }));
  return svg;
}
