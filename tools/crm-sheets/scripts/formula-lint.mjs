// A static check of formulas against what the documentation of Google Sheets says (and does not say). It reads formulas
// in the notation of the API (commas between arguments) and returns the places where the formula leans on something the
// documentation does not promise. Used by the tests over every formula of the mock book: cells, data validation, rules of
// conditional formatting.

/** The text of the formula with the contents of the strings blanked out (quotes kept), so that no rule reads a string. */
export function blankStrings(f) {
  let out = "";
  let inString = false;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (inString) {
      if (ch === '"') {
        if (f[i + 1] === '"') {
          out += "  ";
          i++;
        } else {
          inString = false;
          out += '"';
        }
      } else out += " ";
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

/** Calls NAME( ... ) outside strings: {start, args: [text of each top-level argument, trimmed]}. */
export function findCalls(f, name) {
  const blank = blankStrings(f);
  const found = [];
  const re = new RegExp(`(^|[^A-Za-z0-9_.])(${name.replace(/\./g, "\\.")})\\(`, "gi");
  for (let m = re.exec(blank); m; m = re.exec(blank)) {
    const open = m.index + m[1].length + m[2].length;
    let depth = 0;
    let brace = 0;
    let argStart = open + 1;
    const args = [];
    let i = open;
    for (; i < blank.length; i++) {
      const ch = blank[i];
      if (ch === '"') {
        // skip to the closing quote in the blanked text
        i++;
        while (i < blank.length && blank[i] !== '"') i++;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          args.push(f.slice(argStart, i).trim());
          break;
        }
      } else if (ch === "{") brace++;
      else if (ch === "}") brace--;
      else if (ch === "," && depth === 1 && brace === 0) {
        args.push(f.slice(argStart, i).trim());
        argStart = i + 1;
      }
    }
    found.push({ start: m.index + m[1].length, args });
  }
  return found;
}

const STRING_LITERAL = /^"(?:[^"]|"")*"$/;
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?$/;

/** Is the argument a scalar written out (a string, a number, TRUE or FALSE), not a range or an array? */
export function isScalarLiteral(arg) {
  return STRING_LITERAL.test(arg) || NUMBER_LITERAL.test(arg) || /^(TRUE|FALSE)$/i.test(arg);
}

/** Names that Sheets (or a reader of R1C1 notation) may take for a reference: r, c, rc, r1c1, A1, AB12. */
export function isRiskyName(name) {
  return /^(?:[rc]\d*|r\d*c\d*|[a-z]{1,3}\d+)$/i.test(name);
}

const IFS_FAMILY = ["COUNTIFS", "SUMIFS", "AVERAGEIFS", "MAXIFS", "MINIFS", "COUNTIF", "SUMIF"];
const RANGE_FIRST = new Set(["SUMIFS", "AVERAGEIFS", "MAXIFS", "MINIFS"]); // the first argument is a range too, then pairs

/** Options each SPARKLINE type accepts, by the table of options of the Google Sheets help (support 3093289). */
export const SPARKLINE_OPTIONS = {
  line: ["charttype", "xmin", "xmax", "ymin", "ymax", "color", "empty", "nan", "rtl", "linewidth"],
  column: [
    "charttype",
    "ymin",
    "ymax",
    "color",
    "firstcolor",
    "lastcolor",
    "highcolor",
    "lowcolor",
    "axis",
    "axiscolor",
    "empty",
    "nan",
    "negcolor",
    "rtl",
  ],
  winloss: [
    "charttype",
    "ymin",
    "ymax",
    "color",
    "firstcolor",
    "lastcolor",
    "highcolor",
    "lowcolor",
    "axis",
    "axiscolor",
    "empty",
    "nan",
    "negcolor",
    "rtl",
  ],
  bar: ["charttype", "max", "color1", "color2", "empty", "nan", "rtl"],
};

/** The rows of the options literal of a SPARKLINE: [[name, valueText], ...]; null when it is not a literal. */
export function sparklineOptions(f) {
  const out = [];
  for (const call of findCalls(f, "SPARKLINE")) {
    const lit = call.args[1];
    if (lit?.[0] !== "{") continue;
    const inner = lit.slice(1, -1);
    // rows are separated by ";" outside strings, brackets and braces
    const blank = blankStrings(inner);
    const rows = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < blank.length; i++) {
      const ch = blank[i];
      if (ch === "(" || ch === "{") depth++;
      else if (ch === ")" || ch === "}") depth--;
      else if (ch === ";" && depth === 0) {
        rows.push(inner.slice(from, i));
        from = i + 1;
      }
    }
    rows.push(inner.slice(from));
    const opts = rows.map((r) => {
      const b = blankStrings(r);
      let d = 0;
      let cut = -1;
      for (let i = 0; i < b.length; i++) {
        if (b[i] === "(" || b[i] === "{") d++;
        else if (b[i] === ")" || b[i] === "}") d--;
        else if (b[i] === "," && d === 0) {
          cut = i;
          break;
        }
      }
      const name = (cut < 0 ? r : r.slice(0, cut)).trim().replace(/^"|"$/g, "");
      return [name, cut < 0 ? "" : r.slice(cut + 1).trim()];
    });
    out.push(opts);
  }
  return out;
}

/**
 * Checks one formula. ctx: {sheet, isOtherSheetName(name), where: "cell"|"validation"|"format"}.
 * Returns a list of {rule, text}.
 */
export function lintFormula(f, ctx = {}) {
  const problems = [];
  const add = (rule, text) => problems.push({ rule, text });
  const blank = blankStrings(f);

  // HSTACK does not repeat a scalar down the height of the other arguments: it pads them with #N/A
  for (const call of findCalls(f, "HSTACK")) {
    call.args.forEach((a, i) => {
      if (isScalarLiteral(a)) add("hstack-scalar", `HSTACK argument ${i + 1} is the scalar ${a.slice(0, 40)}`);
    });
  }

  // Names of LAMBDA and LET: not a reference-like word
  for (const call of findCalls(f, "LAMBDA")) {
    call.args.slice(0, -1).forEach((a) => {
      if (isRiskyName(a)) add("risky-name", `LAMBDA parameter ${a} reads like a reference`);
    });
  }
  for (const call of findCalls(f, "LET")) {
    call.args.forEach((a, i) => {
      if (i % 2 === 0 && i < call.args.length - 1 && isRiskyName(a))
        add("risky-name", `LET name ${a} reads like a reference`);
    });
  }

  // COUNTIFS and the like are described for ranges, not for arrays computed on the fly
  for (const name of IFS_FAMILY) {
    for (const call of findCalls(f, name)) {
      call.args.forEach((a, i) => {
        const isRange = RANGE_FIRST.has(name) ? i === 0 || i % 2 === 1 : i % 2 === 0;
        if (isRange) {
          if (
            /^(?:INDEX\(\s*[a-z][a-z0-9_]*\s*,|FILTER\(|SORT\(|SORTN\(|CHOOSECOLS\(|ARRAYFORMULA\(|SEQUENCE\(|\{)/i.test(
              a,
            )
          )
            add("ifs-array", `${name} range argument ${i + 1} is a computed array: ${a.slice(0, 50)}`);
        } else if (/FILTER\(|SEQUENCE\(|^\{/i.test(a)) {
          add("ifs-array", `${name} criterion ${i + 1} is an array: ${a.slice(0, 50)}`);
        }
      });
    }
  }

  // XLOOKUP: the key is one value
  for (const call of findCalls(f, "XLOOKUP")) {
    const key = call.args[0] || "";
    if (/^(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)?!?\$?[A-Za-z]+\$?\d*:\$?[A-Za-z]*\$?\d*$/.test(key) || /!.*:/.test(key))
      add("xlookup-array", `XLOOKUP key is a range: ${key.slice(0, 50)}`);
  }

  // HYPERLINK: only the protocols of the reference; an anchor "#gid=" is not one of them
  if (/"#gid=/.test(f)) add("hyperlink-anchor", "a link that starts with #gid= (the reference lists the protocols)");

  // INDIRECT: the argument is "a cell reference, written as a string", not the name of a named range
  for (const call of findCalls(f, "INDIRECT")) {
    const a = call.args[0] || "";
    if (STRING_LITERAL.test(a)) {
      const text = a.slice(1, -1);
      if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(text) && !/^[A-Za-z]{1,3}\d+$/.test(text))
        add("indirect-name", `INDIRECT("${text}") names a range instead of an address`);
    }
  }

  // Another sheet in data validation and conditional formatting: through INDIRECT only
  if (ctx.isOtherSheetName && (ctx.where === "validation" || ctx.where === "format")) {
    for (const m of blank.matchAll(/(?:^|[^A-Za-z0-9_.])((?:NV|NVD|TH|ND|P|CALC)_[A-Z0-9_]+)(?![A-Za-z0-9_(])/g)) {
      if (ctx.isOtherSheetName(m[1]))
        add("other-sheet-name", `${m[1]} lies on another sheet and is not inside INDIRECT`);
    }
    for (const m of blank.matchAll(/(?:'[^']+'|[A-Za-zА-Яа-я_][A-Za-zА-Яа-я0-9_]*)!/g)) {
      if (ctx.sheet && m[0].replace(/^'|'?!$/g, "") !== ctx.sheet)
        add("other-sheet-ref", `${m[0]} points to another sheet and is not inside INDIRECT`);
    }
  }

  // SPARKLINE options by type
  for (const opts of sparklineOptions(f)) {
    const type = (opts.find((o) => o[0] === "charttype") || ["", '"line"'])[1].replace(/^"|"$/g, "");
    const allowed = SPARKLINE_OPTIONS[type];
    if (!allowed) {
      add("sparkline-type", `unknown SPARKLINE type ${type}`);
      continue;
    }
    for (const [name] of opts) {
      if (!allowed.includes(name)) add("sparkline-option", `option ${name} is not a ${type} option`);
    }
  }

  return problems;
}
