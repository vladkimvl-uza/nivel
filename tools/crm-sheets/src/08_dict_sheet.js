/**
 * "Справочники": all lists for the dropdowns and the code <-> label tables, as columns side by side.
 * Every column is a named range NVD_* (holidays: NV_HOLIDAYS). The owner may edit labels, never codes.
 */

/** Value lists: [name, block, title, width, values, grows]. */
function nvDictColumns() {
  const cols = [];
  const add = (name, block, title, width, values, o) =>
    cols.push(Object.assign({ name: name, block: block, title: title, width: width, values: values }, o || {}));
  const st = NV_STATUSES;
  add(
    "NVD_STATUS_CODE",
    "Статусы заказа",
    "Код",
    150,
    st.map((s) => s.code),
    { code: true },
  );
  add(
    "NVD_STATUS_LABEL",
    "Статусы заказа",
    "Подпись",
    170,
    st.map((s) => s.label),
  );
  add(
    "NVD_STATUS_CLIENT_CODE",
    "Статусы заказа",
    "Для клиента (код)",
    150,
    st.map((s) => s.clientCode),
    { code: true },
  );
  add(
    "NVD_STATUS_CLIENT_LABEL",
    "Статусы заказа",
    "Для клиента (подпись)",
    170,
    st.map((s) => s.clientLabel),
  );
  add(
    "NVD_STATUS_GROUP",
    "Статусы заказа",
    "Группа",
    120,
    st.map((s) => s.group),
  );
  add(
    "NVD_STATUS_STAGE",
    "Статусы заказа",
    "Этап панели",
    130,
    st.map((s) => s.stage),
  );
  add(
    "NVD_STATUS_DATEKEY",
    "Статусы заказа",
    "Колонка даты этапа",
    140,
    st.map((s) => s.dateKey || "—"),
    { code: true },
  );
  add(
    "NVD_STATUS_ORDER",
    "Статусы заказа",
    "Порядок",
    70,
    st.map((s) => s.order),
    { code: true },
  );
  const tr = NV_TRANSITIONS;
  add(
    "NVD_TR_FROM",
    "Переходы",
    "Из статуса",
    150,
    tr.map((t) => t.from),
    { code: true },
  );
  add(
    "NVD_TR_EVENT",
    "Переходы",
    "Событие (код)",
    190,
    tr.map((t) => t.event),
    { code: true },
  );
  add(
    "NVD_TR_LABEL",
    "Переходы",
    "Событие (подпись)",
    230,
    tr.map((t) => nvEventByCode(t.event).label),
  );
  add(
    "NVD_TR_TO",
    "Переходы",
    "В статус",
    150,
    tr.map((t) => t.to),
    { code: true },
  );
  add(
    "NVD_TR_WHO",
    "Переходы",
    "Кто может",
    130,
    tr.map((t) => nvEventByCode(t.event).actors.join(", ")),
    { code: true },
  );
  add(
    "NVD_TR_CHECKS",
    "Переходы",
    "Проверки",
    380,
    tr.map((t) => NV_TRANSITION_CHECKS[t.event] || ""),
  );
  add(
    "NVD_EVENT_CODE",
    "События",
    "Код",
    190,
    NV_EVENTS.map((e) => e.code),
    { code: true },
  );
  add(
    "NVD_EVENT_LABEL",
    "События",
    "Подпись",
    230,
    NV_EVENTS.map((e) => e.label),
  );
  add(
    "NVD_EVENT_UI",
    "События",
    "В списке «Действие»",
    130,
    NV_EVENTS.map((e) => (e.ui ? "да" : "нет (система)")),
    { code: true },
  );
  add(
    "NVD_LEAD_STATUS_CODE",
    "Статусы заявки",
    "Код",
    100,
    NV_LEAD_STATUSES.map((s) => s.code),
    { code: true },
  );
  add(
    "NVD_LEAD_STATUS",
    "Статусы заявки",
    "Подпись",
    110,
    NV_LEAD_STATUSES.map((s) => s.label),
  );
  add(
    "NVD_SCOPE_CODE",
    "Объём заявки",
    "Код",
    100,
    NV_SCOPES.map((s) => s.code),
    { code: true },
  );
  add(
    "NVD_SCOPE",
    "Объём заявки",
    "Подпись",
    150,
    NV_SCOPES.map((s) => s.label),
  );
  add(
    "NVD_SCOPE_KIND",
    "Объём заявки",
    "Вид заказа",
    100,
    NV_SCOPES.map((s) => s.kind),
  );
  add(
    "NVD_KIND_CODE",
    "Вид заказа",
    "Код",
    100,
    NV_KINDS.map((s) => s.code),
    { code: true },
  );
  add(
    "NVD_KIND",
    "Вид заказа",
    "Подпись",
    100,
    NV_KINDS.map((s) => s.label),
  );
  add("NVD_SLOT", "Слот", "Слот", 140, NV_SLOTS);
  add(
    "NVD_BUDGET_CODE",
    "Бюджет",
    "Код",
    90,
    NV_BUDGET_BANDS.map((s) => s.code),
    { code: true },
  );
  add(
    "NVD_BUDGET",
    "Бюджет",
    "Диапазон",
    110,
    NV_BUDGET_BANDS.map((s) => s.label),
  );
  add("NVD_DISTRICT", "Районы", "Район", 170, NV_DISTRICTS, { grow: true });
  add(
    "NVD_CHANNEL",
    "Каналы",
    "Канал",
    160,
    NV_CHANNELS.map((c) => c.label),
    { grow: true },
  );
  add(
    "NVD_CHANNEL_CODE",
    "Каналы",
    "Код источника",
    110,
    NV_CHANNELS.map((c) => c.code),
    { code: true, grow: true },
  );
  add(
    "NVD_CHANNEL_PAID",
    "Каналы",
    "Платный",
    80,
    NV_CHANNELS.map((c) => c.paid),
    { grow: true },
  );
  add("NVD_REJECT", "Причины отказа", "Причина", 200, NV_REJECT_REASONS, { grow: true });
  add("NVD_LANG", "Языки", "Язык", 70, NV_LANGS);
  add(
    "NVD_WARRANTY_STATUS_CODE",
    "Гарантия: статусы",
    "Код",
    130,
    NV_WARRANTY_STATUSES.map((s) => s.code),
    { code: true },
  );
  add(
    "NVD_WARRANTY_STATUS",
    "Гарантия: статусы",
    "Подпись",
    150,
    NV_WARRANTY_STATUSES.map((s) => s.label),
  );
  add(
    "NVD_WARRANTY_EVENT_CODE",
    "Гарантия: события",
    "Код",
    170,
    NV_WARRANTY_EVENTS.map((s) => s.code),
    { code: true },
  );
  add(
    "NVD_WARRANTY_EVENT",
    "Гарантия: события",
    "Подпись",
    200,
    NV_WARRANTY_EVENTS.map((s) => s.label),
  );
  add(
    "NVD_WARRANTY_TR_FROM",
    "Гарантия: переходы",
    "Из",
    130,
    NV_WARRANTY_TRANSITIONS.map((t) => t.from),
    { code: true },
  );
  add(
    "NVD_WARRANTY_TR_EVENT",
    "Гарантия: переходы",
    "Событие",
    170,
    NV_WARRANTY_TRANSITIONS.map((t) => t.event),
    { code: true },
  );
  add(
    "NVD_WARRANTY_TR_TO",
    "Гарантия: переходы",
    "В",
    130,
    NV_WARRANTY_TRANSITIONS.map((t) => t.to),
    { code: true },
  );
  add(
    "NVD_FAULT_CODE",
    "Вина клиента",
    "Код",
    190,
    NV_WARRANTY_FAULTS.map((s) => s.code),
    { code: true },
  );
  add(
    "NVD_FAULT",
    "Вина клиента",
    "Подпись",
    190,
    NV_WARRANTY_FAULTS.map((s) => s.label),
  );
  add("NVD_WARRANTY_CHANNEL", "Гарантия: канал", "Канал", 100, NV_WARRANTY_CHANNELS);
  add("NVD_FIX_TYPE", "Гарантия: тип", "Тип устранения", 120, NV_FIX_TYPES);
  add(
    "NVD_PAY_CODE",
    "Виды платежей",
    "Код",
    150,
    NV_PAYMENT_KINDS.map((k) => k.code),
    { code: true },
  );
  add(
    "NVD_PAY_LABEL",
    "Виды платежей",
    "Подпись",
    200,
    NV_PAYMENT_KINDS.map((k) => k.label),
  );
  add(
    "NVD_PAY_GROUP",
    "Виды платежей",
    "Группа",
    130,
    NV_PAYMENT_KINDS.map((k) => k.group),
  );
  add(
    "NVD_PAY_DIR",
    "Виды платежей",
    "Направление",
    110,
    NV_PAYMENT_KINDS.map((k) => k.direction),
  );
  add(
    "NVD_PAY_METHODS",
    "Виды платежей",
    "Допустимые способы",
    250,
    NV_PAYMENT_KINDS.map((k) => k.methods.join(" / ")),
  );
  add(
    "NVD_METHOD_CODE",
    "Способы платежа",
    "Код",
    150,
    NV_PAYMENT_METHODS.map((k) => k.code),
    { code: true },
  );
  add(
    "NVD_METHOD_LABEL",
    "Способы платежа",
    "Подпись",
    190,
    NV_PAYMENT_METHODS.map((k) => k.label),
  );
  add("NVD_PAY_STATUS", "Статусы платежа", "Статус", 120, NV_PAYMENT_STATUSES);
  add("NVD_CONFIRMER", "Подтверждение", "Подтвердил", 110, NV_CONFIRMERS);
  add(
    "NVD_CANCEL_POINT_CODE",
    "Точки отмены",
    "Код",
    230,
    NV_CANCEL_POINTS.map((p) => p.code),
    { code: true },
  );
  add(
    "NVD_CANCEL_POINT",
    "Точки отмены",
    "Подпись",
    200,
    NV_CANCEL_POINTS.map((p) => p.label),
  );
  add(
    "NVD_CANCEL_STATUSES",
    "Точки отмены",
    "Статусы",
    330,
    NV_CANCEL_POINTS.map((p) => p.statuses.join(", ")),
    { code: true },
  );
  add("NVD_CANCEL_SHARE", "Точки отмены", "Заработано платы", 260, [
    "0",
    "доля этапа «подбор»: 20 %",
    "подбор + закупка: 50 %",
    "50 % + выполнено × 35 %",
    "85 % платы",
  ]);
  add(
    "NVD_CANCEL_PARTS_CODE",
    "Детали — кому",
    "Код",
    120,
    NV_CANCEL_PARTS.map((p) => p.code),
    { code: true },
  );
  add(
    "NVD_CANCEL_PARTS",
    "Детали — кому",
    "Подпись",
    190,
    NV_CANCEL_PARTS.map((p) => p.label),
  );
  add("NVD_REPORT_ACCEPTED", "Отчёт принят", "Значение", 110, NV_REPORT_ACCEPTED);
  add("NVD_CATEGORY", "Категории закупок", "Категория", 190, NV_CATEGORIES, { grow: true });
  add("NVD_SHOP", "Магазины", "Магазин", 170, NV_SHOPS, { grow: true });
  add("NVD_LOANER", "Подменный фонд", "Товар", 210, NV_LOANERS, { grow: true });
  add("NVD_RECEIPT_DOC", "Документ закупки", "Документ", 180, NV_RECEIPT_DOCS);
  add("NVD_PAID_WITH", "Оплата закупки", "Оплачено", 170, NV_PAID_WITH);
  add("NVD_ESF_STATUS", "Статус ЭСФ", "Статус", 120, NV_ESF_STATUSES);
  add("NVD_BOUGHT_BY", "Кто купил", "Купил", 110, NV_BOUGHT_BY);
  add("NVD_RESERVE_FUND", "Резервы: фонды", "Фонд", 140, NV_RESERVE_FUNDS);
  add("NVD_RESERVE_BASIS", "Резервы: основания", "Основание", 260, NV_RESERVE_BASES);
  add("NVD_SOURCE", "Источник записи", "Источник", 110, NV_SOURCES);
  add("NVD_OBJECT", "История: объект", "Объект", 110, NV_OBJECTS);
  add("NVD_ACTOR", "История: кто", "Кто", 110, NV_ACTORS);
  add("NVD_HOW", "История: как", "Как", 130, NV_HOW);
  add("NVD_WEBHOOK_RESULT", "Журнал: результат", "Результат", 120, NV_WEBHOOK_RESULTS);
  add("NVD_CHECK_RESULT", "Самопроверка", "Результат", 130, ["ОК", "Ошибка", "Предупреждение"]);
  add("NVD_PERIOD", "Панель: период", "Период", 140, NV_PERIODS);
  add("NVD_YEAR", "Панель: год", "Год", 80, NV_YEARS);
  add("NVD_OTHER_INCOME", "Прочий доход ИП", "Вид", 170, NV_OTHER_INCOME_KINDS, { grow: true });
  cols.push({
    name: "NV_HOLIDAYS",
    block: "Праздники РУз",
    title: "Дата",
    width: 110,
    values: [],
    grow: true,
    date: true,
    rows: 120,
  });
  return cols;
}

/** The checks of the domain guards that the script makes softly before a transition (text for the dictionary sheet). */
const NV_TRANSITION_CHECKS = {
  SEND_ESTIMATE: "смета заполнена; допуск «Полный цикл» или «Свободное окно»; сроки сметы",
  ACCEPT: "от имени клиента: ссылка на подтверждение обязательна",
  START_PURCHASE:
    "аванс и деньги на закупку получены; наступило «Закупка не раньше»; для первого заказа от 15 млн — встреча",
  PURCHASE_RECORDED: "чек в «Закупки»; чеки не больше полученных денег; выше лимита — согласие клиента",
  PURCHASE_DONE: "есть чеки по заказу",
  SEND_REPORT: "есть чеки; ставятся срок возражений +3 р. д. и возврат остатка +5 р. д.",
  OBJECTION: "срок возражений не истёк; текст обязателен",
  REMAINDER_SETTLED: "отчёт принят; нет возражения; сверка «Сходится»",
  HANDOVER: "подтверждён финал платы с фискальным чеком",
  CLOSE: "сверка «Сходится»; нет возражения",
  PODBOR_DELIVERED: "вид «Подбор»; подтверждена плата «Подбор» с чеком",
  CANCEL: "точка отмены по статусу; причина обязательна; при сборке — выполнено, бп",
  CANCEL_SETTLED: "возвращено не меньше «получено − чеки − потери»",
};

/** Where every dictionary column sits: a pure function, so a theme switch needs no rebuild. */
function nvDictPlacement() {
  const cols = nvDictColumns();
  let col = NV_LAYOUT.firstCol;
  let lastBlock = null;
  return cols.map((c) => {
    if (lastBlock !== null && c.block !== lastBlock) col += 1;
    const p = {
      def: c,
      name: c.name,
      col: col,
      width: c.width,
      block: c.block,
      date: !!c.date,
      code: !!c.code,
      count: Math.max(c.rows || (c.grow ? c.values.length + 30 : c.values.length), 1),
      blockStart: c.block !== lastBlock,
    };
    lastBlock = c.block;
    col += 1;
    return p;
  });
}

/** Writes the dictionary sheet (values only into empty columns, so the owner's edits stay) and the named ranges. */
function nvBuildDict() {
  const ss = nvSpreadsheet();
  const sh = nvSheet("dict");
  const L = NV_LAYOUT;
  const placed = nvDictPlacement();
  const needCols = placed[placed.length - 1].col + 2;
  if (sh.getMaxColumns() < needCols) sh.insertColumnsAfter(sh.getMaxColumns(), needCols - sh.getMaxColumns());
  const needRows = L.firstRow + 140;
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  placed.forEach((p) => {
    const c = p.def;
    const body = sh.getRange(L.firstRow, p.col, p.count, 1);
    const existing = body.getValues().filter((r) => r[0] !== "" && r[0] !== null).length;
    if (existing === 0 && c.values.length) {
      sh.getRange(L.firstRow, p.col, c.values.length, 1).setValues(c.values.map((v) => [v]));
    }
    ss.setNamedRange(c.name, body);
    sh.getRange(L.headerRow, p.col).setValue(c.title);
    sh.getRange(4, p.col).setValue(p.blockStart ? c.block : "");
  });
  return placed;
}

/** Range of a dictionary column by its name (the named range). */
function nvDictRange(name) {
  const r = nvSpreadsheet().getRangeByName(name);
  if (!r) throw new Error("Нет именованного диапазона " + name + ": запустите «Применить оформление»");
  return r;
}

/** Values of a dictionary column as an array (blanks dropped): the owner's labels win over the defaults. */
function nvDictValues(name) {
  return nvDictRange(name)
    .getValues()
    .map((r) => r[0])
    .filter((v) => v !== "" && v !== null && v !== undefined);
}

function nvStyleDict() {
  const sh = nvSheet("dict");
  const T = nvThemeFor("dict");
  const L = NV_LAYOUT;
  const maxCols = sh.getMaxColumns();
  const maxRows = sh.getMaxRows();
  sh.getRange(1, 1, maxRows, maxCols)
    .setBackground(T.bg)
    .setFontFamily(NV_FONT_TEXT)
    .setFontSize(10)
    .setFontColor(T.text)
    .setVerticalAlignment("middle");
  sh.setColumnWidth(1, L.gutterWidth);
  sh.setRowHeight(1, L.rowHeights.top);
  sh.setRowHeight(2, L.rowHeights.title);
  sh.setRowHeight(3, L.rowHeights.caption);
  sh.setRowHeight(4, 22);
  sh.setRowHeight(L.headerRow, L.rowHeights.header);
  sh.setRowHeights(L.firstRow, maxRows - L.firstRow + 1, 24);
  sh.getRange(2, L.firstCol).setRichTextValue(nvTitleRich("Справочники", T, 18));
  sh.getRange(3, L.firstCol)
    .setValue(
      "Подписи можно править, коды (латиница, моноширинные) — нет: формулы и скрипт ссылаются на коды. Списки в проверках данных берутся отсюда.",
    )
    .setFontSize(9)
    .setFontColor(T.text2);
  nvDictPlacement().forEach((p) => {
    sh.setColumnWidth(p.col, p.width);
    if (p.blockStart && p.col > L.firstCol) sh.setColumnWidth(p.col - 1, L.gutterWidth);
    const head = sh.getRange(L.headerRow, p.col);
    head
      .setBackground(T.head)
      .setFontWeight("bold")
      .setFontSize(9)
      .setFontColor(T.headText)
      .setWrap(true)
      .setVerticalAlignment("middle");
    nvBorder(head, "bottom", T.headRule, "SOLID_MEDIUM");
    const cap = sh.getRange(4, p.col);
    cap.setFontWeight("bold").setFontSize(10).setFontColor(T.accentText).setFontFamily(NV_FONT_TEXT).setWrap(false);
    const body = sh.getRange(L.firstRow, p.col, p.count, 1);
    body.setBackground(T.surface);
    nvRowLines(body, T.rowLine);
    if (p.code) body.setFontFamily(NV_FONT_MONO).setFontSize(9).setFontColor(T.text2);
    if (p.date) body.setNumberFormat(NV_FMT.date).setFontFamily(NV_FONT_MONO);
  });
  sh.setFrozenRows(L.headerRow);
  sh.setFrozenColumns(1);
  sh.setHiddenGridlines(true);
  sh.setTabColor("#A9A59C");
}
