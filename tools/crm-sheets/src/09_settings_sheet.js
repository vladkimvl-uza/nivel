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
  layout.forEach((item) => {
    const r = item.def;
    if (item.isGroup) {
      sh.getRange(item.row, NV_SET_COLS.label).setValue(r.group);
      return;
    }
    const valueCell = sh.getRange(item.row, NV_SET_COLS.value);
    sh.getRange(item.row, NV_SET_COLS.label, 1, 1).setValue(r.label);
    sh.getRange(item.row, NV_SET_COLS.unit, 1, 3).setValues([[r.unit, r.name, r.source]]);
    const exists = ss.getRangeByName(r.name);
    if (!exists) {
      if (r.type === "formula") valueCell.setFormula(r.formula);
      else if (r.type === "time" || (r.type === "text" && !r.list)) {
        valueCell.setNumberFormat("@").setValue(r.value);
      } else valueCell.setValue(r.value === "" ? "" : r.value);
      sh.getRange(item.row, NV_SET_COLS.changed).setValue(today);
      ss.setNamedRange(r.name, valueCell);
    }
  });
  // NV_ALERTS_BP: the five alert cells as one range.
  const alertRows = layout.filter((x) => x.def.alert).map((x) => x.row);
  if (alertRows.length)
    ss.setNamedRange("NV_ALERTS_BP", sh.getRange(alertRows[0], NV_SET_COLS.value, alertRows.length, 1));
  nvResetSettingsCache();
}

function nvSettingValidation(r) {
  const b = SpreadsheetApp.newDataValidation().setAllowInvalid(false);
  switch (r.type) {
    case "bp":
      return b
        .requireNumberBetween(0, 10000)
        .setHelpText("Целое число от 0 до 10 000 (базисные пункты, 1500 = 15 %)")
        .build();
    case "sum":
    case "int":
      return b.requireNumberGreaterThanOrEqualTo(0).setHelpText("Целое число не меньше 0").build();
    case "bool":
      return SpreadsheetApp.newDataValidation().requireCheckbox().build();
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
  const rules = [];
  const stageRows = layout.filter((x) => x.def.stage).map((x) => x.row);
  layout.forEach((item) => {
    const range = sh.getRange(item.row, NV_SET_COLS.label, 1, 6);
    if (item.isGroup) {
      range.setBackground(T.bg);
      sh.getRange(item.row, NV_SET_COLS.label).setFontWeight("bold").setFontColor(T.accentText).setFontSize(10);
      sh.setRowHeight(item.row, 30);
      sh.getRange(item.row, NV_SET_COLS.label).setVerticalAlignment("bottom");
      return;
    }
    const r = item.def;
    range.setBackground(item.row % 2 === 0 ? T.surface : T.band);
    nvRowLines(range, T.rowLine);
    sh.setRowHeight(item.row, 28);
    const value = sh.getRange(item.row, NV_SET_COLS.value);
    value.setFontFamily(NV_FONT_MONO).setHorizontalAlignment("right").setFontWeight("bold");
    if (r.type === "bp" || r.type === "int" || r.type === "formula") value.setNumberFormat("#,##0");
    else if (r.type === "sum") value.setNumberFormat(NV_FMT.sum);
    else if (r.type === "date") value.setNumberFormat(NV_FMT.date);
    else if (r.type === "bool") value.setHorizontalAlignment("center");
    if (r.type === "formula") value.setBackground(T.headCalc);
    if (r.readonly) value.setFontColor(T.text2);
    sh.getRange(item.row, NV_SET_COLS.name).setFontFamily(NV_FONT_MONO).setFontSize(9).setFontColor(T.text2);
    sh.getRange(item.row, NV_SET_COLS.unit).setFontColor(T.text2).setHorizontalAlignment("left");
    sh.getRange(item.row, NV_SET_COLS.source).setFontColor(T.text2).setFontSize(9);
    sh.getRange(item.row, NV_SET_COLS.changed)
      .setNumberFormat(NV_FMT.date)
      .setFontFamily(NV_FONT_MONO)
      .setFontSize(9)
      .setFontColor(T.text2)
      .setHorizontalAlignment("left");
    const dv = r.readonly || r.type === "formula" ? null : nvSettingValidation(r);
    if (dv) value.setDataValidation(dv);
  });
  if (stageRows.length) {
    const first = stageRows[0];
    const range = sh.getRange(first, NV_SET_COLS.value, stageRows.length, 1);
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
