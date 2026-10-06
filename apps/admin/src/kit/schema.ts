// admin kit: a zod schema becomes a tree of form fields (ARCHITECTURE 6.2). The owner never edits JSON: every
// characteristic of a catalog position is a typed field built from the schema of @nivel/contracts, so a change of the
// contract changes the form with it.
//
// The walk reads the public structure of zod 4 (`schema._zod.def`, the `minValue`/`isInt` helpers) and nothing else.
import type { z } from "zod";

export type FieldKind =
  /** One line of text. */
  | "text"
  | "longtext"
  | "number"
  | "integer"
  /** Yes / no (and "unknown" when the value may be null). */
  | "boolean"
  | "select"
  | "multiselect"
  | "date"
  | "datetime"
  /** A repeated group of fields (a list of objects). */
  | "array"
  /** A list of plain values typed in one box, one per line. */
  | "list"
  /** A fixed set of fields. */
  | "group"
  /** One number per allowed key (a partial record over an enum). */
  | "record"
  | "tuple"
  /** The two languages of a text: uz and ru tabs. */
  | "localized"
  /** A group chosen by the value of one of its fields (a discriminated union). */
  | "variant"
  /** Anything else: edited as JSON text. */
  | "json"
  | "literal";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldNode {
  kind: FieldKind;
  /** Last segment of the path. */
  key: string;
  /** Path from the root of the schema; array positions are numbers in the form names only. */
  path: string[];
  /** The key may be missing. */
  optional: boolean;
  /** The value may be `null` ("unknown"). */
  nullable: boolean;
  description?: string;
  options?: FieldOption[];
  /** Options that are numbers in the schema (a union of number literals). */
  numericOptions?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  /** Children of a group, record or tuple. */
  children?: FieldNode[];
  /** Element of an array or list. */
  item?: FieldNode;
  /** For `variant`: the field that decides, and the fields of each arm. */
  discriminator?: string;
  arms?: Record<string, FieldNode[]>;
  /** For `literal`: the only allowed value. */
  literal?: string | number | boolean | null;
  /** For `json`: what an empty box means: `{}` for an open record, nothing otherwise. */
  jsonShape?: "object";
}

interface Def {
  type: string;
  [key: string]: unknown;
}
type AnySchema = z.core.$ZodType;

const defOf = (schema: AnySchema): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Public helpers of zod 4 schemas that are not part of `def`. */
interface Probe {
  minValue?: number | null;
  maxValue?: number | null;
  isInt?: boolean;
  minLength?: number | null;
  maxLength?: number | null;
  format?: string | null;
  description?: string;
  _zod: { values?: Set<unknown>; def: Def };
}
const probe = (schema: AnySchema) => schema as unknown as Probe;

function finite(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

interface Wrapped {
  inner: AnySchema;
  optional: boolean;
  nullable: boolean;
  description?: string;
}

/** Peels optional, nullable, default, readonly and pipe wrappers off a schema. */
function unwrap(schema: AnySchema): Wrapped {
  let current = schema;
  let optional = false;
  let nullable = false;
  let description = probe(schema).description;
  for (let guard = 0; guard < 16; guard += 1) {
    const def = defOf(current);
    const next = (() => {
      switch (def.type) {
        case "optional":
        case "nonoptional":
          optional ||= def.type === "optional";
          return def.innerType as AnySchema;
        case "nullable":
          nullable = true;
          return def.innerType as AnySchema;
        case "default":
        case "prefault":
        case "catch":
          optional = true;
          return def.innerType as AnySchema;
        case "readonly":
          return def.innerType as AnySchema;
        case "pipe": {
          const input = def.in as AnySchema;
          return defOf(input).type === "transform" ? (def.out as AnySchema) : input;
        }
        default:
          return null;
      }
    })();
    if (!next) break;
    current = next;
    description ??= probe(current).description;
  }
  return { inner: current, optional, nullable, ...(description ? { description } : {}) };
}

export const humanize = (key: string): string => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
};

function literalOptions(values: readonly unknown[]): { options: FieldOption[]; numeric: boolean } | null {
  if (values.length === 0) return null;
  if (!values.every((v) => typeof v === "string" || typeof v === "number")) return null;
  const numeric = values.every((v) => typeof v === "number");
  return { options: values.map((v) => ({ value: String(v), label: String(v) })), numeric };
}

interface BoundCheck {
  _zod: { def: { check?: string; value?: number; inclusive?: boolean } };
}

function numberBounds(schema: AnySchema, integer: boolean): Pick<FieldNode, "min" | "max"> {
  const p = probe(schema);
  let min = finite(p.minValue);
  let max = finite(p.maxValue);
  // `.positive()` is "greater than 0", not "at least 0": for whole numbers the form needs the first allowed value.
  const checks = (defOf(schema).checks as BoundCheck[] | undefined) ?? [];
  for (const c of checks) {
    const d = c._zod.def;
    if (integer && d.inclusive === false && typeof d.value === "number") {
      if (d.check === "greater_than" && d.value === min) min = d.value + 1;
      if (d.check === "less_than" && d.value === max) max = d.value - 1;
    }
  }
  // zod gives the extreme safe integers for `.int()`: they are not limits a person should see.
  return {
    ...(min !== undefined && min > Number.MIN_SAFE_INTEGER ? { min } : {}),
    ...(max !== undefined && max < Number.MAX_SAFE_INTEGER ? { max } : {}),
  };
}

function stringKind(schema: AnySchema): { kind: FieldKind } & Partial<FieldNode> {
  const p = probe(schema);
  const out: Partial<FieldNode> = {};
  const minLength = finite(p.minLength);
  const maxLength = finite(p.maxLength);
  if (minLength !== undefined) out.minLength = minLength;
  if (maxLength !== undefined) out.maxLength = maxLength;
  const checks =
    (defOf(schema).checks as { _zod: { def: { check?: string; format?: string; pattern?: RegExp } } }[] | undefined) ??
    [];
  const regex = checks.find((c) => c._zod.def.check === "string_format" && c._zod.def.format === "regex");
  if (regex?._zod.def.pattern) out.pattern = regex._zod.def.pattern.source;
  if (p.format === "date") return { kind: "date", ...out };
  if (p.format === "datetime") return { kind: "datetime", ...out };
  if ((maxLength ?? 0) > 200) return { kind: "longtext", ...out };
  return { kind: "text", ...out };
}

/** `{ uz: string, ru: string }`: a localized text (ARCHITECTURE 6.2, `Localized`). */
function isLocalized(shape: Record<string, AnySchema>): boolean {
  const keys = Object.keys(shape);
  return keys.length === 2 && keys.includes("uz") && keys.includes("ru");
}

function describeNode(schema: AnySchema, path: string[], wrapOverride?: Partial<Wrapped>): FieldNode {
  const wrapped = unwrap(schema);
  const { inner } = wrapped;
  const key = path[path.length - 1] ?? "";
  const base = {
    key,
    path,
    optional: wrapOverride?.optional ?? wrapped.optional,
    nullable: wrapOverride?.nullable ?? wrapped.nullable,
    ...(wrapped.description ? { description: wrapped.description } : {}),
  };
  const def = defOf(inner);

  switch (def.type) {
    case "string":
      return { ...base, ...stringKind(inner) };
    case "number": {
      const integer = probe(inner).isInt === true;
      return { ...base, kind: integer ? "integer" : "number", ...numberBounds(inner, integer) };
    }
    case "int":
      return { ...base, kind: "integer", ...numberBounds(inner, true) };
    case "boolean":
      return { ...base, kind: "boolean" };
    case "date":
      return { ...base, kind: "date" };
    case "enum": {
      const values = Object.values(def.entries as Record<string, string | number>);
      const found = literalOptions(values);
      return {
        ...base,
        kind: "select",
        options: found?.options ?? [],
        ...(found?.numeric ? { numericOptions: true } : {}),
      };
    }
    case "literal": {
      const values = def.values as (string | number | boolean | null)[];
      const found = literalOptions(values);
      if (values.length === 1) return { ...base, kind: "literal", literal: values[0] ?? null };
      return found
        ? { ...base, kind: "select", options: found.options, ...(found.numeric ? { numericOptions: true } : {}) }
        : { ...base, kind: "json" };
    }
    case "object": {
      const shape = def.shape as Record<string, AnySchema>;
      if (isLocalized(shape)) return { ...base, kind: "localized" };
      return { ...base, kind: "group", children: Object.entries(shape).map(([k, v]) => describeNode(v, [...path, k])) };
    }
    case "intersection": {
      const left = describeNode(def.left as AnySchema, path);
      const right = describeNode(def.right as AnySchema, path);
      if (left.kind === "group" && right.kind === "group") {
        return { ...base, kind: "group", children: [...(left.children ?? []), ...(right.children ?? [])] };
      }
      if (left.kind === "variant" && right.kind === "group") {
        return { ...left, ...base, arms: mapArms(left.arms ?? {}, (arm) => [...(right.children ?? []), ...arm]) };
      }
      if (right.kind === "variant" && left.kind === "group") {
        return { ...right, ...base, arms: mapArms(right.arms ?? {}, (arm) => [...(left.children ?? []), ...arm]) };
      }
      return { ...base, kind: "json" };
    }
    case "array": {
      const element = def.element as AnySchema;
      const item = describeNode(element, [...path, "*"]);
      if (item.kind === "select" && !item.nullable)
        return { ...base, kind: "multiselect", options: item.options ?? [], item };
      if (item.kind === "group") return { ...base, kind: "array", item };
      if (item.kind === "text" || item.kind === "number" || item.kind === "integer" || item.kind === "date") {
        return { ...base, kind: "list", item };
      }
      return { ...base, kind: "json" };
    }
    case "tuple": {
      const items = def.items as AnySchema[];
      return { ...base, kind: "tuple", children: items.map((s, i) => describeNode(s, [...path, String(i)])) };
    }
    case "record": {
      const keyType = def.keyType as AnySchema;
      const keyDef = defOf(keyType);
      const value = describeNode(def.valueType as AnySchema, [...path, "*"]);
      if (keyDef.type === "enum" && (value.kind === "number" || value.kind === "integer")) {
        const keys = Object.values(keyDef.entries as Record<string, string>);
        return {
          ...base,
          kind: "record",
          item: value,
          children: keys.map((k) => ({
            ...describeNode(def.valueType as AnySchema, [...path, k]),
            optional: true,
            nullable: false,
          })),
        };
      }
      return { ...base, kind: "json", jsonShape: "object" };
    }
    case "union": {
      const options = def.options as AnySchema[];
      const discriminator = def.discriminator as string | undefined;
      if (discriminator) return { ...base, ...variantOf(options, discriminator, path) };
      const literals: unknown[] = [];
      for (const option of options) {
        const o = defOf(unwrap(option).inner);
        if (o.type === "literal") literals.push(...(o.values as unknown[]));
        else if (o.type === "enum") literals.push(...Object.values(o.entries as Record<string, unknown>));
        else return { ...base, kind: "json" };
      }
      const found = literalOptions(literals);
      return found
        ? { ...base, kind: "select", options: found.options, ...(found.numeric ? { numericOptions: true } : {}) }
        : { ...base, kind: "json" };
    }
    default:
      return { ...base, kind: "json" };
  }
}

function mapArms(
  arms: Record<string, FieldNode[]>,
  fn: (arm: FieldNode[]) => FieldNode[],
): Record<string, FieldNode[]> {
  return Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, fn(v)]));
}

function variantOf(
  options: AnySchema[],
  discriminator: string,
  path: string[],
): Pick<FieldNode, "kind" | "discriminator" | "arms" | "options"> {
  const arms: Record<string, FieldNode[]> = {};
  for (const option of options) {
    const shape = defOf(unwrap(option).inner).shape as Record<string, AnySchema> | undefined;
    const marker = shape?.[discriminator];
    if (!shape || !marker) continue;
    const values = [...(probe(unwrap(marker).inner)._zod.values ?? [])].map(String);
    const children = Object.entries(shape).map(([k, v]) => describeNode(v, [...path, k]));
    for (const value of values) arms[value] = children;
  }
  const values = Object.keys(arms);
  return {
    kind: "variant",
    discriminator,
    arms,
    options: values.map((value) => ({ value, label: value })),
  };
}

/** The root of a form: the fields of an object schema (or of a discriminated union). */
export function describeSchema(schema: z.ZodType): FieldNode {
  const root = describeNode(schema, []);
  if (root.kind !== "group" && root.kind !== "variant") {
    throw new Error("a resource schema must be an object or a discriminated union of objects");
  }
  return root;
}

/** The fields to show for a value: for a variant, the arm named by the discriminator; `null` when none is chosen. */
export function fieldsOf(node: FieldNode, value: unknown): FieldNode[] {
  if (node.kind === "group") return node.children ?? [];
  if (node.kind === "variant" && node.discriminator && node.arms) {
    const chosen = (value as Record<string, unknown> | null | undefined)?.[node.discriminator];
    return typeof chosen === "string" ? (node.arms[chosen] ?? []) : [];
  }
  return [];
}

/** The node at `path` below the root; a variant root needs the value that names its arm. */
export function findNode(root: FieldNode, path: string[], value?: unknown): FieldNode | null {
  let level: FieldNode[] = fieldsOf(root, value);
  let found: FieldNode | null = null;
  for (const segment of path) {
    found = level.find((n) => n.key === segment) ?? null;
    if (!found) return null;
    level = found.children ?? found.item?.children ?? [];
  }
  return found;
}
