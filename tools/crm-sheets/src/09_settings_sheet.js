/**
 * "Настройки": parameter, value, unit, name NV_*, source, date of change. Each value cell is a named range.
 * Settings are only written when the name does not exist yet, so a re-run never overwrites the owner's values.
 */

const NV_SET_COLS = { label: 2, value: 3, unit: 4, name: 5, source: 6, changed: 7 };

/** Rows of the settings sheet: group headings and parameters, from the first data row. */
function nvSettingsLayout() {
  let row = NV_LAYOUT.firstRow;
  return NV_SETTINGS.map((r) => {
    const o = { def: r, row: row, isGroup: !r.name };
    row += 1;
    return o;
  });
}

function nvBuildSettings() {
  const ss = nvSpreadsheet();
  const sh = nvSheet("settings");
  const L = NV_LAYOUT;
  const layout = nvSettingsLayout();
  const needRows = L.firstRow + layout.length + 6;
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  if (sh.getMaxRows() > needRows) sh.deleteRows(needRows + 1, sh.getMaxRows() - needRows);
  if (sh.getMaxColumns() < 8) sh.insertColumnsAfter(sh.getMaxColumns(), 8 - sh.getMaxColumns());
  const titles = ["Параметр", "Значение", "Ед.", "Имя в формулах", "Источник", "Дата изменения"];
  sh.getRange(L.headerRow, NV_SET_COLS.label, 1, 6).setValues([titles]);
  const today = nvToday();
  const known = nvNamedMap(ss);
  const params = layout.filter((x) => !x.isGroup);
  const missing = params.filter((x) => !known[x.def.name]);
  if (missing.length === params.length) {
    // A new book: the whole block in two calls (the text cells get the text format first, so "10:00" stays text)
    nvSetFormatRuns(
      sh,
      L.firstRow,
      NV_SET_COLS.value,
      layout.map((x) => (!x.isGroup && (x.def.type === "time" || x.def.type === "text") ? "@" : null)),
    );
    const matrix = layout.map((x) => {
      const r = x.def;
      if (x.isGroup) return [r.group, "", "", "", "", ""];
      const value = r.type === "formula" ? r.formula : r.value;
      return [r.label, value, r.unit, r.name, r.source, today];
    });
    nvWriteMatrix(sh.getRange(L.firstRow, NV_SET_COLS.label, layout.length, 6), matrix);
  } else {
    // A later run: only the settings that are not there yet (the owner's values stay)
    missing.forEach((item) => {
      const r = item.def;
      const valueCell = sh.getRange(item.row, NV_SET_COLS.value);
      sh.getRange(item.row, NV_SET_COLS.label).setValue(r.label);
      sh.getRange(item.row, NV_SET_COLS.unit, 1, 3).setValues([[r.unit, r.name, r.source]]);
      if (r.type === "formula") valueCell.setFormula(r.formula);
      else if (r.type === "time" || r.type === "text") valueCell.setNumberFormat("@").setValue(r.value);
      else valueCell.setValue(r.value);
      sh.getRange(item.row, NV_SET_COLS.changed).setValue(today);
    });
  }
  params.forEach((item) => {
    nvSetName(ss, item.def.name, sh.getRange(item.row, NV_SET_COLS.value));
  });
  // NV_ALERTS_BP: the five alert cells as one range.
  const alertRows = layout.filter((x) => x.def.alert).map((x) => x.row);
  if (alertRows.length)
    nvSetName(ss, "NV_ALERTS_BP", sh.getRange(alertRows[0], NV_SET_COLS.value, alertRows.length, 1));
  nvResetSettingsCache();
}

/**
 * The rule of one setting cell. requireNumberBetween and requireNumberGreaterThanOrEqualTo do not ask for a whole
 * number (1500,5 would pass), so whole numbers are a formula about the cell of this row.
 */
function nvSettingValidation(r, row) {
  const b = SpreadsheetApp.newDataValidation().setAllowInvalid(false);
  const cell = "C" + row;
  const whole = "ISNUMBER(" + cell + "); " + cell + "=INT(" + cell + "); " + cell + ">=0";
  switch (r.type) {
    case "bp":
      return b
        .requireFormulaSatisfied(nvApiFormula("=AND(" + whole + "; " + cell + "<=10000)"))
        .setHelpText("Целое число от 0 до 10 000 (базисные пункты, 1500 = 15 %)")
        .build();
    case "sum":
    case "int":
      return b
        .requireFormulaSatisfied(nvApiFormula("=AND(" + whole + ")"))
        .setHelpText("Целое число не меньше 0")
        .build();
    case "bool":
      return nvCheckboxRule();
    case "date":
      return b.requireDate().setHelpText("Дата").build();
    case "text":
      if (r.list) return b.requireValueInList(r.list, true).build();
      return null;
    default:
      return null;
  }
}

function nvStyleSettings() {
  const sh = nvSheet("settings");
  const T = nvThemeFor("settings");
  const L = NV_LAYOUT;
  const layout = nvSettingsLayout();
  const n = layout.length;
  const first = L.firstRow;
  const maxRows = sh.getMaxRows();
  const maxCols = sh.getMaxColumns();
  sh.getRange(1, 1, maxRows, maxCols)
    .setBackground(T.bg)
    .setFontFamily(NV_FONT_TEXT)
    .setFontSize(10)
    .setFontColor(T.text)
    .setVerticalAlignment("middle");
  sh.setColumnWidth(1, L.gutterWidth);
  [340, 170, 70, 260, 170, 130].forEach((w, i) => {
    sh.setColumnWidth(NV_SET_COLS.label + i, w);
  });
  sh.setColumnWidths(8, Math.max(1, maxCols - 7), L.gutterWidth);
  sh.setRowHeight(1, L.rowHeights.top);
  sh.setRowHeight(2, L.rowHeights.title);
  sh.setRowHeight(3, L.rowHeights.caption);
  sh.setRowHeight(4, L.rowHeights.gap);
  sh.setRowHeight(L.headerRow, L.rowHeights.header);
  sh.getRange(2, L.firstCol).setRichTextValue(nvTitleRich("Настройки", T, 18));
  sh.getRange(3, L.firstCol)
    .setValue(
      "Денежные правила и сроки: копия DEFAULT_FEE_SETTINGS (версия 2026-10-05) и правил порога и резервов. Секретов здесь нет: токены и ключ вебхука — в свойствах скрипта.",
    )
    .setFontSize(9)
    .setFontColor(T.text2);
  const head = sh.getRange(L.headerRow, NV_SET_COLS.label, 1, 6);
  head
    .setBackground(T.head)
    .setFontWeight("bold")
    .setFontSize(9)
    .setFontColor(T.headText)
    .setVerticalAlignment("middle");
  nvBorder(head, "bottom", T.headRule, "SOLID_MEDIUM");

  // The body in whole columns: the rows differ only in the matrices below
  const block = sh.getRange(first, NV_SET_COLS.label, n, 6);
  block.setBackgrounds(
    layout.map((x) => {
      const bg = x.isGroup ? T.bg : x.row % 2 === 0 ? T.surface : T.band;
      const row = new Array(6).fill(bg);
      if (!x.isGroup && x.def.type === "formula") row[1] = T.headCalc;
      return row;
    }),
  );
  nvRowLines(block, T.rowLine);
  sh.setRowHeights(first, n, 28);
  layout.forEach((x) => {
    if (!x.isGroup) return;
    sh.getRange(x.row, NV_SET_COLS.label, 1, 6).setBorder(false, false, false, false, false, false);
    sh.setRowHeight(x.row, 30);
    sh.getRange(x.row, NV_SET_COLS.label).setVerticalAlignment("bottom");
  });
  const labels = sh.getRange(first, NV_SET_COLS.label, n, 1);
  labels.setFontWeights(layout.map((x) => [x.isGroup ? "bold" : "normal"]));
  labels.setFontColors(layout.map((x) => [x.isGroup ? T.accentText : T.text]));
  const values = sh.getRange(first, NV_SET_COLS.value, n, 1);
  values.setFontFamily(NV_FONT_MONO).setFontWeight("bold");
  values.setHorizontalAlignments(layout.map((x) => [!x.isGroup && x.def.type === "bool" ? "center" : "right"]));
  values.setFontColors(layout.map((x) => [!x.isGroup && x.def.readonly ? T.text2 : T.text]));
  nvSetFormatRuns(
    sh,
    first,
    NV_SET_COLS.value,
    layout.map((x) => {
      if (x.isGroup) return null;
      const t = x.def.type;
      if (t === "bp" || t === "int" || t === "formula") return "#,##0";
      if (t === "sum") return NV_FMT.sum;
      if (t === "date") return NV_FMT.date;
      if (t === "time" || t === "text") return "@";
      return null;
    }),
  );
  values.setDataValidations(
    layout.map((x) => [
      x.isGroup || x.def.readonly || x.def.type === "formula" ? null : nvSettingValidation(x.def, x.row),
    ]),
  );
  sh.getRange(first, NV_SET_COLS.unit, n, 1).setFontColor(T.text2).setHorizontalAlignment("left");
  sh.getRange(first, NV_SET_COLS.name, n, 1).setFontFamily(NV_FONT_MONO).setFontSize(9).setFontColor(T.text2);
  sh.getRange(first, NV_SET_COLS.source, n, 1).setFontColor(T.text2).setFontSize(9);
  sh.getRange(first, NV_SET_COLS.changed, n, 1)
    .setNumberFormat(NV_FMT.date)
    .setFontFamily(NV_FONT_MONO)
    .setFontSize(9)
    .setFontColor(T.text2)
    .setHorizontalAlignment("left");
  layout.forEach((x) => {
    if (x.isGroup) sh.getRange(x.row, NV_SET_COLS.label).setFontSize(10).setFontFamily(NV_FONT_TEXT);
  });

  const rules = [];
  const stageRows = layout.filter((x) => x.def.stage).map((x) => x.row);
  if (stageRows.length) {
    const range = sh.getRange(stageRows[0], NV_SET_COLS.value, stageRows.length, 1);
    const f = "=SUM($C$" + stageRows[0] + ":$C$" + stageRows[stageRows.length - 1] + ")<>10000";
    rules.push(nvRule(range, f, { bg: T.overdueFill, color: T.overdueText, bold: true }));
  }
  sh.setConditionalFormatRules(rules);
  sh.setFrozenRows(L.headerRow);
  sh.setHiddenGridlines(true);
  sh.setTabColor("#A9A59C");
}

/** Does the sum of the stage shares equal 10 000 (the self-check and the cancellation rely on it). */
function nvStageSharesOk(s) {
  return s.stageSelectionBp + s.stagePurchaseBp + s.stageAssemblyBp + s.stageHandoverBp === 10000;
}
