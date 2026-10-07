// An in-memory imitation of the parts of Google Apps Script that the CRM uses: SpreadsheetApp (sheets, ranges, formats,
// colours, widths, validations, rules, charts, protections, bandings, named ranges), Charts, Utilities, PropertiesService,
// LockService, CacheService, ScriptApp, UrlFetchApp, MailApp, ContentService, HtmlService and Session. There is no DriveApp:
// the project does not use the Drive, so a call to it stops a test (ReferenceError), as it would stop the script without a scope.
// It records what the script does, so tests and the preview can read the result. Formulas are stored, not evaluated.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const MAX_ROWS = 1000;
const MAX_COLS = 26;

export function colToLetter(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function letterToCol(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Parses an A1 reference ("B2", "B2:D9", "A:A", "A6:A", "3:5") against the size of the sheet. */
export function parseA1(a1, maxRows, maxCols) {
  const clean = a1.replace(/\$/g, "");
  const parts = clean.split(":");
  const one = (p, isEnd, other) => {
    const m = /^([A-Za-z]*)(\d*)$/.exec(p);
    if (!m) throw new Error(`Bad A1 reference: ${a1}`);
    return { col: m[1] ? letterToCol(m[1]) : 0, row: m[2] ? Number(m[2]) : 0, isEnd, other };
  };
  const a = one(parts[0]);
  const b = parts[1] ? one(parts[1]) : { ...a };
  const r1 = a.row || 1;
  const c1 = a.col || 1;
  const r2 = b.row || (parts[1] ? maxRows : r1);
  const c2 = b.col || (parts[1] ? maxCols : c1);
  return { row: r1, col: c1, numRows: r2 - r1 + 1, numCols: c2 - c1 + 1 };
}

const key = (r, c) => `${r},${c}`;

/**
 * The patterns of setNumberFormat are those of the Sheets API guide on number formats: 0 # ? . , % E / : text in quotes,
 * @, the instructions in [ ], and the letters of dates and times. A word such as General is not one of them: the
 * reference does not say that it means "automatic", so the mock refuses it.
 */
function checkNumberFormat(f) {
  if (typeof f !== "string")
    throw new Error(
      "Exception: The parameters (" +
        typeof f +
        ") don't match the method signature for SpreadsheetApp.Range.setNumberFormat.",
    );
  const rest = f
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  const bad = /[^ymdhsEeaApPMDHSY0-9#?.,%/:;@_*()$+<>=!&~^ -]/.exec(rest);
  if (bad)
    throw new Error(
      `Exception: Invalid number format pattern ${JSON.stringify(f)} (unexpected ${JSON.stringify(bad[0])})`,
    );
}

/**
 * Google may hand a formula back in its own spelling: the reference of getFormulas says only "formulas (A1 notation)".
 * With env.normalizeFormulas the mock imitates that: no blanks outside text, no quotes round sheet names, function names
 * in capitals. Code that compares a formula it wrote with one it read back must survive this.
 */
function respell(f) {
  let out = "";
  let inString = false;
  let code = "";
  const flush = () => {
    out += code.replace(/'/g, "").replace(/[A-Za-z_.]+(?=\()/g, (m) => m.toUpperCase());
    code = "";
  };
  for (const ch of f) {
    if (inString) {
      out += ch;
      if (ch === '"') inString = false;
    } else if (ch === '"') {
      flush();
      out += ch;
      inString = true;
    } else if (!/\s/.test(ch)) code += ch;
  }
  flush();
  return out;
}

/**
 * What a cell does with a value written by setValue/setValues: the value is read as if typed. A string that starts with =
 * is a formula; a leading apostrophe makes the rest text; in a cell with the text format (@) a string stays text;
 * otherwise a string that looks like a number or TRUE/FALSE becomes a number or a boolean ("+998901234567" is a number).
 */
function writeInput(cell, v) {
  delete cell.f;
  if (v === null || v === undefined) {
    cell.v = "";
  } else if (typeof v !== "string") {
    cell.v = v;
  } else if (v.startsWith("=")) {
    cell.f = v;
    cell.v = "";
    cell.fvia = "value";
  } else if (v.startsWith("'")) {
    cell.v = v.slice(1);
  } else if (cell.nf === "@") {
    cell.v = v;
  } else if (/^[+-]?\d+(\.\d+)?$/.test(v)) {
    cell.v = Number(v);
  } else if (/^(true|false)$/i.test(v)) {
    cell.v = v.toLowerCase() === "true";
  } else {
    cell.v = v;
  }
}

class DataValidationBuilder {
  constructor() {
    this._p = { allowInvalid: true, dropdown: true };
  }
  requireValueInList(list, dropdown = true) {
    this._p.type = "list";
    this._p.list = list;
    this._p.dropdown = dropdown;
    return this;
  }
  requireValueInRange(range, dropdown = true) {
    this._p.type = "range";
    this._p.range = range.getA1Notation ? range.getA1Notation() : String(range);
    this._p.rangeSheet = range.getSheet ? range.getSheet().getName() : "";
    this._p.dropdown = dropdown;
    return this;
  }
  requireCheckbox() {
    this._p.type = "checkbox";
    return this;
  }
  requireNumberGreaterThanOrEqualTo(n) {
    this._p.type = "number>=";
    this._p.n = n;
    return this;
  }
  requireNumberGreaterThan(n) {
    this._p.type = "number>";
    this._p.n = n;
    return this;
  }
  requireNumberBetween(a, b) {
    this._p.type = "numberBetween";
    this._p.n = [a, b];
    return this;
  }
  requireDate() {
    this._p.type = "date";
    return this;
  }
  requireDateOnOrAfter(d) {
    this._p.type = "date>=";
    this._p.n = d;
    return this;
  }
  requireFormulaSatisfied(f) {
    this._p.type = "formula";
    this._p.formula = f;
    return this;
  }
  requireTextMatchesPattern() {
    throw new Error("not in Apps Script");
  }
  setAllowInvalid(b) {
    this._p.allowInvalid = b;
    return this;
  }
  setHelpText(t) {
    this._p.help = t;
    return this;
  }
  build() {
    return { ...this._p, getCriteriaType: () => this._p.type, getAllowInvalid: () => this._p.allowInvalid };
  }
}

class CfBuilder {
  constructor() {
    this._p = { ranges: [] };
  }
  whenFormulaSatisfied(f) {
    this._p.formula = f;
    return this;
  }
  whenTextEqualTo(t) {
    this._p.formula = `text=${t}`;
    return this;
  }
  setRanges(r) {
    this._p.ranges = r;
    return this;
  }
  setBackground(c) {
    this._p.background = c;
    return this;
  }
  setFontColor(c) {
    this._p.fontColor = c;
    return this;
  }
  setBold(b) {
    this._p.bold = b;
    return this;
  }
  setItalic(b) {
    this._p.italic = b;
    return this;
  }
  setStrikethrough(b) {
    this._p.strike = b;
    return this;
  }
  build() {
    const p = this._p;
    return {
      ...p,
      getRanges: () => p.ranges,
      getBooleanCondition: () => ({ getCriteriaType: () => "CUSTOM_FORMULA", getCriteriaValues: () => [p.formula] }),
    };
  }
}

class TextStyleBuilder {
  constructor() {
    this._p = {};
  }
  setForegroundColor(c) {
    this._p.color = c;
    return this;
  }
  setFontSize(n) {
    this._p.size = n;
    return this;
  }
  setBold(b) {
    this._p.bold = b;
    return this;
  }
  setFontFamily(f) {
    this._p.family = f;
    return this;
  }
  build() {
    return { ...this._p };
  }
}

class RichTextBuilder {
  constructor() {
    this._p = { runs: [], text: "" };
  }
  setText(t) {
    this._p.text = t;
    return this;
  }
  setTextStyle(a, b, style) {
    this._p.runs.push({ start: a, end: b, style });
    return this;
  }
  build() {
    const p = this._p;
    return { getText: () => p.text, runs: p.runs, isRich: true };
  }
}

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  getSheet() {
    return this.sheet;
  }
  getCell(r, c) {
    return new Range(this.sheet, this.row + r - 1, this.col + c - 1, 1, 1);
  }
  getRow() {
    return this.row;
  }
  getColumn() {
    return this.col;
  }
  getLastRow() {
    return this.row + this.numRows - 1;
  }
  getLastColumn() {
    return this.col + this.numCols - 1;
  }
  getNumRows() {
    return this.numRows;
  }
  getNumColumns() {
    return this.numCols;
  }
  getA1Notation() {
    const a = colToLetter(this.col) + this.row;
    if (this.numRows === 1 && this.numCols === 1) return a;
    return `${a}:${colToLetter(this.getLastColumn())}${this.getLastRow()}`;
  }
  _each(fn) {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) fn(this.row + r, this.col + c, r, c);
  }
  _cell(r, c) {
    return this.sheet._cell(r, c);
  }
  _set(prop, value) {
    this._each((r, c) => {
      this._cell(r, c)[prop] = value;
    });
    return this;
  }
  _setMatrix(prop, matrix) {
    if (!Array.isArray(matrix) || matrix.length !== this.numRows) {
      throw new Error(
        `${prop}: expected ${this.numRows} rows, got ${Array.isArray(matrix) ? matrix.length : typeof matrix}`,
      );
    }
    this._each((r, c, i, j) => {
      if (!Array.isArray(matrix[i]) || matrix[i].length !== this.numCols) {
        throw new Error(`${prop}: expected ${this.numCols} columns in row ${i}`);
      }
      this._cell(r, c)[prop] = matrix[i][j];
    });
    return this;
  }
  getValues() {
    this.sheet.owner.env.reads += 1;
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numCols; c++) {
        const cell = this.sheet.cells.get(key(this.row + r, this.col + c));
        row.push(cell && cell.v !== undefined ? cell.v : "");
      }
      out.push(row);
    }
    return out;
  }
  getValue() {
    return this.getValues()[0][0];
  }
  getDisplayValues() {
    return this.getValues().map((r) =>
      r.map((v) => (Object.prototype.toString.call(v) === "[object Date]" ? v.toISOString() : String(v))),
    );
  }
  getFormulas() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numCols; c++) {
        const cell = this.sheet.cells.get(key(this.row + r, this.col + c));
        row.push(cell?.f ? (this.sheet.owner.env.normalizeFormulas ? respell(cell.f) : cell.f) : "");
      }
      out.push(row);
    }
    return out;
  }
  getFormula() {
    return this.getFormulas()[0][0];
  }
  setValues(matrix) {
    if (!Array.isArray(matrix) || matrix.length !== this.numRows) {
      throw new Error(
        `setValues: expected ${this.numRows} rows, got ${Array.isArray(matrix) ? matrix.length : typeof matrix} in ${this.getA1Notation()}`,
      );
    }
    this._each((r, c, i, j) => {
      const row = matrix[i];
      if (!Array.isArray(row) || row.length !== this.numCols) {
        throw new Error(`setValues: expected ${this.numCols} columns in row ${i} of ${this.getA1Notation()}`);
      }
      const cell = this._cell(r, c);
      writeInput(cell, row[j]);
      delete cell.rich;
    });
    this.sheet.owner._touch(this.sheet, this);
    return this;
  }
  setValue(v) {
    this._each((r, c) => {
      const cell = this._cell(r, c);
      writeInput(cell, v);
      delete cell.rich;
    });
    this.sheet.owner._touch(this.sheet, this);
    return this;
  }
  setFormula(f) {
    if (typeof f !== "string" || !f.startsWith("="))
      throw new Error(
        "Exception: The parameters (" +
          typeof f +
          ") don't match the method signature for SpreadsheetApp.Range.setFormula.",
      );
    this._each((r, c) => {
      const cell = this._cell(r, c);
      cell.f = f;
      cell.v = "";
      cell.fvia = "formula";
    });
    this.sheet.owner._touch(this.sheet, this);
    return this;
  }
  setFormulas(m) {
    if (!Array.isArray(m) || m.length !== this.numRows)
      throw new Error(`setFormulas: expected ${this.numRows} rows in ${this.getA1Notation()}`);
    this._each((r, c, i, j) => {
      if (!Array.isArray(m[i]) || m[i].length !== this.numCols)
        throw new Error(`setFormulas: expected ${this.numCols} columns in row ${i} of ${this.getA1Notation()}`);
      const f = m[i][j];
      if (typeof f !== "string" || !f.startsWith("="))
        throw new Error(`setFormulas: ${JSON.stringify(f)} is not a formula (cell ${colToLetter(c)}${r})`);
      const cell = this._cell(r, c);
      cell.f = f;
      cell.v = "";
      cell.fvia = "formula";
    });
    this.sheet.owner._touch(this.sheet, this);
    return this;
  }
  setRichTextValue(rt) {
    this._each((r, c) => {
      const cell = this._cell(r, c);
      cell.rich = rt;
      cell.v = rt.getText();
    });
    return this;
  }
  clear() {
    this._each((r, c) => this.sheet.cells.delete(key(r, c)));
    return this;
  }
  clearContent() {
    this._each((r, c) => {
      const cell = this.sheet.cells.get(key(r, c));
      if (cell) {
        delete cell.v;
        delete cell.f;
        delete cell.rich;
      }
    });
    return this;
  }
  clearFormat() {
    this._each((r, c) => {
      const cell = this.sheet.cells.get(key(r, c));
      if (cell) {
        for (const k of ["nf", "bg", "fc", "ff", "fs", "fw", "fi", "fl", "ha", "va", "wrap", "borders"]) delete cell[k];
      }
    });
    return this;
  }
  clearDataValidations() {
    this._each((r, c) => {
      const cell = this.sheet.cells.get(key(r, c));
      if (cell) delete cell.dv;
    });
    return this;
  }
  clearNote() {
    return this._set("note", undefined);
  }
  setNumberFormat(f) {
    checkNumberFormat(f);
    return this._set("nf", f);
  }
  getNumberFormat() {
    // Automatic format of Sheets, as the reference of getNumberFormat shows it
    return this.sheet.cells.get(key(this.row, this.col))?.nf || "0.###############";
  }
  setNumberFormats(m) {
    if (Array.isArray(m)) for (const row of m) if (Array.isArray(row)) for (const f of row) checkNumberFormat(f);
    return this._setMatrix("nf", m);
  }
  setBackground(c) {
    return this._set("bg", c);
  }
  setBackgrounds(m) {
    return this._setMatrix("bg", m);
  }
  setFontColor(c) {
    return this._set("fc", c);
  }
  setFontColors(m) {
    return this._setMatrix("fc", m);
  }
  setFontFamily(f) {
    return this._set("ff", f);
  }
  setFontSize(n) {
    return this._set("fs", n);
  }
  setFontWeight(w) {
    return this._set("fw", w);
  }
  setFontWeights(m) {
    return this._setMatrix("fw", m);
  }
  setFontStyle(s) {
    return this._set("fi", s);
  }
  setFontLine(l) {
    return this._set("fl", l);
  }
  setHorizontalAlignment(a) {
    return this._set("ha", a);
  }
  setVerticalAlignment(a) {
    return this._set("va", a);
  }
  setWrap(b) {
    return this._set("wrap", b);
  }
  setWrapStrategy(s) {
    return this._set("wrap", s !== "CLIP" && s !== "OVERFLOW");
  }
  setNote(n) {
    return this._set("note", n);
  }
  setNotes(m) {
    return this._setMatrix("note", m);
  }
  setFontFamilies(m) {
    return this._setMatrix("ff", m);
  }
  setFontSizes(m) {
    return this._setMatrix("fs", m);
  }
  setHorizontalAlignments(m) {
    return this._setMatrix("ha", m);
  }
  setDataValidation(rule) {
    return this._set("dv", rule);
  }
  setDataValidations(m) {
    return this._setMatrix("dv", m);
  }
  insertCheckboxes() {
    this._each((r, c) => {
      const cell = this._cell(r, c);
      cell.dv = { type: "checkbox" };
      if (cell.v === undefined || cell.v === "") cell.v = false;
    });
    return this;
  }
  setBorder(top, left, bottom, right, vertical, horizontal, color, style) {
    const b = { top, left, bottom, right, vertical, horizontal, color, style };
    this._each((r, c, i, j) => {
      const cell = this._cell(r, c);
      cell.borders = cell.borders || {};
      const edges = [];
      if (top && i === 0) edges.push("top");
      if (bottom && i === this.numRows - 1) edges.push("bottom");
      if (left && j === 0) edges.push("left");
      if (right && j === this.numCols - 1) edges.push("right");
      if (horizontal && i > 0) edges.push("top");
      if (horizontal && i < this.numRows - 1) edges.push("bottom");
      if (vertical && j > 0) edges.push("left");
      if (vertical && j < this.numCols - 1) edges.push("right");
      if (top === false && i === 0) delete cell.borders.top;
      if (bottom === false && i === this.numRows - 1) delete cell.borders.bottom;
      for (const e of edges) cell.borders[e] = { color: b.color, style: b.style };
      if (top === null || bottom === null || left === null || right === null) {
        // null leaves the edge as it is
      }
    });
    return this;
  }
  merge() {
    const m = { row: this.row, col: this.col, numRows: this.numRows, numCols: this.numCols };
    if (
      !this.sheet.merges.some(
        (x) => x.row === m.row && x.col === m.col && x.numRows === m.numRows && x.numCols === m.numCols,
      )
    ) {
      this.sheet.merges.push(m);
    }
    return this;
  }
  mergeAcross() {
    for (let r = 0; r < this.numRows; r++)
      this.sheet.merges.push({ row: this.row + r, col: this.col, numRows: 1, numCols: this.numCols });
    return this;
  }
  breakApart() {
    this.sheet.merges = this.sheet.merges.filter((m) => !(m.row === this.row && m.col === this.col));
    return this;
  }
  protect() {
    const p = {
      range: this,
      description: "",
      warningOnly: false,
      type: "RANGE",
      setDescription(d) {
        p.description = d;
        return p;
      },
      setWarningOnly(b) {
        p.warningOnly = b;
        return p;
      },
      remove() {
        p.sheet.protections = p.sheet.protections.filter((x) => x !== p);
      },
      getRange() {
        return p.range;
      },
      getDescription() {
        return p.description;
      },
      isWarningOnly() {
        return p.warningOnly;
      },
      getProtectionType() {
        return "RANGE";
      },
      sheet: this.sheet,
    };
    this.sheet.protections.push(p);
    return p;
  }
  applyRowBanding(theme, showHeader, showFooter) {
    const sheet = this.sheet;
    const b = {
      range: this,
      theme,
      showHeader,
      showFooter,
      first: null,
      second: null,
      header: null,
      setFirstRowColor(c) {
        b.first = c;
        return b;
      },
      setSecondRowColor(c) {
        b.second = c;
        return b;
      },
      setHeaderRowColor(c) {
        b.header = c;
        return b;
      },
      setFooterRowColor() {
        return b;
      },
      getRange() {
        return b.range;
      },
      remove() {
        sheet.bandings = sheet.bandings.filter((x) => x !== b);
      },
    };
    sheet.bandings.push(b);
    return b;
  }
  createFilter() {
    this.sheet.filter = { range: this, remove: () => (this.sheet.filter = null), getRange: () => this };
    return this.sheet.filter;
  }
  shiftColumnGroupDepth(d) {
    // Real Sheets: the depth is between 0 and 8, a shift outside it is an error
    for (let c = this.col; c < this.col + this.numCols; c++) {
      const next = (this.sheet._groupDepth.get(c) || 0) + d;
      if (next < 0 || next > 8)
        throw new Error(`Exception: The column group depth must be between 0 and 8, got ${next}`);
    }
    for (let c = this.col; c < this.col + this.numCols; c++) {
      this.sheet._groupDepth.set(c, (this.sheet._groupDepth.get(c) || 0) + d);
    }
    return this;
  }
  collapseGroups() {
    for (let c = this.col; c < this.col + this.numCols; c++) this.sheet.collapsedCols.add(c);
    return this;
  }
  activate() {
    this.sheet.owner.activeSheet = this.sheet;
    return this;
  }
  getRichTextValue() {
    const cell = this.sheet.cells.get(key(this.row, this.col));
    return cell ? cell.rich || null : null;
  }
  setTextStyle(ts) {
    this._each((r, c) => {
      const cell = this._cell(r, c);
      if (ts.color) cell.fc = ts.color;
      if (ts.size) cell.fs = ts.size;
      if (ts.bold !== undefined) cell.fw = ts.bold ? "bold" : "normal";
      if (ts.family) cell.ff = ts.family;
    });
    return this;
  }
  copyTo() {
    return this;
  }
  sort() {
    return this;
  }
  createTextFinder(text) {
    const self = this;
    const state = { entire: false };
    const f = {
      matchEntireCell(b) {
        state.entire = b;
        return f;
      },
      matchCase() {
        return f;
      },
      findNext() {
        let hit = null;
        self._each((r, c) => {
          if (hit) return;
          const cell = self.sheet.cells.get(key(r, c));
          const v = cell ? String(cell.v ?? "") : "";
          if (state.entire ? v === text : v.includes(text)) hit = new Range(self.sheet, r, c, 1, 1);
        });
        return hit;
      },
    };
    return f;
  }
}

class Sheet {
  constructor(owner, id, name) {
    this.owner = owner;
    this.id = id;
    this.name = name;
    this.cells = new Map();
    this.maxRows = MAX_ROWS;
    this.maxCols = MAX_COLS;
    this.colW = new Map();
    this.rowH = new Map();
    this.rowForced = new Set();
    this.hiddenCols = new Set();
    this.hiddenRows = new Set();
    this.frozenRows = 0;
    this.frozenCols = 0;
    this.hiddenGrid = false;
    this.tabColor = null;
    this.hidden = false;
    this.merges = [];
    this.cf = [];
    this.protections = [];
    this.charts = [];
    this.images = [];
    this.bandings = [];
    this.filter = null;
    // Not part of the Apps Script API: the code under test asks getColumnGroupDepth, never this map
    this._groupDepth = new Map();
    this.collapsedCols = new Set();
    this.sheetProtection = null;
    this.filterViews = [];
  }
  _cell(r, c) {
    if (r < 1 || c < 1) throw new Error(`Bad cell ${r},${c}`);
    if (r > this.maxRows || c > this.maxCols) {
      throw new Error(
        `Range outside the grid of ${this.name}: row ${r}, column ${c} (grid ${this.maxRows}x${this.maxCols})`,
      );
    }
    // Every write goes through here: the changes are pending until SpreadsheetApp.flush()
    this.owner.env.dirty = true;
    const k = key(r, c);
    let cell = this.cells.get(k);
    if (!cell) {
      cell = {};
      this.cells.set(k, cell);
    }
    return cell;
  }
  getName() {
    return this.name;
  }
  setName(n) {
    this.name = n;
    return this;
  }
  getSheetId() {
    return this.id;
  }
  getIndex() {
    return this.owner.sheets.indexOf(this) + 1;
  }
  getParent() {
    return this.owner;
  }
  getRange(a, b, c, d) {
    if (typeof a === "string") {
      const p = parseA1(a, this.maxRows, this.maxCols);
      return new Range(this, p.row, p.col, p.numRows, p.numCols);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getDataRange() {
    return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  getLastRow() {
    let m = 0;
    for (const [k, cell] of this.cells) {
      if ((cell.v !== undefined && cell.v !== "") || cell.f) m = Math.max(m, Number(k.split(",")[0]));
    }
    return m;
  }
  getLastColumn() {
    let m = 0;
    for (const [k, cell] of this.cells) {
      if ((cell.v !== undefined && cell.v !== "") || cell.f) m = Math.max(m, Number(k.split(",")[1]));
    }
    return m;
  }
  getMaxRows() {
    return this.maxRows;
  }
  getMaxColumns() {
    return this.maxCols;
  }
  insertRowsAfter(_after, n) {
    this.maxRows += n;
    return this;
  }
  insertColumnsAfter(_after, n) {
    this.maxCols += n;
    return this;
  }
  insertColumns(_at, n) {
    this.maxCols += n;
    return this;
  }
  /**
   * Deletes rows as Sheets does: the rows below move up with what they hold (values, formulas, formats, heights, merges),
   * and the named ranges of this sheet follow their cells; a name that sat only on deleted rows is gone. Rules,
   * protections, bandings and charts are not moved here: the CRM builds them again after such a change.
   */
  deleteRows(from, n) {
    if (!Number.isInteger(from) || !Number.isInteger(n) || from < 1 || n < 1)
      throw new Error(
        "Exception: The parameters do not match the method signature for SpreadsheetApp.Sheet.deleteRows.",
      );
    const last = from + n - 1;
    if (last > this.maxRows) throw new Error("Exception: Those rows are out of bounds.");
    if (n >= this.maxRows) throw new Error("Exception: You can't delete all the rows on the sheet.");
    this.owner.env.dirty = true;
    const deleted = (r) => r >= from && r <= last;
    const up = (r) => (r > last ? r - n : r);
    const cells = new Map();
    for (const [k, cell] of this.cells) {
      const [r, c] = k.split(",").map(Number);
      if (!deleted(r)) cells.set(key(up(r), c), cell);
    }
    this.cells = cells;
    this.rowH = new Map([...this.rowH].filter(([r]) => !deleted(r)).map(([r, h]) => [up(r), h]));
    this.rowForced = new Set([...this.rowForced].filter((r) => !deleted(r)).map(up));
    this.hiddenRows = new Set([...this.hiddenRows].filter((r) => !deleted(r)).map(up));
    // A block of rows (a merge, a named range) loses the deleted rows and moves up with the rest; nothing left, nothing kept
    const shrink = (block) => {
      const top = block.row < from ? block.row : block.row > last ? block.row - n : from;
      const bottomAt = block.row + block.numRows - 1;
      const bottom = bottomAt < from ? bottomAt : bottomAt > last ? bottomAt - n : from - 1;
      if (bottom < top) return false;
      block.row = top;
      block.numRows = bottom - top + 1;
      return true;
    };
    this.merges = this.merges.filter((m) => shrink(m));
    for (const [name, range] of [...this.owner.named]) {
      if (range.sheet !== this) continue;
      // A new Range: one that the code holds in a variable keeps the coordinates it had, as in Sheets
      const moved = new Range(this, range.row, range.col, range.numRows, range.numCols);
      if (shrink(moved)) this.owner.named.set(name, moved);
      else this.owner.named.delete(name);
    }
    this.maxRows -= n;
    return this;
  }
  deleteColumns(_from, n) {
    this.maxCols = Math.max(1, this.maxCols - n);
    for (const k of [...this.cells.keys()]) if (Number(k.split(",")[1]) > this.maxCols) this.cells.delete(k);
    return this;
  }
  deleteRow(r) {
    return this.deleteRows(r, 1);
  }
  appendRow(values) {
    const r = this.getLastRow() + 1;
    if (r > this.maxRows) this.maxRows = r;
    this.getRange(r, 1, 1, values.length).setValues([values]);
    return this;
  }
  setColumnWidth(c, w) {
    this.colW.set(c, w);
    return this;
  }
  setColumnWidths(c, n, w) {
    for (let i = 0; i < n; i++) this.colW.set(c + i, w);
    return this;
  }
  // setRowHeight(s): "By default, rows grow to fit cell contents" (the reference); setRowHeightsForced fixes the height
  setRowHeight(r, h) {
    return this.setRowHeights(r, 1, h);
  }
  setRowHeights(r, n, h) {
    if (!Number.isInteger(r) || !Number.isInteger(n) || typeof h !== "number")
      throw new Error(
        "Exception: The parameters do not match the method signature for SpreadsheetApp.Sheet.setRowHeights.",
      );
    for (let i = 0; i < n; i++) {
      this.rowH.set(r + i, h);
      this.rowForced.delete(r + i);
    }
    return this;
  }
  setRowHeightsForced(r, n, h) {
    if (!Number.isInteger(r) || !Number.isInteger(n) || typeof h !== "number")
      throw new Error(
        "Exception: The parameters do not match the method signature for SpreadsheetApp.Sheet.setRowHeightsForced.",
      );
    for (let i = 0; i < n; i++) {
      this.rowH.set(r + i, h);
      this.rowForced.add(r + i);
    }
    return this;
  }
  setFrozenRows(n) {
    this.frozenRows = n;
    return this;
  }
  setFrozenColumns(n) {
    this.frozenCols = n;
    return this;
  }
  getFrozenRows() {
    return this.frozenRows;
  }
  getFrozenColumns() {
    return this.frozenCols;
  }
  setHiddenGridlines(b) {
    this.hiddenGrid = b;
    return this;
  }
  setTabColor(c) {
    this.tabColor = c;
    return this;
  }
  getTabColor() {
    return this.tabColor;
  }
  hideSheet() {
    this.hidden = true;
    return this;
  }
  showSheet() {
    this.hidden = false;
    return this;
  }
  isSheetHidden() {
    return this.hidden;
  }
  hideColumns(c, n = 1) {
    for (let i = 0; i < n; i++) this.hiddenCols.add(c + i);
    return this;
  }
  showColumns(c, n = 1) {
    for (let i = 0; i < n; i++) this.hiddenCols.delete(c + i);
    return this;
  }
  hideRows(r, n = 1) {
    for (let i = 0; i < n; i++) this.hiddenRows.add(r + i);
    return this;
  }
  isColumnHiddenByUser(c) {
    return this.hiddenCols.has(c);
  }
  getConditionalFormatRules() {
    return [...this.cf];
  }
  setConditionalFormatRules(rules) {
    this.cf = [...rules];
    return this;
  }
  getProtections(type) {
    if (type === "SHEET") return this.sheetProtection ? [this.sheetProtection] : [];
    return [...this.protections];
  }
  protect() {
    // The reference: on a sheet that is protected already, protect() returns the protection that exists
    if (this.sheetProtection) return this.sheetProtection;
    const sheet = this;
    const p = {
      type: "SHEET",
      warningOnly: false,
      description: "",
      unprotected: [],
      setDescription(d) {
        p.description = d;
        return p;
      },
      getDescription() {
        return p.description;
      },
      setWarningOnly(b) {
        p.warningOnly = b;
        return p;
      },
      setUnprotectedRanges(r) {
        if (!Array.isArray(r) || r.some((x) => !x || typeof x.getSheet !== "function" || x.getSheet() !== sheet))
          throw new Error(
            "Exception: The parameters do not match setUnprotectedRanges(Range): ranges of the same sheet",
          );
        p.unprotected = r;
        return p;
      },
      remove: () => {
        this.sheetProtection = null;
      },
      getProtectionType: () => "SHEET",
      isWarningOnly() {
        return p.warningOnly;
      },
    };
    this.sheetProtection = p;
    return p;
  }
  getBandings() {
    return [...this.bandings];
  }
  getCharts() {
    return [...this.charts];
  }
  newChart() {
    return new ChartBuilder(this);
  }
  insertChart(chart) {
    chart.sheet = this;
    this.charts.push(chart);
    return this;
  }
  removeChart(chart) {
    this.charts = this.charts.filter((c) => c !== chart);
    return this;
  }
  updateChart(_chart) {
    return this;
  }
  getFilter() {
    return this.filter;
  }
  insertImage(blob, col, row, offX = 0, offY = 0) {
    const img = {
      blob,
      col,
      row,
      offX,
      offY,
      width: 0,
      height: 0,
      setWidth(w) {
        img.width = w;
        return img;
      },
      setHeight(h) {
        img.height = h;
        return img;
      },
      remove: () => {
        this.images = this.images.filter((x) => x !== img);
      },
      setAltTextTitle(t) {
        img.title = t;
        return img;
      },
      setAltTextDescription(t) {
        img.description = t;
        return img;
      },
    };
    this.images.push(img);
    return img;
  }
  getImages() {
    return [...this.images];
  }
  setColumnGroupControlPosition() {
    return this;
  }
  getColumnGroupDepth(col) {
    if (!Number.isInteger(col) || col < 1)
      throw new Error("Exception: The parameters do not match getColumnGroupDepth(Integer)");
    return this._groupDepth.get(col) || 0;
  }
  collapseAllColumnGroups() {
    for (const [c, depth] of this._groupDepth) if (depth > 0) this.collapsedCols.add(c);
    return this;
  }
  activate() {
    this.owner.activeSheet = this;
    return this;
  }
  clear() {
    this.cells.clear();
    this.merges = [];
    this.cf = [];
    return this;
  }
  clearConditionalFormatRules() {
    this.cf = [];
    return this;
  }
  createTextFinder(text) {
    return this.getDataRange().createTextFinder(text);
  }
  setActiveSelection() {
    return this;
  }
  autoResizeColumn() {
    return this;
  }
}

const CHART_TYPE_NAMES = ["COLUMN", "BAR", "LINE", "AREA", "COMBO", "STEPPED_AREA", "SCATTER", "PIE", "TABLE"];
// The first part of the keys of Google Charts that ComboChart, LineChart, BarChart and ColumnChart know (the reference of
// EmbeddedChartBuilder.setOption does not check the key: the mock does, so that a typo does not pass silently)
const CHART_OPTION_ROOTS = new Set([
  "title",
  "titleTextStyle",
  "fontName",
  "fontSize",
  "backgroundColor",
  "chartArea",
  "legend",
  "hAxis",
  "vAxis",
  "series",
  "seriesType",
  "isStacked",
  "bar",
  "lineWidth",
  "pointSize",
  "width",
  "height",
  "colors",
  "curveType",
  "areaOpacity",
  "animation",
  "annotations",
  "focusTarget",
  "orientation",
  "reverseCategories",
  "tooltip",
  "interpolateNulls",
  "dataOpacity",
  "pointShape",
  "theme",
]);

class ChartBuilder {
  constructor(sheet) {
    this.sheet = sheet;
    this.spec = { ranges: [], options: {}, type: null, position: null };
  }
  setChartType(t) {
    if (!CHART_TYPE_NAMES.includes(t))
      throw new Error(
        "Exception: The parameters (" +
          String(t) +
          ") don't match the method signature for SpreadsheetApp.EmbeddedChartBuilder.setChartType.",
      );
    this.spec.type = t;
    return this;
  }
  addRange(r) {
    if (!r || typeof r.getA1Notation !== "function")
      throw new Error(
        "Exception: The parameters don't match the method signature for SpreadsheetApp.EmbeddedChartBuilder.addRange.",
      );
    this.spec.ranges.push(r.getA1Notation());
    return this;
  }
  setPosition(row, col, offX, offY) {
    if (![row, col, offX, offY].every(Number.isInteger) || row < 1 || col < 1)
      throw new Error(
        "Exception: The parameters don't match the method signature for SpreadsheetApp.EmbeddedChartBuilder.setPosition.",
      );
    this.spec.position = { row, col, offX, offY };
    return this;
  }
  setOption(k, v) {
    if (typeof k !== "string")
      throw new Error(
        "Exception: The parameters don't match the method signature for SpreadsheetApp.EmbeddedChartBuilder.setOption.",
      );
    this.spec.options[k] = v;
    return this;
  }
  setNumHeaders(n) {
    if (!Number.isInteger(n))
      throw new Error(
        "Exception: The parameters don't match the method signature for SpreadsheetApp.EmbeddedChartBuilder.setNumHeaders.",
      );
    this.spec.numHeaders = n;
    return this;
  }
  setTransposeRowsAndColumns(b) {
    this.spec.transpose = b;
    return this;
  }
  setMergeStrategy(m) {
    this.spec.merge = m;
    return this;
  }
  asBarChart() {
    this.spec.type = "BAR";
    return this;
  }
  build() {
    const spec = this.spec;
    if (!spec.type) throw new Error("Exception: The chart has no type");
    if (!spec.ranges.length) throw new Error("Exception: The chart has no data range");
    for (const k of Object.keys(spec.options)) {
      const root = k.split(".")[0];
      if (!CHART_OPTION_ROOTS.has(root)) throw new Error(`Exception: Unknown chart option ${JSON.stringify(k)}`);
      // Gridlines exist only on a continuous axis: in a horizontal bar chart the axis of values is hAxis, vAxis lists the categories
      const discrete =
        spec.type === "BAR"
          ? "vAxis"
          : spec.type === "LINE" || spec.type === "COMBO" || spec.type === "COLUMN"
            ? "hAxis"
            : "";
      if (discrete && (k.startsWith(`${discrete}.gridlines`) || k.startsWith(`${discrete}.minorGridlines`)))
        throw new Error(
          "Exception: " +
            k +
            " is only supported for a continuous axis; " +
            discrete +
            " of a " +
            spec.type +
            " chart is discrete",
        );
    }
    const env = this.sheet.owner.env;
    env.chartSeq = (env.chartSeq || 100) + 1;
    const id = env.chartSeq;
    return {
      spec,
      sheet: this.sheet,
      id,
      getChartId: () => id,
      getContainerInfo: () => ({
        getAnchorRow: () => spec.position?.row ?? 1,
        getAnchorColumn: () => spec.position?.col ?? 1,
        getOffsetX: () => spec.position?.offX ?? 0,
        getOffsetY: () => spec.position?.offY ?? 0,
      }),
      getOptions: () => ({ get: (k) => (env.chartDropOptions?.includes(k) ? null : spec.options[k]) }),
      getRanges: () => spec.ranges,
    };
  }
}

class Spreadsheet {
  constructor(env, name = "Nivel CRM") {
    this.env = env;
    this.name = name;
    this.sheets = [];
    this.nextId = 100;
    this.named = new Map();
    this.tz = "GMT";
    this.locale = "en_US";
    this.themeColors = {};
    this.themeFont = null;
    this.filterViews = [];
    this.nextFilterViewId = 1000;
    this.activeSheet = null;
    this.toasts = [];
    this.id = "mock-spreadsheet-id";
    this.touches = [];
    this.onTouch = null;
    env.reads = 0;
    this.insertSheet("Sheet1");
  }
  _touch(sheet, range) {
    if (this.onTouch) this.onTouch(sheet, range);
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getUrl() {
    return `https://docs.google.com/spreadsheets/d/${this.id}/edit`;
  }
  getSheets() {
    return [...this.sheets];
  }
  getSheetByName(n) {
    return this.sheets.find((s) => s.name === n) || null;
  }
  insertSheet(name) {
    if (name && this.getSheetByName(name)) throw new Error(`A sheet with the name "${name}" already exists`);
    const s = new Sheet(this, this.nextId++, name || `Sheet${this.nextId}`);
    this.sheets.push(s);
    if (!this.activeSheet) this.activeSheet = s;
    return s;
  }
  deleteSheet(s) {
    if (this.sheets.length === 1) throw new Error("Cannot delete the only sheet");
    this.sheets = this.sheets.filter((x) => x !== s);
    if (this.activeSheet === s) this.activeSheet = this.sheets[0];
  }
  setActiveSheet(s) {
    this.activeSheet = s;
    return s;
  }
  getActiveSheet() {
    return this.activeSheet;
  }
  moveActiveSheet(pos) {
    const s = this.activeSheet;
    this.sheets = this.sheets.filter((x) => x !== s);
    this.sheets.splice(pos - 1, 0, s);
  }
  setSpreadsheetTimeZone(z) {
    this.tz = z;
  }
  getSpreadsheetTimeZone() {
    return this.tz;
  }
  setSpreadsheetLocale(l) {
    this.locale = l;
  }
  getSpreadsheetLocale() {
    return this.locale;
  }
  getNamedRanges() {
    return [...this.named.entries()].map(([name, _range]) => ({
      getName: () => name,
      getRange: () => this.named.get(name),
      setRange: (r) => {
        this.named.set(name, r);
      },
      remove: () => this.named.delete(name),
    }));
  }
  setNamedRange(name, range) {
    this.named.set(name, range);
  }
  removeNamedRange(name) {
    this.named.delete(name);
  }
  getRangeByName(name) {
    return this.named.get(name) || null;
  }
  toast(msg, title, sec) {
    this.toasts.push({ msg, title, sec });
  }
  getSpreadsheetTheme() {
    // The reference: "SpreadsheetTheme|null: the current theme, or null if no theme is applied"
    if (this.env.noTheme) return null;
    const self = this;
    const types = new Set([
      "TEXT",
      "BACKGROUND",
      "ACCENT1",
      "ACCENT2",
      "ACCENT3",
      "ACCENT4",
      "ACCENT5",
      "ACCENT6",
      "HYPERLINK",
    ]);
    const bad = (what) =>
      new Error(
        `Exception: The parameters (${what}) don't match the method signature for SpreadsheetApp.SpreadsheetTheme.setConcreteColor.`,
      );
    return {
      setFontFamily(f) {
        if (typeof f !== "string" || f === "")
          throw new Error("Exception: The parameters do not match setFontFamily(String)");
        self.themeFont = f;
        return this;
      },
      getFontFamily: () => self.themeFont,
      // Real overloads: (ThemeColorType, Color) and (ThemeColorType, Integer, Integer, Integer). A hex string is refused.
      setConcreteColor(type, a, b, c) {
        if (!types.has(type)) throw bad(String(type));
        let hex;
        if (a && typeof a === "object" && a._isColor === true && b === undefined) hex = a._hex;
        else if ([a, b, c].every((x) => Number.isInteger(x) && x >= 0 && x <= 255))
          hex =
            "#" +
            [a, b, c]
              .map((x) => x.toString(16).padStart(2, "0"))
              .join("")
              .toUpperCase();
        else throw bad(`(String, ${typeof a === "string" ? "String" : typeof a})`);
        self.themeColors[type] = hex;
        return this;
      },
      getConcreteColor: (type) => ({ asRgbColor: () => ({ asHexString: () => self.themeColors[type] }) }),
    };
  }
  setRecalculationInterval(v) {
    if (!["ON_CHANGE", "MINUTE", "HOUR"].includes(v)) throw new Error(`Exception: Invalid RecalculationInterval ${v}`);
    this.recalc = v;
  }
  getRecalculationInterval() {
    return this.recalc || "ON_CHANGE";
  }
  rename(n) {
    this.name = n;
  }
  getBlob() {
    return { getBytes: () => [] };
  }
  getDeveloperMetadata() {
    return [];
  }
}

class Env {
  constructor(opts = {}) {
    this.now = opts.now || new Date("2026-10-06T12:00:00+05:00");
    this.ss = new Spreadsheet(this);
    this.scriptProps = new Map(Object.entries(opts.scriptProps || {}));
    this.docProps = new Map();
    this.userProps = new Map();
    this.cache = new Map();
    this.triggers = [];
    this.triggerSeq = 0;
    this.fetches = [];
    this.fetchHandler = opts.fetchHandler || null;
    this.mails = [];
    this.alerts = [];
    this.prompts = [];
    this.alertAnswers = [];
    this.promptAnswers = [];
    this.userEmail = opts.userEmail === undefined ? "owner@example.com" : opts.userEmail;
    // Scopes of the manifest of the project: Session.getActiveUser().getEmail() needs userinfo.email among them
    this.scopes = opts.scopes || readManifest().oauthScopes || [];
    // false imitates a context without a UI (the phone app, a trigger of another user): alert and prompt fail
    this.uiAvailable = true;
    this.dialogsUnderLock = [];
    this.lockEvents = [];
    this.locked = false;
    this.lockHeldElsewhere = false;
    this.uuidCounter = 0;
    this.logs = [];
    this.sidebars = [];
    this.menus = [];
    this.dialogs = [];
    // Switches of the tests: the Sheets service answers with an error; getSpreadsheetTheme() returns null
    this.sheetsFail = false;
    this.noTheme = false;
    this.normalizeFormulas = false;
    this.deprecatedFields = [];
    // Writes not yet flushed at the moment a lock is released: the reference of Lock advises flush() before releaseLock()
    this.dirty = false;
    this.unflushedReleases = 0;
    // The account the code runs as (installable triggers run as the one who created them)
    this.effectiveEmail = opts.effectiveEmail === undefined ? "owner@example.com" : opts.effectiveEmail;
    this.webAppUrl = "https://script.google.com/macros/s/MOCK/exec";
  }
}

function readManifest() {
  const dir = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(dir, "..", "src", "appsscript.json"), "utf8"));
}

const _hex = (buf) => Buffer.from(buf).toString("hex");

function formatDate(date, tz, pattern) {
  const offsetMin = tz === "Asia/Tashkent" ? 300 : tz === "GMT" || tz === "UTC" ? 0 : 0;
  const d = new Date(date.getTime() + offsetMin * 60000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const map = {
    yyyy: p(d.getUTCFullYear(), 4),
    MM: p(d.getUTCMonth() + 1),
    dd: p(d.getUTCDate()),
    HH: p(d.getUTCHours()),
    mm: p(d.getUTCMinutes()),
    ss: p(d.getUTCSeconds()),
    SSS: p(d.getUTCMilliseconds(), 3),
    XXX: offsetMin === 300 ? "+05:00" : "Z",
    u: String(d.getUTCDay() === 0 ? 7 : d.getUTCDay()),
  };
  // Literal text in single quotes is kept as it is.
  return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|SSS|XXX|u/g, (m, lit) => (lit !== undefined ? lit : map[m]));
}

/**
 * The advanced service "Sheets" (v4), as far as the CRM uses it: Spreadsheets.get and batchUpdate with filter views.
 * It refuses what the reference of the Sheets API refuses: a condition type that filters do not support (ONE_OF_LIST is
 * "supported by data validation" only), a wrong number of values, an unknown request, a missing sheet. A batch is all or
 * nothing. The deprecated field FilterView.criteria is accepted (it still works) but recorded in env.deprecatedFields.
 */
const FILTER_CONDITIONS = {
  NUMBER_GREATER: 1,
  NUMBER_GREATER_THAN_EQ: 1,
  NUMBER_LESS: 1,
  NUMBER_LESS_THAN_EQ: 1,
  NUMBER_EQ: 1,
  NUMBER_NOT_EQ: 1,
  NUMBER_BETWEEN: 2,
  NUMBER_NOT_BETWEEN: 2,
  TEXT_CONTAINS: 1,
  TEXT_NOT_CONTAINS: 1,
  TEXT_STARTS_WITH: 1,
  TEXT_ENDS_WITH: 1,
  TEXT_EQ: 1,
  TEXT_NOT_EQ: 1,
  DATE_EQ: 1,
  DATE_BEFORE: 1,
  DATE_AFTER: 1,
  DATE_ON_OR_BEFORE: 1,
  DATE_ON_OR_AFTER: 1,
  DATE_BETWEEN: 2,
  DATE_NOT_BETWEEN: 2,
  DATE_NOT_EQ: 1,
  DATE_IS_VALID: 0,
  BLANK: 0,
  NOT_BLANK: 0,
  CUSTOM_FORMULA: 1,
};
const RELATIVE_DATES = ["PAST_YEAR", "PAST_MONTH", "PAST_WEEK", "YESTERDAY", "TODAY", "TOMORROW"];

function sheetsError(path, text) {
  return new Error(
    `GoogleJsonResponseException: API call to sheets.spreadsheets.batchUpdate failed with error: Invalid requests${path}: ${text}`,
  );
}

function checkFilterCondition(path, cond) {
  if (!cond || typeof cond !== "object") throw sheetsError(path, "condition is missing");
  if (!(cond.type in FILTER_CONDITIONS))
    throw sheetsError(
      `${path}.type`,
      `condition type ${JSON.stringify(cond.type)} is not supported by filters (data validation only, or unknown)`,
    );
  const values = cond.values || [];
  if (!Array.isArray(values) || values.length !== FILTER_CONDITIONS[cond.type])
    throw sheetsError(
      `${path}.values`,
      `${cond.type} needs ${FILTER_CONDITIONS[cond.type]} value(s), got ${values.length}`,
    );
  values.forEach((v, i) => {
    const kinds = ["userEnteredValue", "relativeDate"].filter((k) => v && v[k] !== undefined);
    if (kinds.length !== 1)
      throw sheetsError(`${path}.values[${i}]`, "exactly one of userEnteredValue or relativeDate");
    if (kinds[0] === "userEnteredValue" && typeof v.userEnteredValue !== "string")
      throw sheetsError(`${path}.values[${i}].userEnteredValue`, "must be a string");
    if (kinds[0] === "relativeDate") {
      if (!RELATIVE_DATES.includes(v.relativeDate))
        throw sheetsError(`${path}.values[${i}].relativeDate`, `unknown ${v.relativeDate}`);
      if (!cond.type.startsWith("DATE_"))
        throw sheetsError(`${path}.values[${i}]`, "relativeDate only for date conditions");
    }
  });
}

function checkFilterCriteria(path, crit) {
  if (!crit || typeof crit !== "object") throw sheetsError(path, "filterCriteria is missing");
  if (crit.hiddenValues !== undefined) {
    if (!Array.isArray(crit.hiddenValues) || crit.hiddenValues.some((x) => typeof x !== "string"))
      throw sheetsError(`${path}.hiddenValues`, "must be a list of strings");
  }
  if (crit.condition !== undefined) checkFilterCondition(`${path}.condition`, crit.condition);
  if (crit.hiddenValues === undefined && crit.condition === undefined) throw sheetsError(path, "empty criteria");
}

function createSheetsService(env) {
  const noMatch = (name) =>
    new Error(`Exception: The parameters do not match the method signature for Sheets.Spreadsheets.${name}`);
  return {
    Spreadsheets: {
      get(id, optionalArgs) {
        if (env.sheetsFail)
          throw new Error("GoogleJsonResponseException: sheets.spreadsheets.get failed: Service unavailable");
        if (typeof id !== "string") throw noMatch("get");
        if (optionalArgs !== undefined && (optionalArgs === null || typeof optionalArgs !== "object"))
          throw noMatch("get");
        if (id !== env.ss.id) throw new Error(`GoogleJsonResponseException: Requested entity was not found: ${id}`);
        return {
          spreadsheetId: id,
          sheets: env.ss.sheets.map((sh) => ({
            properties: { sheetId: sh.id, title: sh.name },
            filterViews: env.ss.filterViews
              .filter((v) => v.range.sheetId === sh.id)
              .map((v) => ({ filterViewId: v.filterViewId, title: v.title })),
          })),
        };
      },
      batchUpdate(resource, id) {
        if (env.sheetsFail)
          throw new Error("GoogleJsonResponseException: sheets.spreadsheets.batchUpdate failed: Service unavailable");
        if (!resource || !Array.isArray(resource.requests) || typeof id !== "string") throw noMatch("batchUpdate");
        const work = env.ss.filterViews.map((v) => ({ ...v }));
        let nextId = env.ss.nextFilterViewId;
        const replies = [];
        const deprecated = [];
        resource.requests.forEach((req, i) => {
          const keys = Object.keys(req);
          const path = `[${i}]`;
          if (keys.length !== 1) throw sheetsError(path, "a request has exactly one field");
          const kind = keys[0];
          if (kind === "deleteFilterView") {
            const fid = req.deleteFilterView.filterId;
            const at = work.findIndex((v) => v.filterViewId === fid);
            if (at < 0) throw sheetsError(`${path}.deleteFilterView.filterId`, `no filter view ${fid}`);
            work.splice(at, 1);
            replies.push({});
          } else if (kind === "addFilterView") {
            const f = req.addFilterView.filter;
            const p = `${path}.addFilterView.filter`;
            if (!f || typeof f.title !== "string" || !f.title) throw sheetsError(`${p}.title`, "missing");
            const r = f.range;
            if (!r || !env.ss.sheets.some((sh) => sh.id === r.sheetId))
              throw sheetsError(`${p}.range.sheetId`, "no such sheet");
            for (const k of ["startRowIndex", "startColumnIndex", "endColumnIndex", "endRowIndex"]) {
              if (r[k] !== undefined && (!Number.isInteger(r[k]) || r[k] < 0))
                throw sheetsError(`${p}.range.${k}`, "must be a non-negative integer");
            }
            if (f.criteria !== undefined) {
              deprecated.push("FilterView.criteria");
              for (const [col, c] of Object.entries(f.criteria)) checkFilterCriteria(`${p}.criteria[${col}]`, c);
            }
            (f.filterSpecs || []).forEach((spec, j) => {
              if (!Number.isInteger(spec.columnIndex) || spec.columnIndex < 0)
                throw sheetsError(`${p}.filterSpecs[${j}].columnIndex`, "must be a non-negative integer");
              checkFilterCriteria(`${p}.filterSpecs[${j}].filterCriteria`, spec.filterCriteria);
            });
            (f.sortSpecs || []).forEach((spec, j) => {
              if (!Number.isInteger(spec.dimensionIndex) || spec.dimensionIndex < 0)
                throw sheetsError(`${p}.sortSpecs[${j}].dimensionIndex`, "must be a non-negative integer");
              if (!["ASCENDING", "DESCENDING"].includes(spec.sortOrder))
                throw sheetsError(`${p}.sortSpecs[${j}].sortOrder`, `unknown ${spec.sortOrder}`);
            });
            const filterViewId = nextId++;
            work.push({ ...f, filterViewId });
            replies.push({ addFilterView: { filter: { ...f, filterViewId } } });
          } else {
            throw sheetsError(path, `request ${kind} is not imitated by the mock`);
          }
        });
        env.ss.filterViews = work;
        env.ss.nextFilterViewId = nextId;
        env.deprecatedFields.push(...deprecated);
        return { spreadsheetId: id, replies };
      },
    },
  };
}

/** Builds the global objects of Apps Script around one environment. */
export function createGas(opts = {}) {
  const env = new Env(opts);
  const enumOf = (names) => Object.fromEntries(names.map((n) => [n, n]));

  // The answer of alert() and prompt() is a value of the enum Button. The reference compares it with ui.Button.YES and so
  // on and never says that String(button) is the name: here a value is an object that stringifies to nothing useful.
  const Button = Object.fromEntries(
    ["OK", "CANCEL", "YES", "NO", "CLOSE"].map((n) => [
      n,
      Object.freeze({ toString: () => "[object Button]", _name: n }),
    ]),
  );
  const buttonOf = (answer) => Button[answer] || Button.CLOSE;
  const SpreadsheetApp = {
    getActive: () => env.ss,
    getActiveSpreadsheet: () => env.ss,
    openById: (id) => {
      if (id !== env.ss.id) throw new Error(`No access to ${id}`);
      return env.ss;
    },
    getUi: () => ({
      createMenu: (title) => {
        const menu = { title, items: [], subs: [] };
        const api = {
          addItem(label, fn) {
            menu.items.push({ label, fn });
            return api;
          },
          addSeparator() {
            menu.items.push({ separator: true });
            return api;
          },
          addSubMenu(sub) {
            menu.items.push({ sub: sub._menu });
            return api;
          },
          addToUi() {
            env.menus.push(menu);
          },
          _menu: menu,
        };
        return api;
      },
      alert: (title, text, buttons) => {
        if (!env.uiAvailable) throw new Error("Exception: Cannot call SpreadsheetApp.getUi() from this context.");
        if (env.locked) env.dialogsUnderLock.push(title);
        env.alerts.push({ title, text, buttons });
        return buttonOf(env.alertAnswers.length ? env.alertAnswers.shift() : "YES");
      },
      prompt: (title, text) => {
        if (!env.uiAvailable) throw new Error("Exception: Cannot call SpreadsheetApp.getUi() from this context.");
        if (env.locked) env.dialogsUnderLock.push(title);
        env.prompts.push({ title, text });
        const a = env.promptAnswers.length ? env.promptAnswers.shift() : "";
        return {
          getSelectedButton: () => (a === null ? Button.CANCEL : Button.OK),
          getResponseText: () => (a === null ? "" : a),
        };
      },
      showSidebar: (html) => env.sidebars.push(html),
      showModalDialog: (html, title) => env.dialogs.push({ html, title }),
      ButtonSet: enumOf(["OK", "OK_CANCEL", "YES_NO", "YES_NO_CANCEL"]),
      Button: Button,
    }),
    flush: () => {
      env.dirty = false;
    },
    newDataValidation: () => new DataValidationBuilder(),
    newColor: () => {
      const st = { hex: null };
      const api = {
        setRgbColor(h) {
          if (typeof h !== "string" || !/^#[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Exception: Invalid color ${h}`);
          st.hex = h.toUpperCase();
          return api;
        },
        setThemeColor() {
          throw new Error("setThemeColor is not used by the CRM");
        },
        build() {
          if (!st.hex) throw new Error("Exception: the color has no value");
          return {
            _isColor: true,
            _hex: st.hex,
            asRgbColor: () => ({ asHexString: () => st.hex }),
            getColorType: () => "RGB",
          };
        },
      };
      return api;
    },
    newConditionalFormatRule: () => new CfBuilder(),
    newRichTextValue: () => new RichTextBuilder(),
    newTextStyle: () => new TextStyleBuilder(),
    BorderStyle: enumOf(["SOLID", "SOLID_MEDIUM", "SOLID_THICK", "DASHED", "DOTTED", "DOUBLE"]),
    BandingTheme: enumOf([
      "LIGHT_GREY",
      "CYAN",
      "GREEN",
      "YELLOW",
      "ORANGE",
      "BLUE",
      "TEAL",
      "GREY",
      "BROWN",
      "LIGHT_GREEN",
      "INDIGO",
      "PINK",
    ]),
    ProtectionType: enumOf(["RANGE", "SHEET"]),
    ThemeColorType: enumOf([
      "TEXT",
      "BACKGROUND",
      "ACCENT1",
      "ACCENT2",
      "ACCENT3",
      "ACCENT4",
      "ACCENT5",
      "ACCENT6",
      "HYPERLINK",
    ]),
    RecalculationInterval: enumOf(["ON_CHANGE", "MINUTE", "HOUR"]),
    WrapStrategy: enumOf(["WRAP", "OVERFLOW", "CLIP"]),
    GroupControlTogglePosition: enumOf(["BEFORE", "AFTER"]),
    Dimension: enumOf(["ROWS", "COLUMNS"]),
    DataValidationCriteria: enumOf(["CHECKBOX", "VALUE_IN_LIST", "VALUE_IN_RANGE"]),
  };

  const Charts = {
    ChartType: enumOf(["COLUMN", "BAR", "LINE", "AREA", "COMBO", "STEPPED_AREA", "SCATTER", "PIE", "TABLE"]),
    ChartMergeStrategy: enumOf(["MERGE_ROWS", "MERGE_COLUMNS"]),
    Position: enumOf(["TOP", "BOTTOM", "LEFT", "RIGHT", "NONE"]),
  };

  // Quotas of the reference: a value of a property is at most 9 KB (9216 bytes), all properties 500 KB
  const checkProp = (k, v) => {
    if (Buffer.byteLength(String(v), "utf8") > 9 * 1024)
      throw new Error(`Exception: The value of property ${k} is too large (the limit is 9 KB per value)`);
  };
  const propsApi = (map) => ({
    getProperty: (k) => (map.has(k) ? map.get(k) : null),
    setProperty(k, v) {
      checkProp(k, v);
      map.set(k, String(v));
      return this;
    },
    setProperties(o, del) {
      for (const [k, v] of Object.entries(o)) checkProp(k, v);
      if (del) map.clear();
      for (const [k, v] of Object.entries(o)) map.set(k, String(v));
      return this;
    },
    deleteProperty(k) {
      map.delete(k);
      return this;
    },
    getProperties: () => Object.fromEntries(map),
    getKeys: () => [...map.keys()],
  });
  const PropertiesService = {
    getScriptProperties: () => propsApi(env.scriptProps),
    getDocumentProperties: () => propsApi(env.docProps),
    getUserProperties: () => propsApi(env.userProps),
  };

  const LockService = {
    _make: () => ({
      waitLock(_ms) {
        // The text is Russian on purpose: the owner's interface is Russian, and the code must not look for a word in it
        if (env.lockHeldElsewhere)
          throw new Error("Превышено время ожидания: другой процесс слишком долго удерживал доступ");
        if (env.locked) throw new Error("Lock is already held by this execution");
        env.locked = true;
      },
      tryLock(_ms) {
        if (env.lockHeldElsewhere || env.locked) return false;
        env.locked = true;
        return true;
      },
      releaseLock() {
        if (env.dirty) env.unflushedReleases += 1;
        env.locked = false;
      },
      hasLock: () => env.locked,
    }),
    getDocumentLock() {
      return this._make();
    },
    getScriptLock() {
      return this._make();
    },
    getUserLock() {
      return this._make();
    },
  };

  const CacheService = {
    getScriptCache: () => ({
      get: (k) => (env.cache.has(k) ? env.cache.get(k) : null),
      put: (k, v) => {
        if (String(k).length > 250) throw new Error("Exception: Argument too large: key");
        if (String(v).length > 100 * 1024) throw new Error("Exception: Argument too large: value");
        env.cache.set(k, String(v));
      },
      remove: (k) => env.cache.delete(k),
    }),
    getDocumentCache: () => CacheService.getScriptCache(),
  };

  const triggerBuilder = (kind) => {
    // An installable trigger runs as the account that created it, and only that account sees it in getProjectTriggers
    const t = { kind, handler: "", id: `trg-${++env.triggerSeq}`, params: {}, owner: env.effectiveEmail };
    const api = {
      forSpreadsheet() {
        t.source = "spreadsheet";
        return api;
      },
      onEdit() {
        t.event = "ON_EDIT";
        return api;
      },
      onOpen() {
        t.event = "ON_OPEN";
        return api;
      },
      onChange() {
        t.event = "ON_CHANGE";
        return api;
      },
      timeBased() {
        t.event = "CLOCK";
        return api;
      },
      everyHours(n) {
        t.params.everyHours = n;
        return api;
      },
      everyDays(n) {
        t.params.everyDays = n;
        return api;
      },
      everyWeeks(n) {
        t.params.everyWeeks = n;
        return api;
      },
      onWeekDay(d) {
        t.params.weekDay = d;
        return api;
      },
      onMonthDay(d) {
        t.params.monthDay = d;
        return api;
      },
      atHour(h) {
        t.params.atHour = h;
        return api;
      },
      nearMinute(m) {
        t.params.nearMinute = m;
        return api;
      },
      inTimezone(z) {
        t.params.tz = z;
        return api;
      },
      after(ms) {
        t.params.after = ms;
        return api;
      },
      create() {
        env.triggers.push(t);
        return {
          getHandlerFunction: () => t.handler,
          getUniqueId: () => t.id,
          getEventType: () => t.event,
        };
      },
    };
    api.handler = t;
    return api;
  };
  const ScriptApp = {
    newTrigger: (fn) => {
      const b = triggerBuilder("new");
      b.handler.handler = fn;
      return b;
    },
    getProjectTriggers: () =>
      env.triggers
        .filter((t) => t.owner === env.effectiveEmail)
        .map((t) => ({
          getHandlerFunction: () => t.handler,
          getUniqueId: () => t.id,
          getEventType: () => t.event,
          _spec: t,
        })),
    deleteTrigger: (tr) => {
      env.triggers = env.triggers.filter((t) => t.id !== tr.getUniqueId());
    },
    getService: () => ({ getUrl: () => env.webAppUrl }),
    WeekDay: enumOf(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
    EventType: enumOf(["ON_EDIT", "ON_OPEN", "CLOCK", "ON_CHANGE"]),
  };

  const Utilities = {
    formatDate: (d, tz, pattern) => formatDate(d, tz, pattern),
    // The CRM must name the encoding of text it signs or hashes: the default one is not documented, and the platform
    // signs UTF-8 bytes. A text argument without a Charset is refused here so that no code can rely on the default.
    computeHmacSha256Signature: (value, key, charset) => {
      const needs = typeof value === "string" || typeof key === "string";
      if (needs && charset !== "UTF_8")
        throw new Error("Exception: computeHmacSha256Signature of text needs Utilities.Charset.UTF_8");
      const k = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
      const v = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
      return [...crypto.createHmac("sha256", k).update(v).digest()].map((b) => (b > 127 ? b - 256 : b));
    },
    computeDigest: (_alg, value, charset) => {
      if (typeof value === "string" && charset !== "UTF_8")
        throw new Error("Exception: computeDigest of text needs Utilities.Charset.UTF_8");
      const v = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
      return [...crypto.createHash("sha256").update(v).digest()].map((b) => (b > 127 ? b - 256 : b));
    },
    DigestAlgorithm: enumOf(["SHA_256", "MD5"]),
    MacAlgorithm: enumOf(["HMAC_SHA_256"]),
    base64Encode: (b) => (typeof b === "string" ? Buffer.from(b, "utf8") : Buffer.from(b)).toString("base64"),
    base64Decode: (s) => [...Buffer.from(s, "base64")].map((b) => (b > 127 ? b - 256 : b)),
    newBlob: (data, type, name) => ({
      data,
      type,
      name,
      getBytes: () => data,
      getName: () => name,
      getContentType: () => type,
    }),
    getUuid: () => crypto.randomUUID(),
    sleep: () => {},
    parseDate: (s) => new Date(s),
    Charset: enumOf(["UTF_8"]),
  };

  const UrlFetchApp = {
    fetch: (url, options = {}) => {
      env.fetches.push({ url, options });
      const res = env.fetchHandler ? env.fetchHandler(url, options) : { code: 200, body: '{"ok":true}' };
      return {
        getResponseCode: () => res.code,
        getContentText: () => res.body,
      };
    },
  };

  const MailApp = {
    sendEmail: (to, subject, body) => {
      env.mails.push(typeof to === "object" ? to : { to, subject, body });
    },
    getRemainingDailyQuota: () => 100,
  };

  const ContentService = {
    MimeType: enumOf(["JSON", "TEXT"]),
    createTextOutput: (text) => {
      const out = {
        text,
        mime: "TEXT",
        setMimeType: (m) => {
          out.mime = m;
          return out;
        },
        getContent: () => out.text,
      };
      return out;
    },
  };

  const HtmlService = {
    createHtmlOutput: (html) => {
      const out = {
        html,
        title: "",
        width: 0,
        setTitle: (t) => {
          out.title = t;
          return out;
        },
        setWidth: (w) => {
          out.width = w;
          return out;
        },
        setHeight: () => out,
        getContent: () => out.html,
      };
      return out;
    },
  };

  const Session = {
    getActiveUser: () => ({
      getEmail: () => {
        if (!env.scopes.includes("https://www.googleapis.com/auth/userinfo.email"))
          throw new Error("Exception: You do not have permission to call Session.getActiveUser (needs userinfo.email)");
        return env.userEmail;
      },
    }),
    getEffectiveUser: () => ({ getEmail: () => env.effectiveEmail }),
    getScriptTimeZone: () => "Asia/Tashkent",
  };

  const Logger = { log: (...a) => env.logs.push(a.join(" ")) };

  // Date is the real one, but `new Date()` without arguments follows env.now so that tests control the clock.
  return {
    env,
    globals: {
      ...(opts.sheetsService === false ? {} : { Sheets: createSheetsService(env) }),
      SpreadsheetApp,
      Charts,
      PropertiesService,
      LockService,
      CacheService,
      ScriptApp,
      Utilities,
      UrlFetchApp,
      MailApp,
      ContentService,
      HtmlService,
      Session,
      Logger,
    },
  };
}

/** Runs a function with `new Date()` and `Date.now()` of the given context pinned to env.now. */
export function pinClock(ctx, env) {
  const RealDate = vm.runInContext("Date", ctx);
  function PinnedDate(...args) {
    if (!new.target) return new RealDate(env.now.getTime()).toString();
    if (args.length === 0) return new RealDate(env.now.getTime());
    return new RealDate(...args);
  }
  PinnedDate.prototype = RealDate.prototype;
  PinnedDate.now = () => env.now.getTime();
  PinnedDate.UTC = RealDate.UTC;
  PinnedDate.parse = RealDate.parse;
  ctx.Date = PinnedDate;
}
