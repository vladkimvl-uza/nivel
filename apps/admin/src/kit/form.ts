// admin kit: from submitted text to a typed value, and from validation errors to Russian messages. The same reader
// serves HTML forms and CSV rows (a row is just another source of named fields), so a position imported from a file and
// a position typed by hand pass through one set of rules.
import { armOf, type FieldNode } from "./schema.ts";

/** Suffix of the checkbox "unknown" next to a structured field: ticked means `null`. */
export const UNKNOWN_SUFFIX = "__unknown";
/** Suffix of the hidden number of rows of a repeated group. */
export const COUNT_SUFFIX = "__count";
/** Suffix of the hidden marker of a group of checkboxes: no box ticked is then "none", not "the field is missing". */
export const PRESENT_SUFFIX = "__present";
/** The separator of several values inside one CSV cell. */
export const CELL_LIST_SEPARATOR = "|";

export interface FieldSource {
  /** The text of a field; `null` when the field is not there at all. */
  get(name: string): string | null;
  /** All values of a field that may repeat (a group of checkboxes). */
  getAll(name: string): string[];
  /** Names of every field, to find rows of repeated groups in a file. */
  names(): string[];
}

export const nameOf = (path: readonly string[]): string => path.join(".");

export function formDataSource(data: FormData): FieldSource {
  return {
    get(name) {
      const v = data.get(name);
      return typeof v === "string" ? v : null;
    },
    getAll: (name) => data.getAll(name).filter((v): v is string => typeof v === "string"),
    names: () => [...new Set([...data.keys()])],
  };
}

/** One CSV row as a source: the header gives the names. */
export function cellsSource(header: readonly string[], row: readonly string[]): FieldSource {
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    const name = h.trim();
    if (name !== "" && !index.has(name)) index.set(name, i);
  });
  const cell = (name: string): string | null => {
    const i = index.get(name);
    return i === undefined ? null : (row[i] ?? "");
  };
  return {
    get: cell,
    getAll(name) {
      const text = cell(name);
      return text === null || text.trim() === "" ? [] : text.split(CELL_LIST_SEPARATOR).map((s) => s.trim());
    },
    names: () => [...index.keys()],
  };
}

export function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export interface ReadOptions {
  /** The value being edited: fields that were not on the page keep their stored value. */
  previous?: unknown;
  /** Names (dotted) the page did not show; they keep `previous` instead of becoming blank. */
  keep?: (name: string) => boolean;
}

export interface ReadResult {
  value: unknown;
  /** Reading problems by dotted path: text that could not be a number, broken JSON, no variant chosen. */
  problems: Record<string, string>;
}

interface Ctx {
  source: FieldSource;
  opts: ReadOptions;
  problems: Record<string, string>;
}

const YES = new Set(["true", "да", "yes", "y", "1", "+"]);
const NO = new Set(["false", "нет", "no", "n", "0", "-"]);

const isBlank = (raw: string | null): boolean => raw === null || raw.trim() === "";

/** What an empty field becomes: unknown for a nullable one, nothing for the rest (validation then names it). */
function blank(node: FieldNode): null | undefined {
  return node.nullable ? null : undefined;
}

function parseNumber(raw: string, integer: boolean): number | null {
  const text = raw.trim().replace(/[\s ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return integer && !Number.isInteger(n) ? null : n;
}

function scalar(node: FieldNode, raw: string, name: string, ctx: Ctx): unknown {
  const text = raw.trim();
  switch (node.kind) {
    case "number":
    case "integer": {
      const n = parseNumber(text, node.kind === "integer");
      if (n !== null) return n;
      ctx.problems[name] =
        node.kind === "integer" && parseNumber(text, false) !== null ? "Нужно целое число." : "Нужно число.";
      return raw;
    }
    case "boolean": {
      const lower = text.toLowerCase();
      if (YES.has(lower)) return true;
      if (NO.has(lower)) return false;
      ctx.problems[name] = "Выберите «да» или «нет».";
      return raw;
    }
    case "select": {
      if (node.numericOptions) {
        const n = parseNumber(text, false);
        return n === null ? raw : n;
      }
      return text;
    }
    default:
      return text;
  }
}

function listItems(raw: string): string[] {
  return raw
    .split(/[\n\r;,|]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.every(isEmptyValue);
  return false;
}

function readNode(node: FieldNode, at: string[], ctx: Ctx): unknown {
  const name = nameOf(at);
  if (ctx.opts.keep?.(name)) {
    const kept = valueAt(ctx.opts.previous, at);
    return kept === undefined ? blank(node) : kept;
  }
  const structured =
    node.kind === "multiselect" ||
    node.kind === "array" ||
    node.kind === "group" ||
    node.kind === "record" ||
    node.kind === "tuple" ||
    node.kind === "list";
  if (node.nullable && structured && ctx.source.get(`${name}.${UNKNOWN_SUFFIX}`) !== null) return null;

  switch (node.kind) {
    case "literal":
      return node.literal;

    case "multiselect": {
      const there = ctx.source.get(`${name}.${PRESENT_SUFFIX}`) !== null || ctx.source.names().includes(name);
      // A file without the column, or with a blank cell, says nothing: unknown. A form always sends its marker.
      if (!there || (ctx.source.get(name) !== null && isBlank(ctx.source.get(name)))) {
        if (node.nullable) return null;
      }
      const picked = ctx.source.getAll(name);
      const allowed = new Set((node.options ?? []).map((o) => o.value));
      const known = picked.filter((v) => allowed.has(v));
      return node.item?.numericOptions ? known.map(Number) : known;
    }

    case "list": {
      const raw = ctx.source.get(name);
      if (isBlank(raw)) return node.nullable ? null : [];
      const itemKind = node.item?.kind;
      return listItems(raw ?? "").map((text, i) => {
        if (itemKind === "number" || itemKind === "integer") {
          const n = parseNumber(text, itemKind === "integer");
          if (n !== null) return n;
          ctx.problems[`${name}.${i}`] = "Нужно число.";
        }
        return text;
      });
    }

    case "localized": {
      const uz = (ctx.source.get(`${name}.uz`) ?? "").trim();
      const ru = (ctx.source.get(`${name}.ru`) ?? "").trim();
      if (uz === "" && ru === "") return blank(node) ?? (node.optional ? undefined : { uz, ru });
      return { uz, ru };
    }

    case "json": {
      const raw = ctx.source.get(name);
      if (isBlank(raw)) return blank(node) ?? (node.jsonShape === "object" ? {} : undefined);
      try {
        return JSON.parse(raw ?? "");
      } catch {
        ctx.problems[name] = "Некорректный JSON.";
        return raw;
      }
    }

    case "group": {
      const object: Record<string, unknown> = {};
      for (const child of node.children ?? []) {
        const v = readNode(child, [...at, child.key], ctx);
        if (v !== undefined) object[child.key] = v;
      }
      if (node.nullable && Object.values(object).every(isEmptyValue)) return null;
      return object;
    }

    case "record": {
      const object: Record<string, unknown> = {};
      for (const child of node.children ?? []) {
        const raw = ctx.source.get(nameOf([...at, child.key]));
        if (isBlank(raw)) continue;
        object[child.key] = scalar(child, raw ?? "", nameOf([...at, child.key]), ctx);
      }
      return object;
    }

    case "tuple": {
      const items = (node.children ?? []).map((child) => readNode(child, [...at, child.key], ctx));
      if (node.nullable && items.every(isEmptyValue)) return null;
      return items;
    }

    case "array": {
      const rowNode = node.item;
      if (!rowNode) return [];
      // A file may carry the whole array as JSON in one cell.
      const json = ctx.source.get(name);
      if (!isBlank(json)) {
        try {
          return JSON.parse(json ?? "");
        } catch {
          ctx.problems[name] = "Некорректный JSON.";
          return json;
        }
      }
      const declared = Number(ctx.source.get(`${name}.${COUNT_SUFFIX}`));
      const indexed = indexedRows(ctx.source.names(), name);
      if (ctx.source.get(`${name}.${COUNT_SUFFIX}`) === null && indexed === 0 && node.nullable) return null;
      const count = Math.min(Number.isInteger(declared) && declared > 0 ? declared : indexed, 200);
      const rows: unknown[] = [];
      for (let i = 0; i < count; i += 1) {
        const row = readNode({ ...rowNode, nullable: false, key: String(i) }, [...at, String(i)], ctx);
        if (
          !isEmptyValue(row) &&
          !(typeof row === "object" && row !== null && Object.values(row).every(isEmptyValue))
        ) {
          rows.push(row);
        }
      }
      return rows;
    }

    case "variant": {
      const discriminator = node.discriminator ?? "";
      const chosen = ctx.source.get(nameOf([...at, discriminator]))?.trim() ?? "";
      const arm = armOf(node, chosen);
      if (!arm) {
        ctx.problems[nameOf([...at, discriminator])] = "Выберите значение.";
        return {};
      }
      return readNode({ ...node, kind: "group", children: arm }, at, ctx);
    }

    default: {
      const raw = ctx.source.get(name);
      if (isBlank(raw)) return blank(node);
      return scalar(node, raw ?? "", name, ctx);
    }
  }
}

/** How many rows of `name.<i>.…` a file carries: the highest index plus one. */
function indexedRows(names: string[], name: string): number {
  const prefix = `${name}.`;
  let count = 0;
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const index = /^(\d+)\./.exec(n.slice(prefix.length));
    if (index) count = Math.max(count, Number(index[1]) + 1);
  }
  return count;
}

/** Reads the whole form (or row) described by `root`. */
export function readFields(root: FieldNode, source: FieldSource, opts: ReadOptions = {}): ReadResult {
  const ctx: Ctx = { source, opts, problems: {} };
  const value = readNode(root, [], ctx);
  return { value, problems: ctx.problems };
}

// ---- validation messages ----------------------------------------------------------------------------------------

export interface IssueLike {
  code: string;
  path: PropertyKey[];
  message: string;
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

function describeIssue(base: IssueLike): string {
  // Zod issues carry different extra fields per code; they are read by name below.
  const issue = base as IssueLike & Record<string, unknown>;
  switch (issue.code) {
    case "invalid_type": {
      if (/received (undefined|null)/.test(issue.message)) return "Обязательное поле.";
      if (issue.expected === "int") return "Нужно целое число.";
      if (issue.expected === "number") return "Нужно число.";
      if (issue.expected === "boolean") return "Выберите «да» или «нет».";
      if (issue.expected === "array") return "Нужен список.";
      return "Недопустимое значение.";
    }
    case "too_small": {
      const n = Number(issue.minimum);
      if (issue.origin === "string") return `Не короче ${n} ${plural(n, "знака", "знаков", "знаков")}.`;
      if (issue.origin === "array" || issue.origin === "set") return `Выберите не меньше ${n}.`;
      return issue.inclusive === false ? `Должно быть больше ${n}.` : `Не меньше ${n}.`;
    }
    case "too_big": {
      const n = Number(issue.maximum);
      if (issue.origin === "string") return `Не длиннее ${n} ${plural(n, "знака", "знаков", "знаков")}.`;
      if (issue.origin === "array" || issue.origin === "set") return `Не больше ${n} значений.`;
      return issue.inclusive === false ? `Должно быть меньше ${n}.` : `Не больше ${n}.`;
    }
    case "invalid_value":
    case "invalid_union":
      return "Недопустимое значение.";
    case "invalid_format":
      return "Неверный формат.";
    case "unrecognized_keys":
      return `Лишние поля: ${(issue.keys as string[]).join(", ")}.`;
    case "not_multiple_of":
      return "Недопустимое значение.";
    default:
      // A rule written in the contract (`refine`): its own text.
      return issue.message;
  }
}

/** Messages by dotted path, the first one per path. */
export function formatIssues(issues: readonly IssueLike[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".");
    if (!(path in out)) out[path] = describeIssue(issue);
  }
  return out;
}
