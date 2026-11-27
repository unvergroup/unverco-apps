// Yazdirilan belgelerin metinleri (secili dilde) ve Intl ay / gun adlari.
export function docLabels(ctx, year = 2027) {
  const { t, i18n } = ctx;
  return {
    footer: t("doc.footer"), less: t("year.less"), more: t("year.more"), noSuchDay: t("year.noDay"),
    colHabit: t("year.colHabit"), colRate: t("year.colRate"), colBest: t("year.colBest"), colComebacks: t("year.colComebacks"),
    myYearTitle: t("doc.myYear", { year }), myMonthSub: t("doc.myMonthSub"), blankMonthSub: t("doc.blankMonthSub"), habitLine: t("doc.habitLine"), restLetter: t("doc.restLetter"),
    monthsShort: i18n.monthsShort, monthsLong: i18n.monthsLong, weekdayNarrow: i18n.weekdayNarrow,
  };
}
