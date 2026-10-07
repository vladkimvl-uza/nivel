/**
 * Structure of the table sheets: grid size, headers, calculated columns, captions, totals, validations, notes, protections.
 * Nothing here depends on the theme, and nothing here touches the rows of data.
 */

/** Rows a table keeps under the header. */
function nvBodyRows(sheetKey) {
  const big = { history: 4000, webhook: 4000, selfcheck: 120, promo: 240 };
  return big[sheetKey] || NV_LAYOUT.spareRows;
}

/** Brings the sheet grid to the size of the table: headerRow + body rows, columns + one gutter. */
function nvFitGrid(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const rows = NV_LAYOUT.headerRow + nvBodyRows(sheetKey);
  const cols = nvLastColIndex(sheetKey) + 1 + (def.extraCols || 0);
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  else if (sh.getMaxRows() > rows) {
    // Never cut below the last filled row of the key column.
    const keep = Math.max(rows, nvNextRow(sheetKey) + 20);
    if (sh.getMaxRows() > keep) sh.deleteRows(keep + 1, sh.getMaxRows() - keep);
  }
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  else if (sh.getMaxColumns() > cols) sh.deleteColumns(cols + 1, sh.getMaxColumns() - cols);
}

/** Validation rule of a column; null when the column takes anything. */
function nvColumnValidation(sheetKey, col) {
  const L = NV_LAYOUT;
  const letter = nvColLetter(sheetKey, col.key);
  const cell = letter + L.firstRow;
  const b = () => SpreadsheetApp.newDataValidation().setAllowInvalid(false);
  if (col.calc) return null;
  // Checkboxes are put on the rows that exist (nvFlagValidations): an empty row shows no boxes.
  if (col.type === "flag") return null;
  if (col.list)
    // A "soft" list is a hint: any other text is accepted (the name of a shop comes from the platform as it is)
    return b()
      .requireValueInRange(nvDictRange(col.list), true)
      .setAllowInvalid(col.soft === true)
      .setHelpText(col.soft ? "Подсказка: можно выбрать из списка или написать своё" : "Выберите значение из списка")
      .build();
  if (col.orderList) {
    const orders = nvSheet("orders");
    const c = nvColIndex("orders", "num");
    return b()
      .requireValueInRange(orders.getRange(L.firstRow, c, orders.getMaxRows() - L.firstRow + 1, 1), true)
      .setHelpText("Номер существующего заказа NV-ГГГГ-NNNN")
      .build();
  }
  if (col.memory) {
    const purchased = nvColLetter(sheetKey, "purchased") + L.firstRow;
    return b()
      .requireFormulaSatisfied(
        nvApiFormula(
          "=AND(ISNUMBER(" +
            cell +
            "); " +
            cell +
            "=INT(" +
            cell +
            "); " +
            cell +
            ">=0; " +
            cell +
            "<=" +
            purchased +
            ")",
        ),
      )
      .setHelpText("Целое число от 0; память и SSD не больше закупки ИП")
      .build();
  }
  if (col.doneBp)
    return b()
      .requireFormulaSatisfied(
        nvApiFormula(
          "=AND(ISNUMBER(" + cell + "); " + cell + "=INT(" + cell + "); " + cell + ">=0; " + cell + "<=10000)",
        ),
      )
      .setHelpText("Целое число 0–10 000 (бп)")
      .build();
  if (col.nonzero) {
    return b()
      .requireFormulaSatisfied(
        nvApiFormula("=AND(ISNUMBER(" + cell + "); " + cell + "=INT(" + cell + "); " + cell + "<>0)"),
      )
      .setHelpText("Целая сумма, не ноль (расход — со знаком минус)")
      .build();
  }
  if (col.positive)
    return b()
      .requireFormulaSatisfied(
        nvApiFormula("=AND(ISNUMBER(" + cell + "); " + cell + "=INT(" + cell + "); " + cell + ">0)"),
      )
      .setHelpText("Целая сумма больше нуля")
      .build();
  if (col.min1)
    return b()
      .requireFormulaSatisfied(
        nvApiFormula("=AND(ISNUMBER(" + cell + "); " + cell + "=INT(" + cell + "); " + cell + ">=1)"),
      )
      .setHelpText("Целое число не меньше 1")
      .build();
  if (col.int || col.type === "sum")
    return b()
      .requireFormulaSatisfied(
        nvApiFormula("=AND(ISNUMBER(" + cell + "); " + cell + "=INT(" + cell + "); " + cell + ">=0)"),
      )
      .setHelpText("Целое число не меньше 0")
      .build();
  if (col.firstOfMonth)
    return b()
      .requireFormulaSatisfied(nvApiFormula("=AND(ISNUMBER(" + cell + "); DAY(" + cell + ")=1)"))
      .setHelpText("Первое число месяца")
      .build();
  if (col.regex)
    return b()
      .requireFormulaSatisfied(nvApiFormula("=REGEXMATCH(TO_TEXT(" + cell + '); "' + col.regex + '")'))
      .setHelpText(col.regex === "^@" ? "Ник начинается с @" : "Формат +998XXXXXXXXX")
      .build();
  if (col.type === "date") return b().requireDate().setHelpText("Дата").build();
  return null;
}

/** The checks "number of an existing order" of the sheets that refer to orders, over the whole current range of the orders. */
function nvRefreshOrderLists() {
  NV_TABLE_SHEETS.forEach((key) => {
    const def = NV_SCHEMA[key];
    const sh = nvSheet(key);
    def.cols.forEach((c, i) => {
      if (!c.orderList) return;
      const rows = sh.getMaxRows() - NV_LAYOUT.firstRow + 1;
      sh.getRange(NV_LAYOUT.firstRow, NV_LAYOUT.firstCol + i, rows, 1).setDataValidation(nvColumnValidation(key, c));
    });
  });
}

/** Writes headers, formulas, captions, totals, validations and notes of one table sheet. */
function nvBuildTable(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const L = NV_LAYOUT;
  nvFitGrid(sheetKey);
  const rows = sh.getMaxRows() - L.firstRow + 1;

  // Header row: the title, or the MAP formula of a calculated column
  const heads = def.cols.map((c) => (c.calc ? nvApiFormula(nvCalcFormula(sheetKey, c)) : c.title));
  nvWriteMatrix(sh.getRange(L.headerRow, L.firstCol, 1, def.cols.length), [heads]);

  // Caption: the counters of the sheet and a short remark
  const cap = nvResolveCaption(sheetKey, def.caption);
  const remark = def.captionRight ? '&"   ·   ' + def.captionRight.replace(/"/g, '""') + '"' : "";
  sh.getRange(3, L.firstCol).setFormula(nvApiFormula(cap + remark));

  // Totals over the visible rows (filters respected)
  if (def.totals) {
    sh.getRange(4, L.firstCol).setValue("Итого");
    def.cols.forEach((c, i) => {
      if (!c.tot) return;
      const range = nvColRange(sheetKey, c.key, false);
      sh.getRange(4, L.firstCol + i)
        .setFormula(nvApiFormula("=SUBTOTAL(109; " + range + ")"))
        .setNumberFormat(NV_FMT.sum);
    });
  }

  // Checkboxes of the rows that are filled already
  const filled = nvNextRow(sheetKey) - L.firstRow;
  if (filled > 0) nvFlagValidations(sheetKey, L.firstRow, filled);

  // Validations; the notes of the header go in one call
  const notes = [];
  def.cols.forEach((c, i) => {
    const colIdx = L.firstCol + i;
    const dv = nvColumnValidation(sheetKey, c);
    if (dv) sh.getRange(L.firstRow, colIdx, rows, 1).setDataValidation(dv);
    let note = "";
    if (c.calc || c.prot === "formula") note = "Считает формула. Не править: ячейки ниже заполняются сами.";
    else if (c.prot === "script") note = "Заполняет скрипт. Ручная правка допустима только в крайнем случае.";
    else if (c.plat)
      note =
        "Поле платформы: у строк с источником «Платформа» его присылает событие, правка вручную спросит подтверждение.";
    else if (c.dynamicList) note = "Список допустимых событий для текущего статуса.";
    notes.push(note);
  });
  sh.getRange(L.headerRow, L.firstCol, 1, def.cols.length).setNotes([notes]);
  return def;
}

/** Protection of the calculated and scripted columns: a warning for the owner, nothing is locked. */
function nvProtectTable(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const L = NV_LAYOUT;
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach((p) => {
    if (String(p.getDescription()).indexOf("Nivel:") === 0) p.remove();
  });
  const rows = sh.getMaxRows() - L.firstRow + 1;
  const runs = [];
  def.cols.forEach((c, i) => {
    const kind = def.appendOnly
      ? "script"
      : c.calc || c.prot === "formula"
        ? "formula"
        : c.prot === "script"
          ? "script"
          : null;
    const last = runs[runs.length - 1];
    if (!kind) return;
    if (last && last.to === i - 1 && last.kind === kind) last.to = i;
    else runs.push({ from: i, to: i, kind: kind });
  });
  runs.forEach((run) => {
    const range = sh.getRange(L.firstRow, L.firstCol + run.from, rows, run.to - run.from + 1);
    const text = run.kind === "formula" ? "Nivel: считает формула" : "Nivel: заполняет скрипт";
    range.protect().setDescription(text).setWarningOnly(true);
  });
  // The header and the title block are never edited by hand.
  sh.getRange(1, 1, L.headerRow, sh.getMaxColumns())
    .protect()
    .setDescription("Nivel: шапка листа")
    .setWarningOnly(true);
}

/** The action list of an order or a warranty row: the events allowed in the current status. */
function nvSetActionValidation(sheetKey, row, labels) {
  const sh = nvSheet(sheetKey);
  const c = nvColIndex(sheetKey, "action");
  const cell = sh.getRange(row, c);
  if (!labels.length) {
    cell.clearDataValidations();
    return;
  }
  cell.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(labels, true)
      .setAllowInvalid(false)
      .setHelpText("Доступно в этом статусе")
      .build(),
  );
}

/** Checkboxes in the flag columns of rows firstRow..firstRow+count-1 (only the rows that hold data get them). */
function nvFlagValidations(sheetKey, firstRow, count) {
  if (count <= 0) return;
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const rule = nvCheckboxRule();
  def.cols.forEach((c, i) => {
    if (c.type === "flag") sh.getRange(firstRow, NV_LAYOUT.firstCol + i, count, 1).setDataValidation(rule);
  });
}
