// Tek sayfa donem plani + bos sablon. Iki katman:
//   buildPlanModel(...)  SAF: metinler ve satirlar (ekran sonucu dailyAmount'tan gelir; ikinci formul yok).
//   layoutPlan(model, paper, measure)  SAF: 200 dpi sayfada cizim komutlari; HER ZAMAN TEK SAYFA (fazla satir "+N more").
// Cizim (canvas), PDF ve yazdirma core/print.js'tedir. Kagit her zaman beyaz.
import { addDays, diffDays } from "../../../core/dates.js";
import { envelopeSpent } from "../logic/engine.js";

export const PAPERS = Object.freeze({ letter: { w: 1700, h: 2200 }, a4: { w: 1654, h: 2339 } });
export const LIMITS = Object.freeze({ bills: 20, envelopes: 12, funds: 8, days: 32 });
const M = 110;
const INK = "#111111", MUTED = "#555555", RULE = "#c8c8c8", SOFT = "#f1f1ee", GOLD = "#8a6200";
const FAMILY = "-apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const font = (size, bold = false) => `${bold ? "700" : "400"} ${size}px ${FAMILY}`;

/** Satir sinirlama: limit asilirsa son satir yerine "+N more". */
function cap(rows, limit, more) {
  if (rows.length <= limit) return { rows, more: "" };
  const keep = rows.slice(0, limit - 1);
  return { rows: keep, more: more(rows.length - keep.length) };
}

export function buildPlanModel({ state, result, occurrences, envelopes, today, i18n, blank = false, envName }) {
  const { t, formatCurrency: money, formatDate } = i18n;
  const md = (iso) => formatDate(iso, { month: "short", day: "numeric" });
  const more = (n) => t("print.more", { n });
  const base = {
    blank, brand: t("app.name"), title: t(blank ? "print.blankTitle" : "print.planTitle"), disclaimer: t("disclaimer"),
    billsTitle: t("print.billsTitle"), cols: [t("print.col.due"), t("print.col.bill"), t("print.col.amount"), t("print.col.paid")],
    envTitle: t("print.envTitle"), fundTitle: t("print.fundTitle"), trackTitle: t("print.trackTitle"), dailyLabel: t("today.spendable"),
  };
  if (blank) {
    return { ...base, period: t("print.blankPeriod"), printedOn: "", dailyValue: "", reason: "", breakdown: [t("print.bd.balance"), t("print.bd.bills"), t("print.bd.aside"), t("print.bd.funds"), t("print.bd.available")].map((l) => [l, ""]),
      bills: Array.from({ length: 16 }, () => ({ due: "", name: "", amount: "", paid: false })), billsMore: "", aside: "",
      envs: Array.from({ length: 10 }, () => ({ name: "", left: "", of: "" })), envMore: "", funds: Array.from({ length: 6 }, () => ({ name: "", saved: "" })), fundMore: "",
      days: Array.from({ length: 16 }, () => "") };
  }
  const r = result;
  const end = addDays(r.nextPay, -1);
  const reason = reasonText(r.reason, i18n);
  const bd = [
    [t("print.bd.balance"), money(r.startOfDayMinor)],
    [t("math.bills", { date: md(r.nextPay), n: r.billsDueCount }), money(-r.billsDueMinor)],
    [t("print.bd.aside"), money(-r.reserveMinor)],
    [t("math.funds"), money(-r.earmarkedMinor)],
    [t("math.available"), money(r.availableMinor)],
    [t("math.perDay", { n: r.daysLeft }), t("math.aDay", { amount: money(r.dailyMinor) })],
  ];
  const billRows = occurrences.filter((o) => o.idx === 0 && (o.paid || o.due >= state.payPlan.startDate)).map((o) => ({ due: md(o.due), name: o.bill.name + (o.bill.kind === "debtMin" ? ` (${t("bills.minimum")})` : ""), amount: money(o.amountMinor), paid: o.paid }));
  const b = cap(billRows, LIMITS.bills, more);
  const envRows = envelopes.filter((e) => !e.hidden && e.limitPerPeriodMinor > 0).map((e) => {
    const spent = envelopeSpent(state.transactions, e.presetId || e.id, r.periodStart, r.nextPay);
    const left = e.limitPerPeriodMinor - spent;
    return { name: envName(e), left: left >= 0 ? money(left) : t("env.over", { amount: money(-left) }), of: t("env.of", { spent: money(spent), limit: money(e.limitPerPeriodMinor) }) };
  });
  const en = cap(envRows, LIMITS.envelopes, more);
  const fundRows = state.funds.filter((f) => !f.archived).map((f) => {
    const saved = state.fundMoves.filter((m) => m.fundId === f.id).reduce((n, m) => n + m.amountMinor, 0);
    return { name: f.name, saved: f.targetMinor > 0 ? t("fund.savedOf", { saved: money(saved), target: money(f.targetMinor) }) : money(saved) };
  });
  const fu = cap(fundRows, LIMITS.funds, more);
  const n = Math.min(LIMITS.days, Math.max(1, diffDays(r.periodStart, r.nextPay)));
  const aside = r.reserveMinor > 0 && r.reason.key === "reserve" ? t("print.aside", { amount: money(r.reserveMinor), bill: r.reason.params.bill, due: md(r.reason.params.due) }) : "";
  return {
    ...base, period: t("print.period", { from: md(r.periodStart), to: md(end), pay: md(r.nextPay) }), printedOn: t("print.printedOn", { date: formatDate(today, { dateStyle: "medium" }) }),
    dailyValue: money(r.dailyMinor), reason, breakdown: bd,
    bills: b.rows, billsMore: b.more, aside, envs: en.rows, envMore: en.more, funds: fu.rows, fundMore: fu.more,
    days: Array.from({ length: n }, (_, i) => formatDate(addDays(r.periodStart, i), { weekday: "short", month: "short", day: "numeric" })),
  };
}

/** Neden satiri metni (ekran ve baski ayni islevi kullanir). */
export function reasonText(reason, i18n) {
  const { t, formatCurrency: money, formatDate } = i18n;
  const md = (iso) => (iso ? formatDate(iso, { month: "short", day: "numeric" }) : "");
  const p = reason.params;
  const s = t(`reason.${reason.key}`, { amount: money(p.amount ?? 0), date: md(p.date), bill: p.bill ?? "", due: md(p.due), n: p.count ?? 0 });
  return reason.estimated ? `${s} ${t("reason.estimated")}` : s;
}

/** Metni maxW'ye sigan satirlara boler (sigmayan sozcuk harf harf). */
export function wrap(text, fnt, maxW, measure) {
  const out = [];
  let line = "";
  for (const w of String(text ?? "").split(/\s+/).filter(Boolean)) {
    const tryL = line ? `${line} ${w}` : w;
    if (measure(tryL, fnt) <= maxW) { line = tryL; continue; }
    if (line) out.push(line);
    let rest = w;
    while (measure(rest, fnt) > maxW && rest.length > 1) {
      let k = rest.length - 1;
      while (k > 1 && measure(rest.slice(0, k), fnt) > maxW) k -= 1;
      out.push(rest.slice(0, k)); rest = rest.slice(k);
    }
    line = rest;
  }
  if (line) out.push(line);
  return out;
}

/** Tek sayfa yerlesim. logo: { w, h } (dogal olcu) ya da null. -> { width, height, ops, bottom } */
export function layoutPlan(model, paper = "letter", measure, logo = null) {
  const P = PAPERS[paper] ?? PAPERS.letter;
  const W = P.w, H = P.h, L = M, R = W - M, CW = R - L;
  const ops = [];
  const text = (x, y, s, fnt, color = INK, align = "left") => { if (s) ops.push({ t: "text", x, y, text: String(s), font: fnt, color, align }); };
  const fit = (s, fnt, maxW) => { let v = String(s ?? ""); if (measure(v, fnt) <= maxW) return v; while (v.length > 1 && measure(`${v}…`, fnt) > maxW) v = v.slice(0, -1); return `${v}…`; };
  const line = (x1, y1, x2, y2, color = RULE, w = 2) => ops.push({ t: "line", x1, y1, x2, y2, color, w });
  const rect = (x, y, w, h, color) => ops.push({ t: "rect", x, y, w, h, color });
  const box = (x, y, w, h, color = INK, lw = 2, r = 18) => ops.push({ t: "box", x, y, w, h, color, w2: lw, r });

  // Baslik
  let y = M;
  text(L, y + 50, model.title, font(52, true));
  text(R, y + 40, model.printedOn, font(24), MUTED, "right");
  text(L, y + 98, model.period, font(28), MUTED);
  y += 130;
  // Ozet kutusu
  const boxH = 250;
  box(L, y, CW, boxH);
  const leftW = Math.round(CW * 0.42);
  text(L + 30, y + 52, model.dailyLabel.toUpperCase(), font(24, true), MUTED);
  if (model.blank) line(L + 30, y + 160, L + leftW - 30, y + 160, INK, 2);
  else text(L + 30, y + 150, fit(model.dailyValue, font(84, true), leftW - 50), font(84, true));
  line(L + leftW, y + 24, L + leftW, y + boxH - 24);
  const bx = L + leftW + 30, bw = CW - leftW - 60;
  model.breakdown.forEach(([k, v], i) => {
    const yy = y + 46 + i * 36;
    const strong = i >= 4;
    text(bx, yy, fit(k, font(23, strong), bw - 220), font(23, strong));
    if (model.blank) line(R - 230, yy + 6, R - 30, yy + 6, RULE, 2);
    else text(R - 30, yy, v, font(23, strong), INK, "right");
  });
  y += boxH + 14;
  if (model.reason) {
    for (const ln of wrap(model.reason, font(26), CW, measure).slice(0, 2)) { text(L, y + 30, ln, font(26), GOLD); y += 36; }
  }
  y += 24;
  // Iki sutun
  const gap = 50;
  const lw = Math.round((CW - gap) * 0.6), rx = L + lw + gap, rw = CW - lw - gap;
  const colTop = y;
  const head = (x, yy, s) => { text(x, yy + 34, s, font(30, true)); return yy + 52; };
  // Faturalar
  let ly = head(L, colTop, model.billsTitle);
  const c = [L + 12, L + 150, L + lw - 150, L + lw - 12];
  rect(L, ly, lw, 42, SOFT);
  text(c[0], ly + 29, model.cols[0], font(21, true)); text(c[1], ly + 29, model.cols[1], font(21, true));
  text(c[2], ly + 29, model.cols[2], font(21, true), INK, "right"); text(c[3], ly + 29, model.cols[3], font(21, true), INK, "right");
  ly += 42;
  const rowH = 42;
  for (const b of model.bills) {
    text(c[0], ly + 29, b.due, font(23)); text(c[1], ly + 29, fit(b.name, font(23), c[2] - c[1] - 140), font(23));
    text(c[2], ly + 29, b.amount, font(23), INK, "right");
    box(c[3] - 26, ly + 8, 26, 26, INK, 2, 4);
    if (b.paid) { line(c[3] - 21, ly + 21, c[3] - 14, ly + 29, INK, 3); line(c[3] - 14, ly + 29, c[3] - 4, ly + 12, INK, 3); }
    line(L, ly + rowH, L + lw, ly + rowH);
    ly += rowH;
  }
  if (model.billsMore) { text(c[1], ly + 30, model.billsMore, font(22), MUTED); ly += rowH; }
  if (!model.bills.length) { text(c[1], ly + 30, "—", font(23), MUTED); ly += rowH; }
  if (model.aside) for (const ln of wrap(model.aside, font(22), lw, measure).slice(0, 2)) { text(L, ly + 34, ln, font(22), MUTED); ly += 32; }
  // Zarflar + kumbaralar
  let ry = head(rx, colTop, model.envTitle);
  const rowR = 40;
  for (const e of model.envs) {
    text(rx, ry + 28, fit(e.name, font(23, true), rw * 0.5), font(23, true));
    text(rx + rw, ry + 28, e.left, font(23, true), INK, "right");
    line(rx, ry + rowR, rx + rw, ry + rowR);
    ry += rowR;
  }
  if (model.envMore) { text(rx, ry + 28, model.envMore, font(22), MUTED); ry += rowR; }
  if (!model.envs.length) { text(rx, ry + 28, "—", font(23), MUTED); ry += rowR; }
  ry = head(rx, ry + 16, model.fundTitle);
  for (const f of model.funds) {
    text(rx, ry + 28, fit(f.name, font(23, true), rw * 0.45), font(23, true));
    text(rx + rw, ry + 28, fit(f.saved, font(22), rw * 0.55), font(22), INK, "right");
    line(rx, ry + rowR, rx + rw, ry + rowR);
    ry += rowR;
  }
  if (model.fundMore) { text(rx, ry + 28, model.fundMore, font(22), MUTED); ry += rowR; }
  if (!model.funds.length) { text(rx, ry + 28, "—", font(23), MUTED); ry += rowR; }
  // Gunluk takip izgarasi
  y = Math.max(ly, ry) + 30;
  y = head(L, y, model.trackTitle);
  const cols = 8, cellW = CW / cols;
  const rows = Math.max(1, Math.ceil(model.days.length / cols));
  const footTop = H - M - 70 - 30;
  const cellH = Math.max(74, Math.min(170, Math.floor((footTop - y) / rows))); // bos alan yazmak icin hucrelere verilir
  model.days.forEach((d, i) => {
    const cx = L + (i % cols) * cellW, cy = y + Math.floor(i / cols) * cellH;
    box(cx + 4, cy + 4, cellW - 8, cellH - 8, RULE, 2, 8);
    text(cx + 14, cy + 30, fit(d, font(19), cellW - 28), font(19), MUTED);
  });
  y += Math.ceil(model.days.length / cols) * cellH;
  // Altbilgi: uyari + marka (beyaz kagitta mavi ÜNVERCO logosu, oran korunur; logo yeniden cizilmez)
  const footY = H - M - 70;
  line(L, footY - 14, R, footY - 14, RULE, 2);
  const lgH = 70, lgW = logo ? Math.round((logo.w / logo.h) * lgH) : 0;
  for (const [i, ln] of wrap(model.disclaimer, font(21), CW - lgW - 30, measure).slice(0, 2).entries()) text(L, footY + 26 + i * 28, ln, font(21), MUTED);
  if (logo) {
    ops.push({ t: "image", x: R - lgW, y: footY, w: lgW, h: lgH });
  } else text(R, footY + 40, model.brand, font(22, true), MUTED, "right");
  return { width: W, height: H, ops, bottom: y, footY };
}

/** Komutlari 2B baglama cizer (tarayici). */
export function paintPlan(c2d, lay, image = null) {
  c2d.fillStyle = "#ffffff";
  c2d.fillRect(0, 0, lay.width, lay.height);
  c2d.textBaseline = "alphabetic";
  for (const op of lay.ops) {
    if (op.t === "text") { c2d.font = op.font; c2d.fillStyle = op.color; c2d.textAlign = op.align; c2d.fillText(op.text, op.x, op.y); }
    else if (op.t === "rect") { c2d.fillStyle = op.color; c2d.fillRect(op.x, op.y, op.w, op.h); }
    else if (op.t === "line") { c2d.strokeStyle = op.color; c2d.lineWidth = op.w; c2d.beginPath(); c2d.moveTo(op.x1, op.y1); c2d.lineTo(op.x2, op.y2); c2d.stroke(); }
    else if (op.t === "box") {
      c2d.beginPath();
      if (typeof c2d.roundRect === "function") c2d.roundRect(op.x, op.y, op.w, op.h, op.r); else c2d.rect(op.x, op.y, op.w, op.h);
      if (op.fill) { c2d.fillStyle = op.fill; c2d.fill(); }
      if (op.w2) { c2d.strokeStyle = op.color; c2d.lineWidth = op.w2; c2d.stroke(); }
    } else if (op.t === "image" && image) c2d.drawImage(image, op.x, op.y, op.w, op.h);
  }
}
