// Computes the formulas of the mock book with the evaluator: the scalar templates of the calculated columns of the table
// sheets, and the plain formulas of the other sheets (threshold, reserves summary, calculator). The values are written into
// the cells (the formulas stay), so the preview and the tests see what the sheet would show.
import { calc, evaluate, FormulaError, fromSerial, isDate, parse, Ref, toSerial } from "./formula-eval.mjs";

/** Value of a mock cell as the evaluator wants it. */
function colLetter(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function createComputer(project) {
  const { env, call, run } = project;
  const ss = env.ss;
  const L = run("NV_LAYOUT");
  const schema = JSON.parse(run("JSON.stringify(NV_SCHEMA)"));
  const _sheetNameOf = (key) => schema[key].title;
  const keyBySheetName = Object.fromEntries(Object.keys(schema).map((k) => [schema[k].title, k]));
  const cache = new Map();
  const errors = [];
  const resolved = {};
  const templateOf = (sheetKey, colKey) => {
    const id = `${sheetKey}.${colKey}`;
    if (!resolved[id]) {
      const col = schema[sheetKey].cols.find((c) => c.key === colKey);
      resolved[id] = call("nvResolveRefs", col.calc);
    }
    return resolved[id];
  };
  const trees = new Map();
  const treeOf = (text) => {
    if (!trees.has(text)) trees.set(text, parse(text));
    return trees.get(text);
  };
  const colIndexOf = (sheetKey, colKey) => L.firstCol + schema[sheetKey].cols.findIndex((c) => c.key === colKey);
  const calcCol = (sheetName, col) => {
    const key = keyBySheetName[sheetName];
    if (!key) return null;
    const i = col - L.firstCol;
    const def = schema[key];
    if (i < 0 || i >= def.cols.length || !def.cols[i].calc) return null;
    return { sheetKey: key, col: def.cols[i] };
  };

  function rawCell(sheetName, r, c) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return undefined;
    const cell = sh.cells.get(`${r},${c}`);
    return cell ? cell.v : undefined;
  }

  const ctxFor = (sheetName, extra = {}) => ({
    sheetName,
    getCell: (sheet, r, c) => cellValue(sheet, r, c),
    maxRows: (sheet) => (ss.getSheetByName(sheet) ? ss.getSheetByName(sheet).maxRows : 1000),
    named: (name) => {
      const range = ss.named.get(name);
      return range
        ? new Ref(range.sheet.name, range.row, range.col, range.row + range.numRows - 1, range.col + range.numCols - 1)
        : null;
    },
    now: env.now,
    // Functions written in Apps Script and called from cells
    custom: { NIVEL_PARTS_FROM_BUDGET: (...a) => call("NIVEL_PARTS_FROM_BUDGET", ...a) },
    ...extra,
  });

  /** The value of a cell, computing a formula cell when needed. */
  function cellValue(sheetName, r, c) {
    const calcInfo = calcCol(sheetName, c);
    if (calcInfo && r >= L.firstRow) return calcCell(calcInfo.sheetKey, calcInfo.col, r);
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return undefined;
    const cell = sh.cells.get(`${r},${c}`);
    if (cell?.f && !(r === L.headerRow && keyBySheetName[sheetName])) return plainFormula(sheetName, r, c, cell);
    return cell ? cell.v : undefined;
  }

  function calcCell(sheetKey, col, r) {
    const id = `${sheetKey}.${col.key}.${r}`;
    if (cache.has(id)) return cache.get(id);
    cache.set(id, null); // protects from a cycle
    const def = schema[sheetKey];
    const sheetName = def.title;
    const keyVal = rawCell(sheetName, r, colIndexOf(sheetKey, def.keyCol));
    let value = "";
    if (keyVal !== undefined && keyVal !== null && keyVal !== "") {
      const ctx = ctxFor(sheetName, {
        rowRef: (key) => {
          const c = def.cols.find((x) => x.key === key);
          if (!c) throw new FormulaError("#NAME?", `no column ${key}`);
          const v = cellValue(sheetName, r, colIndexOf(sheetKey, key));
          if (isDate(v)) return toSerial(v);
          return v === undefined || v === "" ? null : v;
        },
        rowIndex: r - L.firstRow + 1,
      });
      try {
        value = evaluate(treeOf(templateOf(sheetKey, col.key)), ctx);
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
        errors.push(
          `${sheetName}!${colLetter(colIndexOf(sheetKey, col.key))}${r} (${col.key}): ${e.code} ${e.message}`,
        );
        value = "#ERR";
      }
      if (value === null) value = "";
    }
    cache.set(id, value);
    return value;
  }

  function plainFormula(sheetName, r, c, cell) {
    const id = `${sheetName}!${r},${c}`;
    if (cache.has(id)) return cache.get(id);
    cache.set(id, null);
    let value;
    try {
      value = calc(cell.f, ctxFor(sheetName, { rowRef: () => null, rowIndex: 0 }));
    } catch (e) {
      if (!(e instanceof FormulaError)) throw e;
      value = e.code === "#N/A" ? "#N/A" : "#ERR";
      cell.error = `${e.code} ${e.message}`;
    }
    if (value === null) value = "";
    cache.set(id, value);
    return value;
  }

  /** Writes the values of all calculated columns of the data rows into the cells. */
  function computeTables() {
    Object.keys(schema).forEach((sheetKey) => {
      const def = schema[sheetKey];
      const sh = ss.getSheetByName(def.title);
      if (!sh) return;
      const calcCols = def.cols.filter((c) => c.calc);
      if (!calcCols.length) return;
      const keyIdx = colIndexOf(sheetKey, def.keyCol);
      // The title of a calculated column is the first row of its array formula
      calcCols.forEach((col) => {
        sh._cell(L.headerRow, colIndexOf(sheetKey, col.key)).v = col.title;
      });
      for (let r = L.firstRow; r <= sh.maxRows; r++) {
        const k = rawCell(def.title, r, keyIdx);
        if (k === undefined || k === null || k === "") continue;
        calcCols.forEach((col) => {
          let v = calcCell(sheetKey, col, r);
          if ((col.type === "date" || col.type === "dt") && typeof v === "number" && v > 0) v = fromSerial(v);
          const cellRef = sh._cell(r, colIndexOf(sheetKey, col.key));
          cellRef.v = v;
        });
      }
    });
  }

  /** Writes the values of the plain formulas of a sheet (threshold, reserves summary, calculator). */
  function computePlain(sheetName) {
    const sh = ss.getSheetByName(sheetName);
    for (const [k, cell] of sh.cells) {
      if (!cell.f) continue;
      const [r, c] = k.split(",").map(Number);
      if (keyBySheetName[sheetName] && r === L.headerRow) continue;
      let v = plainFormula(sheetName, r, c, cell);
      const nf = cell.nf || "";
      if (typeof v === "number" && /yyyy|dd\.mm/.test(nf) && v > 20000) v = fromSerial(v);
      cell.v = v;
    }
  }

  const maxRowsOf = (name) => (ss.getSheetByName(name) ? ss.getSheetByName(name).maxRows : 1000);
  const named = (name) => ctxFor("").named(name);
  return {
    cellValue,
    computeTables,
    computePlain,
    errors,
    cache,
    fromSerial,
    toSerial,
    maxRowsOf,
    named,
    plainFormula,
    ctxFor,
  };
}
