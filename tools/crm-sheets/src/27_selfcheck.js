/**
 * Self-check: the sheets and the headers, the formulas of the headers, the names, the money cases of the domain,
 * the threshold, the reserves, the pairs of the payments, the statuses, the triggers, the properties (only "задано /
 * не задано"), the time zone, the fonts, the webhook. The result goes to the sheet "Самопроверка".
 */

/** The money cases of the owner's documents (fee by the scale, advance and final, podbor, the reserve). */
const NV_SELFCHECK_FEE = [
  [5000000, 750000],
  [10000000, 1500000],
  [15000000, 2250000],
  [19999999, 2999999],
  [20000000, 3000000],
  [25000000, 3000000],
  [40000000, 4000000],
  [60000000, 6000000],
];

function nvCheckRow(name, result, details) {
  return { check: name, result: result, details: details || "", time: nvNow() };
}

/** Runs the checks and returns the rows; nothing is written to a sheet here. */
function nvSelfCheckRows() {
  const rows = [];
  const ok = (name, details) => rows.push(nvCheckRow(name, "ОК", details));
  const bad = (name, details) => rows.push(nvCheckRow(name, "Ошибка", details));
  const warn = (name, details) => rows.push(nvCheckRow(name, "Предупреждение", details));
  const ss = nvSpreadsheet();
  const s = nvSettings(true);

  // Sheets
  const missing = Object.keys(NV_SN).filter((k) => !ss.getSheetByName(NV_SN[k]));
  if (missing.length) bad("Листы на месте", "нет: " + missing.map((k) => NV_SN[k]).join(", "));
  else ok("Листы на месте", Object.keys(NV_SN).length + " листов");
  if (missing.length) return rows;

  // Headers and the formulas of the headers
  const headerBad = [];
  const formulaBad = [];
  NV_TABLE_SHEETS.forEach((key) => {
    const def = NV_SCHEMA[key];
    const sh = nvSheet(key);
    const vals = sh.getRange(NV_LAYOUT.headerRow, NV_LAYOUT.firstCol, 1, def.cols.length).getValues()[0];
    const forms = sh.getRange(NV_LAYOUT.headerRow, NV_LAYOUT.firstCol, 1, def.cols.length).getFormulas()[0];
    def.cols.forEach((c, i) => {
      if (c.calc) {
        const expected = nvApiFormula(nvCalcFormula(key, c));
        if (forms[i] !== expected) formulaBad.push(def.title + "!" + c.title);
      } else if (vals[i] !== c.title) headerBad.push(def.title + ": «" + vals[i] + "» вместо «" + c.title + "»");
    });
  });
  if (headerBad.length) bad("Заголовки колонок", headerBad.slice(0, 6).join("; "));
  else ok("Заголовки колонок", "все колонки по структуре");
  if (formulaBad.length)
    bad(
      "Формулы в заголовках не стёрты",
      formulaBad.slice(0, 8).join("; ") + (formulaBad.length > 8 ? " и ещё " + (formulaBad.length - 8) : ""),
    );
  else
    ok(
      "Формулы в заголовках не стёрты",
      "вычисляемых колонок: " + NV_TABLE_SHEETS.reduce((a, k) => a + NV_SCHEMA[k].cols.filter((c) => c.calc).length, 0),
    );

  // Named ranges
  const names = nvSettingRows()
    .map((r) => r.name)
    .concat(
      nvDictColumns().map((c) => c.name),
      ["NV_ALERTS_BP", "P_PERIOD", "P_YEAR", "P_DEMO"],
      nvDataNames().map((n) => n[0]),
      ["TH_YEAR", "TH_LIMIT", "TH_VOLUME", "NV_RES_BAL_W", "NV_RES_RATE"],
    );
  const noName = names.filter((n) => !ss.getRangeByName(n));
  if (noName.length)
    bad(
      "Именованные диапазоны",
      "нет: " + noName.slice(0, 8).join(", ") + (noName.length > 8 ? " и ещё " + (noName.length - 8) : ""),
    );
  else ok("Именованные диапазоны", names.length + " имён");

  // Stage shares
  if (nvStageSharesOk(s)) ok("Доли этапов", "сумма 10 000 бп");
  else bad("Доли этапов", "сумма не равна 10 000 бп");

  // Money cases
  const feeBad = [];
  NV_SELFCHECK_FEE.forEach((c) => {
    const got = nvComputeFee({ basePc: c[0] }, s).total;
    if (got !== c[1]) feeBad.push(c[0] + " → " + got + " вместо " + c[1]);
  });
  const setupFee = nvComputeFee({ basePc: 17500000, baseMount: 7500000 }, s).total;
  if (setupFee !== 3750000) feeBad.push("сетап 17,5 + 7,5 млн → " + setupFee + " вместо 3750000");
  [5000000, 12345679, 31000001].forEach((b) => {
    const f = nvComputeFee({ basePc: b, baseMount: 777777 }, s);
    const q = nvComputeQuote({ kind: "ПК", basePc: b, baseMount: 777777, purchased: b }, s);
    if (q.advance + q.final !== f.total) feeBad.push("аванс + финал ≠ плата для " + b);
    if (f.commission + f.works !== f.total) feeBad.push("вознаграждение + работы ≠ плата для " + b);
    if (q.podborFee !== Math.floor((f.total * s.podborBp) / 10000)) feeBad.push("«Подбор» ≠ доля платы для " + b);
  });
  if (feeBad.length) bad("Контрольные случаи платы", feeBad.join("; "));
  else ok("Контрольные случаи платы", "8 случаев шкалы, сетап, аванс + финал, вознаграждение + работы, «Подбор»");

  // Threshold with the documented defaults
  const d = nvDefaultSettings();
  const t1 = [
    nvThresholdForYear(2026, Object.assign({}, d, { regDate: "2026-10-15", proportion: "Без дня регистрации" })),
    nvThresholdForYear(2026, Object.assign({}, d, { regDate: "2026-10-15", proportion: "С днём регистрации" })),
  ];
  const t2 = [
    nvThresholdForYear(2026, Object.assign({}, d, { regDate: "2026-11-01", proportion: "Без дня регистрации" })),
    nvThresholdForYear(2026, Object.assign({}, d, { regDate: "2026-11-01", proportion: "С днём регистрации" })),
  ];
  if (t1[0] === 210958904 && t1[1] === 213698630 && t2[0] === 164383561 && t2[1] === 167123287)
    ok("Порог года", "15.10.2026 → 210 958 904 и 213 698 630; 01.11.2026 → 164 383 561 и 167 123 287");
  else bad("Порог года", "получено " + t1.join(" / ") + " и " + t2.join(" / "));

  // Reserves
  const r1 = nvWarrantyContribution(1000000, { balance: 0, closedOrders: 0, lossesBp: 0 }, s);
  const r2 = nvWarrantyContribution(10000000, { balance: 0, closedOrders: 0, lossesBp: 0 }, s);
  if (r1 === 150000 && r2 === 200000) ok("Резерв гарантии", "1 млн → 150 000; 10 млн → 200 000");
  else bad("Резерв гарантии", "получено " + r1 + " и " + r2);

  // Pairs of the payments
  const pairs = [
    ["Аванс платы 30 %", "QR Xolis", "Подтверждён", "FS-1", "ОК"],
    ["Аванс платы 30 %", "Перевод на счёт ИП", "Ожидается", "", "Неверная пара: плата только QR или карта"],
    ["Деньги на закупку", "QR Xolis", "Ожидается", "", "Неверная пара: закупка только на счёт ИП"],
    ["Возврат остатка", "Перевод на счёт ИП", "Ожидается", "", "Неверная пара: возврат только переводом"],
    ["Финал платы 70 %", "QR Xolis", "Подтверждён", "", "Нужен фискальный чек"],
  ];
  const pairBad = pairs.filter((p) => nvCheckPayment(p[0], p[1], p[2], p[3]) !== p[4]);
  if (pairBad.length) bad("Пары платежей", "не сошлись случаев: " + pairBad.length);
  else ok("Пары платежей", NV_PAYMENT_KINDS.length + " видов");

  // Statuses: the dictionary of the sheet and the code
  const codes = nvDictValues("NVD_STATUS_CODE");
  const sameStatuses = codes.length === NV_STATUSES.length && NV_STATUSES.every((x) => codes.indexOf(x.code) >= 0);
  const trStatuses = NV_TRANSITIONS.every((t) => codes.indexOf(t.from) >= 0 && codes.indexOf(t.to) >= 0);
  if (sameStatuses && trStatuses) ok("Статусы заказа", NV_STATUSES.length + " статусов в справочнике и в автомате");
  else bad("Статусы заказа", "справочник " + codes.length + ", в коде " + NV_STATUSES.length);

  // Triggers
  const counts = nvTriggerCounts();
  const wrong = Object.keys(counts).filter((k) => counts[k] !== 1);
  if (wrong.length)
    bad(
      "Триггеры",
      "должен быть ровно один: " +
        wrong.map((k) => k + " (" + counts[k] + ")").join(", ") +
        "; меню Настройка → Установить триггеры",
    );
  else ok("Триггеры", "установлены ровно по одному");

  // Properties: only set / not set
  [
    [NV_PROP.telegramToken, "Токен Telegram"],
    [NV_PROP.telegramChat, "Чат Telegram"],
    [NV_PROP.ownerEmail, "Почта владельца"],
    [NV_PROP.hmacSecret, "Ключ вебхука"],
  ].forEach((p) => {
    if (nvHasProp(p[0])) ok(p[1], "задано");
    else warn(p[1], "не задано");
  });

  // Time zone, locale, fonts
  const tz = ss.getSpreadsheetTimeZone();
  if (tz === NV_TZ && ss.getSpreadsheetLocale() === NV_LOCALE) ok("Часовой пояс и локаль", tz + ", " + NV_LOCALE);
  else bad("Часовой пояс и локаль", tz + ", " + ss.getSpreadsheetLocale());
  const head = nvSheet("orders").getRange(NV_LAYOUT.headerRow, NV_LAYOUT.firstCol);
  const mono = nvSheet("orders").getRange(NV_LAYOUT.firstRow, NV_LAYOUT.firstCol);
  const fontOk =
    typeof head.getFontFamily !== "function" ||
    (head.getFontFamily() === NV_FONT_TEXT && mono.getFontFamily() === NV_FONT_MONO);
  if (fontOk) ok("Шрифты", NV_FONT_TEXT + " и " + NV_FONT_MONO);
  else warn("Шрифты", "не применены; если Fira Sans нет в списке шрифтов: Шрифт → Другие шрифты");

  // Webhook
  const last = Number(nvScriptProps().getProperty(NV_PROP.lastWebhookAt) || 0);
  if (s.webhookOn === true) {
    if (last && nvNow().getTime() - last <= 48 * 3600000)
      ok("Вебхук", "последнее событие " + nvFormat(new Date(last), "dd.MM.yyyy HH:mm"));
    else
      warn(
        "Вебхук",
        last ? "последнее событие старше 48 ч: " + nvFormat(new Date(last), "dd.MM.yyyy HH:mm") : "событий ещё не было",
      );
  } else ok("Вебхук", "интеграция выключена");

  // Counters against the numbers present
  const counterBad = [];
  [
    ["leads", "L"],
    ["orders", "NV"],
    ["warranty", "G"],
    ["payments", "P"],
    ["purchases", "Z"],
  ].forEach((c) => {
    const y = nvYear();
    const max = nvMaxNumber(c[0], c[1], y);
    const have = Number(nvScriptProps().getProperty(nvCounterKey(c[1], y, false)) || 0);
    if (max > have) counterBad.push(c[1] + ": счётчик " + have + ", в листе " + max);
  });
  if (counterBad.length)
    warn("Счётчики номеров", counterBad.join("; ") + " (номера платформы главнее: счётчик будет поднят)");
  else ok("Счётчики номеров", "счётчики не меньше номеров в листах");

  // Reconciliation of the orders that must reconcile
  const orders = nvReadTable("orders");
  const payments = nvReadTable("payments");
  const purchases = nvReadTable("purchases");
  const recBad = [];
  orders.forEach((o) => {
    if (["settled", "assembling", "testing", "ready", "delivering", "handed_over", "closed"].indexOf(o.code) < 0)
      return;
    const st = nvOrderState(o, payments, purchases, orders, s, []);
    if (st.recon !== "Сходится") recBad.push(o.num + ": " + st.recon);
  });
  if (recBad.length) warn("Сверка «получено = чеки + возвращено»", recBad.slice(0, 6).join("; "));
  else ok("Сверка «получено = чеки + возвращено»", "расхождений нет");
  return rows;
}

/** Runs the self-check and writes the report to "Самопроверка". Returns the counts. */
function nvSelfCheck() {
  const rows = nvSelfCheckRows();
  const sh = nvSheet("selfcheck");
  const count = (r) => rows.filter((x) => x.result === r).length;
  nvWithLock(() => {
    const rowsCap = sh.getMaxRows() - NV_LAYOUT.firstRow + 1;
    sh.getRange(NV_LAYOUT.firstRow, NV_LAYOUT.firstCol, rowsCap, NV_SCHEMA.selfcheck.cols.length).clearContent();
    nvWriteRowsMatrix("selfcheck", NV_LAYOUT.firstRow, rows);
    sh.setTabColor(count("Ошибка") > 0 ? NV_BRAND.orange : "#A9A59C");
  });
  return { errors: count("Ошибка"), warnings: count("Предупреждение"), ok: count("ОК"), rows: rows };
}
