/**
 * "Панель": the owner's dashboard on one screen. Twelve tiles (three rows of four), a 12-column grid of 96 px,
 * eight charts. Read only: every cell is a formula over the hidden "_Данные"; the owner changes only the period,
 * the year and the demo switch (C3, F3, I3). The tiles and the sparklines take their colours from the theme.
 */

const NV_PANEL = {
  gutter: 16,
  colWidth: 96,
  firstCol: 2,
  lastCol: 13,
  helperCol: 16,
  rows: { top: 1, head: 2, controls: 3, gap: 4 },
  heights: {
    top: 14,
    head: 56,
    controls: 32,
    gap: 14,
    label: 24,
    value: 44,
    line: 24,
    spark: 26,
    heading: 30,
    chart: 22,
  },
  tileTop: [5, 10, 15],
  headings: [
    { row: 20, text: "Динамика" },
    { row: 51, text: "Структура и сроки" },
  ],
  /** Chart anchors: row of the first chart row and the column. A chart is 6 columns (576 px) and 14 rows (308 px) big. */
  charts: [
    { row: 21, col: 2 },
    { row: 21, col: 8 },
    { row: 36, col: 2 },
    { row: 36, col: 8 },
    { row: 52, col: 2 },
    { row: 52, col: 8 },
    { row: 67, col: 2 },
    { row: 67, col: 8 },
  ],
  chartRows: 14,
};

/** The tiles: key of the KPI, label, number format, kind of the trend under the figure. */
const NV_TILES = [
  { key: "fee", label: "Плата за период", fmt: NV_FMT.mln, trend: { col: "B", type: "column" } },
  { key: "wip", label: "Заказы в работе (закупка – доставка)", fmt: "0", trend: { col: "C", type: "column" } },
  { key: "delivered", label: "Сдано за период", fmt: "0", trend: { col: "D", type: "column" } },
  { key: "leads", label: "Заявки без спама", fmt: "0", trend: { col: "E", type: "column" } },
  { key: "threshold", label: "Порог года", fmt: NV_FMT.pct, trend: { type: "bar" } },
  {
    key: "funds",
    label: "Средства клиентов на счёте ИП",
    fmt: NV_FMT.mln,
    trend: null,
    note: "получено на закупку − чеки − возвраты",
  },
  { key: "wres", label: "Резерв гарантии", fmt: NV_FMT.mln, trend: { range: "reserve", col: "B", type: "line" } },
  {
    key: "taxdue",
    label: "Налог 1 % (оценка)",
    fmt: NV_FMT.sum,
    trend: null,
    note: "помесячно — на листе «Порог и налоги»",
  },
  { key: "conv", label: "Конверсия заявка → заказ", fmt: NV_FMT.pct, trend: { col: "F", type: "column" } },
  { key: "avgfee", label: "Средняя плата", fmt: NV_FMT.sum, trend: { col: "G", type: "column" } },
  { key: "reply", label: "Время первого ответа", fmt: '0.0" ч"', trend: { col: "H", type: "column" } },
  { key: "overdue", label: "Просрочено задач", fmt: "0", trend: null, note: "по листу «Сегодня»" },
];

/** Top-left cell (row, col) of a tile. */
function nvTilePos(index) {
  const band = Math.floor(index / 4);
  const pos = index % 4;
  return { row: NV_PANEL.tileTop[band], col: NV_PANEL.firstCol + pos * 3, band: band, pos: pos };
}

/** Hidden helper cell with the "worse" flag of a tile (the conditional formatting reads it). */
function nvTileFlagCell(index) {
  const p = nvTilePos(index);
  return { row: p.row + 2, col: NV_PANEL.helperCol + p.pos };
}

/**
 * The SPARKLINE formula of a tile for a theme; "" when the tile has no trend. The bars are graphite; only the last one is
 * marked, and it is orange only when the tile is worse than the norm (the flag of the tile decides, on the same sheet).
 */
function nvTileTrendFormula(tile, T, flagRef) {
  if (!tile.trend) return "";
  const worseColor = "IF(" + flagRef + '=TRUE; "' + T.accent + '"; "' + T.text + '")';
  if (tile.trend.type === "bar") {
    return (
      '=SPARKLINE({TH_VOLUME\\TH_COMMITTED}; {"charttype"\\"bar"; "max"\\TH_LIMIT; "color1"\\' +
      worseColor +
      '; "color2"\\"' +
      T.compare +
      '"; "empty"\\"zero"})'
    );
  }
  const first = tile.trend.range === "reserve" ? NV_ND.res : NV_ND.weeks;
  const range = nvDataRange(tile.trend.col, first, tile.trend.col, first + 11);
  const color = T === NV_THEMES.night ? "#A9A59C" : T.muted;
  return (
    "=SPARKLINE(" +
    range +
    '; {"charttype"\\"' +
    tile.trend.type +
    '"; "color"\\"' +
    color +
    '"; "lastcolor"\\' +
    worseColor +
    '; "empty"\\"zero"})'
  );
}

/** Structure of the panel: grid, controls, tile formulas. Colours come later from nvStylePanel. */
function nvBuildPanel() {
  const ss = nvSpreadsheet();
  const sh = nvSheet("panel");
  const P = NV_PANEL;
  const needRows = 82;
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  else if (sh.getMaxRows() > needRows) sh.deleteRows(needRows + 1, sh.getMaxRows() - needRows);
  const needCols = P.helperCol + 4;
  if (sh.getMaxColumns() < needCols) sh.insertColumnsAfter(sh.getMaxColumns(), needCols - sh.getMaxColumns());
  else if (sh.getMaxColumns() > needCols) sh.deleteColumns(needCols + 1, sh.getMaxColumns() - needCols);
  // Controls
  sh.getRange("B3").setValue("Период");
  sh.getRange("E3").setValue("Год");
  sh.getRange("G3").setValue("Показывать демо");
  const period = sh.getRange("C3");
  if (period.getValue() === "") period.setValue("Этот месяц");
  const year = sh.getRange("F3");
  if (year.getValue() === "") year.setValue(nvYear());
  const demo = sh.getRange("I3");
  if (demo.getValue() === "") demo.setValue(false);
  period.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(nvDictRange("NVD_PERIOD"), true)
      .setAllowInvalid(false)
      .build(),
  );
  year.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(nvDictRange("NVD_YEAR"), true)
      .setAllowInvalid(false)
      .build(),
  );
  demo.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  nvSetName(ss, "P_PERIOD", period);
  nvSetName(ss, "P_YEAR", year);
  nvSetName(ss, "P_DEMO", demo);
  sh.getRange("B2").setValue("");
  sh.getRange("C2").setValue("Nivel · CRM");
  sh.getRange("K2").setFormula("=" + nvDataRef("B", NV_ND.params + 9));
  // Headings
  P.headings.forEach((h) => {
    sh.getRange(h.row, 2).setValue(h.text);
  });
  // Tiles
  NV_TILES.forEach((tile, i) => {
    const pos = nvTilePos(i);
    const row = nvKpiRow(tile.key);
    sh.getRange(pos.row, pos.col).setValue(tile.label);
    sh.getRange(pos.row + 1, pos.col).setFormula(nvApiFormula("=" + nvDataRef("B", row)));
    sh.getRange(pos.row + 2, pos.col).setFormula(nvApiFormula("=" + nvDataRef("D", row)));
    const flag = nvTileFlagCell(i);
    sh.getRange(flag.row, flag.col).setFormula(nvApiFormula("=" + nvDataRef("E", row)));
  });
  // Merge each tile row across its three columns
  NV_TILES.forEach((tile, i) => {
    const pos = nvTilePos(i);
    for (let r = 0; r < 4; r++) sh.getRange(pos.row + r, pos.col, 1, 3).merge();
  });
  sh.getRange("C2:G2").merge();
  sh.getRange("K2:M2").merge();
  sh.getRange("C3:D3").merge();
  sh.getRange("G3:H3").merge();
}

/** The sparklines carry literal colours, so they are written again with every theme. */
function nvPanelTrends() {
  const sh = nvSheet("panel");
  const T = nvThemeFor("panel");
  NV_TILES.forEach((tile, i) => {
    const pos = nvTilePos(i);
    const cell = sh.getRange(pos.row + 3, pos.col);
    const flag = nvTileFlagCell(i);
    const f = nvTileTrendFormula(tile, T, "$" + nvLetter(flag.col) + flag.row);
    if (f) cell.setFormula(nvApiFormula(f));
    else cell.setValue(tile.note || "");
  });
}

/** The mark of the level (PNG, 40 px) over cell B2: dark for the paper theme, light for the night one. */
function nvPlaceLogo() {
  const sh = nvSheet("panel");
  const nameOfTheme = nvThemeNameFor("panel");
  if (typeof sh.getImages === "function")
    sh.getImages().forEach((im) => {
      im.remove ? im.remove() : null;
    });
  if (typeof NV_LOGO_PNG === "undefined") return;
  const b64 = nameOfTheme === "night" ? NV_LOGO_PNG.light : NV_LOGO_PNG.dark;
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), "image/png", "nivel-mark.png");
  const img = sh.insertImage(blob, 2, 2, 8, 8);
  if (img) {
    img.setHeight(40).setWidth(67);
    if (img.setAltTextTitle) img.setAltTextTitle("Nivel");
  }
}

function nvStylePanel() {
  const sh = nvSheet("panel");
  const T = nvThemeFor("panel");
  const P = NV_PANEL;
  const maxRows = sh.getMaxRows();
  const maxCols = sh.getMaxColumns();
  sh.getRange(1, 1, maxRows, maxCols)
    .setBackground(T.bg)
    .setFontFamily(NV_FONT_TEXT)
    .setFontSize(10)
    .setFontColor(T.text)
    .setVerticalAlignment("middle");
  // Grid: gutter 16, twelve columns of 96, gutter 16, hidden helpers
  sh.setColumnWidth(1, P.gutter);
  sh.setColumnWidths(P.firstCol, 12, P.colWidth);
  sh.setColumnWidth(14, P.gutter);
  sh.setColumnWidths(15, maxCols - 14, P.gutter);
  sh.hideColumns(15, maxCols - 14);
  // Rows
  const H = P.heights;
  sh.setRowHeight(1, H.top);
  sh.setRowHeight(2, H.head);
  sh.setRowHeight(3, H.controls);
  sh.setRowHeight(4, H.gap);
  P.tileTop.forEach((r0) => {
    sh.setRowHeight(r0, H.label);
    sh.setRowHeight(r0 + 1, H.value);
    sh.setRowHeight(r0 + 2, H.line);
    sh.setRowHeight(r0 + 3, H.spark);
    sh.setRowHeight(r0 + 4, H.gap);
  });
  sh.setRowHeight(19, 22);
  P.headings.forEach((h) => {
    sh.setRowHeight(h.row, H.heading);
  });
  sh.setRowHeights(21, 14, H.chart);
  sh.setRowHeight(35, H.gap);
  sh.setRowHeights(36, 14, H.chart);
  sh.setRowHeight(50, H.gap);
  sh.setRowHeights(52, 14, H.chart);
  sh.setRowHeight(66, H.gap);
  sh.setRowHeights(67, 14, H.chart);
  sh.setRowHeights(81, 1, H.gap);
  // Header
  const title = sh.getRange("C2:G2");
  title
    .setFontFamily(NV_FONT_TEXT)
    .setFontSize(16)
    .setFontColor(T.text)
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("left")
    .setFontWeight("bold");
  const updated = sh.getRange("K2:M2");
  updated
    .setFontFamily(NV_FONT_MONO)
    .setFontSize(9)
    .setFontColor(T.text2)
    .setHorizontalAlignment("right")
    .setVerticalAlignment("middle");
  // Controls
  ["B3", "E3", "G3:H3"].forEach((a) => {
    sh.getRange(a).setFontSize(9).setFontColor(T.text2).setHorizontalAlignment("right").setVerticalAlignment("middle");
  });
  [sh.getRange("C3:D3"), sh.getRange("F3"), sh.getRange("I3")].forEach((r) => {
    r.setBackground(T.input)
      .setFontFamily(NV_FONT_MONO)
      .setFontSize(10)
      .setFontColor(T.text)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setFontWeight("bold");
    nvBorder(r, "bottom", T.accent, "SOLID_MEDIUM");
  });
  sh.getRange("F3").setNumberFormat("0");
  // Section headings with a rule
  P.headings.forEach((h) => {
    const r = sh.getRange(h.row, 2, 1, 12);
    sh.getRange(h.row, 2).setFontSize(11).setFontWeight("bold").setFontColor(T.text).setVerticalAlignment("bottom");
    nvBorder(r, "bottom", T.tileRuleOn ? T.tileRule : T.headRule, "SOLID_MEDIUM");
  });
  // Tiles
  NV_TILES.forEach((tile, i) => {
    const pos = nvTilePos(i);
    const block = sh.getRange(pos.row, pos.col, 4, 3);
    block.setBackground(T.surface);
    const label = sh.getRange(pos.row, pos.col, 1, 3);
    label
      .setFontFamily(NV_FONT_TEXT)
      .setFontSize(9)
      .setFontColor(T.text2)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("bottom")
      .setFontWeight("normal");
    const value = sh.getRange(pos.row + 1, pos.col, 1, 3);
    value
      .setFontFamily(NV_FONT_MONO)
      .setFontSize(22)
      .setFontColor(T.text)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle")
      .setFontWeight("bold")
      .setNumberFormat(tile.fmt);
    const line = sh.getRange(pos.row + 2, pos.col, 1, 3);
    line
      .setFontFamily(NV_FONT_MONO)
      .setFontSize(9)
      .setFontColor(T.text2)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle")
      .setFontWeight("normal")
      .setWrap(false);
    const spark = sh.getRange(pos.row + 3, pos.col, 1, 3);
    spark
      .setFontFamily(NV_FONT_TEXT)
      .setFontSize(8)
      .setFontColor(T.muted)
      .setVerticalAlignment("middle")
      .setHorizontalAlignment("left");
    // Separation of the tiles: a thick border in the colour of the sheet around each tile
    const edge = sh.getRange(pos.row - 0, pos.col, 4, 3);
    edge.setBorder(true, true, true, true, false, false, T.bg, SpreadsheetApp.BorderStyle.SOLID_THICK);
    if (T.tileRuleOn) {
      label.setBorder(true, null, null, null, null, null, T.tileRule, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    }
    sh.getRange(nvTileFlagCell(i).row, nvTileFlagCell(i).col).setFontColor(T.bg);
  });
  // Orange only where it is worse: the figure and the line under it
  const rules = [];
  NV_TILES.forEach((tile, i) => {
    const pos = nvTilePos(i);
    const flag = nvTileFlagCell(i);
    const flagRef = "$" + nvLetter(flag.col) + flag.row;
    rules.push(
      nvRule(sh.getRange(pos.row + 2, pos.col, 1, 3), "=" + flagRef + "=TRUE", { color: T.accentText, bold: true }),
    );
    rules.push(nvRule(sh.getRange(pos.row + 1, pos.col, 1, 3), "=" + flagRef + "=TRUE", { color: T.accentText }));
  });
  sh.setConditionalFormatRules(rules);
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  sh.setTabColor(NV_BRAND.asphalt);
  nvPanelTrends();
  nvPlaceLogo();
}

/** The whole sheet is read-only (a warning) except the three controls. */
function nvProtectPanel() {
  const sh = nvSheet("panel");
  const old = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  old.forEach((p) => {
    p.remove();
  });
  const p = sh.protect();
  p.setDescription("Nivel: панель только для чтения, меняются период, год и флажок демо").setWarningOnly(true);
  p.setUnprotectedRanges([sh.getRange("C3:D3"), sh.getRange("F3"), sh.getRange("I3")]);
}
