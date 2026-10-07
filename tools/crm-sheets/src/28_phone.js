/**
 * "Телефон": the six figures of the owner, one under another, in the width of a phone (A + B + C = 396 px). The panel is a
 * grid of four tiles in a row and charts of 576 px: in the app of Google Sheets on a phone it does not fit. This sheet reads
 * the same cells of "_Данные" as the tiles of the panel, so the numbers are the same everywhere. Read only.
 */

const NV_PHONE = {
  gutter: 12,
  labelWidth: 200,
  valueWidth: 184,
  firstRow: 5,
  block: 4,
  keys: ["fee", "funds", "wip", "leads", "overdue", "threshold"],
  helperCol: 5,
  heights: { top: 10, title: 40, caption: 20, gap: 8, label: 22, value: 38, line: 22 },
};

/** Row of the first cell of the block of a figure. */
function nvPhoneRow(index) {
  return NV_PHONE.firstRow + index * NV_PHONE.block;
}

function nvBuildPhone() {
  const sh = nvSheet("phone");
  const P = NV_PHONE;
  const needRows = P.firstRow + P.keys.length * P.block;
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  else if (sh.getMaxRows() > needRows) sh.deleteRows(needRows + 1, sh.getMaxRows() - needRows);
  const needCols = P.helperCol + 1;
  if (sh.getMaxColumns() < needCols) sh.insertColumnsAfter(sh.getMaxColumns(), needCols - sh.getMaxColumns());
  else if (sh.getMaxColumns() > needCols) sh.deleteColumns(needCols + 1, sh.getMaxColumns() - needCols);
  sh.getRange(2, 2).setValue("Сейчас");
  sh.getRange(3, 2).setFormula("=" + nvDataRef("B", NV_ND.params + 9));
  P.keys.forEach((key, i) => {
    const tile = NV_TILES.find((t) => t.key === key);
    const row = nvKpiRow(key);
    const r = nvPhoneRow(i);
    sh.getRange(r, 2).setValue(tile.label);
    sh.getRange(r + 1, 2).setFormula(nvApiFormula("=" + nvDataRef("B", row)));
    sh.getRange(r + 2, 2).setFormula(nvApiFormula("=" + nvDataRef("D", row)));
    sh.getRange(r + 1, P.helperCol).setFormula(nvApiFormula("=" + nvDataRef("E", row)));
    for (let k = 0; k < 3; k++) sh.getRange(r + k, 2, 1, 2).merge();
  });
  sh.getRange(2, 2, 1, 2).merge();
  sh.getRange(3, 2, 1, 2).merge();
}

function nvStylePhone() {
  const sh = nvSheet("phone");
  const T = nvThemeFor("phone");
  const P = NV_PHONE;
  const maxRows = sh.getMaxRows();
  const maxCols = sh.getMaxColumns();
  sh.getRange(1, 1, maxRows, maxCols)
    .setBackground(T.bg)
    .setFontFamily(NV_FONT_TEXT)
    .setFontSize(10)
    .setFontColor(T.text)
    .setVerticalAlignment("middle");
  sh.setColumnWidth(1, P.gutter);
  sh.setColumnWidth(2, P.labelWidth);
  sh.setColumnWidth(3, P.valueWidth);
  sh.setColumnWidth(4, P.gutter);
  sh.setColumnWidth(P.helperCol, P.gutter);
  sh.hideColumns(P.helperCol);
  sh.setRowHeight(1, P.heights.top);
  sh.setRowHeight(2, P.heights.title);
  sh.setRowHeight(3, P.heights.caption);
  sh.setRowHeight(4, P.heights.gap);
  sh.getRange(2, 2).setRichTextValue(nvTitleRich("Сейчас", T, 18));
  sh.getRange(3, 2).setFontFamily(NV_FONT_MONO).setFontSize(9).setFontColor(T.text2).setWrap(false);
  const rules = [];
  P.keys.forEach((key, i) => {
    const tile = NV_TILES.find((t) => t.key === key);
    const r = nvPhoneRow(i);
    sh.setRowHeight(r, P.heights.label);
    sh.setRowHeight(r + 1, P.heights.value);
    sh.setRowHeight(r + 2, P.heights.line);
    sh.setRowHeight(r + 3, P.heights.gap);
    const block = sh.getRange(r, 2, 3, 2);
    block.setBackground(T.surface);
    sh.getRange(r, 2, 1, 2)
      .setFontSize(9)
      .setFontColor(T.text2)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("bottom");
    sh.getRange(r + 1, 2, 1, 2)
      .setFontFamily(NV_FONT_MONO)
      .setFontSize(22)
      .setFontWeight("bold")
      .setHorizontalAlignment("left")
      .setNumberFormat(tile.fmt);
    sh.getRange(r + 2, 2, 1, 2)
      .setFontFamily(NV_FONT_MONO)
      .setFontSize(9)
      .setFontColor(T.text2)
      .setHorizontalAlignment("left")
      .setWrap(false);
    if (T.tileRuleOn)
      sh.getRange(r, 2, 1, 2).setBorder(
        true,
        null,
        null,
        null,
        null,
        null,
        T.tileRule,
        SpreadsheetApp.BorderStyle.SOLID_MEDIUM,
      );
    sh.getRange(r + 1, P.helperCol).setFontColor(T.bg);
    const flag = "$" + nvLetter(P.helperCol) + (r + 1);
    rules.push(nvRule(sh.getRange(r + 1, 2, 2, 2), "=" + flag + "=TRUE", { color: T.accentText, bold: true }));
  });
  sh.setConditionalFormatRules(rules);
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
}
