/**
 * "Калькулятор": a quick estimate in a conversation, without creating an order, and the reverse calculation
 * "budget -> parts". The formulas are the scalar templates of the "Заказы" columns with the cells of this sheet.
 */

/** Input cells (column C) and result cells (column F). */
const NV_CALC = {
  inputs: {
    kind: { row: 6, label: "Вид", type: "kind" },
    basePc: { row: 7, label: "База ПК, сум", type: "sum" },
    baseMount: { row: 8, label: "База монтаж, сум", type: "sum" },
    outside: { row: 9, label: "Вне шкалы (лицензии, доставка, партнёры), сум", type: "sum" },
    purchased: { row: 10, label: "Закупает ИП, сум", type: "sum" },
    memory: { row: 11, label: "Из них память и SSD, сум", type: "sum" },
    complex: { row: 12, label: "Сложная сборка", type: "flag" },
    freeWindow: { row: 13, label: "Свободное окно", type: "flag" },
  },
  results: [
    ["feePc", "Плата ПК", "sum"],
    ["feeMount", "Плата монтаж", "sum"],
    ["feeTotal", "Плата итого", "sum"],
    ["feeRate", "Ставка факт", "pct2"],
    ["commission", "Вознаграждение (строка 1)", "sum"],
    ["works", "Работы (строка 2)", "sum"],
    ["advance", "Аванс 30 %", "sum"],
    ["final", "Финал 70 %", "sum"],
    ["reserveBp", "Резерв, бп", "int"],
    ["reserveSum", "Резерв на рост цен", "sum"],
    ["purchaseLimit", "Лимит закупки", "sum"],
    ["grand", "Итого клиенту", "sum"],
    ["eligibility", "Допуск", "text"],
    ["podborFee", "«Подбор» (плата)", "sum"],
    ["meeting", "Встреча (если первый заказ)", "text"],
  ],
  firstResultRow: 6,
  reverse: { head: 22, budget: 23, reserveBp: 24, parts: 25, fee: 26, reserve: 27, total: 28 },
  check: { head: 31, first: 32 },
};

/** Cell address of an input or result by key (with $). */
function nvCalcCell(key) {
  const inp = NV_CALC.inputs[key];
  if (inp) return "$C$" + inp.row;
  const i = NV_CALC.results.findIndex((r) => r[0] === key);
  if (i >= 0) return "$F$" + (NV_CALC.firstResultRow + i);
  throw new Error("Unknown calculator key " + key);
}

/** The scalar template of an Orders column with [key] replaced by the cells of the calculator. */
function nvCalcTemplate(colKey) {
  const col = NV_SCHEMA.orders.cols.find((c) => c.key === colKey);
  if (!col?.calc) throw new Error("No template for " + colKey);
  return col.calc.replace(/\[([A-Za-z][A-Za-z0-9]*)\]/g, (_, k) => {
    if (k === "slot") return "IF(" + nvCalcCell("freeWindow") + '; "Свободное окно"; "Обычный")';
    if (k === "created" || k === "client" || k === "num") return '""';
    return nvCalcCell(k);
  });
}

/** Formulas of the result block in ru_RU notation, by key. */
function nvCalcFormulas() {
  const f = {};
  NV_CALC.results.forEach((r) => {
    if (r[0] === "meeting") {
      f.meeting = "=IF(" + nvCalcCell("grand") + '>=NV_MEETING_FROM; "Нужна, если первый заказ"; "Нет")';
    } else f[r[0]] = "=" + nvCalcTemplate(r[0]);
  });
  return f;
}

/** The expected values of the scale check: [label, expected, formula]. */
function nvCalcCheckCases() {
  const pc = (base) =>
    "IF(" +
    base +
    "<NV_PC_THRESHOLD; QUOTIENT(" +
    base +
    "*NV_PC_LOW_BP; 10000); MAX(QUOTIENT(" +
    base +
    "*NV_PC_HIGH_BP; 10000); NV_PC_HIGH_MIN_FEE))";
  return [
    ["ПК 5 млн", 750000, "=" + pc("5000000")],
    ["ПК 25 млн", 3000000, "=" + pc("25000000")],
    ["ПК 40 млн", 4000000, "=" + pc("40000000")],
    ["Сетап 17,5 + 7,5 млн", 3750000, "=" + pc("17500000") + "+QUOTIENT(7500000*NV_MOUNT_BP; 10000)"],
  ];
}

function nvBuildCalc() {
  const ss = nvSpreadsheet();
  const sh = nvSheet("calc");
  const L = NV_LAYOUT;
  if (sh.getMaxRows() < 40) sh.insertRowsAfter(sh.getMaxRows(), 40 - sh.getMaxRows());
  if (sh.getMaxColumns() < 8) sh.insertColumnsAfter(sh.getMaxColumns(), 8 - sh.getMaxColumns());
  sh.getRange(4, 2).setValue("Исходные данные");
  sh.getRange(4, 5).setValue("Результат");
  sh.getRange(L.headerRow, 2, 1, 2).setValues([["Параметр", "Значение"]]);
  sh.getRange(L.headerRow, 5, 1, 2).setValues([["Показатель", "Значение"]]);
  Object.keys(NV_CALC.inputs).forEach((k) => {
    const inp = NV_CALC.inputs[k];
    sh.getRange(inp.row, 2).setValue(inp.label);
    const cell = sh.getRange(inp.row, 3);
    if (inp.type === "kind") {
      if (cell.getValue() === "") cell.setValue("ПК");
      cell.setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInRange(nvDictRange("NVD_KIND"), true)
          .setAllowInvalid(false)
          .build(),
      );
    } else if (inp.type === "flag") {
      cell.setDataValidation(nvCheckboxRule());
    } else {
      cell.setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireFormulaSatisfied(
            nvApiFormula(
              "=AND(ISNUMBER(C" +
                inp.row +
                "); C" +
                inp.row +
                "=INT(C" +
                inp.row +
                "); C" +
                inp.row +
                ">=0; C" +
                inp.row +
                "<=" + nvIndirectName("NV_MAX_BUDGET") + ")",
            ),
          )
          .setAllowInvalid(false)
          .setHelpText("Целое число не меньше 0")
          .build(),
      );
    }
    nvSetName(ss, "CALC_" + k.toUpperCase(), cell);
  });
  const formulas = nvCalcFormulas();
  NV_CALC.results.forEach((r, i) => {
    const row = NV_CALC.firstResultRow + i;
    sh.getRange(row, 5).setValue(r[1]);
    sh.getRange(row, 6).setFormula(nvApiFormula(formulas[r[0]]));
  });
  // Reverse calculation: budget -> parts
  const rv = NV_CALC.reverse;
  sh.getRange(rv.head - 1, 2).setValue("Обратный расчёт: бюджет клиента → детали");
  sh.getRange(rv.head, 2, 1, 2).setValues([["Параметр", "Значение"]]);
  sh.getRange(rv.budget, 2).setValue("Бюджет клиента, сум");
  sh.getRange(rv.reserveBp, 2).setValue("Резерв, бп");
  sh.getRange(rv.parts, 2).setValue("На детали можно");
  sh.getRange(rv.fee, 2).setValue("Плата по шкале ПК");
  sh.getRange(rv.reserve, 2).setValue("Резерв на рост цен");
  sh.getRange(rv.total, 2).setValue("Итого (проверка = бюджет или чуть меньше)");
  sh.getRange(rv.reserveBp, 3).setFormula("=NV_RESERVE_BP");
  sh.getRange(rv.budget, 3).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied(
        nvApiFormula(
          "=AND(ISNUMBER(C" +
            rv.budget +
            "); C" +
            rv.budget +
            "=INT(C" +
            rv.budget +
            "); C" +
            rv.budget +
            ">=0; C" +
            rv.budget +
            "<=" + nvIndirectName("NV_MAX_BUDGET") + ")",
        ),
      )
      .setAllowInvalid(false)
      .setHelpText("Целое число от 0 до 1 000 000 000 000")
      .build(),
  );
  const b = "$C$" + rv.budget;
  const bp = "$C$" + rv.reserveBp;
  const parts = "$C$" + rv.parts;
  sh.getRange(rv.parts, 3).setFormula(
    nvApiFormula(
      "=IF(" +
        b +
        '=""; ""; NIVEL_PARTS_FROM_BUDGET(' +
        b +
        "; " +
        bp +
        "; NV_PC_LOW_BP; NV_PC_HIGH_BP; NV_PC_THRESHOLD; NV_PC_HIGH_MIN_FEE; NV_RESERVE_STEP; NV_MAX_BUDGET))",
    ),
  );
  sh.getRange(rv.fee, 3).setFormula(
    nvApiFormula(
      "=IF(" +
        parts +
        '=""; ""; IF(' +
        parts +
        "<NV_PC_THRESHOLD; QUOTIENT(" +
        parts +
        "*NV_PC_LOW_BP; 10000); MAX(QUOTIENT(" +
        parts +
        "*NV_PC_HIGH_BP; 10000); NV_PC_HIGH_MIN_FEE)))",
    ),
  );
  sh.getRange(rv.reserve, 3).setFormula(
    nvApiFormula("=IF(" + parts + '=""; ""; CEILING(QUOTIENT(' + parts + "*" + bp + "+9999; 10000); NV_RESERVE_STEP))"),
  );
  sh.getRange(rv.total, 3).setFormula(
    nvApiFormula("=IF(" + parts + '=""; ""; ' + parts + "+C" + rv.fee + "+C" + rv.reserve + ")"),
  );
  nvSetName(ss, "CALC_BUDGET", sh.getRange(rv.budget, 3));
  nvSetName(ss, "CALC_PARTS", sh.getRange(rv.parts, 3));
  // Self-check of the scale
  const ch = NV_CALC.check;
  sh.getRange(ch.head - 1, 2).setValue("Самопроверка шкалы");
  sh.getRange(ch.head, 2, 1, 5).setValues([["Случай", "Ожидается", "", "Получилось", "Результат"]]);
  nvCalcCheckCases().forEach((cse, i) => {
    const row = ch.first + i;
    sh.getRange(row, 2).setValue(cse[0]);
    sh.getRange(row, 3).setValue(cse[1]);
    sh.getRange(row, 5).setFormula(nvApiFormula(cse[2]));
    sh.getRange(row, 6).setFormula(nvApiFormula("=IF(E" + row + "=C" + row + '; "ОК"; "Ошибка")'));
  });
  sh.getRange(3, 2).setValue(
    "Смета в разговоре с клиентом без создания заказа. Меню «Nivel CRM → Создать заказ из калькулятора» переносит ввод в новый заказ.",
  );
}

function nvStyleCalc() {
  const sh = nvSheet("calc");
  const T = nvThemeFor("calc");
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
  [330, 190, 16, 250, 190, 16].forEach((w, i) => {
    sh.setColumnWidth(2 + i, w);
  });
  sh.setColumnWidths(8, Math.max(1, maxCols - 7), L.gutterWidth);
  sh.setRowHeight(1, L.rowHeights.top);
  sh.setRowHeight(2, L.rowHeights.title);
  sh.setRowHeight(3, L.rowHeights.caption);
  sh.setRowHeight(4, 26);
  sh.setRowHeights(L.headerRow, 1, L.rowHeights.header);
  sh.setRowHeights(L.firstRow, maxRows - L.firstRow + 1, 28);
  sh.getRange(2, L.firstCol).setRichTextValue(nvTitleRich("Калькулятор", T, 18));
  sh.getRange(3, L.firstCol).setFontSize(9).setFontColor(T.text2).setWrap(false);
  const heads = [
    [L.headerRow, 2, 2],
    [L.headerRow, 5, 2],
    [NV_CALC.reverse.head, 2, 2],
    [NV_CALC.check.head, 2, 5],
  ];
  heads.forEach((h) => {
    const r = sh.getRange(h[0], h[1], 1, h[2]);
    r.setBackground(T.head)
      .setFontWeight("bold")
      .setFontSize(9)
      .setFontColor(T.headText)
      .setVerticalAlignment("middle");
    nvBorder(r, "bottom", T.headRule, "SOLID_MEDIUM");
  });
  [
    [4, 2, "Исходные данные"],
    [4, 5, "Результат"],
    [NV_CALC.reverse.head - 1, 2, ""],
    [NV_CALC.check.head - 1, 2, ""],
  ].forEach((t) => {
    sh.getRange(t[0], t[1])
      .setFontWeight("bold")
      .setFontColor(T.accentText)
      .setFontSize(10)
      .setVerticalAlignment("bottom");
  });
  // Input cells: white (or deep warm in the night theme) with a 2 px orange line below
  const inputs = [
    sh.getRange(NV_CALC.inputs.kind.row, 3, 8, 1),
    sh.getRange(NV_CALC.reverse.budget, 3),
    sh.getRange(NV_CALC.reverse.reserveBp, 3),
  ];
  inputs.forEach((r) => {
    r.setBackground(T.input).setFontFamily(NV_FONT_MONO).setFontWeight("bold").setHorizontalAlignment("right");
    // A 2 px orange line under every input cell (bottom edge and the lines between the cells)
    r.setBorder(null, null, true, null, null, true, T.accent, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  });
  Object.keys(NV_CALC.inputs).forEach((k) => {
    const inp = NV_CALC.inputs[k];
    const cell = sh.getRange(inp.row, 3);
    if (inp.type === "sum") cell.setNumberFormat(NV_FMT.sum);
    if (inp.type === "flag") cell.setHorizontalAlignment("center");
    if (inp.type === "kind") cell.setFontFamily(NV_FONT_TEXT).setHorizontalAlignment("left");
  });
  sh.getRange(NV_CALC.reverse.budget, 3).setNumberFormat(NV_FMT.sum);
  sh.getRange(NV_CALC.reverse.reserveBp, 3).setNumberFormat("#,##0");
  // Results: paper with mono numbers
  const results = sh.getRange(NV_CALC.firstResultRow, 5, NV_CALC.results.length, 2);
  results.setBackground(T.surface);
  nvRowLines(results, T.rowLine);
  NV_CALC.results.forEach((r, i) => {
    const row = NV_CALC.firstResultRow + i;
    const cell = sh.getRange(row, 6);
    cell
      .setFontFamily(r[2] === "text" ? NV_FONT_TEXT : NV_FONT_MONO)
      .setHorizontalAlignment("right")
      .setFontWeight(r[0] === "grand" || r[0] === "feeTotal" ? "bold" : "normal");
    cell.setNumberFormat(r[2] === "sum" ? NV_FMT.sum : r[2] === "pct2" ? NV_FMT.pct2 : r[2] === "int" ? "#,##0" : "@");
    if (i % 2 === 1) sh.getRange(row, 5, 1, 2).setBackground(T.band);
  });
  sh.getRange(NV_CALC.firstResultRow + NV_CALC.results.length - 1, 6).setHorizontalAlignment("right");
  const rv = sh.getRange(NV_CALC.reverse.parts, 2, 5, 2);
  rv.setBackground(T.surface);
  nvRowLines(rv, T.rowLine);
  sh.getRange(NV_CALC.reverse.parts, 3, 5, 1)
    .setFontFamily(NV_FONT_MONO)
    .setHorizontalAlignment("right")
    .setNumberFormat(NV_FMT.sum)
    .setFontWeight("bold");
  sh.getRange(NV_CALC.reverse.parts, 2, 1, 2).setFontWeight("bold");
  const ch = sh.getRange(NV_CALC.check.first, 2, 4, 5);
  ch.setBackground(T.surface);
  nvRowLines(ch, T.rowLine);
  sh.getRange(NV_CALC.check.first, 3, 4, 1)
    .setFontFamily(NV_FONT_MONO)
    .setNumberFormat(NV_FMT.sum)
    .setHorizontalAlignment("right");
  sh.getRange(NV_CALC.check.first, 5, 4, 1)
    .setFontFamily(NV_FONT_MONO)
    .setNumberFormat(NV_FMT.sum)
    .setHorizontalAlignment("right");
  sh.getRange(NV_CALC.check.first, 6, 4, 1).setFontFamily(NV_FONT_MONO).setHorizontalAlignment("right");
  sh.setConditionalFormatRules([
    nvRule(sh.getRange(NV_CALC.check.first, 6, 4, 1), "=$F" + NV_CALC.check.first + '="Ошибка"', {
      bg: T.overdueFill,
      color: T.overdueText,
      bold: true,
    }),
    nvRule(
      sh.getRange(NV_CALC.firstResultRow + 12, 6),
      "=OR(LEFT($F" +
        (NV_CALC.firstResultRow + 12) +
        ';6)="Только"; ISNUMBER(SEARCH("ниже минимума"; $F' +
        (NV_CALC.firstResultRow + 12) +
        ")))",
      { color: T.accentText, bold: true },
    ),
  ]);
  sh.setFrozenRows(L.headerRow);
  sh.setHiddenGridlines(true);
  sh.setTabColor(null);
}

/**
 * Custom function of the sheet: the largest base of the parts whose total (base + PC-scale fee + reserve) fits the budget.
 * Pure arithmetic over the arguments, so the sheet recalculates it when a setting changes.
 * @customfunction
 */
function NIVEL_PARTS_FROM_BUDGET(
  budget,
  reserveBp,
  pcLowBp,
  pcHighBp,
  pcThreshold,
  pcHighMinFee,
  reserveStep,
  maxBudget,
) {
  if (budget === "" || budget === null || budget === undefined) return "";
  const s = {
    pcLowBp: Number(pcLowBp),
    pcHighBp: Number(pcHighBp),
    pcThreshold: Number(pcThreshold),
    pcHighMinFee: Number(pcHighMinFee),
    reserveStep: Number(reserveStep),
    maxBudget: Number(maxBudget),
    complexBp: 0,
  };
  return nvPartsFromBudget(Number(budget), s, Number(reserveBp));
}

/** Creates an order from the calculator input (menu). */
function nvOrderFromCalculator() {
  const sh = nvSheet("calc");
  const get = (k) => sh.getRange(NV_CALC.inputs[k].row, 3).getValue();
  const kind = nvStr(get("kind")) || "ПК";
  const num = (k) => {
    const n = nvNum(get(k));
    return Number.isFinite(n) ? n : 0;
  };
  return nvCreateOrder({
    kind: kind,
    basePc: num("basePc"),
    baseMount: num("baseMount"),
    outside: num("outside"),
    purchased: num("purchased"),
    memory: num("memory"),
    complex: get("complex") === true,
    slot: get("freeWindow") === true ? "Свободное окно" : "Обычный",
    notes: "Создан из калькулятора",
  });
}
