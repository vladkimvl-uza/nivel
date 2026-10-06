/**
 * Declarative structure of the table sheets: columns, types, widths, lists, protection, calculated columns.
 * One source for the setup, the styles, the validations, the formulas and the tests.
 *
 * Calculated columns are one MAP over whole columns in the header cell: ={"Title"; MAP(...; LAMBDA(...))}.
 * The scalar template of a column uses [key] for a column of the same sheet and {sheet.key} for a column of another
 * sheet (or of the same one, as a range). Separators are written as in the ru_RU interface (";" and "\"); the
 * function nvApiFormula turns them into what Apps Script's setFormula expects.
 */

/** Cell types: number format, font, alignment. */
const NV_TYPES = {
  id: { fmt: NV_FMT.text, mono: true, align: "left" },
  date: { fmt: NV_FMT.date, mono: true, align: "left" },
  dt: { fmt: NV_FMT.dateTime, mono: true, align: "left" },
  sum: { fmt: NV_FMT.sum, mono: true, align: "right" },
  int: { fmt: NV_FMT.int, mono: true, align: "right" },
  num1: { fmt: "0.0", mono: true, align: "right" },
  pct: { fmt: NV_FMT.pct, mono: true, align: "right" },
  pct2: { fmt: NV_FMT.pct2, mono: true, align: "right" },
  text: { fmt: "@", mono: false, align: "left" },
  long: { fmt: "@", mono: false, align: "left", wrap: true },
  list: { fmt: "@", mono: false, align: "left" },
  flag: { fmt: "General", mono: false, align: "center" },
  url: { fmt: "@", mono: false, align: "left" },
  mono: { fmt: "@", mono: true, align: "left" },
};

/** Column definition helper. */
function nvCol(key, title, type, width, opts) {
  return Object.assign({ key: key, title: title, type: type, width: width }, opts || {});
}

const NV_SCHEMA = {};

NV_SCHEMA.leads = {
  key: "leads",
  title: "Заявки",
  numbering: { prefix: "L", yearly: true, createdKey: "created", demoPrefix: "D" },
  keyCol: "num",
  freezeCols: 2,
  caption:
    '=COUNTA([[num]])&" заявок · новых "&COUNTIF([[status]];"Новая")&" · в работе "&COUNTIF([[status]];"В работе")',
  captionRight: "источник: вручную и события lead.created",
  cols: [
    nvCol("num", "Номер", "id", 128, { prot: "script" }),
    nvCol("created", "Создана", "dt", 128, { prot: "script" }),
    nvCol("channel", "Канал", "list", 150, { list: "NVD_CHANNEL", plat: true }),
    nvCol("source", "Код источника", "text", 130, { plat: true }),
    nvCol("client", "Клиент", "id", 90, { plat: true }),
    nvCol("name", "Как обращаться", "text", 160, { plat: true }),
    nvCol("tg", "Telegram", "text", 130, { plat: true }),
    nvCol("lang", "Язык", "list", 64, { list: "NVD_LANG", plat: true }),
    nvCol("district", "Район", "list", 160, { list: "NVD_DISTRICT", plat: true }),
    nvCol("scope", "Объём", "list", 150, { list: "NVD_SCOPE", plat: true }),
    nvCol("band", "Бюджет", "list", 110, { list: "NVD_BUDGET", plat: true }),
    nvCol("budget", "Бюджет, сум", "sum", 132, { min: 0, plat: true }),
    nvCol("wanted", "Нужно к", "date", 104, { plat: true }),
    nvCol("status", "Статус", "list", 112, { list: "NVD_LEAD_STATUS" }),
    nvCol("reason", "Причина отказа", "list", 190, { list: "NVD_REJECT" }),
    nvCol("firstReply", "Первый ответ", "dt", 128, { prot: "script" }),
    nvCol("replyH", "Ответ, ч", "num1", 80, {
      prot: "formula",
      calc: 'IF([firstReply]=""; ""; ROUND((NETWORKDAYS.INTL([created]; [firstReply]; "0000001"; NV_HOLIDAYS)-1)*9+(MOD([firstReply];1)-MOD([created];1))*24; 1))',
    }),
    nvCol("next", "Следующий шаг", "text", 240),
    nvCol("nextDate", "Дата шага", "date", 104, { min: 0 }),
    nvCol("order", "Заказ", "id", 128, { prot: "script" }),
    nvCol("config", "Код сборки", "mono", 100, { plat: true }),
    nvCol("note", "Комментарий", "long", 280),
    nvCol("src", "Источник записи", "list", 120, { list: "NVD_SOURCE", prot: "script" }),
    nvCol("updated", "Обновлено", "dt", 128, { prot: "script" }),
    nvCol("demo", "Демо", "flag", 56, { demo: true }),
  ],
};

NV_SCHEMA.orders = {
  key: "orders",
  title: "Заказы",
  numbering: { prefix: "NV", yearly: true, createdKey: "created", demoPrefix: "D" },
  keyCol: "num",
  freezeCols: 2,
  totals: true,
  caption:
    '=COUNTA([[num]])&" заказов · в работе "&COUNTIF([[group]];"В работе")&" · ждут клиента "&COUNTIF([[group]];"Ждёт клиента")',
  captionRight: "статус меняется только через колонку «Действие»; источник: вручную и order.status_changed",
  groups: {
    calc: "Расчёт сметы",
    report: "Отчёт",
    dates: "Даты этапов",
    cancel: "Отмена",
    tax: "Налоги и резервы",
  },
  cols: [
    // Card
    nvCol("num", "Номер", "id", 128, { prot: "script" }),
    nvCol("created", "Создан", "dt", 128, { prot: "script" }),
    nvCol("lead", "Заявка", "id", 128, { plat: true }),
    nvCol("client", "Клиент", "id", 90, { plat: true }),
    nvCol("clientName", "Клиент: имя", "text", 160, {
      prot: "formula",
      calc: 'IFERROR(XLOOKUP([client]; {clients.code}; {clients.name}); "")',
    }),
    nvCol("kind", "Вид", "list", 96, { list: "NVD_KIND", plat: true }),
    nvCol("slot", "Слот", "list", 140, { list: "NVD_SLOT" }),
    nvCol("complex", "Сложная сборка", "flag", 70),
    nvCol("furn", "Только мебель и декор", "flag", 70),
    // Status
    nvCol("status", "Статус", "text", 168, { prot: "script" }),
    nvCol("action", "Действие", "list", 210, { dynamicList: true }),
    nvCol("code", "Код статуса", "mono", 130, { prot: "script", hidden: true }),
    nvCol("forClient", "Для клиента", "text", 150, {
      prot: "formula",
      calc:
        'IF([code]="accepted"; IF([feePaid]="Да"; "' +
        NV_CUSTOMER_PREPAID +
        '"; "Ждём предоплату"); IFERROR(XLOOKUP([code]; NVD_STATUS_CODE; NVD_STATUS_CLIENT_LABEL); ""))',
    }),
    nvCol("group", "Группа статуса", "text", 120, {
      prot: "formula",
      hidden: true,
      calc: 'IFERROR(XLOOKUP([code]; NVD_STATUS_CODE; NVD_STATUS_GROUP); "")',
    }),
    // Estimate inputs
    nvCol("basePc", "База ПК, сум", "sum", 132, { int: true, plat: true }),
    nvCol("baseMount", "База монтаж, сум", "sum", 132, { int: true, plat: true }),
    nvCol("outside", "Вне шкалы, сум", "sum", 132, { int: true, plat: true }),
    nvCol("purchased", "Закупает ИП, сум", "sum", 132, { int: true, plat: true }),
    nvCol("memory", "Из них память и SSD, сум", "sum", 132, { int: true, plat: true, memory: true }),
    // Key money (formulas)
    nvCol("purchaseLimit", "Лимит закупки", "sum", 132, {
      prot: "formula",
      tot: true,
      calc: "[purchased]+[reserveSum]",
    }),
    nvCol("feeTotal", "Плата итого", "sum", 132, { prot: "formula", tot: true, calc: "[feePc]+[feeMount]" }),
    nvCol("grand", "Итого клиенту", "sum", 132, {
      prot: "formula",
      tot: true,
      calc: 'IF([kind]="Подбор"; [podborFee]; [purchaseLimit]+[feeTotal])',
    }),
    nvCol("eligibility", "Допуск", "text", 190, {
      prot: "formula",
      calc: 'IF([kind]="Подбор"; "«Подбор»"; IF([kind]="Сетап"; IF([basePc]+[baseMount]>=NV_MIN_SETUP; "Полный цикл"; "Сетап ниже минимума"); IF([basePc]+[baseMount]>=NV_MIN_PC; "Полный цикл"; IF([basePc]+[baseMount]>=NV_MIN_WINDOW; IF([slot]="Свободное окно"; "Только в свободное окно"; "Только «Подбор»: окна нет"); "Только «Подбор»"))))',
    }),
    nvCol("validUntil", "Смета действует до", "dt", 128, { prot: "script" }),
    // Calculation of the estimate (group)
    nvCol("reserveBp", "Резерв, бп", "int", 90, {
      prot: "formula",
      grp: "calc",
      calc: "IF(([purchased]>0)*([memory]*10000>=NV_RESERVE_HIGH_SHARE_BP*[purchased]); NV_RESERVE_HIGH_BP; NV_RESERVE_BP)",
    }),
    nvCol("reserveSum", "Резерв на рост цен", "sum", 132, {
      prot: "formula",
      grp: "calc",
      calc: "CEILING(QUOTIENT([purchased]*[reserveBp]+9999; 10000); NV_RESERVE_STEP)",
    }),
    nvCol("feePc", "Плата ПК", "sum", 132, {
      prot: "formula",
      grp: "calc",
      calc: "IF([basePc]<=0; 0; IF([complex]; QUOTIENT([basePc]*NV_COMPLEX_BP; 10000); IF([basePc]<NV_PC_THRESHOLD; QUOTIENT([basePc]*NV_PC_LOW_BP; 10000); MAX(QUOTIENT([basePc]*NV_PC_HIGH_BP; 10000); NV_PC_HIGH_MIN_FEE))))",
    }),
    nvCol("feeMount", "Плата монтаж", "sum", 132, {
      prot: "formula",
      grp: "calc",
      calc: "QUOTIENT([baseMount]*NV_MOUNT_BP; 10000)",
    }),
    nvCol("feeRate", "Ставка факт", "pct2", 90, {
      prot: "formula",
      grp: "calc",
      calc: "IF([basePc]+[baseMount]>0; MIN(10000; QUOTIENT([feeTotal]*10000; [basePc]+[baseMount]))/10000; 0)",
    }),
    nvCol("commission", "Вознаграждение (строка 1)", "sum", 140, {
      prot: "formula",
      grp: "calc",
      calc: "QUOTIENT([feeTotal]*NV_COMMISSION_BP+5000; 10000)",
    }),
    nvCol("works", "Работы (строка 2)", "sum", 132, { prot: "formula", grp: "calc", calc: "[feeTotal]-[commission]" }),
    nvCol("advance", "Аванс 30 %", "sum", 132, {
      prot: "formula",
      grp: "calc",
      calc: "QUOTIENT([feeTotal]*NV_ADVANCE_BP+5000; 10000)",
    }),
    nvCol("final", "Финал 70 %", "sum", 132, { prot: "formula", grp: "calc", calc: "[feeTotal]-[advance]" }),
    nvCol("podborFee", "Плата «Подбор»", "sum", 132, {
      prot: "formula",
      grp: "calc",
      calc: "QUOTIENT([feeTotal]*NV_PODBOR_BP; 10000)",
    }),
    nvCol("podborCredit", "Зачёт «Подбора», сум", "sum", 132, {
      prot: "formula",
      grp: "calc",
      calc: 'IF(OR([kind]="Подбор"; [client]=""); 0; SUMIFS({orders.podborFee}; {orders.client}; [client]; {orders.kind}; "Подбор"; {orders.code}; "podbor_delivered"; {orders.podborUntil}; ">="&[created]))',
    }),
    // Money (formulas over Платежи and Закупки)
    nvCol("feePaid", "Аванс получен", "text", 96, {
      prot: "formula",
      calc: 'IF(SUMIFS({payments.amount}; {payments.order}; [num]; {payments.kind}; "Аванс платы 30 %"; {payments.status}; "Подтверждён"; {payments.receipt}; "<>")>=[advance]; "Да"; "Нет")',
    }),
    nvCol("fundsGot", "Получено на закупку", "sum", 132, {
      prot: "formula",
      calc: 'SUMIFS({payments.amount}; {payments.order}; [num]; {payments.group}; "Закупка"; {payments.status}; "Подтверждён")',
    }),
    nvCol("fundsOk", "Деньги получены", "text", 96, {
      prot: "formula",
      calc: 'IF(AND([purchaseLimit]>0; [fundsGot]>=[purchaseLimit]); "Да"; "Нет")',
    }),
    nvCol("notBefore", "Закупка не раньше", "dt", 128, {
      prot: "formula",
      calc: 'IF([fundsOk]="Да"; WORKDAY.INTL(INT(MAXIFS({payments.confirmedAt}; {payments.order}; [num]; {payments.group}; "Закупка"; {payments.status}; "Подтверждён")); 1; "0000001"; NV_HOLIDAYS)+TIMEVALUE(NV_RESPONSE_FROM); "")',
    }),
    nvCol("firstOrder", "Первый заказ клиента", "text", 96, {
      prot: "formula",
      calc: 'IF(COUNTIFS({orders.client}; [client]; {orders.created}; "<"&[created]; {orders.code}; "<>cancelled")=0; "Да"; "Нет")',
    }),
    nvCol("meetingNeeded", "Встреча нужна", "text", 96, {
      prot: "formula",
      calc: 'IF(AND([firstOrder]="Да"; [grand]>=NV_MEETING_FROM); "Да"; "Нет")',
    }),
    nvCol("meetingDone", "Встреча проведена", "flag", 70),
    nvCol("receipts", "Чеки итого", "sum", 132, {
      prot: "formula",
      tot: true,
      calc: "SUMIFS({purchases.amount}; {purchases.order}; [num])",
    }),
    nvCol("limitUsed", "Лимит использован", "pct", 96, {
      prot: "formula",
      calc: 'IF([purchaseLimit]>0; [receipts]/[purchaseLimit]; "")',
    }),
    nvCol("refunded", "Возвращено клиенту", "sum", 132, {
      prot: "formula",
      calc: 'SUMIFS({payments.amount}; {payments.order}; [num]; {payments.group}; "Возврат денег"; {payments.status}; "Подтверждён")',
    }),
    nvCol("remainder", "Остаток у ИП", "sum", 132, {
      prot: "formula",
      tot: true,
      calc: "[fundsGot]-[receipts]-[refunded]",
    }),
    nvCol("feeNet", "Плата получена (нетто)", "sum", 132, {
      prot: "formula",
      tot: true,
      calc: 'SUMIFS({payments.amount}; {payments.order}; [num]; {payments.group}; "Плата"; {payments.status}; "Подтверждён")-SUMIFS({payments.amount}; {payments.order}; [num]; {payments.group}; "Возврат платы"; {payments.status}; "Подтверждён")',
    }),
    nvCol("recon", "Сверка", "text", 150, {
      prot: "formula",
      calc: 'IF([fundsGot]=0; "—"; IF([fundsGot]=[receipts]+[refunded]; "Сходится"; "Остаток "&TEXT([remainder]; "#,##0")&" сум"))',
    }),
    // Report (group)
    nvCol("reportTarget", "Отчёт к (+24 ч)", "dt", 128, { prot: "script", grp: "report" }),
    nvCol("reportDeadline", "Отчёт крайний (+48 ч)", "dt", 128, { prot: "script", grp: "report" }),
    nvCol("reportSent", "Отчёт отправлен", "dt", 128, { prot: "script", grp: "report" }),
    nvCol("objectionUntil", "Возражения до (+3 р. д.)", "dt", 128, { prot: "script", grp: "report" }),
    nvCol("objection", "Возражение (текст)", "long", 240, { grp: "report" }),
    nvCol("reportAccepted", "Отчёт принят", "list", 110, {
      list: "NVD_REPORT_ACCEPTED",
      grp: "report",
      prot: "script",
    }),
    nvCol("refundDue", "Вернуть остаток до (+5 р. д.)", "dt", 128, { prot: "script", grp: "report" }),
    // Stage dates (group, set by the script)
    nvCol("dEstimate", "Смета отправлена", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dAccepted", "Принят", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dPurchase", "Закупка начата", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dPurchaseDone", "Закупка завершена", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dSettled", "Сверен", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dAssembly", "Сборка", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dTest", "Тест", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dReady", "Готов", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dDelivery", "Доставка", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dHandover", "Сдан", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dClosed", "Закрыт", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dPodbor", "Подбор сдан", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("podborUntil", "Зачёт «Подбора» до", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dCancelStart", "Отмена начата", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("dCancelled", "Отменён", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("warrantyUntil", "Гарантия до", "date", 110, { prot: "script", grp: "dates" }),
    nvCol("aftercare1", "Сопровождение 7 дн.", "dt", 128, { prot: "script", grp: "dates" }),
    nvCol("aftercare2", "Сопровождение 30 дн.", "dt", 128, { prot: "script", grp: "dates" }),
    // Cancellation (group)
    nvCol("cancelPoint", "Точка отмены", "list", 190, { list: "NVD_CANCEL_POINT", grp: "cancel", prot: "script" }),
    nvCol("cancelReason", "Причина отмены", "long", 240, { grp: "cancel" }),
    nvCol("doneBp", "Выполнено сборки, бп", "int", 110, { grp: "cancel", doneBp: true }),
    nvCol("feeEarned", "Заработано платы", "sum", 132, { prot: "script", grp: "cancel" }),
    nvCol("feeToRefund", "Вернуть платы", "sum", 132, { prot: "script", grp: "cancel" }),
    nvCol("feeToInvoice", "Доплатить платы (отдельный QR)", "sum", 140, { prot: "script", grp: "cancel" }),
    nvCol("shopRefunds", "Возвраты магазинов", "sum", 132, { int: true, grp: "cancel" }),
    nvCol("losses", "Подтверждённые потери", "sum", 132, { int: true, grp: "cancel" }),
    nvCol("fundsToRefund", "Вернуть денег на закупку", "sum", 140, { prot: "script", grp: "cancel" }),
    nvCol("partsTo", "Детали — кому", "list", 170, { list: "NVD_CANCEL_PARTS", grp: "cancel", prot: "script" }),
    nvCol("cancelDue", "Вернуть до", "dt", 128, { prot: "script", grp: "cancel" }),
    // Taxes and reserves (group)
    nvCol("taxEst", "Налог 1 % (оценка)", "sum", 132, {
      prot: "formula",
      grp: "tax",
      calc: "IF([feeNet]>0; QUOTIENT([feeNet]*NV_TURNOVER_TAX_BP+9999; 10000); 0)",
    }),
    nvCol("taxReserve", "Взнос в налоговый резерв", "sum", 132, {
      prot: "formula",
      grp: "tax",
      calc: 'SUMIFS({reserves.amount}; {reserves.ref}; [num]; {reserves.fund}; "Налоговый риск")',
    }),
    nvCol("warrantyContribution", "Взнос в резерв гарантии", "sum", 132, {
      prot: "formula",
      grp: "tax",
      calc: 'SUMIFS({reserves.amount}; {reserves.ref}; [num]; {reserves.fund}; "Гарантийный"; {reserves.basis}; "Взнос при сдаче")',
    }),
    // Work
    nvCol("nextStep", "Следующий шаг", "text", 240),
    nvCol("nextDate", "Дата шага", "date", 104, { min: 0 }),
    nvCol("channel", "Канал (из заявки)", "text", 150, {
      prot: "formula",
      calc: 'IFERROR(XLOOKUP([lead]; {leads.num}; {leads.channel}); "")',
    }),
    nvCol("district", "Район", "text", 150, {
      prot: "formula",
      calc: 'IFERROR(XLOOKUP([lead]; {leads.num}; {leads.district}); "")',
    }),
    nvCol("adminUrl", "Ссылка в админке", "url", 200, { plat: true }),
    nvCol("tgTopic", "Тема Telegram", "url", 200, { plat: true }),
    nvCol("notes", "Заметки", "long", 280),
    nvCol("src", "Источник записи", "list", 120, { list: "NVD_SOURCE", prot: "script" }),
    nvCol("seq", "Посл. seq события", "int", 90, { prot: "script", hidden: true }),
    nvCol("updated", "Обновлено", "dt", 128, { prot: "script" }),
    nvCol("demo", "Демо", "flag", 56, { demo: true }),
  ],
};

NV_SCHEMA.payments = {
  key: "payments",
  title: "Платежи",
  numbering: { prefix: "P", yearly: true, createdKey: "date", demoPrefix: "D" },
  keyCol: "id",
  freezeCols: 2,
  totals: true,
  caption:
    '=COUNTA([[id]])&" платежей · подтверждено "&COUNTIF([[status]];"Подтверждён")&" · ожидается "&COUNTIF([[status]];"Ожидается")',
  captionRight: "плата — QR Xolis с чеком; деньги на закупку — только на счёт ИП; возвраты — исходящим переводом",
  cols: [
    nvCol("id", "ID платежа", "id", 128, { prot: "script" }),
    nvCol("order", "Заказ", "id", 128, { orderList: true }),
    nvCol("client", "Клиент", "id", 90, {
      prot: "formula",
      calc: 'IFERROR(XLOOKUP([order]; {orders.num}; {orders.client}); "")',
    }),
    nvCol("kind", "Вид", "list", 190, { list: "NVD_PAY_LABEL" }),
    nvCol("group", "Группа", "text", 130, {
      prot: "formula",
      calc: 'IFERROR(XLOOKUP([kind]; NVD_PAY_LABEL; NVD_PAY_GROUP); "")',
    }),
    nvCol("direction", "Направление", "text", 110, {
      prot: "formula",
      calc: 'IF(OR([group]="Плата"; [group]="Закупка"); "Входящий"; "Исходящий")',
    }),
    nvCol("method", "Способ", "list", 170, { list: "NVD_METHOD_LABEL" }),
    nvCol("amount", "Сумма, сум", "sum", 132, { int: true, positive: true, tot: true }),
    nvCol("status", "Статус", "list", 120, { list: "NVD_PAY_STATUS" }),
    nvCol("date", "Дата операции", "date", 110),
    nvCol("receipt", "№ фискального чека", "mono", 150),
    nvCol("bankDoc", "№ банковского документа", "mono", 160),
    nvCol("payerIsClient", "Плательщик — клиент", "flag", 80),
    nvCol("thirdParty", "Заявление третьего лица", "url", 200),
    nvCol("confirmedBy", "Подтвердил", "list", 120, { list: "NVD_CONFIRMER" }),
    nvCol("confirmedAt", "Подтверждено", "dt", 128, { prot: "script" }),
    nvCol("reversal", "Сторно платежа (ID)", "id", 128),
    nvCol("voidReason", "Причина аннулирования", "long", 240),
    nvCol("check", "Проверка", "text", 280, {
      prot: "formula",
      calc: 'IFS([kind]=""; ""; AND([group]="Плата"; [method]<>"QR Xolis"; [method]<>"Карта (мерчант)"); "Неверная пара: плата только QR или карта"; AND([group]="Закупка"; [method]<>"Перевод на счёт ИП"); "Неверная пара: закупка только на счёт ИП"; AND(LEFT([group];7)="Возврат"; [method]<>"Исходящий перевод"); "Неверная пара: возврат только переводом"; AND([group]="Плата"; [status]="Подтверждён"; [receipt]=""); "Нужен фискальный чек"; TRUE; "ОК")',
    }),
    nvCol("src", "Источник записи", "list", 120, { list: "NVD_SOURCE", prot: "script" }),
    nvCol("demo", "Демо", "flag", 56, { demo: true }),
  ],
};

NV_SCHEMA.purchases = {
  key: "purchases",
  title: "Закупки",
  numbering: { prefix: "Z", yearly: true, createdKey: "bought", demoPrefix: "D" },
  keyCol: "id",
  freezeCols: 2,
  totals: true,
  caption: '=COUNTA([[id]])&" чеков · на "&TEXT(SUM([[amount]]);"#,##0")&" сум"',
  captionRight: "основа отчёта комиссионера: получено = закуплено + возвращено",
  cols: [
    nvCol("id", "ID закупки", "id", 128, { prot: "script" }),
    nvCol("order", "Заказ", "id", 128, { orderList: true }),
    nvCol("item", "Позиция (без ПД)", "text", 240),
    nvCol("category", "Категория", "list", 160, { list: "NVD_CATEGORY" }),
    nvCol("shop", "Магазин", "list", 150, { list: "NVD_SHOP" }),
    nvCol("qty", "Кол-во", "int", 64, { min1: true }),
    nvCol("amount", "Сумма по чеку, сум", "sum", 132, { int: true, tot: true }),
    nvCol("paidWith", "Оплачено", "list", 160, { list: "NVD_PAID_WITH" }),
    nvCol("docKind", "Документ", "list", 170, { list: "NVD_RECEIPT_DOC" }),
    nvCol("receipt", "№ чека", "mono", 130),
    nvCol("esf", "№ ЭСФ", "mono", 130),
    nvCol("esfDue", "ЭСФ до (+10 дней)", "date", 110, {
      prot: "formula",
      calc: 'IF([esf]=""; ""; [bought]+NV_ESF_DAYS)',
    }),
    nvCol("esfStatus", "Статус ЭСФ", "list", 120, { list: "NVD_ESF_STATUS" }),
    nvCol("discount", "Скидка, сум (вся — клиенту)", "sum", 132, { int: true }),
    nvCol("bonus", "Бонус (текст)", "text", 160),
    nvCol("serials", "Серийные номера", "mono", 200),
    nvCol("warrantyMonths", "Гарантия магазина, мес.", "int", 90),
    nvCol("warrantyUntil", "Гарантия магазина до", "date", 110, {
      prot: "formula",
      calc: 'IF([warrantyMonths]=""; ""; EDATE([bought]; [warrantyMonths]))',
    }),
    nvCol("photo", "Фото чека (ссылка)", "url", 200),
    nvCol("verified", "Подлинность проверена", "flag", 80),
    nvCol("bought", "Куплено", "date", 110),
    nvCol("boughtBy", "Купил", "list", 110, { list: "NVD_BOUGHT_BY" }),
    nvCol("cumul", "Нарастающим по заказу", "sum", 132, {
      prot: "formula",
      calc: 'IF([order]=""; ""; SUMIFS(INDEX({purchases.amount}; 1):INDEX({purchases.amount}; [#]); INDEX({purchases.order}; 1):INDEX({purchases.order}; [#]); [order]))',
    }),
    nvCol("limitCheck", "Проверка лимита", "text", 260, {
      prot: "formula",
      calc: 'IF([order]=""; ""; IFS([cumul]>IFERROR(XLOOKUP([order]; {orders.num}; {orders.fundsGot}); 0); "Больше полученных денег — нельзя"; [cumul]>IFERROR(XLOOKUP([order]; {orders.num}; {orders.purchaseLimit}); 0); "Выше лимита — нужно согласие клиента"; TRUE; "ОК"))',
    }),
    nvCol("src", "Источник записи", "list", 120, { list: "NVD_SOURCE", prot: "script" }),
    nvCol("demo", "Демо", "flag", 56, { demo: true }),
  ],
};

NV_SCHEMA.warranty = {
  key: "warranty",
  title: "Гарантия",
  numbering: { prefix: "G", yearly: true, createdKey: "opened", demoPrefix: "D" },
  keyCol: "num",
  freezeCols: 2,
  caption: '=COUNTA([[num]])&" случаев · открыто "&(COUNTA([[num]])-COUNTIF([[status]];"Закрыт"))',
  captionRight: "ответ 1 р. д. · диагностика 2 р. д. · подменный 3 суток · устранение 10 р. д. или 20 дней",
  cols: [
    nvCol("num", "Номер", "id", 128, { prot: "script" }),
    nvCol("order", "Заказ", "id", 128, { orderList: true }),
    nvCol("client", "Клиент", "id", 90, {
      prot: "formula",
      calc: 'IFERROR(XLOOKUP([order]; {orders.num}; {orders.client}); "")',
    }),
    nvCol("purchase", "Закупка / деталь", "id", 128),
    nvCol("opened", "Открыт", "dt", 128),
    nvCol("channel", "Канал", "list", 110, { list: "NVD_WARRANTY_CHANNEL" }),
    nvCol("desc", "Описание (без ПД)", "long", 280),
    nvCol("status", "Статус", "text", 150, { prot: "script" }),
    nvCol("action", "Действие", "list", 200, { dynamicList: true }),
    nvCol("fixType", "Тип устранения", "list", 110, { list: "NVD_FIX_TYPE" }),
    nvCol("replyBy", "Ответить до", "dt", 128, { prot: "script" }),
    nvCol("diagBy", "Диагностика до", "dt", 128, { prot: "script" }),
    nvCol("loanerBy", "Подменный до", "dt", 128, { prot: "script" }),
    nvCol("fixBy", "Устранить до", "dt", 128, { prot: "script" }),
    nvCol("loanerItem", "Подменный товар", "list", 190, { list: "NVD_LOANER" }),
    nvCol("supplierClaim", "Претензия поставщику", "long", 240),
    nvCol("cost", "Затраты из резерва, сум", "sum", 132, { int: true }),
    nvCol("fault", "Вина клиента", "list", 190, { list: "NVD_FAULT" }),
    nvCol("evidence", "Доказательства (ссылка)", "url", 200),
    nvCol("closed", "Закрыт", "date", 110, { prot: "script" }),
    nvCol("inWarranty", "В гарантии", "text", 130, {
      prot: "formula",
      calc: 'IF([opened]=""; ""; IF(ISNUMBER(XLOOKUP([order]; {orders.num}; {orders.warrantyUntil})); IF(INT([opened])<=XLOOKUP([order]; {orders.num}; {orders.warrantyUntil}); "Да"; "Нет — вне срока"); "Нет — вне срока"))',
    }),
    nvCol("overdue", "Просрочено", "text", 110, {
      prot: "formula",
      calc: 'IFS([status]="Открыт"; IF(AND([replyBy]<>""; [replyBy]<NOW()); "Просрочено"; ""); [status]="Диагностика"; IF(AND([diagBy]<>""; [diagBy]<NOW()); "Просрочено"; ""); OR([status]="Выдан подменный"; [status]="У поставщика"); IF(AND([fixBy]<>""; [fixBy]<NOW()); "Просрочено"; ""); TRUE; "")',
    }),
    nvCol("src", "Источник записи", "list", 120, { list: "NVD_SOURCE", prot: "script" }),
    nvCol("demo", "Демо", "flag", 56, { demo: true }),
  ],
};

NV_SCHEMA.clients = {
  key: "clients",
  title: "Клиенты",
  numbering: { prefix: "K", yearly: false, createdKey: "firstContact", demoPrefix: "D" },
  keyCol: "code",
  freezeCols: 2,
  caption: '=COUNTA([[code]])&" клиентов · с заказами "&COUNTIF([[ordersN]];">0")',
  captionRight: "минимум персональных данных: код K-, как обращаться, @ник, район",
  cols: [
    nvCol("code", "Код", "id", 100, { prot: "script" }),
    nvCol("name", "Как обращаться", "text", 170),
    nvCol("tg", "Telegram", "text", 140, { regex: "^@" }),
    nvCol("phone", "Телефон", "mono", 150, { regex: "^\\+998\\d{9}$" }),
    nvCol("lang", "Язык", "list", 64, { list: "NVD_LANG" }),
    nvCol("district", "Район", "list", 160, { list: "NVD_DISTRICT" }),
    nvCol("firstContact", "Первый контакт", "date", 110),
    nvCol("firstChannel", "Первый канал", "list", 150, { list: "NVD_CHANNEL" }),
    nvCol("referral", "Пришёл по рекомендации", "id", 110),
    nvCol("leadsN", "Заявок", "int", 80, { prot: "formula", calc: "COUNTIF({leads.client}; [code])" }),
    nvCol("ordersN", "Заказов", "int", 80, {
      prot: "formula",
      calc: 'COUNTIFS({orders.client}; [code]; {orders.code}; "<>cancelled")',
    }),
    nvCol("delivered", "Сдано", "int", 80, {
      prot: "formula",
      calc: 'COUNTIFS({orders.client}; [code]; {orders.group}; "Сдан")',
    }),
    nvCol("dealsSum", "Сделок на сумму", "sum", 132, {
      prot: "formula",
      tot: true,
      calc: 'SUMIFS({orders.grand}; {orders.client}; [code]; {orders.group}; "Сдан")',
    }),
    nvCol("feeAll", "Плата всего", "sum", 132, {
      prot: "formula",
      tot: true,
      calc: "SUMIFS({orders.feeNet}; {orders.client}; [code])",
    }),
    nvCol("lastOrder", "Последний заказ", "date", 110, {
      prot: "formula",
      calc: 'IF(MAXIFS({orders.created}; {orders.client}; [code])=0; ""; INT(MAXIFS({orders.created}; {orders.client}; [code])))',
    }),
    nvCol("warrantyUntil", "Гарантия до", "date", 110, {
      prot: "formula",
      calc: 'IF(MAXIFS({orders.warrantyUntil}; {orders.client}; [code])=0; ""; MAXIFS({orders.warrantyUntil}; {orders.client}; [code]))',
    }),
    nvCol("adminUrl", "Ссылка в админке", "url", 200),
    nvCol("ref", "Ref платформы", "mono", 120),
    nvCol("notes", "Заметки", "long", 260),
    nvCol("demo", "Демо", "flag", 56, { demo: true }),
  ],
};

NV_SCHEMA.promo = {
  key: "promo",
  title: "Продвижение",
  keyCol: "month",
  freezeCols: 2,
  caption: '="расходов на "&TEXT(SUM([[spend]]);"#,##0")&" сум"',
  captionRight: "цена заявки и цена клиента по каналам (MARKETING 3.3)",
  cols: [
    nvCol("month", "Месяц", "date", 104, { firstOfMonth: true }),
    nvCol("channel", "Канал", "list", 170, { list: "NVD_CHANNEL" }),
    nvCol("campaign", "Кампания / код источника", "text", 200),
    nvCol("spend", "Расход, сум (с НДС и комиссией)", "sum", 140, { int: true, tot: true }),
    nvCol("leadsN", "Заявок", "int", 80, {
      prot: "formula",
      calc: 'COUNTIFS({leads.channel}; [channel]; {leads.created}; ">="&[month]; {leads.created}; "<"&EDATE([month]; 1))',
    }),
    nvCol("ordersN", "Заказов", "int", 80, {
      prot: "formula",
      calc: 'COUNTIFS({orders.channel}; [channel]; {orders.dAccepted}; ">="&[month]; {orders.dAccepted}; "<"&EDATE([month]; 1))',
    }),
    nvCol("leadCost", "Цена заявки", "sum", 132, {
      prot: "formula",
      calc: 'IF([leadsN]>0; QUOTIENT([spend]; [leadsN]); "—")',
    }),
    nvCol("clientCost", "Цена клиента", "sum", 132, {
      prot: "formula",
      calc: 'IF([ordersN]>0; QUOTIENT([spend]; [ordersN]); "—")',
    }),
    nvCol("note", "Комментарий", "long", 260),
    nvCol("demo", "Демо", "flag", 56, { demo: true }),
  ],
};

NV_SCHEMA.reserves = {
  key: "reserves",
  title: "Резервы",
  keyCol: "date",
  extraCols: 4,
  freezeCols: 2,
  appendOnly: true,
  caption:
    '=COUNTA([[date]])&" записей · гарантийный "&TEXT(SUMIFS([[amount]];[[fund]];"Гарантийный");"#,##0")&" сум · налоговый "&TEXT(SUMIFS([[amount]];[[fund]];"Налоговый риск");"#,##0")&" сум"',
  captionRight: "только дописывание: пишет скрипт, поправка — через меню с комментарием",
  cols: [
    nvCol("date", "Дата", "date", 104),
    nvCol("fund", "Фонд", "list", 140, { list: "NVD_RESERVE_FUND" }),
    nvCol("ref", "Заказ / случай", "id", 128),
    nvCol("amount", "Сумма, сум (±)", "sum", 140, { nonzero: true }),
    nvCol("basis", "Основание", "list", 260, { list: "NVD_RESERVE_BASIS" }),
    nvCol("who", "Кто", "list", 110, { list: "NVD_ACTOR" }),
    nvCol("comment", "Комментарий", "long", 300),
    nvCol("demo", "Демо", "flag", 56, { demo: true }),
  ],
};

NV_SCHEMA.history = {
  key: "history",
  title: "История",
  keyCol: "time",
  freezeCols: 2,
  appendOnly: true,
  caption: '=COUNTA([[time]])&" записей"',
  captionRight: "только дописывается; пишет скрипт",
  cols: [
    nvCol("time", "Время", "dt", 150, { fmt: NV_FMT.dateTimeSec }),
    nvCol("object", "Объект", "list", 100, { list: "NVD_OBJECT" }),
    nvCol("num", "Номер", "id", 128),
    nvCol("from", "Из статуса", "text", 150),
    nvCol("to", "В статус", "text", 150),
    nvCol("event", "Событие (код)", "mono", 190),
    nvCol("eventLabel", "Событие", "text", 230),
    nvCol("actor", "Кто", "list", 110, { list: "NVD_ACTOR" }),
    nvCol("how", "Как", "list", 130, { list: "NVD_HOW" }),
    nvCol("reason", "Причина или комментарий", "long", 300),
    nvCol("eventId", "ID события платформы", "mono", 250),
    nvCol("seq", "seq", "int", 64),
  ],
};

NV_SCHEMA.webhook = {
  key: "webhook",
  title: "Журнал вебхука",
  keyCol: "received",
  freezeCols: 2,
  appendOnly: true,
  caption:
    '="последнее: "&IF(COUNT([[received]])=0;"нет";TEXT(MAX([[received]]);"dd.mm.yyyy hh:mm"))&" · за 24 ч: "&COUNTIFS([[received]];">"&(NOW()-1))&" · отклонено за 24 ч: "&COUNTIFS([[received]];">"&(NOW()-1);[[result]];"Отклонено")',
  captionRight: "тело события не хранится: только SHA-256 и краткая сводка",
  cols: [
    nvCol("received", "Получено", "dt", 150, { fmt: NV_FMT.dateTimeSec }),
    nvCol("eventId", "ID события", "mono", 270),
    nvCol("type", "Тип", "mono", 170),
    nvCol("num", "Номер объекта", "id", 128),
    nvCol("seq", "seq", "int", 64),
    nvCol("sentAt", "Метка времени отправки", "dt", 150, { fmt: NV_FMT.dateTimeSec }),
    nvCol("result", "Результат", "list", 120, { list: "NVD_WEBHOOK_RESULT" }),
    nvCol("error", "Ошибка", "mono", 130),
    nvCol("hash", "SHA-256 тела (16 знаков)", "mono", 170),
    nvCol("summary", "Краткая сводка", "text", 360),
    nvCol("ms", "Время обработки, мс", "int", 110),
  ],
};

NV_SCHEMA.selfcheck = {
  key: "selfcheck",
  title: "Самопроверка",
  keyCol: "check",
  freezeCols: 2,
  appendOnly: true,
  caption: '="ошибок: "&COUNTIF([[result]];"Ошибка")&" · предупреждений: "&COUNTIF([[result]];"Предупреждение")',
  captionRight: "отчёт последнего запуска: меню Nivel CRM → Самопроверка",
  cols: [
    nvCol("check", "Проверка", "text", 330),
    nvCol("result", "Результат", "list", 130, { list: "NVD_CHECK_RESULT" }),
    nvCol("details", "Подробности", "long", 520),
    nvCol("time", "Время", "dt", 150, { fmt: NV_FMT.dateTimeSec }),
  ],
};

/** The sheets built from the generic table schema, in the order of the book. */
const NV_TABLE_SHEETS = [
  "leads",
  "orders",
  "payments",
  "purchases",
  "warranty",
  "clients",
  "reserves",
  "promo",
  "history",
  "webhook",
  "selfcheck",
];

/** Letter of a column index (1-based): 1 -> A, 27 -> AA. */
function nvLetter(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Index (1-based) of a column of a table sheet; throws for an unknown key. */
function nvColIndex(sheetKey, colKey) {
  const def = NV_SCHEMA[sheetKey];
  if (!def) throw new Error("Unknown sheet key: " + sheetKey);
  const i = def.cols.findIndex((c) => c.key === colKey);
  if (i < 0) throw new Error("Unknown column " + sheetKey + "." + colKey);
  return NV_LAYOUT.firstCol + i;
}

function nvColLetter(sheetKey, colKey) {
  return nvLetter(nvColIndex(sheetKey, colKey));
}

/** Open-ended range of a column from the first data row: 'Заказы'!$B$6:$B. */
function nvColRange(sheetKey, colKey, withSheet) {
  const l = nvColLetter(sheetKey, colKey);
  const r = "$" + l + "$" + NV_LAYOUT.firstRow + ":$" + l;
  return withSheet === false ? r : nvQuoteSheet(NV_SCHEMA[sheetKey].title) + "!" + r;
}

function nvQuoteSheet(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
}

/** Last column index of a table sheet. */
function nvLastColIndex(sheetKey) {
  return NV_LAYOUT.firstCol + NV_SCHEMA[sheetKey].cols.length - 1;
}

/** Reads the cells of a row object by column keys: { key: value } -> array in the order of the columns. */
function nvRowToArray(sheetKey, obj) {
  return NV_SCHEMA[sheetKey].cols.map((c) => (obj[c.key] === undefined ? "" : obj[c.key]));
}

/** Array of a row -> object by column keys. */
function nvArrayToRow(sheetKey, arr) {
  const o = {};
  NV_SCHEMA[sheetKey].cols.forEach((c, i) => {
    o[c.key] = arr[i];
  });
  return o;
}
