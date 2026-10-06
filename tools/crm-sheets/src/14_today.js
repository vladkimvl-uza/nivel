/**
 * "Сегодня": the list of things to do and the overdue ones, collected by formulas from all sheets by the term rules
 * of the domain (24/48 h report, 3 working days of objections, 5 working days of refund, warranty terms and so on),
 * plus the owner's own tasks. "_Задачи" holds the 20 rule blocks; "Сегодня" sorts and labels them.
 */

const NV_TODAY = { first: 6, manualCol: 13 };

function nvSheetGid(sheetKey) {
  return nvSheet(sheetKey).getSheetId();
}

/** One block: FILTER over HSTACK of eight columns (due, text, object, number, client, sum, rule code, link). */
function nvTaskBlock(b) {
  const empty = "{" + new Array(8).fill('""').join("\\") + "}";
  const url = '"#gid=' + nvSheetGid(b.sheet) + '&range=B"&ROW(' + nvR(b.sheet, b.keyCol) + ")";
  const conds = b.conds.concat([nvDemoOk(nvR(b.sheet, "demo"))]);
  return (
    "ARRAYFORMULA(IFERROR(FILTER(HSTACK(" +
    [b.due, b.text, nvQ(b.object), b.num, b.client, b.amount || '""', nvQ(b.code), url].join("; ") +
    "); " +
    conds.join("; ") +
    "); " +
    empty +
    "))"
  );
}

/** The 20 rules; a rule can be made of several blocks. */
function nvTaskRules() {
  const O = (k) => nvR("orders", k);
  const L = (k) => nvR("leads", k);
  const Pu = (k) => nvR("purchases", k);
  const W = (k) => nvR("warranty", k);
  const orderBlock = (code, due, text, conds, amount) => ({
    sheet: "orders",
    keyCol: "num",
    code: code,
    due: due,
    text: text,
    object: "Заказ",
    num: O("num"),
    client: O("clientName"),
    amount: amount,
    conds: conds,
  });
  const clientOfPurchase = "IFERROR(XLOOKUP(" + Pu("order") + "; " + O("num") + "; " + O("clientName") + '); "")';
  const or = (...xs) => "(" + xs.join("+") + ")>0";
  return [
    {
      code: "lead_no_reply",
      blocks: [
        {
          sheet: "leads",
          keyCol: "num",
          code: "lead_no_reply",
          due: L("created") + "+NV_FIRST_RESPONSE_HOURS/24",
          text: nvQ("Ответить на новую заявку"),
          object: "Заявка",
          num: L("num"),
          client: L("name"),
          amount: L("budget"),
          conds: [L("status") + '="Новая"', L("num") + '<>""', L("firstReply") + '=""'],
        },
      ],
    },
    {
      code: "next_step",
      blocks: [
        {
          sheet: "leads",
          keyCol: "num",
          code: "next_step",
          due: L("nextDate"),
          text: '"Шаг: "&' + L("next"),
          object: "Заявка",
          num: L("num"),
          client: L("name"),
          amount: L("budget"),
          conds: [L("nextDate") + '<>""', or("(" + L("status") + '="Новая")', "(" + L("status") + '="В работе")')],
        },
        orderBlock(
          "next_step",
          O("nextDate"),
          '"Шаг: "&' + O("nextStep"),
          [O("nextDate") + '<>""', O("group") + '<>"Сдан"', O("group") + '<>"Отмена"', O("num") + '<>""'],
          O("grand"),
        ),
      ],
    },
    {
      code: "estimate_expiring",
      blocks: [
        orderBlock(
          "estimate_expiring",
          O("validUntil"),
          nvQ("Смета истекает: напомнить клиенту или пересмотреть"),
          [O("code") + '="estimate_sent"', O("validUntil") + '<>""', "(" + O("validUntil") + "-NOW())<=1"],
          O("grand"),
        ),
      ],
    },
    {
      code: "no_advance",
      blocks: [
        orderBlock(
          "no_advance",
          O("dAccepted") + "+1",
          nvQ("Принят без аванса: напомнить об оплате платы"),
          [O("code") + '="accepted"', O("feePaid") + '="Нет"', O("dAccepted") + '<>""'],
          O("advance"),
        ),
      ],
    },
    {
      code: "no_funds",
      blocks: [
        orderBlock(
          "no_funds",
          O("dAccepted") + "+1",
          nvQ("Нет денег на закупку: напомнить о переводе на счёт ИП"),
          [O("code") + '="accepted"', O("fundsOk") + '="Нет"', O("dAccepted") + '<>""'],
          O("purchaseLimit"),
        ),
      ],
    },
    {
      code: "meeting",
      blocks: [
        orderBlock(
          "meeting",
          O("dAccepted") + "+1",
          nvQ("Провести встречу или видеозвонок (первый заказ от 15 млн)"),
          [
            O("code") + '="accepted"',
            O("meetingNeeded") + '="Да"',
            O("meetingDone") + "<>TRUE",
            O("dAccepted") + '<>""',
          ],
          O("grand"),
        ),
      ],
    },
    {
      code: "can_purchase",
      blocks: [
        orderBlock(
          "can_purchase",
          O("notBefore"),
          nvQ("Можно начинать закупку"),
          [
            O("code") + '="accepted"',
            O("feePaid") + '="Да"',
            O("fundsOk") + '="Да"',
            O("notBefore") + '<>""',
            or("(" + O("meetingNeeded") + '="Нет")', "(" + O("meetingDone") + "=TRUE)"),
          ],
          O("purchaseLimit"),
        ),
      ],
    },
    {
      code: "report",
      blocks: [
        orderBlock(
          "report_due",
          O("reportTarget"),
          nvQ("Отправить отчёт о закупке (цель 24 ч)"),
          [O("code") + '="report_due"', O("reportTarget") + '<>""'],
          O("receipts"),
        ),
        orderBlock(
          "report_deadline",
          O("reportDeadline"),
          nvQ("Отчёт о закупке: крайний срок 48 ч"),
          [O("code") + '="report_due"', O("reportDeadline") + '<>""'],
          O("receipts"),
        ),
      ],
    },
    {
      code: "objection_expired",
      blocks: [
        orderBlock(
          "objection_expired",
          O("objectionUntil"),
          nvQ("Срок возражений истёк: отчёт принят по сроку"),
          [
            O("code") + '="report_sent"',
            or("(" + O("reportAccepted") + '="Нет")', "(" + O("reportAccepted") + '="")'),
            O("objection") + '=""',
            O("objectionUntil") + '<>""',
          ],
          O("remainder"),
        ),
      ],
    },
    {
      code: "refund_due",
      blocks: [
        orderBlock(
          "refund_due",
          O("refundDue"),
          nvQ("Вернуть остаток клиенту"),
          [O("code") + '="report_sent"', O("refundDue") + '<>""', O("remainder") + ">0"],
          O("remainder"),
        ),
      ],
    },
    {
      code: "esf_due",
      blocks: [
        {
          sheet: "purchases",
          keyCol: "id",
          code: "esf_due",
          due: Pu("esfDue"),
          text: nvQ("Получить подпись ЭСФ"),
          object: "Закупка",
          num: Pu("id"),
          client: clientOfPurchase,
          amount: Pu("amount"),
          conds: [Pu("esfDue") + '<>""', Pu("esfStatus") + '<>"Подписана"'],
        },
      ],
    },
    {
      code: "aftercare",
      blocks: [
        orderBlock(
          "aftercare_7",
          O("aftercare1"),
          nvQ("Сопровождение: 7 дней после сдачи, спросить, как работает сетап"),
          [O("aftercare1") + '<>""', O("aftercare1") + ">=TODAY()-2"],
          O("grand"),
        ),
        orderBlock(
          "aftercare_30",
          O("aftercare2"),
          nvQ("Сопровождение: 30 дней после сдачи, спросить об отзыве"),
          [O("aftercare2") + '<>""', O("aftercare2") + ">=TODAY()-2"],
          O("grand"),
        ),
      ],
    },
    {
      code: "order_warranty_end",
      blocks: [
        orderBlock(
          "order_warranty_end",
          O("warrantyUntil") + "-30",
          nvQ("Гарантия заказа истекает через 30 дней"),
          [O("warrantyUntil") + '<>""', O("warrantyUntil") + ">=TODAY()"],
          O("grand"),
        ),
      ],
    },
    {
      code: "shop_warranty_end",
      blocks: [
        {
          sheet: "purchases",
          keyCol: "id",
          code: "shop_warranty_end",
          due: Pu("warrantyUntil") + "-30",
          text: nvQ("Гарантия магазина истекает через 30 дней"),
          object: "Закупка",
          num: Pu("id"),
          client: clientOfPurchase,
          amount: Pu("amount"),
          conds: [Pu("warrantyUntil") + '<>""', Pu("warrantyUntil") + ">=TODAY()"],
        },
      ],
    },
    {
      code: "warranty_case",
      blocks: [
        {
          sheet: "warranty",
          keyCol: "num",
          code: "warranty_case",
          due:
            "IFS(" +
            W("status") +
            '="Открыт"; ' +
            W("replyBy") +
            "; " +
            W("status") +
            '="Диагностика"; ' +
            W("diagBy") +
            "; (" +
            W("status") +
            '="Выдан подменный")+(' +
            W("status") +
            '="У поставщика")>0; ' +
            W("fixBy") +
            '; TRUE; "")',
          text:
            "IFS(" +
            W("status") +
            '="Открыт"; "Гарантия: ответить клиенту"; ' +
            W("status") +
            '="Диагностика"; "Гарантия: закончить диагностику"; TRUE; "Гарантия: устранить неисправность")',
          object: "Гарантия",
          num: W("num"),
          client: W("client"),
          amount: W("cost"),
          conds: [
            W("num") + '<>""',
            or(
              "(" + W("status") + '="Открыт")',
              "(" + W("status") + '="Диагностика")',
              "(" + W("status") + '="Выдан подменный")',
              "(" + W("status") + '="У поставщика")',
            ),
          ],
        },
        {
          sheet: "warranty",
          keyCol: "num",
          code: "warranty_loaner",
          due: W("loanerBy"),
          text: nvQ("Гарантия: выдать подменный (3 суток)"),
          object: "Гарантия",
          num: W("num"),
          client: W("client"),
          amount: W("cost"),
          conds: [
            W("num") + '<>""',
            or("(" + W("status") + '="Открыт")', "(" + W("status") + '="Диагностика")'),
            W("loanerBy") + '<>""',
          ],
        },
      ],
    },
    {
      code: "podbor_credit",
      blocks: [
        orderBlock(
          "podbor_credit",
          O("podborUntil") + "-7",
          nvQ("Зачёт «Подбора» истекает через 7 дней: предложить заказ"),
          [O("code") + '="podbor_delivered"', O("podborUntil") + '<>""', O("podborUntil") + ">=TODAY()"],
          O("podborFee"),
        ),
      ],
    },
    {
      code: "cancel_due",
      blocks: [
        orderBlock(
          "cancel_due",
          O("cancelDue"),
          nvQ("Отмена: вернуть клиенту до этого срока"),
          [O("code") + '="cancelling"', O("cancelDue") + '<>""'],
          O("feeToRefund") + "+" + O("fundsToRefund"),
        ),
      ],
    },
    { code: "taxes", blocks: [{ raw: true, formula: nvTaxTasksFormula() }] },
    {
      code: "threshold_alert",
      blocks: [
        {
          raw: true,
          formula:
            'ARRAYFORMULA(IFERROR(FILTER({TODAY()\\"Порог года: пройден рубеж "&TEXT(MAX(FILTER(NV_ALERTS_BP;TH_SHARE*10000>=NV_ALERTS_BP))/100;"0")&" %"\\"Порог"\\""\\""\\TH_VOLUME\\"threshold_alert"\\"#gid=' +
            nvSheetGid("threshold") +
            '"}; {TH_SHARE*10000>=NV_ALERT_1}); ' +
            "{" +
            new Array(8).fill('""').join("\\") +
            "}))",
        },
      ],
    },
    {
      code: "webhook_silent",
      blocks: [
        {
          raw: true,
          formula:
            'ARRAYFORMULA(IFERROR(FILTER({TODAY()\\"Вебхук молчит больше 48 ч: проверить платформу"\\"Интеграция"\\""\\""\\""\\"webhook_silent"\\"#gid=' +
            nvSheetGid("webhook") +
            '"}; {AND(NV_WEBHOOK_ON; NOW()-MAX(' +
            nvR("webhook", "received") +
            ")>2)}); " +
            "{" +
            new Array(8).fill('""').join("\\") +
            "}))",
        },
      ],
    },
  ];
}

/** The taxes block: turnover tax, social tax (by the 15th), reconciliation of the account (last working day). */
function nvTaxTasksFormula() {
  const day15 = "DATE(YEAR(TODAY());MONTH(TODAY());15)";
  const prevStart = "(EOMONTH(TODAY();-2)+1)";
  const lastWorking = 'WORKDAY.INTL(EOMONTH(TODAY();0)+1;-1;"0000001";NV_HOLIDAYS)';
  const url = '"#gid=' + nvSheetGid("threshold") + '"';
  const taxPrev = nvKpiRowRef("taxdue");
  const rows = [
    [day15, '"Уплатить налог с оборота 1 % за прошлый месяц"', '"Налоги"', '""', '""', taxPrev, '"tax_turnover"', url],
    [day15, '"Уплатить социальный налог"', '"Налоги"', '""', '""', "NV_SOCIAL_TAX", '"tax_social"', url],
    [
      lastWorking,
      '"Сверить счёт «средства комитентов» с выпиской"',
      '"Налоги"',
      '""',
      '""',
      '""',
      '"reconcile_account"',
      url,
    ],
  ];
  const literal = "{" + rows.map((r) => r.join("\\")).join(";") + "}";
  const cond =
    "{AND(TODAY()<=" +
    day15 +
    "+3; NOT(IFERROR(INDEX(TH_PAID; MATCH(" +
    prevStart +
    "; TH_MONTHS; 0)); FALSE))); TODAY()<=" +
    day15 +
    "+3; TRUE}";
  return "ARRAYFORMULA(IFERROR(FILTER(" + literal + "; " + cond + "); {" + new Array(8).fill('""').join("\\") + "}))";
}

/** The cell of a KPI value in the data sheet. */
function nvKpiRowRef(key) {
  return nvDataRef("B", nvKpiRow(key));
}

/** The whole formula of "_Задачи": all blocks one under another. */
function nvTasksFormula() {
  const parts = [];
  nvTaskRules().forEach((rule) => {
    rule.blocks.forEach((b) => {
      parts.push(b.raw ? b.formula : nvTaskBlock(b));
    });
  });
  return "=VSTACK(" + parts.join("; ") + ")";
}

/** The formula of the list on "Сегодня". */
function nvTodayFormula() {
  const tasks = nvQuoteSheet(NV_SN.tasks);
  return (
    "=IFERROR(LET(t; SORT(FILTER(" +
    tasks +
    "!$A$2:$H; " +
    tasks +
    '!$A$2:$A<>""; ' +
    tasks +
    "!$A$2:$A<=TODAY()+7); 1; TRUE); HSTACK(" +
    'MAP(INDEX(t;;1); LAMBDA(d; TEXT(d; IF(MOD(d;1)=0; "dd.mm.yyyy"; "dd.mm.yyyy hh:mm")))); ' +
    'MAP(INDEX(t;;1); LAMBDA(d; IFS(IF(MOD(d;1)=0; d<TODAY(); d<NOW()); "Просрочено"; INT(d)=TODAY(); "Сегодня"; INT(d)=TODAY()+1; "Завтра"; TRUE; "На неделе"))); ' +
    'CHOOSECOLS(t; 2; 3; 4; 5; 6; 7; 8))); "")'
  );
}

const NV_TODAY_HEADS = [
  "Срок",
  "Состояние срока",
  "Что сделать",
  "Объект",
  "Номер",
  "Клиент",
  "Сумма, сум",
  "Правило",
  "Ссылка",
  "Перейти",
];
const NV_TODAY_MANUAL_HEADS = ["Дата", "Задача", "Номер", "Готово", "Заметка"];

function nvBuildTasks() {
  const sh = nvSheet("tasks");
  if (sh.getMaxColumns() < 10) sh.insertColumnsAfter(sh.getMaxColumns(), 10 - sh.getMaxColumns());
  sh.getRange(1, 1, 1, 8).setValues([
    ["Срок", "Что сделать", "Объект", "Номер", "Клиент", "Сумма", "Правило", "Ссылка"],
  ]);
  sh.getRange("A2").setFormula(nvApiFormula(nvTasksFormula()));
  sh.getRange("A:A").setNumberFormat(NV_FMT.dateTime);
  sh.setTabColor("#A9A59C");
  sh.hideSheet();
}

function nvBuildToday() {
  const sh = nvSheet("today");
  const L = NV_LAYOUT;
  if (sh.getMaxColumns() < 18) sh.insertColumnsAfter(sh.getMaxColumns(), 18 - sh.getMaxColumns());
  if (sh.getMaxRows() < L.headerRow + 300) sh.insertRowsAfter(sh.getMaxRows(), L.headerRow + 300 - sh.getMaxRows());
  sh.getRange(L.headerRow, 2, 1, NV_TODAY_HEADS.length).setValues([NV_TODAY_HEADS]);
  sh.getRange(L.headerRow, NV_TODAY.manualCol, 1, NV_TODAY_MANUAL_HEADS.length).setValues([NV_TODAY_MANUAL_HEADS]);
  sh.getRange(4, 2).setValue("Ближайшие семь дней и просрочки");
  sh.getRange(4, NV_TODAY.manualCol).setValue("Мои задачи");
  sh.getRange(NV_TODAY.first, 2).setFormula(nvApiFormula(nvTodayFormula()));
  sh.getRange(NV_TODAY.first, 11).setFormula(
    nvApiFormula('=ARRAYFORMULA(IF($J$6:$J=""; ""; HYPERLINK($J$6:$J; "Открыть")))'),
  );
  sh.getRange(3, 2).setFormula(
    nvApiFormula(
      '=COUNTIF($C$6:$C;"Просрочено")&" просрочено · "&COUNTIF($C$6:$C;"Сегодня")&" на сегодня · "&COUNTIF($C$6:$C;"Завтра")&" на завтра · "&COUNTIF($C$6:$C;"На неделе")&" на неделе   ·   правила сроков домена, источники — все листы"',
    ),
  );
  const rows = sh.getMaxRows() - NV_TODAY.first + 1;
  sh.getRange(NV_TODAY.first, NV_TODAY.manualCol, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build(),
  );
  sh.getRange(L.headerRow, 3).setNote("Просрочено: срок прошёл. Сегодня, Завтра, На неделе: ближайшие дни.");
  sh.getRange(L.headerRow, 9).setNote("Код правила из «_Задачи».");
}

function nvStyleToday() {
  const sh = nvSheet("today");
  const T = nvThemeFor("today");
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
  [140, 120, 360, 90, 128, 150, 132, 130, 16, 90, 16, 104, 260, 128, 70, 240].forEach((w, i) => {
    sh.setColumnWidth(2 + i, w);
  });
  sh.setColumnWidths(18, Math.max(1, maxCols - 17), L.gutterWidth);
  sh.hideColumns(10);
  sh.setRowHeight(1, L.rowHeights.top);
  sh.setRowHeight(2, L.rowHeights.title);
  sh.setRowHeight(3, L.rowHeights.caption);
  sh.setRowHeight(4, 24);
  sh.setRowHeight(L.headerRow, L.rowHeights.header);
  sh.setRowHeights(L.firstRow, maxRows - L.firstRow + 1, 28);
  sh.getRange(2, L.firstCol).setRichTextValue(nvTitleRich("Сегодня", T, 18));
  sh.getRange(3, L.firstCol).setFontSize(9).setFontColor(T.text2).setWrap(false);
  [
    [2, 10],
    [NV_TODAY.manualCol, 5],
  ].forEach((b) => {
    sh.getRange(4, b[0])
      .setFontWeight("bold")
      .setFontColor(T.accentText)
      .setFontSize(10)
      .setVerticalAlignment("bottom");
    const head = sh.getRange(L.headerRow, b[0], 1, b[1]);
    head
      .setBackground(T.head)
      .setFontWeight("bold")
      .setFontSize(9)
      .setFontColor(T.headText)
      .setWrap(true)
      .setVerticalAlignment("middle");
    nvBorder(head, "bottom", T.headRule, "SOLID_MEDIUM");
  });
  sh.getBandings().forEach((b) => {
    b.remove();
  });
  const rows = maxRows - L.firstRow + 1;
  sh.getRange(L.firstRow, 2, rows, 10)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor(T.surface)
    .setSecondRowColor(T.band);
  sh.getRange(L.firstRow, NV_TODAY.manualCol, rows, 5)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor(T.surface)
    .setSecondRowColor(T.band);
  nvRowLines(sh.getRange(L.firstRow, 2, rows, 10), T.rowLine);
  nvRowLines(sh.getRange(L.firstRow, NV_TODAY.manualCol, rows, 5), T.rowLine);
  sh.getRange(L.firstRow, 2, rows, 2).setFontFamily(NV_FONT_MONO).setFontSize(10);
  sh.getRange(L.firstRow, 3, rows, 1).setFontFamily(NV_FONT_TEXT).setFontWeight("bold");
  sh.getRange(L.firstRow, 6, rows, 1).setFontFamily(NV_FONT_MONO);
  sh.getRange(L.firstRow, 8, rows, 1)
    .setFontFamily(NV_FONT_MONO)
    .setNumberFormat(NV_FMT.sum)
    .setHorizontalAlignment("right");
  sh.getRange(L.firstRow, 9, rows, 1).setFontFamily(NV_FONT_MONO).setFontSize(9).setFontColor(T.text2);
  sh.getRange(L.firstRow, 11, rows, 1).setFontColor(T.accentText).setFontWeight("bold");
  sh.getRange(L.firstRow, NV_TODAY.manualCol, rows, 1).setNumberFormat(NV_FMT.date).setFontFamily(NV_FONT_MONO);
  sh.getRange(L.firstRow, NV_TODAY.manualCol + 2, rows, 1).setFontFamily(NV_FONT_MONO);
  sh.getRange(L.firstRow, NV_TODAY.manualCol + 3, rows, 1).setHorizontalAlignment("center");
  const state = sh.getRange(L.firstRow, 3, rows, 1);
  const manual = sh.getRange(L.firstRow, NV_TODAY.manualCol, rows, 5);
  sh.setConditionalFormatRules([
    nvRule(state, '=$C6="Просрочено"', { bg: T.overdueFill, color: T.overdueText, bold: true }),
    nvRule(state, '=$C6="Сегодня"', { color: T.accentText, bold: true }),
    nvRule(state, '=$C6="На неделе"', { color: T.text2 }),
    nvRule(sh.getRange(L.firstRow, 2, rows, 1), '=$C6="Просрочено"', { color: T.accentText, bold: true }),
    nvRule(manual, "=$P6=TRUE", { color: T.muted, strike: true }),
  ]);
  sh.setFrozenRows(L.headerRow);
  sh.setFrozenColumns(2);
  sh.setHiddenGridlines(true);
  sh.setTabColor(NV_BRAND.orange);
}

/** A row of the owner's own tasks gets its checkbox when something is typed into it (empty rows show no boxes). */
function nvOnTodayEdit(range) {
  const sh = range.getSheet();
  const c0 = Math.max(range.getColumn(), NV_TODAY.manualCol);
  const c1 = Math.min(range.getLastColumn(), NV_TODAY.manualCol + 4);
  if (c0 > c1 || range.getLastRow() < NV_TODAY.first) return;
  const first = Math.max(range.getRow(), NV_TODAY.first);
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sh.getRange(first, NV_TODAY.manualCol + 3, range.getLastRow() - first + 1, 1).setDataValidation(rule);
}
