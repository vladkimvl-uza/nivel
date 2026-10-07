/**
 * Formula helpers. Templates are written the way the owner sees them in the ru_RU interface (";" between arguments,
 * "\" between columns of an array literal). Apps Script's setFormula wants the US notation (",", and the same ";" between
 * rows of a literal), so every template goes through nvApiFormula before it is written.
 */

/** ru_RU notation -> the notation of setFormula. Text inside double quotes is left untouched. */
function nvApiFormula(formula) {
  const stack = [];
  let out = "";
  let inString = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (inString) {
      out += ch;
      if (ch === '"') {
        if (formula[i + 1] === '"') {
          out += '"';
          i++;
        } else inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "(" || ch === "{") {
      stack.push(ch);
      out += ch;
    } else if (ch === ")" || ch === "}") {
      stack.pop();
      out += ch;
    } else if (ch === ";") {
      out += stack.length && stack[stack.length - 1] === "{" ? ";" : ",";
    } else if (ch === "\\" && stack.length && stack[stack.length - 1] === "{") {
      out += ",";
    } else out += ch;
  }
  return out;
}

/** Splits a formula into tokens outside of strings: used by the tests to check references and functions. */
function nvFormulaOutsideStrings(formula) {
  let out = "";
  let inString = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (inString) {
      if (ch === '"') {
        if (formula[i + 1] === '"') i++;
        else inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += '"';
    } else out += ch;
  }
  return out;
}

/** Keys of the columns used as [key] in a scalar template, in order of appearance, without duplicates. */
function nvTemplateDeps(template) {
  const seen = [];
  const re = /\[([A-Za-z][A-Za-z0-9]*)\]/g;
  let m = re.exec(template);
  while (m) {
    if (seen.indexOf(m[1]) < 0) seen.push(m[1]);
    m = re.exec(template);
  }
  return seen;
}

/** {sheet.key} -> the open-ended range of a column of a table sheet (or a named sheet of a special layout). */
function nvResolveRefs(template) {
  return template.replace(/\{([a-z]+)\.([A-Za-z0-9]+)\}/g, (_, sheet, key) => nvColRange(sheet, key, true));
}

/**
 * The header formula of a calculated column: one MAP over the whole columns.
 * ={"Title"; MAP(keyRange; depRange...; LAMBDA(key_; dep_...; IF(key_=""; ""; <scalar expression>)))}
 */
function nvCalcFormula(sheetKey, col) {
  const def = NV_SCHEMA[sheetKey];
  const template = nvResolveRefs(col.calc);
  const usesIndex = /\[#\]/.test(template);
  const deps = nvTemplateDeps(template.replace(/\[#\]/g, ""));
  const params = [def.keyCol];
  deps.forEach((d) => {
    if (params.indexOf(d) < 0) params.push(d);
  });
  const ranges = params.map((k) => nvColRange(sheetKey, k, false));
  const names = params.map((k) => k + "_");
  if (usesIndex) {
    ranges.push("SEQUENCE(ROWS(" + nvColRange(sheetKey, def.keyCol, false) + "))");
    names.push("i_");
  }
  let expr = template.replace(/\[#\]/g, "i_");
  expr = expr.replace(/\[([A-Za-z][A-Za-z0-9]*)\]/g, "$1_");
  return (
    '={"' +
    col.title.replace(/"/g, '""') +
    '"; MAP(' +
    ranges.join("; ") +
    "; LAMBDA(" +
    names.join("; ") +
    "; IF(" +
    def.keyCol +
    '_=""; ""; ' +
    expr +
    ")))}"
  );
}

/** Same-sheet range for the captions: [[key]] -> $X$6:$X. */
function nvResolveCaption(sheetKey, text) {
  return text.replace(/\[\[([A-Za-z0-9]+)\]\]/g, (_, key) => nvColRange(sheetKey, key, false));
}

/** Number of unmatched brackets or quotes in a formula; 0 for a well-formed one. */
function nvFormulaBalance(formula) {
  const stack = [];
  let inString = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (inString) {
      if (ch === '"') {
        if (formula[i + 1] === '"') i++;
        else inString = false;
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "(" || ch === "{") stack.push(ch);
    else if (ch === ")" || ch === "}") {
      const top = stack.pop();
      if ((ch === ")" && top !== "(") || (ch === "}" && top !== "{")) return 1;
    }
  }
  return stack.length + (inString ? 1 : 0);
}

/** A formula quoted for a string cell in a SPARKLINE or a message: doubles the quotes. */
function nvQ(text) {
  return '"' + String(text).replace(/"/g, '""') + '"';
}
