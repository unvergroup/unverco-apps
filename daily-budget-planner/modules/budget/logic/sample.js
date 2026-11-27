// Ornek veri: 3 senaryo (weekly / biweekly / monthly). Uydurma hane; gercek kisi ya da marka yok. Tarihler BUGUNE gore kurulur.
// biweekly senaryo spec §5 T-ENG-01'i aynen verir: gunluk $70.42, bugun $12.50 harcandi -> kalan $57.92, ayrilan $412.00 (kira).
// Her kayit sample: true tasir; "Remove sample data" yalniz bunlari siler.
import { addDays } from "../../../core/dates.js";

export const SAMPLE_KINDS = Object.freeze(["biweekly", "weekly", "monthly"]);

const bill = (t, key, amountMinor, due, extra = {}) => ({ name: t(key), amountMinor, kind: "bill", repeat: "monthly", firstDue: due, everyN: 2, endDate: "", payFrom: "auto", active: true, sample: true, ...extra });
const spend = (date, amountMinor, envelopeId, note) => ({ date, type: "expense", amountMinor, envelopeId, note, source: "manual", sample: true });

/** -> { payPlan, transactions, bills, funds, fundMoves(fundIndex ile), envelopeLimits } */
export function sampleData(kind, today, t) {
  const d = (n) => addDays(today, n);
  if (kind === "weekly") {
    const start = d(-3);
    return {
      payPlan: { frequency: "weekly", anchorDate: start, semiDays: [1, 15], monthDay: 1, amountMinor: 72000, nextOverride: "", startBalanceMinor: 78115, startDate: start, setupDone: true, sample: true },
      transactions: [
        { date: start, type: "income", amountMinor: 72000, envelopeId: "", note: "", source: "pay", payFor: start, sample: true },
        spend(d(-3), 6840, "groceries", t("sample.note.groceries")), spend(d(-2), 3500, "transport", t("sample.note.gas")),
        spend(d(-1), 1275, "eatingOut", t("sample.note.lunch")), spend(today, 525, "eatingOut", t("sample.note.coffee")),
      ],
      bills: [
        bill(t, "sample.rent", 110000, d(6), { payFrom: "earlier" }), bill(t, "sample.phone", 4500, d(2)),
        bill(t, "sample.insurance", 12000, d(10)), bill(t, "sample.gym", 3000, d(12)),
      ],
      funds: [{ name: t("sample.fund.car"), targetMinor: 60000, targetDate: d(120), mode: "toDate", perPeriodMinor: 0, archived: false, sample: true }],
      fundMoves: [{ fund: 0, date: d(-10), amountMinor: 8000, kind: "manual" }],
      envelopeLimits: { groceries: 15000, eatingOut: 6000, transport: 5000, fun: 4000 },
    };
  }
  if (kind === "monthly") {
    const start = d(-10);
    const day = Number(start.slice(8, 10));
    return {
      payPlan: { frequency: "monthly", anchorDate: "", semiDays: [1, 15], monthDay: day, amountMinor: 320000, nextOverride: "", startBalanceMinor: 161730, startDate: start, setupDone: true, sample: true },
      transactions: [
        { date: start, type: "income", amountMinor: 320000, envelopeId: "", note: "", source: "pay", payFor: start, sample: true },
        spend(d(-9), 14230, "groceries", t("sample.note.groceries")), spend(d(-6), 9810, "groceries", t("sample.note.groceries")),
        spend(d(-5), 4600, "transport", t("sample.note.gas")), spend(d(-3), 3850, "fun", t("sample.note.movie")),
        spend(d(-1), 2240, "kids", t("sample.note.school")), spend(today, 890, "eatingOut", t("sample.note.coffee")),
      ],
      bills: [
        bill(t, "sample.rent", 145000, d(12), { payFrom: "earlier" }), bill(t, "sample.utilities", 16000, d(5)),
        bill(t, "sample.car", 31000, d(15)), bill(t, "sample.internet", 6000, d(3)),
        bill(t, "sample.cardMin", 4000, d(8), { kind: "debtMin" }),
      ],
      funds: [{ name: t("sample.fund.holiday"), targetMinor: 80000, targetDate: "", mode: "fixed", perPeriodMinor: 10000, archived: false, sample: true }],
      fundMoves: [{ fund: 0, date: start, amountMinor: 10000, kind: "auto", period: start }],
      envelopeLimits: { groceries: 60000, eatingOut: 20000, transport: 18000, household: 10000, kids: 12000, fun: 15000 },
    };
  }
  // biweekly: spec §5 ornegi (T-ENG-01)
  const start = d(-7);
  const tx = [
    { date: start, type: "income", amountMinor: 140000, envelopeId: "", note: "", source: "pay", payFor: start, sample: true },
    spend(d(-7), 9620, "groceries", t("sample.note.groceries")), spend(d(-3), 8620, "groceries", t("sample.note.groceries")),
    spend(d(-6), 5480, "eatingOut", t("sample.note.dinner")), spend(d(-4), 3890, "eatingOut", t("sample.note.takeout")),
    spend(d(-2), 2500, "eatingOut", t("sample.note.pizza")),
    spend(d(-5), 4100, "transport", t("sample.note.gas")), spend(d(-4), 2215, "household", t("sample.note.household")),
    spend(d(-3), 1800, "personal", t("sample.note.haircut")), spend(d(-1), 6450, "fun", t("sample.note.concert")),
    spend(today, 475, "eatingOut", t("sample.note.coffee")), spend(today, 775, "eatingOut", t("sample.note.lunch")),
  ];
  return {
    payPlan: { frequency: "biweekly", anchorDate: start, semiDays: [1, 15], monthDay: 1, amountMinor: 140000, nextOverride: "", startBalanceMinor: 19675, startDate: start, setupDone: true, sample: true },
    transactions: tx,
    bills: [
      bill(t, "sample.phone", 6000, d(3)), bill(t, "sample.cardMin", 3500, d(5), { kind: "debtMin" }),
      bill(t, "sample.rent", 138200, d(8)), bill(t, "sample.electric", 12000, d(13)),
      bill(t, "sample.car", 26000, d(18)), bill(t, "sample.streaming", 1500, d(23)),
    ],
    funds: [{ name: t("sample.fund.holiday"), targetMinor: 60000, targetDate: "", mode: "fixed", perPeriodMinor: 5000, archived: false, sample: true }],
    fundMoves: [{ fund: 0, date: d(-20), amountMinor: 10000, kind: "manual" }, { fund: 0, date: start, amountMinor: 5000, kind: "auto", period: start }],
    envelopeLimits: { groceries: 30000, eatingOut: 12000, transport: 9000, household: 6000, personal: 5000, fun: 8000 },
  };
}

