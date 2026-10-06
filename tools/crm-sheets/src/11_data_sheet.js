/**
 * "_Данные": the hidden sheet that prepares the figures and the series for the tiles and charts of "Панель".
 * Everything is a formula over the table sheets, so the dashboard is always current and needs no script to refresh.
 * Row numbers are fixed (NV_ND), the panel and the charts refer to them.
 */

const NV_ND = {
  params: 2,
  kpiHead: 13,
  kpi: 14,
  weekHead: 28,
  weeks: 29,
  monthHead: 43,
  months: 44,
  dealHead: 58,
  deals: 59,
  funnelHead: 73,
  funnel: 74,
  chanHead: 81,
  chan: 82,
  chanN: 32,
  topHead: 116,
  top: 117,
  stageHead: 127,
  stages: 128,
  resHead: 136,
  res: 137,
  cycleHead: 151,
  cycle: 152,
  compHead: 166,
  comp: 167,
};

/** Keys of the twelve tiles in the order of the panel. */
const NV_KPI_KEYS = [
  "fee",
  "wip",
  "delivered",
  "leads",
  "threshold",
  "funds",
  "wres",
  "taxdue",
  "conv",
  "avgfee",
  "reply",
  "overdue",
];

/** Row of a KPI in the data sheet. */
function nvKpiRow(key) {
  const i = NV_KPI_KEYS.indexOf(key);
  if (i < 0) throw new Error("Unknown KPI " + key);
  return NV_ND.kpi + i;
}

/** Reference to a cell of the data sheet: '_Данные'!$B$14. */
function nvDataRef(col, row) {
  return nvQuoteSheet(NV_SN.data) + "!$" + col + "$" + row;
}

function nvDataRange(colFrom, rowFrom, colTo, rowTo) {
  return nvQuoteSheet(NV_SN.data) + "!$" + colFrom + "$" + rowFrom + ":$" + colTo + "$" + rowTo;
}

/** Shorthands for the column ranges of the sheets (with the sheet name). */
function nvR(sheetKey, colKey) {
  return nvColRange(sheetKey, colKey, true);
}

/** The demo filter as a criterion for SUMIFS and COUNTIFS. */
const NV_DEMO_CRIT = "ND_DEMO_CRIT";
/** The demo filter as a condition array for FILTER over a demo column. */
function nvDemoOk(demoRange) {
  return "((" + demoRange + "<>TRUE)+ND_DEMO_ON)>0";
}

/** Confirmed fee received in [from, toExclusive) net of the fee refunds. */
function nvFeeIn(from, toX) {
  const P = (k) => nvR("payments", k);
  const part = (group) =>
    "SUMIFS(" +
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
    from +
    "; " +
    P("date") +
    '; "<"&' +
    toX +
    "; " +
    P("demo") +
    "; " +
    NV_DEMO_CRIT +
    ")";
  return "(" + part("Плата") + "-" + part("Возврат платы") + ")";
}

/** Comparison text with the previous period: "+12 % к прошлому периоду". */
function nvCompareText(b, c) {
  return (
    "IF(" + c + '="";"";IF(' + c + '=0;"прошлый: 0";TEXT((' + b + "-" + c + ")/" + c + ';"+0%;-0%;0%")&" к прошлому"))'
  );
}

/** The twelve KPIs: value, previous value, the text under the figure, the "worse" flag. */
function nvKpiDefs() {
  const O = (k) => nvR("orders", k);
  const L = (k) => nvR("leads", k);
  const W = (k) => nvR("warranty", k);
  const C = NV_DEMO_CRIT;
  const periodCount = (from, toX, extra) =>
    "COUNTIFS(" +
    L("created") +
    '; ">="&' +
    from +
    "; " +
    L("created") +
    '; "<"&' +
    toX +
    "; " +
    L("demo") +
    "; " +
    C +
    (extra ? "; " + extra : "") +
    ")";
  const ordersIn = (key, from, toX) =>
    "COUNTIFS(" + O(key) + '; ">="&' + from + "; " + O(key) + '; "<"&' + toX + "; " + O("demo") + "; " + C + ")";
  const convOf = (from, toX) =>
    "IFERROR(" +
    periodCount(from, toX, L("status") + '; "В заказе"') +
    "/(" +
    periodCount(from, toX) +
    "-" +
    periodCount(from, toX, L("status") + '; "Спам"') +
    "), 0)";
  const prev = (f) => 'IF(ND_PREV_FROM="";"";' + f + ")";
  const row = (key) => NV_ND.kpi + NV_KPI_KEYS.indexOf(key);
  const b = (key) => "B" + row(key);
  const c = (key) => "C" + row(key);
  const mln = (x) => "TEXT(" + x + '/1000000;"0.0")';
  const defs = {};
  defs.fee = {
    v: nvFeeIn("ND_FROM", "ND_TO_X"),
    p: prev(nvFeeIn("ND_PREV_FROM", "ND_PREV_TO_X")),
    sub:
      '"платежей: "&COUNTIFS(' +
      nvR("payments", "group") +
      '; "Плата"; ' +
      nvR("payments", "status") +
      '; "Подтверждён"; ' +
      nvR("payments", "date") +
      '; ">="&ND_FROM; ' +
      nvR("payments", "date") +
      '; "<"&ND_TO_X; ' +
      nvR("payments", "demo") +
      "; " +
      C +
      ")",
    cmp: true,
  };
  defs.wip = {
    v: "COUNTIFS(" + O("group") + '; "В работе"; ' + O("demo") + "; " + C + ")",
    p: '""',
    sub:
      mln("SUMIFS(" + O("grand") + "; " + O("group") + '; "В работе"; ' + O("demo") + "; " + C + ")") +
      '&" млн сум · ждут клиента: "&COUNTIFS(' +
      O("group") +
      '; "Ждёт клиента"; ' +
      O("demo") +
      "; " +
      C +
      ")",
  };
  defs.delivered = {
    v: ordersIn("dHandover", "ND_FROM", "ND_TO_X"),
    p: prev(ordersIn("dHandover", "ND_PREV_FROM", "ND_PREV_TO_X")),
    sub:
      '"цикл "&IFERROR(TEXT(AVERAGE(FILTER(' +
      O("dHandover") +
      "-" +
      O("dAccepted") +
      "; " +
      O("dHandover") +
      ">=ND_FROM; " +
      O("dHandover") +
      "<ND_TO_X; " +
      O("dAccepted") +
      '<>""; ' +
      nvDemoOk(O("demo")) +
      ')); "0.0")&" дн."; "—")',
    cmp: true,
  };
  defs.leads = {
    v: periodCount("ND_FROM", "ND_TO_X"),
    p: prev(periodCount("ND_PREV_FROM", "ND_PREV_TO_X")),
    sub:
      '"спам "&' +
      periodCount("ND_FROM", "ND_TO_X", L("status") + '; "Спам"') +
      '&" · отказ "&' +
      periodCount("ND_FROM", "ND_TO_X", L("status") + '; "Отказ"'),
    cmp: true,
  };
  defs.threshold = {
    v: "TH_SHARE",
    p: '""',
    sub: mln("TH_VOLUME") + '&" из "&' + mln("TH_LIMIT") + '&" млн · с принятыми "&TEXT(TH_PROJ;"0%")',
    worse: "TH_SHARE*10000>=NV_ALERT_2",
  };
  defs.funds = {
    v:
      "SUMIFS(" +
      O("remainder") +
      "; " +
      O("code") +
      '; "<>closed"; ' +
      O("code") +
      '; "<>cancelled"; ' +
      O("demo") +
      "; " +
      C +
      ")",
    p: '""',
    sub:
      '"заказов: "&COUNTIFS(' +
      O("remainder") +
      '; ">0"; ' +
      O("code") +
      '; "<>closed"; ' +
      O("code") +
      '; "<>cancelled"; ' +
      O("demo") +
      "; " +
      C +
      ')&" · сверка с выпиской"',
  };
  defs.wres = {
    v: "NV_RES_BAL_W",
    p: '""',
    sub: '"взнос "&NV_RES_RATE&" · закрыто "&NV_RES_CLOSED&" из "&NV_WARRANTY_MATURE_ORDERS',
  };
  const prevStart = "(EOMONTH(TODAY();-2)+1)";
  const thisStart = "(EOMONTH(TODAY();-1)+1)";
  defs.taxdue = {
    v: "QUOTIENT(MAX(0; " + nvFeeIn(prevStart, thisStart) + ")*NV_TURNOVER_TAX_BP+9999; 10000)",
    p: '""',
    sub:
      '"до "&TEXT(DATE(YEAR(TODAY());MONTH(TODAY());15);"dd.mm.yyyy")&" · резерв налога "&' +
      mln("NV_RES_BAL_T") +
      '&" млн"',
    worse:
      "AND(TODAY()>DATE(YEAR(TODAY());MONTH(TODAY());15); NOT(IFERROR(INDEX(TH_PAID; MATCH(" +
      prevStart +
      "; TH_MONTHS; 0)); FALSE)))",
  };
  defs.conv = {
    v: convOf("ND_FROM", "ND_TO_X"),
    p: prev(convOf("ND_PREV_FROM", "ND_PREV_TO_X")),
    sub:
      '"из "&(' +
      periodCount("ND_FROM", "ND_TO_X") +
      "-" +
      periodCount("ND_FROM", "ND_TO_X", L("status") + '; "Спам"') +
      ')&" заявок"',
    cmp: true,
  };
  const delivered = (k, from, toX) =>
    "SUMIFS(" +
    O(k) +
    "; " +
    O("dHandover") +
    '; ">="&' +
    from +
    "; " +
    O("dHandover") +
    '; "<"&' +
    toX +
    "; " +
    O("demo") +
    "; " +
    C +
    ")";
  const avgFee = (from, toX) =>
    "IFERROR(AVERAGEIFS(" +
    O("feeTotal") +
    "; " +
    O("dHandover") +
    '; ">="&' +
    from +
    "; " +
    O("dHandover") +
    '; "<"&' +
    toX +
    "; " +
    O("demo") +
    "; " +
    C +
    "), 0)";
  defs.avgfee = {
    v: avgFee("ND_FROM", "ND_TO_X"),
    p: prev(avgFee("ND_PREV_FROM", "ND_PREV_TO_X")),
    sub:
      '"ставка в среднем "&TEXT(IFERROR(' +
      delivered("feeTotal", "ND_FROM", "ND_TO_X") +
      "/(" +
      delivered("basePc", "ND_FROM", "ND_TO_X") +
      "+" +
      delivered("baseMount", "ND_FROM", "ND_TO_X") +
      '); 0); "0.0%")',
    cmp: true,
  };
  const replyIn = (from, toX) =>
    "IFERROR(MEDIAN(FILTER(" +
    L("replyH") +
    "; " +
    L("created") +
    ">=" +
    from +
    "; " +
    L("created") +
    "<" +
    toX +
    "; " +
    L("replyH") +
    '<>""; ' +
    nvDemoOk(L("demo")) +
    ')), "")';
  defs.reply = {
    v: replyIn("ND_FROM", "ND_TO_X"),
    p: prev(replyIn("ND_PREV_FROM", "ND_PREV_TO_X")),
    sub:
      '"цель "&NV_FIRST_RESPONSE_HOURS&" ч: в срок "&TEXT(IFERROR(COUNTIFS(' +
      L("replyH") +
      '; "<="&NV_FIRST_RESPONSE_HOURS; ' +
      L("created") +
      '; ">="&ND_FROM; ' +
      L("created") +
      '; "<"&ND_TO_X; ' +
      L("demo") +
      "; " +
      C +
      ")/COUNTIFS(" +
      L("replyH") +
      '; ">=0"; ' +
      L("created") +
      '; ">="&ND_FROM; ' +
      L("created") +
      '; "<"&ND_TO_X; ' +
      L("demo") +
      "; " +
      C +
      '); 0); "0%")',
    cmp: true,
    lowerIsBetter: true,
  };
  defs.overdue = {
    v: "COUNTIF(" + nvQuoteSheet(NV_SN.today) + '!$C$6:$C; "Просрочено")',
    p: '""',
    sub:
      '"гарантия: открыто "&COUNTIFS(' +
      W("num") +
      '; "<>"; ' +
      W("status") +
      '; "<>Закрыт"; ' +
      W("demo") +
      "; " +
      C +
      ')&", просрочено "&COUNTIFS(' +
      W("overdue") +
      '; "Просрочено"; ' +
      W("demo") +
      "; " +
      C +
      ")",
    worse: "B" + row("overdue") + ">0",
  };
  // Texts and flags built from the pieces
  NV_KPI_KEYS.forEach((k) => {
    const d = defs[k];
    d.text = d.cmp ? d.sub + '&" · "&' + nvCompareText(b(k), c(k)) : d.sub;
    if (d.cmp) {
      d.worse = "IF(OR(" + c(k) + '="";' + b(k) + '="");FALSE;' + b(k) + (d.lowerIsBetter ? ">" : "<") + c(k) + ")";
    } else if (!d.worse) d.worse = "FALSE";
  });
  return defs;
}

/** Formulas of the whole data sheet as [{row, col, f}] (ru_RU notation; nvApiFormula is applied when writing). */
function nvDataCells() {
  const cells = [];
  const put = (col, row, f) => cells.push({ col: col, row: row, f: f });
  const P = (k) => nvR("payments", k);
  const O = (k) => nvR("orders", k);
  const L = (k) => nvR("leads", k);
  const Rs = (k) => nvR("reserves", k);
  const C = NV_DEMO_CRIT;
  const p = NV_ND.params;
  const period = "P_PERIOD";
  put("A", 1, "Служебный лист: пересчитывается формулами, вручную не править");
  const params = [
    [
      "ПериодС",
      "=SWITCH(" +
        period +
        '; "Этот месяц"; EOMONTH(TODAY();-1)+1; "Прошлый месяц"; EOMONTH(TODAY();-2)+1; "Квартал"; DATE(YEAR(TODAY()); 3*INT((MONTH(TODAY())-1)/3)+1; 1); "С начала года"; DATE(YEAR(TODAY());1;1); "12 месяцев"; EDATE(TODAY();-12)+1; DATE(2026;1;1))',
    ],
    [
      "ПериодПо",
      "=SWITCH(" +
        period +
        '; "Этот месяц"; EOMONTH(TODAY();0); "Прошлый месяц"; EOMONTH(TODAY();-1); "Квартал"; EOMONTH(DATE(YEAR(TODAY()); 3*INT((MONTH(TODAY())-1)/3)+3; 1); 0); "С начала года"; TODAY(); "12 месяцев"; TODAY(); TODAY())',
    ],
    [
      "Прошлый период С",
      "=SWITCH(" +
        period +
        '; "Этот месяц"; EDATE(ND_FROM;-1); "Прошлый месяц"; EDATE(ND_FROM;-1); "Квартал"; EDATE(ND_FROM;-3); "С начала года"; EDATE(ND_FROM;-12); "12 месяцев"; EDATE(ND_FROM;-12); "")',
    ],
    [
      "Прошлый период По",
      "=SWITCH(" +
        period +
        '; "Этот месяц"; EDATE(MIN(ND_TO;TODAY());-1); "Прошлый месяц"; EOMONTH(ND_TO;-1); "Квартал"; EDATE(MIN(ND_TO;TODAY());-3); "С начала года"; EDATE(TODAY();-12); "12 месяцев"; EDATE(TODAY();-12); "")',
    ],
    ["Год", "=P_YEAR"],
    ["Показывать демо", "=P_DEMO=TRUE"],
    ["Критерий демо", '=IF(ND_DEMO_ON; "<>zzz"; "<>TRUE")'],
    ["ПериодПо + 1 день", "=ND_TO+1"],
    ["Прошлый По + 1 день", '=IF(ND_PREV_TO="";"";ND_PREV_TO+1)'],
    ["Обновлено", '="Обновлено "&TEXT(NOW();"dd.mm.yyyy hh:mm")'],
  ];
  params.forEach((pr, i) => {
    put("A", p + i, pr[0]);
    put("B", p + i, pr[1]);
  });

  // KPI table
  ["Ключ", "Значение", "Прошлый период", "Подпись", "Хуже"].forEach((t, i) => {
    put(String.fromCharCode(65 + i), NV_ND.kpiHead, t);
  });
  const defs = nvKpiDefs();
  NV_KPI_KEYS.forEach((k, i) => {
    const r = NV_ND.kpi + i;
    put("A", r, k);
    put("B", r, "=" + defs[k].v);
    put("C", r, "=" + defs[k].p);
    put("D", r, "=" + defs[k].text);
    put("E", r, "=" + defs[k].worse);
  });

  // Weeks (12): the trend inside the tiles
  ["Неделя", "Плата", "Заказов создано", "Сдано", "Заявок", "Конверсия", "Средняя плата", "Ответ, ч"].forEach(
    (t, i) => {
      put(String.fromCharCode(65 + i), NV_ND.weekHead, t);
    },
  );
  for (let i = 0; i < 12; i++) {
    const r = NV_ND.weeks + i;
    put("A", r, i === 0 ? "=TODAY()-WEEKDAY(TODAY();3)-77" : "=A" + (r - 1) + "+7");
    put("B", r, "=" + nvFeeIn("A" + r, "(A" + r + "+7)"));
    const inWeek = (range) => range + '; ">="&A' + r + "; " + range + '; "<"&A' + r + "+7";
    put("C", r, "=COUNTIFS(" + inWeek(O("created")) + "; " + O("demo") + "; " + C + ")");
    put("D", r, "=COUNTIFS(" + inWeek(O("dHandover")) + "; " + O("demo") + "; " + C + ")");
    put("E", r, "=COUNTIFS(" + inWeek(L("created")) + "; " + L("demo") + "; " + C + ")");
    put(
      "F",
      r,
      "=IFERROR(COUNTIFS(" +
        inWeek(L("created")) +
        "; " +
        L("status") +
        '; "В заказе"; ' +
        L("demo") +
        "; " +
        C +
        ")/COUNTIFS(" +
        inWeek(L("created")) +
        "; " +
        L("demo") +
        "; " +
        C +
        "), 0)",
    );
    put(
      "G",
      r,
      "=IFERROR(AVERAGEIFS(" + O("feeTotal") + "; " + inWeek(O("dHandover")) + "; " + O("demo") + "; " + C + "), 0)",
    );
    put(
      "H",
      r,
      "=IFERROR(MEDIAN(FILTER(" +
        L("replyH") +
        "; " +
        L("created") +
        ">=A" +
        r +
        "; " +
        L("created") +
        "<A" +
        r +
        "+7; " +
        L("replyH") +
        '<>""; ' +
        nvDemoOk(L("demo")) +
        ")), 0)",
    );
  }

  // Months (12): payment of the month and since the start of the year, in millions
  ["Месяц", "Плата за месяц, млн", "С начала года, млн", "Начало месяца"].forEach((t, i) => {
    put(String.fromCharCode(65 + i), NV_ND.monthHead, t);
  });
  for (let i = 0; i < 12; i++) {
    const r = NV_ND.months + i;
    put("D", r, "=EDATE(DATE(YEAR(TODAY());MONTH(TODAY());1);" + (i - 11) + ")");
    put("A", r, "=TEXT(D" + r + ';"mmm yy")');
    put("B", r, "=" + nvFeeIn("D" + r, "EDATE(D" + r + ";1)") + "/1000000");
    put("C", r, "=" + nvFeeIn("DATE(YEAR(D" + r + ");1;1)", "EDATE(D" + r + ";1)") + "/1000000");
  }

  // Deals of the selected year against the threshold, in millions
  [
    "Месяц",
    "Сделки нарастающим, млн",
    "Прогноз с принятыми сметами, млн",
    "План 2026, млн",
    "Лимит года, млн",
    "Начало месяца",
  ].forEach((t, i) => {
    put(String.fromCharCode(65 + i), NV_ND.dealHead, t);
  });
  for (let i = 0; i < 12; i++) {
    const r = NV_ND.deals + i;
    put("F", r, "=DATE(ND_YEAR;" + (i + 1) + ";1)");
    put("A", r, "=TEXT(F" + r + ';"mmm")');
    put("B", r, "=IF(F" + r + "<=TODAY(); INDEX(TH_CUM; " + (i + 1) + ")/1000000; NA())");
    put(
      "C",
      r,
      "=IF(AND(F" +
        r +
        ">=DATE(YEAR(TODAY());MONTH(TODAY());1); YEAR(F" +
        r +
        ")=YEAR(TODAY())); (TH_VOLUME+TH_COMMITTED)/1000000; NA())",
    );
    put("D", r, "=IF(ND_YEAR=2026; NV_PLAN_CAP_2026/1000000; NA())");
    put("E", r, "=TH_LIMIT/1000000");
  }

  // Funnel
  ["Этап", "Этапы", "Сдан", "Количество", "Доля"].forEach((t, i) => {
    put(String.fromCharCode(65 + i), NV_ND.funnelHead, t);
  });
  const fr = NV_ND.funnel;
  const leadIn = (extra) =>
    "COUNTIFS(" +
    L("created") +
    '; ">="&ND_FROM; ' +
    L("created") +
    '; "<"&ND_TO_X; ' +
    L("demo") +
    "; " +
    C +
    (extra ? "; " + extra : "") +
    ")";
  const stagesF = [
    ["Заявки", leadIn(L("status") + '; "<>Спам"')],
    ["В работе", "(" + leadIn(L("status") + '; "В работе"') + "+" + leadIn(L("status") + '; "В заказе"') + ")"],
    [
      "Смета",
      "COUNTIFS(" +
        O("dEstimate") +
        '; ">="&ND_FROM; ' +
        O("dEstimate") +
        '; "<"&ND_TO_X; ' +
        O("demo") +
        "; " +
        C +
        ")",
    ],
    [
      "Принят",
      "COUNTIFS(" +
        O("dAccepted") +
        '; ">="&ND_FROM; ' +
        O("dAccepted") +
        '; "<"&ND_TO_X; ' +
        O("demo") +
        "; " +
        C +
        ")",
    ],
    [
      "Сдан",
      "COUNTIFS(" +
        O("dHandover") +
        '; ">="&ND_FROM; ' +
        O("dHandover") +
        '; "<"&ND_TO_X; ' +
        O("demo") +
        "; " +
        C +
        ")",
    ],
  ];
  const stageTitles = ["Заявки", "В работе", "Смета отправлена", "Принят", "Сдан"];
  stagesF.forEach((s, i) => {
    const r = fr + i;
    put("D", r, "=" + s[1]);
    put("E", r, "=IF($D$" + fr + "=0; 0; D" + r + "/$D$" + fr + ")");
    const label = '="' + stageTitles[i] + ' · "&D' + r + '&" · "&TEXT(E' + r + ';"0%")';
    put("A", r, label);
    put("B", r, i < 4 ? "=D" + r : "=NA()");
    put("C", r, i < 4 ? "=NA()" : "=D" + r);
  });

  // Channels: all (unsorted) and the top eight
  ["Канал", "Заявок", "Заказов"].forEach((t, i) => {
    put(String.fromCharCode(65 + i), NV_ND.chanHead, t);
  });
  for (let i = 0; i < NV_ND.chanN; i++) {
    const r = NV_ND.chan + i;
    put("A", r, "=IFERROR(INDEX(NVD_CHANNEL;" + (i + 1) + ')&"";"")');
    put(
      "B",
      r,
      "=IF(A" +
        r +
        '="";0;COUNTIFS(' +
        L("channel") +
        "; A" +
        r +
        "; " +
        L("created") +
        '; ">="&ND_FROM; ' +
        L("created") +
        '; "<"&ND_TO_X; ' +
        L("status") +
        '; "<>Спам"; ' +
        L("demo") +
        "; " +
        C +
        "))",
    );
    put(
      "C",
      r,
      "=IF(A" +
        r +
        '="";0;COUNTIFS(' +
        L("channel") +
        "; A" +
        r +
        "; " +
        L("created") +
        '; ">="&ND_FROM; ' +
        L("created") +
        '; "<"&ND_TO_X; ' +
        L("status") +
        '; "В заказе"; ' +
        L("demo") +
        "; " +
        C +
        "))",
    );
  }
  ["Канал", "Заявки", "Заказы"].forEach((t, i) => {
    put(String.fromCharCode(65 + i), NV_ND.topHead, t);
  });
  const c0 = NV_ND.chan;
  const c1 = NV_ND.chan + NV_ND.chanN - 1;
  put(
    "A",
    NV_ND.top,
    "=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({A" +
      c0 +
      ":C" +
      c1 +
      "}; B" +
      c0 +
      ":B" +
      c1 +
      '>0); 2; FALSE); 8; 3); {"нет заявок"\\0\\0})',
  );

  // Orders by stage now: in time and with an overdue next step
  ["Этап", "В срок", "С просрочкой", "Всего"].forEach((t, i) => {
    put(String.fromCharCode(65 + i), NV_ND.stageHead, t);
  });
  NV_STAGES.forEach((st, i) => {
    const r = NV_ND.stages + i;
    const codes = "FILTER(NVD_STATUS_CODE; NVD_STATUS_STAGE=A" + r + ")";
    put("A", r, st);
    put("D", r, "=SUMPRODUCT(COUNTIFS(" + O("code") + "; " + codes + "; " + O("demo") + "; " + C + "))");
    put(
      "C",
      r,
      "=SUMPRODUCT(COUNTIFS(" +
        O("code") +
        "; " +
        codes +
        "; " +
        O("nextDate") +
        '; "<"&TODAY(); ' +
        O("demo") +
        "; " +
        C +
        "))",
    );
    put("B", r, "=D" + r + "-C" + r);
  });

  // Reserves by month, cumulative, in millions
  ["Месяц", "Гарантийный, млн", "Налоговый, млн", "Начало месяца"].forEach((t, i) => {
    put(String.fromCharCode(65 + i), NV_ND.resHead, t);
  });
  for (let i = 0; i < 12; i++) {
    const r = NV_ND.res + i;
    put("D", r, "=EDATE(DATE(YEAR(TODAY());MONTH(TODAY());1);" + (i - 11) + ")");
    put("A", r, "=TEXT(D" + r + ';"mmm yy")');
    const bal = (fund) =>
      "SUMIFS(" +
      Rs("amount") +
      "; " +
      Rs("fund") +
      '; "' +
      fund +
      '"; ' +
      Rs("date") +
      '; "<"&EDATE(D' +
      r +
      ";1); " +
      Rs("demo") +
      "; " +
      C +
      ")/1000000";
    put("B", r, "=" + bal("Гарантийный"));
    put("C", r, "=" + bal("Налоговый риск"));
  }

  // Cycle of the last twelve delivered orders
  ["Заказ", "Дней", "Сдан", "До цели", "Выше цели"].forEach((t, i) => {
    put(String.fromCharCode(65 + i), NV_ND.cycleHead, t);
  });
  put(
    "A",
    NV_ND.cycle,
    "=IFERROR(SORT(ARRAY_CONSTRAIN(SORT(FILTER(HSTACK(" +
      O("num") +
      "; ROUND(" +
      O("dHandover") +
      "-" +
      O("dAccepted") +
      "; 1); " +
      O("dHandover") +
      "); " +
      O("dHandover") +
      '<>""; ' +
      O("dAccepted") +
      '<>""; ' +
      nvDemoOk(O("demo")) +
      '); 3; FALSE); 12; 3); 3; TRUE); "")',
  );
  for (let i = 0; i < 12; i++) {
    const r = NV_ND.cycle + i;
    put("D", r, "=IF(A" + r + '="";0;IF(B' + r + "<=NV_CYCLE_TARGET_DAYS;B" + r + ";0))");
    put("E", r, "=IF(A" + r + '="";0;IF(B' + r + ">NV_CYCLE_TARGET_DAYS;B" + r + ";0))");
  }

  // Composition of the orders of the period
  put("A", NV_ND.compHead, "");
  NV_KINDS.forEach((k, i) => {
    put(String.fromCharCode(66 + i), NV_ND.compHead, k.label);
    put(
      String.fromCharCode(66 + i),
      NV_ND.comp,
      "=COUNTIFS(" +
        O("kind") +
        '; "' +
        k.label +
        '"; ' +
        O("created") +
        '; ">="&ND_FROM; ' +
        O("created") +
        '; "<"&ND_TO_X; ' +
        O("demo") +
        "; " +
        C +
        ")",
    );
  });
  put("A", NV_ND.comp, "Заказы");
  return cells;
}

/** Named cells of the data sheet used by the other sheets. */
function nvDataNames() {
  const p = NV_ND.params;
  const names = [
    ["ND_FROM", "B", p],
    ["ND_TO", "B", p + 1],
    ["ND_PREV_FROM", "B", p + 2],
    ["ND_PREV_TO", "B", p + 3],
    ["ND_YEAR", "B", p + 4],
    ["ND_DEMO_ON", "B", p + 5],
    ["ND_DEMO_CRIT", "B", p + 6],
    ["ND_TO_X", "B", p + 7],
    ["ND_PREV_TO_X", "B", p + 8],
    ["ND_UPDATED", "B", p + 9],
  ];
  return names;
}

function nvBuildData() {
  const ss = nvSpreadsheet();
  const sh = nvSheet("data");
  const need = NV_ND.comp + 4;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  if (sh.getMaxColumns() < 8) sh.insertColumnsAfter(sh.getMaxColumns(), 8 - sh.getMaxColumns());
  nvDataNames().forEach((n) => {
    ss.setNamedRange(n[0], sh.getRange(n[1] + n[2]));
  });
  nvDataCells().forEach((c) => {
    const f = c.f;
    const range = sh.getRange(c.col + c.row);
    if (typeof f === "string" && f.charAt(0) === "=") range.setFormula(nvApiFormula(f));
    else range.setValue(f);
  });
  sh.getRange(NV_ND.kpi, 1, NV_KPI_KEYS.length, 1).setFontColor("#6B6862");
  sh.setTabColor("#A9A59C");
  sh.hideSheet();
}
