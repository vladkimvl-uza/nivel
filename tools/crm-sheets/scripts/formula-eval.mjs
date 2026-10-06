// A small evaluator of Google Sheets formulas: enough to check the scalar templates of the calculated columns, the
// conditional-formatting rules and the money formulas of the calculator against the mock sheets. It is not a spreadsheet
// engine: no arrays, no LAMBDA; the functions are the ones the CRM uses in its scalar formulas.
// Both notations are read: ";" and "," separate arguments.

export class FormulaError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const na = () => new FormulaError("#N/A");

/** A reference to a rectangular area of a sheet (1-based, inclusive). */
export class Ref {
  constructor(sheet, r1, c1, r2, c2) {
    this.sheet = sheet;
    this.r1 = r1;
    this.c1 = c1;
    this.r2 = r2;
    this.c2 = c2;
  }
  get single() {
    return this.r1 === this.r2 && this.c1 === this.c2;
  }
}

const RU_MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const RU_MONTHS_FULL = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
const TZ_MS = 5 * 3600000;
const EPOCH_SERIAL = 25569; // 1970-01-01 in the serial numbers of Sheets

/** Date -> serial number (days since 30.12.1899 in Tashkent time). */
/** Dates of the project come from another realm (the vm context), so `instanceof Date` cannot be used. */
export const isDate = (v) => Object.prototype.toString.call(v) === "[object Date]";
export const toSerial = (d) => (d.getTime() + TZ_MS) / 86400000 + EPOCH_SERIAL;
/** Serial number -> Date (the instant of that Tashkent wall time). */
export const fromSerial = (n) => new Date(Math.round((n - EPOCH_SERIAL) * 86400000) - TZ_MS);

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      while (i < n) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          break;
        }
        s += src[i++];
      }
      i++;
      tokens.push({ t: "str", v: s });
      continue;
    }
    if (ch === "[") {
      const j = src.indexOf("]", i);
      tokens.push({ t: "row", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      // A number directly followed by letters is not a number (a reference such as 1A is invalid anyway)
      tokens.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let name = "";
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            name += "'";
            j += 2;
            continue;
          }
          break;
        }
        name += src[j++];
      }
      j++; // closing quote
      if (src[j] !== "!") throw new FormulaError("#NAME?", "quoted name without !");
      j++;
      let k = j;
      while (k < n && /[A-Za-z0-9$:]/.test(src[k])) k++;
      tokens.push({ t: "ref", sheet: name, v: src.slice(j, k) });
      i = k;
      continue;
    }
    if (/[A-Za-zА-Яа-яЁё_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-zА-Яа-яЁё0-9_.$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      // Sheet!A1 without quotes
      if (src[j] === "!") {
        let k = j + 1;
        while (k < n && /[A-Za-z0-9$:]/.test(src[k])) k++;
        tokens.push({ t: "ref", sheet: word, v: src.slice(j + 1, k) });
        i = k;
        continue;
      }
      // A range A1:B2 / $B$6:$B / A:A
      if (/^\$?[A-Za-z]{1,3}\$?\d*$/.test(word) && src[j] === ":" && /[A-Za-z$0-9]/.test(src[j + 1] || "")) {
        let k = j + 1;
        while (k < n && /[A-Za-z0-9$]/.test(src[k])) k++;
        const second = src.slice(j + 1, k);
        if (/^\$?[A-Za-z]{1,3}\$?\d*$/.test(second)) {
          tokens.push({ t: "ref", sheet: null, v: `${word}:${second}` });
          i = k;
          continue;
        }
      }
      if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(word)) {
        tokens.push({ t: "ref", sheet: null, v: word });
        i = j;
        continue;
      }
      tokens.push({ t: "id", v: word });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      tokens.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/&=<>():;,%^".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw new FormulaError("#ERROR!", `unexpected character ${ch} at ${i} in ${src}`);
  }
  return tokens;
}

/** Parses into a tree: {k: "num"|"str"|"bool"|"ref"|"row"|"name"|"call"|"bin"|"neg"|"pct", ...}. */
export function parse(src) {
  const tokens = tokenize(src.replace(/^=/, ""));
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isOp = (v) => peek() && peek().t === "op" && peek().v === v;
  function primary() {
    const tk = next();
    if (!tk) throw new FormulaError("#ERROR!", "unexpected end");
    if (tk.t === "num") return { k: "num", v: tk.v };
    if (tk.t === "str") return { k: "str", v: tk.v };
    if (tk.t === "row") return { k: "row", v: tk.v };
    if (tk.t === "ref") return { k: "ref", sheet: tk.sheet, v: tk.v };
    if (tk.t === "op" && tk.v === "(") {
      const e = comparison();
      if (!isOp(")")) throw new FormulaError("#ERROR!", "missing )");
      next();
      return e;
    }
    if (tk.t === "op" && tk.v === "-") return { k: "neg", e: unary() };
    if (tk.t === "op" && tk.v === "+") return unary();
    if (tk.t === "id") {
      if (isOp("(")) {
        next();
        const args = [];
        if (isOp(")")) {
          next();
          return { k: "call", name: tk.v.toUpperCase(), args };
        }
        for (;;) {
          if (isOp(";") || isOp(",")) args.push({ k: "empty" });
          else args.push(comparison());
          if (isOp(";") || isOp(",")) {
            next();
            if (isOp(")")) {
              args.push({ k: "empty" });
              next();
              break;
            }
            continue;
          }
          if (isOp(")")) {
            next();
            break;
          }
          throw new FormulaError("#ERROR!", `bad arguments of ${tk.v}`);
        }
        return { k: "call", name: tk.v.toUpperCase(), args };
      }
      const up = tk.v.toUpperCase();
      if (up === "TRUE") return { k: "bool", v: true };
      if (up === "FALSE") return { k: "bool", v: false };
      return { k: "name", v: tk.v };
    }
    throw new FormulaError("#ERROR!", `unexpected token ${JSON.stringify(tk)}`);
  }
  function postfix() {
    let e = primary();
    while (isOp("%")) {
      next();
      e = { k: "pct", e };
    }
    while (isOp(":")) {
      next();
      e = { k: "range", a: e, b: primary() };
    }
    return e;
  }
  function unary() {
    if (isOp("-")) {
      next();
      return { k: "neg", e: unary() };
    }
    return postfix();
  }
  function mul() {
    let e = unary();
    while (isOp("*") || isOp("/")) {
      const op = next().v;
      e = { k: "bin", op, a: e, b: unary() };
    }
    return e;
  }
  function add() {
    let e = mul();
    while (isOp("+") || isOp("-")) {
      const op = next().v;
      e = { k: "bin", op, a: e, b: mul() };
    }
    return e;
  }
  function concat() {
    let e = add();
    while (isOp("&")) {
      next();
      e = { k: "bin", op: "&", a: e, b: add() };
    }
    return e;
  }
  function comparison() {
    let e = concat();
    while (peek() && peek().t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().v)) {
      const op = next().v;
      e = { k: "bin", op, a: e, b: concat() };
    }
    return e;
  }
  const tree = comparison();
  if (p < tokens.length) throw new FormulaError("#ERROR!", `extra tokens after the formula: ${src}`);
  return tree;
}

function colLetterToNum(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * ctx: {
 *   sheetName: current sheet, getCell(sheet, r, c) -> raw value, maxRows(sheet), maxCols(sheet),
 *   named(name) -> Ref | null, now: Date, rowRef(key) -> value (for [key]), rowIndex: number (for [#]),
 *   offset: {dr, dc}
 * }
 */
export function evaluate(tree, ctx) {
  const off = ctx.offset || { dr: 0, dc: 0 };
  function refOf(node) {
    const sheet = node.sheet || ctx.sheetName;
    const parts = node.v.split(":");
    const parse1 = (s) => {
      const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d*)$/.exec(s);
      if (!m) throw new FormulaError("#REF!", `bad reference ${s}`);
      return { absCol: m[1] === "$", col: colLetterToNum(m[2]), absRow: m[3] === "$", row: m[4] ? Number(m[4]) : null };
    };
    const a = parse1(parts[0]);
    const b = parts[1] ? parse1(parts[1]) : a;
    const rowMax = ctx.maxRows(sheet);
    const adjR = (x) => (x.row === null ? null : x.absRow ? x.row : x.row + off.dr);
    const adjC = (x) => (x.absCol ? x.col : x.col + off.dc);
    const r1 = adjR(a) ?? 1;
    const r2 = parts[1] ? (adjR(b) ?? rowMax) : r1;
    return new Ref(sheet, r1, adjC(a), r2, adjC(b));
  }
  function cellValue(sheet, r, c) {
    const v = ctx.getCell(sheet, r, c);
    if (isDate(v)) return toSerial(v);
    if (v === undefined || v === null || v === "") return null;
    return v;
  }
  function scalar(v) {
    if (v instanceof Ref) {
      if (v.single || v.r1 <= v.r2) return cellValue(v.sheet, v.r1, v.c1);
      return null;
    }
    return v;
  }
  function cellsOf(ref) {
    const out = [];
    for (let r = ref.r1; r <= ref.r2; r++) for (let c = ref.c1; c <= ref.c2; c++) out.push(cellValue(ref.sheet, r, c));
    return out;
  }
  function num(v) {
    v = scalar(v);
    if (v === null || v === "") return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    const n = Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) throw new FormulaError("#VALUE!", `not a number: ${v}`);
    return n;
  }
  function str(v) {
    v = scalar(v);
    if (v === null) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return String(v);
  }
  function bool(v) {
    v = scalar(v);
    if (typeof v === "boolean") return v;
    if (v === null || v === "") return false;
    if (typeof v === "number") return v !== 0;
    const s = String(v).toUpperCase();
    if (s === "TRUE") return true;
    if (s === "FALSE") return false;
    throw new FormulaError("#VALUE!", `not a boolean: ${v}`);
  }
  function compare(op, a, b) {
    a = scalar(a);
    b = scalar(b);
    // Blank equals "" and 0 and FALSE
    const isBlank = (x) => x === null || x === "";
    let x = a;
    let y = b;
    if (isBlank(x) && typeof y === "number") x = 0;
    else if (isBlank(y) && typeof x === "number") y = 0;
    else if (isBlank(x) && typeof y === "boolean") x = false;
    else if (isBlank(y) && typeof x === "boolean") y = false;
    else {
      if (isBlank(x)) x = "";
      if (isBlank(y)) y = "";
    }
    const rank = (v) => (typeof v === "number" ? 1 : typeof v === "string" ? 2 : 3);
    let cmp;
    if (rank(x) !== rank(y)) cmp = rank(x) - rank(y);
    else if (typeof x === "string")
      cmp = x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0;
    else cmp = x < y ? -1 : x > y ? 1 : 0;
    switch (op) {
      case "=":
        return cmp === 0;
      case "<>":
        return cmp !== 0;
      case "<":
        return cmp < 0;
      case ">":
        return cmp > 0;
      case "<=":
        return cmp <= 0;
      default:
        return cmp >= 0;
    }
  }
  function wildcard(pattern) {
    const esc = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${esc}$`, "i");
  }
  function matchCriterion(value, crit) {
    crit = scalar(crit);
    if (typeof crit === "boolean") return value === crit;
    if (typeof crit === "number") return typeof value === "number" && value === crit;
    let s = crit === null ? "" : String(crit);
    let op = "=";
    const m = /^(<>|<=|>=|<|>|=)(.*)$/.exec(s);
    if (m) {
      op = m[1];
      s = m[2];
    }
    if (s === "") return op === "<>" ? value !== null && value !== "" : value === null || value === "";
    const upper = s.toUpperCase();
    let operand;
    if (upper === "TRUE") operand = true;
    else if (upper === "FALSE") operand = false;
    else if (/^-?\d+(\.\d+)?$/.test(s)) operand = Number(s);
    else operand = s;
    if (typeof operand === "boolean") {
      const eq = value === operand;
      return op === "<>" ? !eq : eq;
    }
    if (typeof operand === "number") {
      if (typeof value !== "number") return op === "<>";
      return {
        "=": value === operand,
        "<>": value !== operand,
        "<": value < operand,
        ">": value > operand,
        "<=": value <= operand,
        ">=": value >= operand,
      }[op];
    }
    // text with wildcards
    if (op === "=" || op === "<>") {
      const eq = value !== null && value !== "" ? wildcard(operand).test(String(value)) : false;
      return op === "<>" ? !eq : eq;
    }
    if (typeof value !== "string") return false;
    return { "<": value < operand, ">": value > operand, "<=": value <= operand, ">=": value >= operand }[op];
  }
  function ymd(serial) {
    const d = fromSerial(Math.floor(serial));
    const l = new Date(d.getTime() + TZ_MS);
    return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(), wd: l.getUTCDay() };
  }
  const serialOfYmd = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + EPOCH_SERIAL;
  function isWork(serial, weekend, hol) {
    const wd = ymd(serial).wd; // 0 = Sunday
    const idx = wd === 0 ? 6 : wd - 1; // Monday first, as in the weekend string
    if (weekend[idx] === "1") return false;
    return !hol.includes(Math.floor(serial));
  }
  function holidays(arg) {
    if (arg === undefined || arg.k === "empty") return [];
    const v = ev(arg);
    if (v instanceof Ref)
      return cellsOf(v)
        .filter((x) => typeof x === "number")
        .map(Math.floor);
    return typeof v === "number" ? [Math.floor(v)] : [];
  }
  function textFormat(value, fmt) {
    const v = scalar(value);
    if (typeof v !== "number") return str(v);
    const f = fmt;
    if (/^0\.0%$/.test(f)) return `${(v * 100).toFixed(1).replace(".", ",")}%`;
    if (/^0%$/.test(f)) return `${Math.round(v * 100)}%`;
    if (/^\+0%;-0%;0%$/.test(f)) return `${(v > 0 ? "+" : "") + Math.round(v * 100)}%`;
    if (/^#,##0$/.test(f))
      return Math.round(v)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    if (/^0\.0$/.test(f)) return v.toFixed(1).replace(".", ",");
    if (/^0$/.test(f)) return String(Math.round(v));
    if (/dd|mm|yyyy|hh/.test(f)) {
      const d = fromSerial(v);
      const l = new Date(d.getTime() + TZ_MS);
      const p = (x, w = 2) => String(x).padStart(w, "0");
      // Tokens in order; "mm" after hours (or a colon) is minutes, otherwise the month.
      let out = "";
      let prev = "";
      const re = /yyyy|yy|mmmm|mmm|mm|dd|hh|ss|[^a-z]+/gi;
      let m = re.exec(f);
      while (m) {
        const t = m[0];
        let piece = t;
        if (t === "yyyy") piece = p(l.getUTCFullYear(), 4);
        else if (t === "yy") piece = p(l.getUTCFullYear() % 100);
        else if (t === "mmmm") piece = RU_MONTHS_FULL[l.getUTCMonth()];
        else if (t === "mmm") piece = RU_MONTHS[l.getUTCMonth()];
        else if (t === "mm") piece = prev === "hh" || prev === ":" ? p(l.getUTCMinutes()) : p(l.getUTCMonth() + 1);
        else if (t === "dd") piece = p(l.getUTCDate());
        else if (t === "hh") piece = p(l.getUTCHours());
        else if (t === "ss") piece = p(l.getUTCSeconds());
        out += piece;
        prev = /^[^a-z]+$/i.test(t) ? t.trim().slice(-1) || prev : t;
        m = re.exec(f);
      }
      return out;
    }
    return String(v);
  }
  const fns = {
    IF: (a) => (bool(ev(a[0])) ? ev(a[1]) : a[2] ? ev(a[2]) : false),
    IFS: (a) => {
      for (let i = 0; i + 1 < a.length; i += 2) if (bool(ev(a[i]))) return ev(a[i + 1]);
      throw na();
    },
    IFERROR: (a) => {
      try {
        const v = ev(a[0]);
        return v;
      } catch (e) {
        if (e instanceof FormulaError) return a[1] ? ev(a[1]) : "";
        throw e;
      }
    },
    SWITCH: (a) => {
      const key = scalar(ev(a[0]));
      let i = 1;
      for (; i + 1 < a.length; i += 2) if (compare("=", key, ev(a[i]))) return ev(a[i + 1]);
      if (i < a.length) return ev(a[i]);
      throw na();
    },
    AND: (a) => a.every((x) => bool(ev(x))),
    OR: (a) => a.some((x) => bool(ev(x))),
    NOT: (a) => !bool(ev(a[0])),
    COUNTA: (a) =>
      a
        .flatMap((x) => {
          const v = ev(x);
          return v instanceof Ref ? cellsOf(v) : [scalar(v)];
        })
        .filter((v) => v !== null && v !== "").length,
    COUNT: (a) =>
      a
        .flatMap((x) => {
          const v = ev(x);
          return v instanceof Ref ? cellsOf(v) : [scalar(v)];
        })
        .filter((v) => typeof v === "number").length,
    SUBTOTAL: (a) =>
      a
        .slice(1)
        .flatMap((x) => flatNums(ev(x)))
        .reduce((s, x) => s + x, 0),
    TRUE: () => true,
    FALSE: () => false,
    MAX: (a) => Math.max(...a.flatMap((x) => flatNums(ev(x)))),
    MIN: (a) => Math.min(...a.flatMap((x) => flatNums(ev(x)))),
    SUM: (a) => a.flatMap((x) => flatNums(ev(x))).reduce((s, x) => s + x, 0),
    ABS: (a) => Math.abs(num(ev(a[0]))),
    INT: (a) => Math.floor(num(ev(a[0]))),
    MOD: (a) => {
      const x = num(ev(a[0]));
      const y = num(ev(a[1]));
      return x - y * Math.floor(x / y);
    },
    ROUND: (a) => {
      const f = 10 ** num(ev(a[1]));
      return Math.round(num(ev(a[0])) * f) / f;
    },
    QUOTIENT: (a) => {
      const y = num(ev(a[1]));
      if (y === 0) throw new FormulaError("#DIV/0!");
      return Math.trunc(num(ev(a[0])) / y);
    },
    CEILING: (a) => {
      const x = num(ev(a[0]));
      const s = num(ev(a[1]));
      return s === 0 ? 0 : Math.ceil(x / s) * s;
    },
    LEFT: (a) => str(ev(a[0])).slice(0, a[1] ? num(ev(a[1])) : 1),
    RIGHT: (a) => str(ev(a[0])).slice(-(a[1] ? num(ev(a[1])) : 1)),
    LEN: (a) => str(ev(a[0])).length,
    SEARCH: (a) => {
      const i = str(ev(a[1]))
        .toLowerCase()
        .indexOf(str(ev(a[0])).toLowerCase());
      if (i < 0) throw new FormulaError("#VALUE!");
      return i + 1;
    },
    ISNUMBER: (a) => typeof scalar(ev(a[0])) === "number",
    ISBLANK: (a) => scalar(ev(a[0])) === null,
    TO_TEXT: (a) => str(ev(a[0])),
    TEXT: (a) => textFormat(ev(a[0]), str(ev(a[1]))),
    REGEXMATCH: (a) => new RegExp(str(ev(a[1]))).test(str(ev(a[0]))),
    CONCATENATE: (a) => a.map((x) => str(ev(x))).join(""),
    TODAY: () => Math.floor(toSerial(ctx.now)),
    NOW: () => toSerial(ctx.now),
    DATE: (a) => {
      const y = num(ev(a[0]));
      const m = num(ev(a[1]));
      const d = num(ev(a[2]));
      return Date.UTC(y, m - 1, d) / 86400000 + EPOCH_SERIAL;
    },
    YEAR: (a) => ymd(num(ev(a[0]))).y,
    MONTH: (a) => ymd(num(ev(a[0]))).m,
    DAY: (a) => ymd(num(ev(a[0]))).d,
    EDATE: (a) => {
      const s = num(ev(a[0]));
      const { y, m, d } = ymd(s);
      const idx = y * 12 + (m - 1) + num(ev(a[1]));
      const ny = Math.floor(idx / 12);
      const nm = (idx % 12) + 1;
      const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
      return serialOfYmd(ny, nm, Math.min(d, last)) + (s - Math.floor(s));
    },
    EOMONTH: (a) => {
      const { y, m } = ymd(num(ev(a[0])));
      const idx = y * 12 + (m - 1) + num(ev(a[1]));
      return serialOfYmd(Math.floor(idx / 12), (idx % 12) + 1 + 1, 0);
    },
    TIMEVALUE: (a) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(str(ev(a[0])));
      if (!m) throw new FormulaError("#VALUE!");
      return (Number(m[1]) * 60 + Number(m[2])) / 1440;
    },
    TIME: (a) => (num(ev(a[0])) * 3600 + num(ev(a[1])) * 60 + num(ev(a[2]))) / 86400,
    "WORKDAY.INTL": (a) => {
      let s = Math.floor(num(ev(a[0])));
      let n = num(ev(a[1]));
      const weekend = a[2] && a[2].k !== "empty" ? str(ev(a[2])) : "0000011";
      const hol = holidays(a[3]);
      const step = n >= 0 ? 1 : -1;
      n = Math.abs(n);
      while (n > 0) {
        s += step;
        if (isWork(s, weekend, hol)) n--;
      }
      return s;
    },
    "NETWORKDAYS.INTL": (a) => {
      const s = Math.floor(num(ev(a[0])));
      const e = Math.floor(num(ev(a[1])));
      const weekend = a[2] && a[2].k !== "empty" ? str(ev(a[2])) : "0000011";
      const hol = holidays(a[3]);
      let n = 0;
      for (let d = Math.min(s, e); d <= Math.max(s, e); d++) if (isWork(d, weekend, hol)) n++;
      return s <= e ? n : -n;
    },
    COUNTIF: (a) => {
      const r = ev(a[0]);
      return cellsOf(r).filter((v) => matchCriterion(v, ev(a[1]))).length;
    },
    COUNTIFS: (a) => countMatches(a, 0).length,
    SUMIFS: (a) => {
      const sumRef = ev(a[0]);
      return countMatches(a, 1).reduce((s, idx) => {
        const v = cellValueAt(sumRef, idx);
        return s + (typeof v === "number" ? v : 0);
      }, 0);
    },
    MAXIFS: (a) => {
      const ref = ev(a[0]);
      const vals = countMatches(a, 1)
        .map((idx) => cellValueAt(ref, idx))
        .filter((v) => typeof v === "number");
      return vals.length ? Math.max(...vals) : 0;
    },
    XLOOKUP: (a) => {
      const key = scalar(ev(a[0]));
      const look = cellsOf(ev(a[1]));
      const ret = cellsOf(ev(a[2]));
      const i = look.findIndex(
        (v) => v !== null && key !== null && String(v).toLowerCase() === String(key).toLowerCase(),
      );
      if (i < 0) throw na();
      return ret[i] === undefined ? null : ret[i];
    },
    INDEX: (a) => {
      const r = ev(a[0]);
      const i = a[1] && a[1].k !== "empty" ? num(ev(a[1])) : 1;
      const j = a[2] && a[2].k !== "empty" ? num(ev(a[2])) : 1;
      if (!(r instanceof Ref)) return r;
      if (r.c1 === r.c2) return new Ref(r.sheet, r.r1 + i - 1, r.c1, r.r1 + i - 1, r.c1);
      return new Ref(r.sheet, r.r1 + i - 1, r.c1 + j - 1, r.r1 + i - 1, r.c1 + j - 1);
    },
    INDIRECT: (a) => {
      const name = str(ev(a[0]));
      const named = ctx.named(name);
      if (named) return named;
      return refOf({ sheet: null, v: name });
    },
    ROW: (a) => {
      const r = ev(a[0]);
      return r instanceof Ref ? r.r1 : 0;
    },
  };
  function flatNums(v) {
    if (v instanceof Ref) return cellsOf(v).filter((x) => typeof x === "number");
    const s = scalar(v);
    return [num(s)];
  }
  function cellValueAt(ref, idx) {
    const rows = ref.r2 - ref.r1 + 1;
    return cellValue(ref.sheet, ref.r1 + (idx % rows), ref.c1 + Math.floor(idx / rows));
  }
  /** Indices of the rows (in a column-major listing of the first criteria range) that match all the criteria. */
  function countMatches(a, from) {
    const pairs = [];
    for (let i = from; i + 1 < a.length; i += 2) pairs.push([ev(a[i]), ev(a[i + 1])]);
    if (!pairs.length) return [];
    const lists = pairs.map((p) => cellsOf(p[0]));
    const n = lists[0].length;
    const out = [];
    for (let i = 0; i < n; i++) {
      if (pairs.every((p, k) => matchCriterion(lists[k][i], p[1]))) out.push(i);
    }
    return out;
  }
  function ev(node) {
    switch (node.k) {
      case "num":
        return node.v;
      case "str":
        return node.v;
      case "bool":
        return node.v;
      case "empty":
        return null;
      case "row": {
        if (node.v === "#") return ctx.rowIndex;
        return ctx.rowRef(node.v);
      }
      case "ref":
        return refOf(node);
      case "name": {
        const r = ctx.named(node.v);
        if (!r) throw new FormulaError("#NAME?", `unknown name ${node.v}`);
        return r;
      }
      case "range": {
        const a = ev(node.a);
        const b = ev(node.b);
        if (!(a instanceof Ref) || !(b instanceof Ref)) throw new FormulaError("#VALUE!");
        return new Ref(a.sheet, Math.min(a.r1, b.r1), Math.min(a.c1, b.c1), Math.max(a.r2, b.r2), Math.max(a.c2, b.c2));
      }
      case "neg":
        return -num(ev(node.e));
      case "pct":
        return num(ev(node.e)) / 100;
      case "bin": {
        const a = ev(node.a);
        const b = ev(node.b);
        switch (node.op) {
          case "+":
            return num(a) + num(b);
          case "-":
            return num(a) - num(b);
          case "*":
            return num(a) * num(b);
          case "/": {
            const d = num(b);
            if (d === 0) throw new FormulaError("#DIV/0!");
            return num(a) / d;
          }
          case "&":
            return str(a) + str(b);
          default:
            return compare(node.op, a, b);
        }
      }
      case "call": {
        const f = fns[node.name];
        if (!f) {
          const custom = ctx.custom?.[node.name];
          if (!custom) throw new FormulaError("#NAME?", `unsupported function ${node.name}`);
          return custom(...node.args.map((x) => scalar(ev(x))));
        }
        return f(node.args);
      }
      default:
        throw new FormulaError("#ERROR!", `bad node ${node.k}`);
    }
  }
  const result = ev(tree);
  return scalar(result);
}

/** Convenience: parse and evaluate. */
export function calc(src, ctx) {
  return evaluate(parse(src), ctx);
}
