/**
 * "Порог и налоги" (annual threshold, tax by month, other income) and the summary block of "Резервы".
 * Both sheets are custom layouts: several blocks side by side, fixed cell addresses, named cells TH_* and NV_RES_*.
 */

const NV_TH = {
  year: { head: 5, first: 6 },
  months: { col: 5, first: 6, last: 17, total: 18 },
  other: { col: 18, first: 6, rows: 200 },
};

/** Block of the year: label and the formula (ru_RU notation) for each row; C is the value column. */
function nvThresholdYearRows() {
  const P = (k) => nvR("payments", k);
  const O = (k) => nvR("orders", k);
  const C = NV_DEMO_CRIT;
  const daysInYear = "(DATE(C6+1;1;1)-DATE(C6;1;1))";
  return [
    ["Год", "=P_YEAR", "TH_YEAR", "int"],
    [
      "Лимит года",
      "=IF(YEAR(NV_REG_DATE)<>C6; NV_ANNUAL_LIMIT; QUOTIENT(NV_ANNUAL_LIMIT*(" +
        daysInYear +
        '-(NV_REG_DATE-DATE(C6;1;1)+1)+IF(NV_PROPORTION="С днём регистрации";1;0)); ' +
        daysInYear +
        "))",
      "TH_LIMIT",
      "sum",
    ],
    ["Объём сделок", "=SUM($J$6:$J$17)", "TH_VOLUME", "sum"],
    [
      "Принятые сметы",
      "=SUMIFS(" +
        O("purchaseLimit") +
        "; " +
        O("code") +
        '; "accepted"; ' +
        O("demo") +
        "; " +
        C +
        ")+SUMIFS(" +
        O("feeTotal") +
        "; " +
        O("code") +
        '; "accepted"; ' +
        O("demo") +
        "; " +
        C +
        ")",
      "TH_COMMITTED",
      "sum",
    ],
    ["Доля", "=IF(C7>0; MIN(1; QUOTIENT(MAX(0; C8)*10000; C7)/10000); 1)", "TH_SHARE", "pct"],
    ["Прогнозная доля", "=IF(C7>0; MIN(1; QUOTIENT(MAX(0; C8+C9)*10000; C7)/10000); 1)", "TH_PROJ", "pct"],
    [
      "Пройденные рубежи",
      '=IFERROR(TEXTJOIN(", "; TRUE; FILTER(NV_ALERTS_BP/100&" %"; C10*10000>=NV_ALERTS_BP)); "—")',
      "TH_ALERTS",
      "text",
    ],
    ["Выше плана", '=IF(C6=2026; IF(C8+C9>NV_PLAN_CAP_2026; "Да"; "Нет"); "—")', "TH_OVER", "text"],
    ["Остаток до лимита", "=MAX(0; C7-C8-C9)", "TH_LEFT", "sum"],
    ["План года", '=IF(C6=2026; NV_PLAN_CAP_2026; "—")', "TH_PLAN", "sum"],
  ];
}

const NV_TH_MONTH_HEAD = [
  "Месяц",
  "Чеки закупок",
  "Плата получена",
  "Возвраты платы",
  "Прочий доход ИП",
  "Сделки месяца",
  "Нарастающим",
  "Налог 1 % (оценка)",
  "Налог по выписке Xolis",
  "Срок уплаты",
  "Уплачено",
  "Дата уплаты",
];
const NV_TH_OTHER_HEAD = ["Дата", "Сумма", "Вид", "Заметка"];

function nvBuildThreshold() {
  const ss = nvSpreadsheet();
  const sh = nvSheet("threshold");
  const L = NV_LAYOUT;
  const P = (k) => nvR("payments", k);
  const Pu = (k) => nvR("purchases", k);
  const C = NV_DEMO_CRIT;
  const needRows = L.headerRow + NV_TH.other.rows + 2;
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  if (sh.getMaxColumns() < 22) sh.insertColumnsAfter(sh.getMaxColumns(), 22 - sh.getMaxColumns());
  sh.getRange(4, 2).setValue("Год");
  sh.getRange(4, NV_TH.months.col).setValue("Месяцы");
  sh.getRange(4, NV_TH.other.col).setValue("Прочий доход ИП");
  sh.getRange(L.headerRow, 2, 1, 2).setValues([["Показатель", "Значение"]]);
  sh.getRange(L.headerRow, NV_TH.months.col, 1, 12).setValues([NV_TH_MONTH_HEAD]);
  sh.getRange(L.headerRow, NV_TH.other.col, 1, 4).setValues([NV_TH_OTHER_HEAD]);
  const yearRows = nvThresholdYearRows();
  sh.getRange(NV_TH.year.first, 2, yearRows.length, 2).setValues(yearRows.map((r) => [r[0], nvApiFormula(r[1])]));
  yearRows.forEach((r, i) => {
    nvSetName(ss, r[2], sh.getRange(NV_TH.year.first + i, 3));
  });
  const ot = (k) =>
    "$" + nvLetter(NV_TH.other.col + k) + "$" + NV_TH.other.first + ":$" + nvLetter(NV_TH.other.col + k);
  // The twelve months: columns E..L in one call and the due dates (N) in another; the inputs M, O, P are never written
  const feeOf = (group, m) =>
    "=SUMIFS(" +
    P("amount") +
    "; " +
    P("group") +
    '; "' +
    group +
    '"; ' +
    P("status") +
    '; "Подтверждён"; ' +
    P("date") +
    '; ">="&' +
    m +
    "; " +
    P("date") +
    '; "<"&EDATE(' +
    m +
    "; 1); " +
    P("demo") +
    "; " +
    C +
    ")";
  const monthRows = [];
  const dueRows = [];
  for (let i = 0; i < 12; i++) {
    const r = NV_TH.months.first + i;
    const m = "E" + r;
    monthRows.push(
      [
        "=DATE($C$6; " + (i + 1) + "; 1)",
        "=SUMIFS(" +
          Pu("amount") +
          "; " +
          Pu("bought") +
          '; ">="&' +
          m +
          "; " +
          Pu("bought") +
          '; "<"&EDATE(' +
          m +
          "; 1); " +
          Pu("demo") +
          "; " +
          C +
          ")",
        feeOf("Плата", m),
        feeOf("Возврат платы", m),
        "=SUMIFS(" + ot(1) + "; " + ot(0) + '; ">="&' + m + "; " + ot(0) + '; "<"&EDATE(' + m + "; 1))",
        "=F" + r + "+G" + r + "-H" + r + "+I" + r,
        "=SUM($J$6:J" + r + ")",
        "=QUOTIENT(MAX(0; G" + r + "-H" + r + ")*NV_TURNOVER_TAX_BP+9999; 10000)",
      ].map(nvApiFormula),
    );
    dueRows.push([nvApiFormula("=DATE(YEAR(E" + r + "); MONTH(E" + r + ")+1; 15)")]);
  }
  sh.getRange(NV_TH.months.first, 5, 12, 8).setValues(monthRows);
  sh.getRange(NV_TH.months.first, 14, 12, 1).setValues(dueRows);
  const tr = NV_TH.months.total;
  sh.getRange(tr, 5).setValue("Итого");
  ["F", "G", "H", "I", "J", "L", "M"].forEach((l) => {
    sh.getRange(l + tr).setFormula(nvApiFormula("=SUM(" + l + "6:" + l + "17)"));
  });
  nvSetName(ss, "TH_MONTHS", sh.getRange("E6:E17"));
  nvSetName(ss, "TH_DEALS", sh.getRange("J6:J17"));
  nvSetName(ss, "TH_CUM", sh.getRange("K6:K17"));
  nvSetName(ss, "TH_TAX_EST", sh.getRange("L6:L17"));
  nvSetName(ss, "TH_PAID", sh.getRange("O6:O17"));

  // Validations
  const intRule = (cell) =>
    SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied(
        nvApiFormula("=AND(ISNUMBER(" + cell + "); " + cell + "=INT(" + cell + "); " + cell + ">=0)"),
      )
      .setAllowInvalid(false)
      .setHelpText("Целое число не меньше 0")
      .build();
  sh.getRange("M6:M17").setDataValidation(intRule("M6"));
  sh.getRange("O6:O17").setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sh.getRange("P6:P17").setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build(),
  );
  const o0 = NV_TH.other.first;
  const oc = NV_TH.other.col;
  sh.getRange(o0, oc, NV_TH.other.rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build(),
  );
  sh.getRange(o0, oc + 1, NV_TH.other.rows, 1).setDataValidation(intRule(nvLetter(oc + 1) + o0));
  sh.getRange(o0, oc + 2, NV_TH.other.rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(nvDictRange("NVD_OTHER_INCOME"), true)
      .setAllowInvalid(false)
      .build(),
  );
  sh.getRange(3, 2).setFormula(
    nvApiFormula(
      '="год "&TH_YEAR&" · лимит "&TEXT(TH_LIMIT;"#,##0")&" сум · объём сделок "&TEXT(TH_VOLUME;"#,##0")&" сум · доля "&TEXT(TH_SHARE;"0.0%")&"   ·   сделки = чеки закупок + плата − возвраты платы + прочий доход ИП"',
    ),
  );
  sh.getRange("L5").setNote(
    "Оценка: 1 % платы за месяц (за вычетом возвратов), вверх до сума. В отчётах главнее колонка «по выписке Xolis».",
  );
  sh.getRange("M5").setNote("Сумма налога по выписке Xolis: вводится вручную.");
}

function nvStyleThreshold() {
  const sh = nvSheet("threshold");
  const T = nvThemeFor("threshold");
  const L = NV_LAYOUT;
  const maxRows = sh.getMaxRows();
  const maxCols = sh.getMaxColumns();
  sh.getRange(1, 1, maxRows, maxCols)
    .setBackground(T.bg)
    .setFontFamily(NV_FONT_TEXT)
    .setFontSize(10)
    .setFontColor(T.text)
    .setVerticalAlignment("middle");
  sh.setColumnWidth(1, L.gutterWidth);
  [220, 170, 16, 104, 128, 128, 128, 128, 128, 128, 128, 128, 104, 76, 104, 16, 104, 128, 170, 220].forEach((w, i) => {
    sh.setColumnWidth(2 + i, w);
  });
  sh.setColumnWidths(22, Math.max(1, maxCols - 21), L.gutterWidth);
  sh.setRowHeight(1, L.rowHeights.top);
  sh.setRowHeight(2, L.rowHeights.title);
  sh.setRowHeight(3, L.rowHeights.caption);
  sh.setRowHeight(4, 24);
  sh.setRowHeight(L.headerRow, L.rowHeights.header);
  sh.setRowHeights(L.firstRow, maxRows - L.firstRow + 1, 28);
  sh.getRange(2, L.firstCol).setRichTextValue(nvTitleRich("Порог и налоги", T, 18));
  sh.getRange(3, L.firstCol).setFontSize(9).setFontColor(T.text2).setWrap(false);
  const blocks = [
    { col: 2, n: 2, rows: 10, label: 2 },
    { col: NV_TH.months.col, n: 12, rows: 13 },
    { col: NV_TH.other.col, n: 4, rows: NV_TH.other.rows },
  ];
  blocks.forEach((b) => {
    sh.getRange(4, b.col)
      .setFontWeight("bold")
      .setFontColor(T.accentText)
      .setFontSize(10)
      .setVerticalAlignment("bottom");
    const head = sh.getRange(L.headerRow, b.col, 1, b.n);
    head
      .setBackground(T.head)
      .setFontWeight("bold")
      .setFontSize(9)
      .setFontColor(T.headText)
      .setWrap(true)
      .setVerticalAlignment("middle");
    nvBorder(head, "bottom", T.headRule, "SOLID_MEDIUM");
    const body = sh.getRange(L.firstRow, b.col, b.rows, b.n);
    body.setBackground(T.surface);
    nvRowLines(body, T.rowLine);
  });
  // Year block
  nvThresholdYearRows().forEach((r, i) => {
    const row = NV_TH.year.first + i;
    const cell = sh.getRange(row, 3);
    cell.setFontFamily(NV_FONT_MONO).setFontWeight("bold").setHorizontalAlignment("right");
    cell.setNumberFormat(r[3] === "sum" ? NV_FMT.sum : r[3] === "pct" ? NV_FMT.pct : r[3] === "int" ? "0" : "@");
    if (i % 2 === 1) sh.getRange(row, 2, 1, 2).setBackground(T.band);
  });
  // Month block
  const months = sh.getRange(NV_TH.months.first, 5, 12, 12);
  months.setFontFamily(NV_FONT_MONO).setHorizontalAlignment("right");
  sh.getRange(NV_TH.months.first, 5, 12, 1)
    .setNumberFormat("mmmm yyyy")
    .setHorizontalAlignment("left")
    .setFontFamily(NV_FONT_TEXT);
  sh.getRange(NV_TH.months.first, 6, 12, 6).setNumberFormat(NV_FMT.sum);
  sh.getRange(NV_TH.months.first, 12, 12, 2).setNumberFormat(NV_FMT.sum);
  sh.getRange(NV_TH.months.first, 14, 12, 1).setNumberFormat(NV_FMT.date).setHorizontalAlignment("left");
  sh.getRange(NV_TH.months.first, 15, 12, 1).setHorizontalAlignment("center");
  sh.getRange(NV_TH.months.first, 16, 12, 1).setNumberFormat(NV_FMT.date).setHorizontalAlignment("left");
  for (let i = 1; i < 12; i += 2) sh.getRange(NV_TH.months.first + i, 5, 1, 12).setBackground(T.band);
  const total = sh.getRange(NV_TH.months.total, 5, 1, 12);
  total
    .setBackground(T.totalBg)
    .setFontWeight("bold")
    .setFontFamily(NV_FONT_MONO)
    .setNumberFormat(NV_FMT.sum)
    .setHorizontalAlignment("right");
  nvBorder(total, "top", T.totalRule, "SOLID_MEDIUM");
  sh.getRange(NV_TH.months.total, 5).setFontFamily(NV_FONT_TEXT).setHorizontalAlignment("left").setNumberFormat("@");
  // Other income block
  const oc = NV_TH.other.col;
  sh.getRange(NV_TH.other.first, oc, NV_TH.other.rows, 1).setNumberFormat(NV_FMT.date).setFontFamily(NV_FONT_MONO);
  sh.getRange(NV_TH.other.first, oc + 1, NV_TH.other.rows, 1)
    .setNumberFormat(NV_FMT.sum)
    .setFontFamily(NV_FONT_MONO)
    .setHorizontalAlignment("right");
  sh.getBandings().forEach((b) => {
    b.remove();
  });
  sh.getRange(NV_TH.other.first, oc, NV_TH.other.rows, 4)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor(T.surface)
    .setSecondRowColor(T.band);
  const solid = { bg: T.overdueFill, color: T.overdueText, bold: true };
  sh.setConditionalFormatRules([
    nvRule(sh.getRange("N6:O17"), "=AND($N6<TODAY(); $O6<>TRUE; $L6>0)", solid),
    nvRule(sh.getRange("C10:C11"), '=C10*10000>=INDIRECT("NV_ALERT_5")', solid),
    nvRule(sh.getRange("C10:C11"), '=C10*10000>=INDIRECT("NV_ALERT_2")', { color: T.accentText, bold: true }),
    nvRule(sh.getRange("C13"), '=C13="Да"', solid),
  ]);
  sh.setFrozenRows(L.headerRow);
  sh.setHiddenGridlines(true);
  sh.setTabColor(null);
}

/* ---------------------------------------------------------------- reserves summary */

const NV_RES_SUMMARY = { col: 11, first: 6 };

function nvBuildReservesSummary() {
  const ss = nvSpreadsheet();
  const sh = nvSheet("reserves");
  const L = NV_LAYOUT;
  const R = (k) => nvColRange("reserves", k, false);
  const O = (k) => nvR("orders", k);
  const C = NV_DEMO_CRIT;
  const rows = [
    [
      "Баланс гарантийного",
      "=SUMIFS(" + R("amount") + "; " + R("fund") + '; "Гарантийный"; ' + R("demo") + "; " + C + ")",
      "NV_RES_BAL_W",
      "sum",
    ],
    [
      "Баланс налогового",
      "=SUMIFS(" + R("amount") + "; " + R("fund") + '; "Налоговый риск"; ' + R("demo") + "; " + C + ")",
      "NV_RES_BAL_T",
      "sum",
    ],
    ["Закрыто заказов", "=COUNTIFS(" + O("code") + '; "closed"; ' + O("demo") + "; " + C + ")", "NV_RES_CLOSED", "int"],
    [
      "Потери за 12 мес., бп",
      "=QUOTIENT(-SUMIFS(" +
        R("amount") +
        "; " +
        R("fund") +
        '; "Гарантийный"; ' +
        R("basis") +
        '; "Расход*"; ' +
        R("date") +
        '; ">="&EDATE(TODAY(); -12); ' +
        R("demo") +
        "; " +
        C +
        ")*10000; MAX(1; SUMIFS(" +
        O("receipts") +
        "; " +
        O("dHandover") +
        '; ">="&EDATE(TODAY(); -12); ' +
        O("demo") +
        "; " +
        C +
        ")))",
      "NV_RES_LOSS_BP",
      "int",
    ],
    [
      "Ставка взноса сейчас",
      '=IF(L11="да"; TEXT(NV_WARRANTY_MATURE_BP/100; "0")&" %"; TEXT(NV_WARRANTY_RATE_BP/100; "0")&" %, минимум "&TEXT(NV_WARRANTY_MIN; "#,##0")&" сум")',
      "NV_RES_RATE",
      "text",
    ],
    [
      "Фонд «созрел»",
      '=IF(AND(L6>=NV_WARRANTY_MATURE_BALANCE; L8>=NV_WARRANTY_MATURE_ORDERS; L9<NV_WARRANTY_MATURE_LOSS_BP); "да"; "нет")',
      "NV_RES_MATURE",
      "text",
    ],
  ];
  if (sh.getMaxColumns() < 13) sh.insertColumnsAfter(sh.getMaxColumns(), 13 - sh.getMaxColumns());
  const c = NV_RES_SUMMARY.col;
  sh.getRange(L.headerRow, c, 1, 2).setValues([["Сводка", "Значение"]]);
  sh.getRange(4, c).setValue("Фонды");
  rows.forEach((r, i) => {
    const row = NV_RES_SUMMARY.first + i;
    sh.getRange(row, c).setValue(r[0]);
    sh.getRange(row, c + 1).setFormula(nvApiFormula(r[1]));
    nvSetName(ss, r[2], sh.getRange(row, c + 1));
  });
  sh.getRange(NV_RES_SUMMARY.first + 3, c).setNote(
    "Определение подтверждает владелец: расходы из гарантийного резерва за 12 месяцев к чекам сданных заказов, в бп.",
  );
}

function nvStyleReservesSummary() {
  const sh = nvSheet("reserves");
  const T = nvThemeFor("reserves");
  const L = NV_LAYOUT;
  const c = NV_RES_SUMMARY.col;
  sh.setColumnWidth(c - 1, L.gutterWidth);
  sh.setColumnWidth(c, 230);
  sh.setColumnWidth(c + 1, 230);
  const head = sh.getRange(L.headerRow, c, 1, 2);
  head
    .setBackground(T.head)
    .setFontWeight("bold")
    .setFontSize(9)
    .setFontColor(T.headText)
    .setFontFamily(NV_FONT_TEXT)
    .setVerticalAlignment("middle");
  nvBorder(head, "bottom", T.headRule, "SOLID_MEDIUM");
  sh.getRange(4, c)
    .setFontWeight("bold")
    .setFontColor(T.accentText)
    .setFontSize(10)
    .setFontFamily(NV_FONT_TEXT)
    .setVerticalAlignment("bottom");
  const body = sh.getRange(NV_RES_SUMMARY.first, c, 6, 2);
  body
    .setBackground(T.surface)
    .setFontFamily(NV_FONT_TEXT)
    .setFontSize(10)
    .setFontColor(T.text)
    .setVerticalAlignment("middle");
  nvRowLines(body, T.rowLine);
  const vals = sh.getRange(NV_RES_SUMMARY.first, c + 1, 6, 1);
  vals.setFontFamily(NV_FONT_MONO).setHorizontalAlignment("right").setFontWeight("bold");
  sh.getRange(NV_RES_SUMMARY.first, c + 1, 2, 1).setNumberFormat(NV_FMT.sum);
  sh.getRange(NV_RES_SUMMARY.first + 2, c + 1, 2, 1).setNumberFormat("#,##0");
  for (let i = 1; i < 6; i += 2) sh.getRange(NV_RES_SUMMARY.first + i, c, 1, 2).setBackground(T.band);
  sh.getRange(1, c - 1, 4, 3).setBackground(T.bg);
  sh.getRange(NV_RES_SUMMARY.first + 6, c - 1, sh.getMaxRows() - NV_RES_SUMMARY.first - 5, 4).setBackground(T.bg);
}
