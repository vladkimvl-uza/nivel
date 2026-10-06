/**
 * Small runtime helpers shared by all files: clock, lock, properties, spreadsheet access, row access.
 * Everything that touches SpreadsheetApp goes through here, so the tests can replace the environment.
 */

function nvNow() {
  return new Date();
}

/** Active spreadsheet; in a web app execution the id saved at setup is used. */
function nvSpreadsheet() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    ss = null;
  }
  if (ss) return ss;
  const id = PropertiesService.getScriptProperties().getProperty(NV_PROP.spreadsheetId);
  if (!id) throw new Error("Книга не найдена: выполните «Nivel CRM → Настройка → Установить триггеры» из таблицы");
  return SpreadsheetApp.openById(id);
}

function nvSheet(key) {
  const name = NV_SN[key] || NV_SCHEMA[key]?.title || key;
  const sh = nvSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error("Нет листа «" + name + "»: запустите «Nivel CRM → Применить оформление»");
  return sh;
}

function nvToast(message, title, seconds) {
  try {
    nvSpreadsheet().toast(message, title || "Nivel CRM", seconds || 6);
  } catch (e) {
    Logger.log("toast: " + message);
  }
}

/** Date formatted in Asia/Tashkent. */
function nvFormat(date, pattern) {
  return Utilities.formatDate(date, NV_TZ, pattern);
}

function nvYear(date) {
  return Number(nvFormat(date || nvNow(), "yyyy"));
}

function nvToday() {
  return nvMidnightDate(nvNow());
}

/** Midnight (Tashkent) of the day of d as a Date. */
function nvMidnightDate(d) {
  return new Date(nvMidnight(d));
}

/** Value of a date cell (Date, serial number or ISO text) as a Date; null for blank. */
function nvToDate(v) {
  if (v === "" || v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // A serial number of Sheets (days since 30.12.1899) read as Tashkent local time.
    return new Date(Math.round((v - 25569) * NV_DAY_MS) - NV_TZ_OFFSET_MS);
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function nvIsoOf(date) {
  return date ? nvIsoDate(date) : "";
}

/** Runs fn under the document lock (re-entrant: an inner call reuses the outer lock). */
let nvLockDepth = 0;
function nvWithLock(fn, waitMs) {
  if (nvLockDepth > 0) return fn();
  // One lock for every execution of the project (the edit trigger, the web app, the timers): the script lock
  // also works in a web app execution, where the document lock is not available.
  const lock = LockService.getScriptLock();
  lock.waitLock(waitMs || 30000);
  nvLockDepth++;
  try {
    return fn();
  } finally {
    nvLockDepth--;
    lock.releaseLock();
  }
}

function nvDocProps() {
  return PropertiesService.getDocumentProperties();
}

function nvScriptProps() {
  return PropertiesService.getScriptProperties();
}

/** Is a property set (the value is never shown). */
function nvHasProp(name) {
  const v = nvScriptProps().getProperty(name);
  return v !== null && v !== undefined && v !== "";
}

/* ---------------------------------------------------------------- settings */

let nvSettingsCache = null;

/** Settings from the "Настройки" cells (named ranges); falls back to the defaults before the sheet is built. */
function nvSettings(fresh) {
  if (nvSettingsCache && !fresh) return nvSettingsCache;
  const s = nvDefaultSettings();
  let ss = null;
  try {
    ss = nvSpreadsheet();
  } catch (e) {
    ss = null;
  }
  if (ss) {
    nvSettingRows().forEach((row) => {
      const range = ss.getRangeByName(row.name);
      if (!range) return;
      let v = range.getValue();
      if (v === "" || v === null) {
        if (row.type !== "date") return;
      }
      if (row.type === "date") v = v instanceof Date ? nvIsoDate(v) : String(v || "");
      else if (row.type === "bool") v = v === true || v === "TRUE" || v === "Да";
      else if (row.type === "time" && v instanceof Date) v = nvFormat(v, "HH:mm");
      else if (["bp", "sum", "int"].indexOf(row.type) >= 0) v = Number(v);
      s[row.key] = v;
    });
  }
  s.alerts = [s.alert1, s.alert2, s.alert3, s.alert4, s.alert5].map(Number).filter((x) => x > 0);
  nvSettingsCache = s;
  return s;
}

function nvResetSettingsCache() {
  nvSettingsCache = null;
}

/** Holidays as ISO dates from the named range NV_HOLIDAYS. */
function nvHolidays() {
  let ss = null;
  try {
    ss = nvSpreadsheet();
  } catch (e) {
    return [];
  }
  const range = ss.getRangeByName("NV_HOLIDAYS");
  if (!range) return [];
  const out = [];
  range.getValues().forEach((r) => {
    const d = nvToDate(r[0]);
    if (d) out.push(nvIsoDate(d));
  });
  return out;
}

/* ---------------------------------------------------------------- table access */

/** The row after the last filled row of the key column (the formula columns fill the sheet, so getLastRow is useless). */
function nvNextRow(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const col = nvColIndex(sheetKey, def.keyCol);
  const max = sh.getMaxRows();
  if (max < NV_LAYOUT.firstRow) return NV_LAYOUT.firstRow;
  const vals = sh.getRange(NV_LAYOUT.firstRow, col, max - NV_LAYOUT.firstRow + 1, 1).getValues();
  let last = -1;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i][0] !== "" && vals[i][0] !== null) {
      last = i;
      break;
    }
  }
  return NV_LAYOUT.firstRow + last + 1;
}

/** All filled rows of a table as {row, ...values by key} (one batch read). */
function nvReadTable(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const next = nvNextRow(sheetKey);
  if (next <= NV_LAYOUT.firstRow) return [];
  const n = def.cols.length;
  const vals = sh.getRange(NV_LAYOUT.firstRow, NV_LAYOUT.firstCol, next - NV_LAYOUT.firstRow, n).getValues();
  const keyIdx = def.cols.findIndex((c) => c.key === def.keyCol);
  const out = [];
  vals.forEach((arr, i) => {
    if (arr[keyIdx] === "" || arr[keyIdx] === null) return;
    const o = nvArrayToRow(sheetKey, arr);
    o._row = NV_LAYOUT.firstRow + i;
    out.push(o);
  });
  return out;
}

/** Row object by the value of the key column, or null. */
function nvFindRow(sheetKey, keyValue, rows) {
  const def = NV_SCHEMA[sheetKey];
  const list = rows || nvReadTable(sheetKey);
  return list.find((r) => String(r[def.keyCol]) === String(keyValue)) || null;
}

/** Writes values of the given keys into a row (one setValues per run of adjacent columns). */
function nvWriteCells(sheetKey, row, values) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const keys = Object.keys(values).filter((k) => def.cols.some((c) => c.key === k));
  const idx = keys.map((k) => nvColIndex(sheetKey, k)).sort((a, b) => a - b);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    const from = idx[i];
    const rowVals = [];
    for (let c = from; c <= idx[j]; c++) {
      const k = def.cols[c - NV_LAYOUT.firstCol].key;
      rowVals.push(values[k] === undefined || values[k] === null ? "" : values[k]);
    }
    sh.getRange(row, from, 1, idx[j] - from + 1).setValues([rowVals]);
    i = j + 1;
  }
}

/** Appends a whole row (by keys) at the next free row and returns its number. */
function nvAppendRow(sheetKey, values) {
  const row = nvNextRow(sheetKey);
  nvEnsureCapacity(sheetKey, row);
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const arr = def.cols.map((c) => {
    if (c.calc) return null;
    const v = values[c.key];
    return v === undefined ? "" : v;
  });
  // Calculated columns hold the header formula only: never write into them. Write the runs between them.
  let i = 0;
  while (i < arr.length) {
    if (arr[i] === null) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < arr.length && arr[j + 1] !== null) j++;
    sh.getRange(row, NV_LAYOUT.firstCol + i, 1, j - i + 1).setValues([arr.slice(i, j + 1)]);
    i = j + 1;
  }
  nvFlagValidations(sheetKey, row, 1);
  return row;
}

/** Writes the values of a row-matrix into the columns of the table that are not calculated, run by run. */
function nvWriteRowsMatrix(sheetKey, row, objects) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const cols = def.cols;
  let i = 0;
  while (i < cols.length) {
    if (cols[i].calc) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < cols.length && !cols[j + 1].calc) j++;
    const matrix = objects.map((o) =>
      cols.slice(i, j + 1).map((c) => (o[c.key] === undefined || o[c.key] === null ? "" : o[c.key])),
    );
    sh.getRange(row, NV_LAYOUT.firstCol + i, objects.length, j - i + 1).setValues(matrix);
    i = j + 1;
  }
  nvFlagValidations(sheetKey, row, objects.length);
}

/** Rows appended in one batch (for history, the journal and the demo): the calculated columns are never written. */
function nvAppendRows(sheetKey, objects) {
  if (!objects.length) return;
  const row = nvNextRow(sheetKey);
  nvEnsureCapacity(sheetKey, row + objects.length);
  nvWriteRowsMatrix(sheetKey, row, objects);
}

/** Makes sure the sheet has rows up to the given one; new rows get the format of the existing body. */
function nvEnsureCapacity(sheetKey, neededRow) {
  const sh = nvSheet(sheetKey);
  const have = sh.getMaxRows();
  if (neededRow + 20 <= have) return;
  const add = 500;
  sh.insertRowsAfter(have, add);
  if (typeof nvStyleBody === "function") nvStyleBody(sheetKey, have + 1, have + add);
}

/** The text of a cell as a trimmed string. */
function nvStr(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Whole number from a cell; NaN for anything else. */
function nvNum(v) {
  if (typeof v === "number") return v;
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/\s| /g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
