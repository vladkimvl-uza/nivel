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

/** The error of a busy lock. It carries a mark: the code never looks for a word in the text (the interface is Russian). */
function nvLockError() {
  const err = new Error("Книга занята другим действием: повторите через минуту");
  err.nvLock = true;
  return err;
}

function nvIsLockError(err) {
  return !!err && err.nvLock === true;
}

/**
 * Runs fn under the script lock (re-entrant: an inner call reuses the outer lock). tryLock answers true or false, so a
 * busy lock is a mark of our own, not an exception whose text could be in any language. Nothing that waits for a person
 * (a dialog) may run inside: ask first, then take the lock for the short change.
 */
let nvLockDepth = 0;
function nvWithLock(fn, waitMs) {
  if (nvLockDepth > 0) return fn();
  // One lock for every execution of the project (the edit trigger, the web app, the timers): the script lock
  // also works in a web app execution, where the document lock is not available.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || 30000)) throw nvLockError();
  // Another execution may have written while this one waited: what was read before is not to be trusted
  nvInvalidate();
  nvLockDepth++;
  try {
    return fn();
  } finally {
    nvLockDepth--;
    // The reference of Lock: flush before releaseLock, so that the writes reach the sheet before the next execution reads it
    try {
      SpreadsheetApp.flush();
    } catch (e) {
      Logger.log("flush перед снятием блокировки: " + (e?.message ? e.message : e));
    }
    lock.releaseLock();
  }
}

/** Is the code inside nvWithLock now (a dialog must never be shown then). */
function nvInLock() {
  return nvLockDepth > 0;
}

/* ---------------------------------------------------------------- table cache of one execution */

let nvTableCache = null;

/**
 * Inside fn a table is read from the sheet once: the quota of the triggers (90 minutes a day for all of them) is spent on
 * reads, and one edit used to read the 98 columns of the orders several times. Every writer of the tables below calls
 * nvInvalidate, so the next read sees the change. Outside nvCached nothing is cached.
 */
function nvCached(fn) {
  if (nvTableCache) return fn();
  nvTableCache = {};
  try {
    return fn();
  } finally {
    nvTableCache = null;
  }
}

function nvInvalidate(sheetKey) {
  if (!nvTableCache) return;
  if (sheetKey) delete nvTableCache[sheetKey];
  else nvTableCache = {};
}

/** Cuts secrets out of a text before it is written to a log: the token of a bot inside an address, and the given values. */
function nvScrub(text, secrets) {
  let out = String(text === undefined || text === null ? "" : text);
  (secrets || []).forEach((s) => {
    if (s) out = out.split(String(s)).join("***");
  });
  return out.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***").replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, "***");
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

/* ---------------------------------------------------------------- named ranges */

let nvNamedCache = null;

/** The named ranges of the book by name (read once; cleared when the setup starts). */
function nvNamedMap(ss) {
  if (!nvNamedCache) {
    nvNamedCache = {};
    ss.getNamedRanges().forEach((nr) => {
      nvNamedCache[nr.getName()] = nr;
    });
  }
  return nvNamedCache;
}

function nvResetNamedCache() {
  nvNamedCache = null;
}

/** The same place of a range as text: Sheet!A1:B2. */
function nvPlaceOf(range) {
  return range.getSheet().getName() + "!" + range.getA1Notation();
}

/**
 * Names a range; if the name exists and points elsewhere, the existing name is moved (setNamedRange would fail or
 * duplicate); if it already points there, nothing is written (a second setup makes no calls for it).
 */
function nvSetName(ss, name, range) {
  const map = nvNamedMap(ss);
  const existing = map[name];
  if (existing) {
    if (nvPlaceOf(existing.getRange()) !== nvPlaceOf(range)) existing.setRange(range);
    return;
  }
  ss.setNamedRange(name, range);
  // A stub for the next lookups of this run; moving it later re-reads the real object
  map[name] = {
    getRange: () => range,
    setRange: (r) => {
      nvNamedCache = null;
      nvNamedMap(ss)[name].setRange(r);
    },
  };
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
  const sheet = ss ? ss.getSheetByName(NV_SN.settings) : null;
  if (sheet) {
    // One read of the columns value..name; the rows are found by the name NV_* in the column E
    const n = Math.max(0, sheet.getMaxRows() - NV_LAYOUT.firstRow + 1);
    const block = n ? sheet.getRange(NV_LAYOUT.firstRow, NV_SET_COLS.value, n, 3).getValues() : [];
    const byName = {};
    block.forEach((r) => {
      if (r[2]) byName[r[2]] = r[0];
    });
    nvSettingRows().forEach((row) => {
      if (!(row.name in byName)) return;
      let v = byName[row.name];
      if (v === "" || v === null) {
        if (row.type !== "date") return;
      }
      if (row.type === "date") v = nvIsDateValue(v) ? nvIsoDate(v) : String(v || "");
      else if (row.type === "bool") v = v === true || v === "TRUE" || v === "Да";
      else if (row.type === "time" && nvIsDateValue(v)) v = nvFormat(v, "HH:mm");
      else if (["bp", "sum", "int"].indexOf(row.type) >= 0) v = Number(v);
      s[row.key] = v;
    });
  }
  s.alerts = [s.alert1, s.alert2, s.alert3, s.alert4, s.alert5].map(Number).filter((x) => x > 0);
  if (sheet) nvRememberWindow(s);
  nvSettingsCache = s;
  return s;
}

/** Keeps the response window in a document property, so a trigger can decide "not now" without reading the sheets. */
function nvRememberWindow(s) {
  try {
    const value = nvStr(s.responseFrom) + "-" + nvStr(s.responseTo);
    if (!/^\d\d:\d\d-\d\d:\d\d$/.test(value)) return;
    const props = nvDocProps();
    if (props.getProperty("NV_RESP_WINDOW") !== value) props.setProperty("NV_RESP_WINDOW", value);
  } catch (e) {
    // a property is a convenience, never a reason to stop
  }
}

/** A Date of any realm (the test environment makes dates in another context). */
function nvIsDateValue(v) {
  return Object.prototype.toString.call(v) === "[object Date]";
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

/**
 * Text that came from outside (a name, a note, the summary of an event) must never become a formula: a value that
 * starts with = + - or @ is stored as text (the leading apostrophe is not part of the value in Sheets).
 */
function nvSafeText(v) {
  return typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v;
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

/** All filled rows of a table as {row, ...values by key} (one batch read; once per execution inside nvCached). */
function nvReadTable(sheetKey) {
  if (nvTableCache?.[sheetKey]) return nvTableCache[sheetKey];
  const rows = nvReadTableRaw(sheetKey);
  if (nvTableCache) nvTableCache[sheetKey] = rows;
  return rows;
}

function nvReadTableRaw(sheetKey) {
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
  nvInvalidate(sheetKey);
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
      rowVals.push(values[k] === undefined || values[k] === null ? "" : nvSafeText(values[k]));
    }
    sh.getRange(row, from, 1, idx[j] - from + 1).setValues([rowVals]);
    i = j + 1;
  }
}

/** Appends a whole row (by keys) at the next free row and returns its number. */
function nvAppendRow(sheetKey, values) {
  nvInvalidate(sheetKey);
  const row = nvNextRow(sheetKey);
  nvEnsureCapacity(sheetKey, row);
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const arr = def.cols.map((c) => {
    if (c.calc) return null;
    const v = values[c.key];
    return v === undefined ? "" : nvSafeText(v);
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
  nvInvalidate(sheetKey);
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
      cols.slice(i, j + 1).map((c) => (o[c.key] === undefined || o[c.key] === null ? "" : nvSafeText(o[c.key]))),
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
