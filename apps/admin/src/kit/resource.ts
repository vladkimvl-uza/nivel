// admin kit: `defineResource` (ARCHITECTURE 6.2). One definition (a zod schema, a table, roles) gives a list with
// filters and pages, an edit form, validation on the server, a journal entry for every change, and an import from CSV
// with a preview. Screens in `app/` stay thin: they call this and draw the result.
import type { z } from "zod";
import type { AuditSink } from "../auth/audit.ts";
import { type Role, requireRole } from "../auth/roles.ts";
import type { SessionUser } from "../auth/service.ts";
import { parseCsv } from "./csv.ts";
import { cellsSource, type FieldSource, formatIssues, nameOf, readFields } from "./form.ts";
import { armOf, describeSchema, type FieldNode, fieldsOf, humanize } from "./schema.ts";

// ---- definition ---------------------------------------------------------------------------------------------------

export interface FilterDef {
  field: string;
  label: string;
  kind?: "select" | "text";
  options?: { value: string; label: string }[];
}

export interface ListDef<V> {
  columns: (keyof V & string)[];
  filters?: FilterDef[];
  defaultSort?: string;
}

export interface FormDef<V> {
  /** Never shown and never taken from a submitted form (they change by their own acts: status, owner of a record). */
  hidden?: string[];
  /** Values of hidden fields for a new record. */
  defaults?: Partial<V>;
  /** A field is shown only while the predicate is true for the value being edited. */
  conditional?: Record<string, (value: V) => boolean>;
}

export interface StatusDef<V> {
  field: string;
  /** Statuses that put the record in front of customers (default: verified, published). */
  publishValues?: string[];
  publishGuard?: (value: V) => string | null;
}

export interface CsvDef<V> {
  /** Natural key inside one file: two rows with the same key are a mistake. */
  key?: (value: V) => string;
}

// Not in R0, so not in the types either (a definition that names them must fail to compile, not be ignored): groups of
// fields, file fields and references with search. The first package that needs one adds it together with its screen;
// the phone upload of files is `kit/upload` and does not go through a resource.
export interface ResourceDef<T extends z.ZodType> {
  name: string;
  title: string;
  /** The Drizzle table, or its qualified name (`catalog.products`): the journal names the entity by it. */
  table: AnyTable | string;
  schema: T;
  store: ResourceStore<z.infer<T>>;
  list: ListDef<z.infer<T>>;
  form?: FormDef<z.infer<T>>;
  /** Rendered as two blocks, uz and ru, side by side; uz is required to publish. */
  localized?: (keyof z.infer<T> & string)[];
  status?: StatusDef<z.infer<T>>;
  csv?: CsvDef<z.infer<T>>;
  /** Russian captions by key or dotted path. */
  labels?: Record<string, string>;
  roles: { read: Role[]; write: Role[] };
  audit: true;
  auditSink: AuditSink;
}

/** Any Drizzle table: only its name is used here. */
export type AnyTable = object;

// ---- storage port -------------------------------------------------------------------------------------------------

export interface ListQuery {
  page: number;
  pageSize: number;
  sort: { field: string; dir: "asc" | "desc" };
  filters: Record<string, string>;
}

export interface StoredRecord<V> {
  id: string;
  value: V;
}

export interface AuditDraft {
  action: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export interface WriteContext {
  actor: SessionUser;
  /** Writes the journal entry; a store that has a transaction passes it as `tx` so that both commit together. */
  audit(entry: AuditDraft, tx?: unknown): Promise<void>;
}

export interface ResourceStore<V> {
  list(q: ListQuery): Promise<{ rows: StoredRecord<V>[]; total: number }>;
  get(id: string): Promise<StoredRecord<V> | null>;
  create(value: V, ctx: WriteContext): Promise<{ id: string }>;
  update(id: string, value: V, ctx: WriteContext): Promise<void>;
  /** The record with the same natural key, when there is one: an import updates it instead of making a twin. */
  findByKey?(value: V): Promise<string | null>;
}

/** A refusal by the rules of the data (a database constraint, a business rule): text for the person. */
export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleViolation";
  }
}

// ---- results --------------------------------------------------------------------------------------------------------

export type SaveResult<V> =
  | { ok: true; id: string; value: V }
  | { ok: false; errors: Record<string, string>; value: unknown };

export interface ListPage<V> {
  columns: { key: string; label: string }[];
  rows: { id: string; cells: string[]; value: V }[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  sort: { field: string; dir: "asc" | "desc" };
  filters: { def: FilterDef; value: string }[];
}

export interface ImportRow {
  line: number;
  status: "new" | "update" | "error";
  errors: Record<string, string>;
  /** The validated value of a good row. */
  value?: unknown;
  /** Id of the record an `update` row replaces. */
  id?: string;
}

export type ImportPreview =
  | { ok: true; header: string[]; rows: ImportRow[]; counts: { new: number; update: number; error: number } }
  | { ok: false; error: string };

export type ImportApplied =
  | {
      ok: true;
      applied: { created: number; updated: number };
      failed: { line: number; errors: Record<string, string> }[];
    }
  | { ok: false; error: string };

export interface FormModel<V> {
  root: FieldNode;
  value: Partial<V> | Record<string, unknown>;
  fields: (FieldNode & { label: string })[];
}

export interface Resource<T extends z.ZodType> {
  def: ResourceDef<T>;
  root: FieldNode;
  can(actor: SessionUser, what: "read" | "write"): boolean;
  labelFor(path: string[]): string;
  /** Whether the field at `path` is shown for `value` (hidden fields and unmet conditions are not). */
  visible(path: string[], value: unknown): boolean;
  /** Dotted names of the fields not shown for `value`: the hidden ones and those whose condition does not hold. */
  hiddenNames(value: unknown): string[];
  list(actor: SessionUser, query: Record<string, string | undefined>): Promise<ListPage<z.infer<T>>>;
  get(actor: SessionUser, id: string): Promise<StoredRecord<z.infer<T>> | null>;
  formModel(value: unknown): FormModel<z.infer<T>>;
  save(actor: SessionUser, id: string | null, source: FieldSource): Promise<SaveResult<z.infer<T>>>;
  setStatus(
    actor: SessionUser,
    id: string,
    status: string,
  ): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }>;
  csvColumns(discriminatorValue: string | undefined): string[];
  importPreview(actor: SessionUser, text: string): Promise<ImportPreview>;
  importApply(actor: SessionUser, text: string): Promise<ImportApplied>;
}

// ---- helpers ------------------------------------------------------------------------------------------------------

export const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PUBLISH = ["verified", "published"];

function entityName(table: AnyTable | string, fallback: string): string {
  return typeof table === "string" ? table : fallback;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (Array.isArray(v)) return v.map(formatCell).join(", ");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
}

/** The column names a file may carry for these fields: dotted paths; a repeated group gets three indexed rows. */
function columnsOf(fields: FieldNode[], prefix: string[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const at = [...prefix, f.key];
    switch (f.kind) {
      case "localized":
        out.push(`${nameOf(at)}.uz`, `${nameOf(at)}.ru`);
        break;
      case "group":
      case "tuple":
      case "record":
        out.push(...columnsOf(f.children ?? [], at));
        break;
      case "array":
        for (let i = 0; i < 3; i += 1) out.push(...columnsOf(f.item?.children ?? [], [...at, String(i)]));
        break;
      default:
        out.push(nameOf(at));
    }
  }
  return out;
}

/** Is `column` a name this schema can read? Accepts any row index of a repeated group and a JSON cell for it. */
function knownColumn(fields: FieldNode[], column: string): boolean {
  const walk = (nodes: FieldNode[], segments: string[]): boolean => {
    const [head, ...rest] = segments;
    if (head === undefined) return false;
    return nodes.some((n) => {
      if (n.key !== head) return false;
      if (rest.length === 0) return !["group", "localized", "tuple", "record"].includes(n.kind);
      switch (n.kind) {
        case "localized":
          return rest.length === 1 && (rest[0] === "uz" || rest[0] === "ru");
        case "group":
        case "tuple":
        case "record":
          return walk(n.children ?? [], rest);
        case "array":
          return /^\d+$/.test(rest[0] ?? "") && walk(n.item?.children ?? [], rest.slice(1));
        default:
          return false;
      }
    });
  };
  return walk(fields, column.split("."));
}

function allFields(root: FieldNode): FieldNode[] {
  return root.kind === "variant" ? Object.values(root.arms ?? {}).flat() : (root.children ?? []);
}

// ---- the definition ---------------------------------------------------------------------------------------------

export function defineResource<T extends z.ZodType>(def: ResourceDef<T>): Resource<T> {
  type V = z.infer<T>;
  const root = describeSchema(def.schema);
  const hidden = new Set(def.form?.hidden ?? []);
  const entity = entityName(def.table, def.name);
  const labels = def.labels ?? {};
  const statusField = def.status?.field;

  const labelFor = (path: string[]): string =>
    labels[nameOf(path)] ?? labels[path[path.length - 1] ?? ""] ?? humanize(path[path.length - 1] ?? "");

  const can = (actor: SessionUser, what: "read" | "write") => def.roles[what].includes(actor.role);
  const need = (actor: SessionUser, what: "read" | "write") => requireRole(actor, def.roles[what]);

  /** Is the field at this dotted name shown for this value (not hidden, its condition holds)? */
  const isShown = (name: string, value: unknown): boolean => {
    if (hidden.has(name)) return false;
    const rule = def.form?.conditional?.[name];
    return rule ? rule(value as V) : true;
  };

  function writeContext(actor: SessionUser): WriteContext {
    return {
      actor,
      audit: (entry, tx) =>
        def.auditSink.append(
          {
            actor: `admin:${actor.id}`,
            action: `${def.name}.${entry.action}`,
            entity,
            entityId: entry.entityId,
            ...(entry.before !== undefined ? { before: entry.before } : {}),
            ...(entry.after !== undefined ? { after: entry.after } : {}),
          },
          tx,
        ),
    };
  }

  /** Reads and validates a value from any source of named fields. `previous` supplies what the source did not show. */
  function parse(source: FieldSource, previous: unknown): { value: unknown; errors: Record<string, string>; data?: V } {
    const stored = { ...(def.form?.defaults ?? {}), ...(previous as object | undefined) } as Record<string, unknown>;
    const onlyHidden = (name: string) => !name.includes(".") && hidden.has(name);
    // First pass: what was submitted. The conditional rules are asked about it, not about the stored record,
    // so that a field that appears together with the choice that shows it is read.
    const first = readFields(root, source, { previous: stored, keep: onlyHidden }).value as Record<string, unknown>;
    const rules = def.form?.conditional ?? {};
    const keep = (name: string) => {
      if (hidden.has(name)) return true;
      const rule = rules[name];
      return rule ? !rule(first as V) : false;
    };
    const read = readFields(root, source, { previous: stored, keep });
    // Hidden fields never come from the form, whatever the source said.
    const value = { ...(read.value as Record<string, unknown>) };
    for (const key of hidden) {
      if (stored[key] === undefined) delete value[key];
      else value[key] = stored[key];
    }
    const parsed = def.schema.safeParse(value);
    const errors = parsed.success ? {} : formatIssues(parsed.error.issues);
    return { value, errors: { ...errors, ...read.problems }, ...(parsed.success ? { data: parsed.data as V } : {}) };
  }

  function publishErrors(value: V, nextStatus: string | undefined): Record<string, string> {
    const publishing = nextStatus !== undefined && (def.status?.publishValues ?? DEFAULT_PUBLISH).includes(nextStatus);
    if (!publishing || !statusField) return {};
    const errors: Record<string, string> = {};
    for (const field of def.localized ?? []) {
      const text = (value as Record<string, unknown>)[field] as { uz?: string } | null | undefined;
      if (text && (text.uz ?? "").trim() === "") errors[`${field}.uz`] = "Узбекский текст обязателен для публикации.";
    }
    const guard = def.status?.publishGuard?.(value);
    if (guard) errors[statusField] = guard;
    return errors;
  }

  async function writeValue(
    actor: SessionUser,
    id: string | null,
    value: V,
  ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    try {
      const ctx = writeContext(actor);
      if (id === null) return { ok: true, id: (await def.store.create(value, ctx)).id };
      await def.store.update(id, value, ctx);
      return { ok: true, id };
    } catch (error) {
      if (error instanceof RuleViolation) return { ok: false, error: error.message };
      throw error;
    }
  }

  // ---- import ------------------------------------------------------------------------------------------------------

  async function preview(actor: SessionUser, text: string): Promise<ImportPreview> {
    need(actor, "write");
    const file = parseCsv(text);
    if (!file.ok) return { ok: false, error: file.error };
    const columns = allFields(root).filter((f) => !hidden.has(f.key));
    const unknown = file.header.filter((h) => !knownColumn(columns, h));
    if (unknown.length > 0) return { ok: false, error: `Неизвестные столбцы: ${unknown.join(", ")}.` };

    const rows: ImportRow[] = [];
    const seen = new Map<string, number>();
    for (const row of file.rows) {
      if (row.cells.length !== file.header.length) {
        rows.push({
          line: row.line,
          status: "error",
          errors: { "": `В строке ${row.cells.length} значений вместо ${file.header.length}.` },
        });
        continue;
      }
      const source = cellsSource(file.header, row.cells);
      let parsed = parse(source, undefined);
      if (Object.keys(parsed.errors).length > 0 || parsed.data === undefined) {
        rows.push({ line: row.line, status: "error", errors: parsed.errors });
        continue;
      }
      let data = parsed.data;
      const key = def.csv?.key?.(data);
      if (key !== undefined) {
        const earlier = seen.get(key);
        if (earlier !== undefined) {
          rows.push({
            line: row.line,
            status: "error",
            errors: { "": `Повтор в файле: такая же позиция в строке ${earlier}.` },
          });
          continue;
        }
        seen.set(key, row.line);
      }
      const existing = def.store.findByKey ? await def.store.findByKey(data) : null;
      if (existing) {
        // An update keeps what a file cannot carry (status, owner): re-read the row over the stored record.
        const stored = await def.store.get(existing);
        parsed = parse(source, stored?.value);
        if (Object.keys(parsed.errors).length > 0 || parsed.data === undefined) {
          rows.push({ line: row.line, status: "error", errors: parsed.errors });
          continue;
        }
        data = parsed.data;
        rows.push({ line: row.line, status: "update", errors: {}, value: data, id: existing });
      } else {
        rows.push({ line: row.line, status: "new", errors: {}, value: data });
      }
    }
    const counts = { new: 0, update: 0, error: 0 };
    for (const r of rows) counts[r.status] += 1;
    return { ok: true, header: file.header, rows, counts };
  }

  // ---- the resource -----------------------------------------------------------------------------------------------

  return {
    def,
    root,
    can,
    labelFor,
    visible: (path, value) => isShown(nameOf(path), value),
    hiddenNames: (value) =>
      [...new Set([...hidden, ...Object.keys(def.form?.conditional ?? {})])].filter((name) => !isShown(name, value)),

    async list(actor, query) {
      need(actor, "read");
      const columns = def.list.columns.map((key) => ({ key, label: labelFor([key]) }));
      const num = (raw: string | undefined, fallback: number) => {
        const n = Number(raw);
        return Number.isInteger(n) && n >= 1 ? n : fallback;
      };
      const page = num(query.page, 1);
      const pageSize = Math.min(num(query.pageSize, PAGE_SIZE), MAX_PAGE_SIZE);

      const sortRaw = query.sort ?? "";
      const sortField = sortRaw.replace(/^-/, "");
      const fallbackSort = def.list.defaultSort ?? def.list.columns[0] ?? "";
      const sort = (def.list.columns as readonly string[]).includes(sortField)
        ? { field: sortField, dir: sortRaw.startsWith("-") ? ("desc" as const) : ("asc" as const) }
        : {
            field: fallbackSort.replace(/^-/, ""),
            dir: fallbackSort.startsWith("-") ? ("desc" as const) : ("asc" as const),
          };

      const filters: Record<string, string> = {};
      const shown: ListPage<V>["filters"] = [];
      for (const f of def.list.filters ?? []) {
        const value = (query[f.field] ?? "").trim();
        const allowed = f.kind !== "select" || f.options === undefined || f.options.some((o) => o.value === value);
        const optionsFromSchema = f.kind === "select" && f.options === undefined ? selectValues(root, f.field) : null;
        const ok = value !== "" && allowed && (optionsFromSchema === null || optionsFromSchema.includes(value));
        if (ok) filters[f.field] = value;
        shown.push({ def: f, value: ok ? value : "" });
      }

      const result = await def.store.list({ page, pageSize, sort, filters });
      return {
        columns,
        rows: result.rows.map((r) => ({
          id: r.id,
          value: r.value,
          cells: def.list.columns.map((c) => formatCell((r.value as Record<string, unknown>)[c])),
        })),
        total: result.total,
        page,
        pages: Math.max(1, Math.ceil(result.total / pageSize)),
        pageSize,
        sort,
        filters: shown,
      };
    },

    async get(actor, id) {
      need(actor, "read");
      return def.store.get(id);
    },

    formModel(value) {
      const current = (value ?? def.form?.defaults ?? {}) as Record<string, unknown>;
      const fields = fieldsOf(root, current)
        .filter((f) => isShown(f.key, current))
        .map((f) => ({ ...f, label: labelFor(f.path) }));
      return { root, value: current as Partial<V>, fields };
    },

    async save(actor, id, source) {
      need(actor, "write");
      let stored: StoredRecord<V> | null = null;
      if (id !== null) {
        stored = await def.store.get(id);
        if (!stored) return { ok: false, errors: { "": "Запись не найдена." }, value: {} };
      }
      const { value, errors, data } = parse(source, stored?.value);
      if (data === undefined || Object.keys(errors).length > 0) return { ok: false, errors, value };
      const nextStatus = statusField
        ? ((data as Record<string, unknown>)[statusField] as string | undefined)
        : undefined;
      const blocked = publishErrors(data, nextStatus);
      if (Object.keys(blocked).length > 0) return { ok: false, errors: blocked, value };
      const written = await writeValue(actor, id, data);
      if (!written.ok) return { ok: false, errors: { "": written.error }, value };
      return { ok: true, id: written.id, value: data };
    },

    async setStatus(actor, id, status) {
      need(actor, "write");
      if (!statusField) throw new Error(`resource ${def.name} has no status field`);
      const stored = await def.store.get(id);
      if (!stored) return { ok: false, errors: { "": "Запись не найдена." } };
      const candidate = { ...(stored.value as Record<string, unknown>), [statusField]: status };
      const parsed = def.schema.safeParse(candidate);
      if (!parsed.success) {
        const all = formatIssues(parsed.error.issues);
        return { ok: false, errors: statusField in all ? { [statusField]: all[statusField] as string } : all };
      }
      const blocked = publishErrors(parsed.data as V, status);
      if (Object.keys(blocked).length > 0) return { ok: false, errors: blocked };
      const written = await writeValue(actor, id, parsed.data as V);
      return written.ok ? { ok: true } : { ok: false, errors: { "": written.error } };
    },

    csvColumns(discriminatorValue) {
      const fields =
        root.kind === "variant"
          ? discriminatorValue
            ? (armOf(root, discriminatorValue) ?? [])
            : []
          : (root.children ?? []);
      return columnsOf(
        fields.filter((f) => !hidden.has(f.key)),
        [],
      );
    },

    importPreview: preview,

    async importApply(actor, text) {
      const plan = await preview(actor, text);
      if (!plan.ok) return plan;
      let created = 0;
      let updated = 0;
      const failed: { line: number; errors: Record<string, string> }[] = plan.rows
        .filter((r) => r.status === "error")
        .map((r) => ({ line: r.line, errors: r.errors }));
      for (const row of plan.rows) {
        if (row.status === "error") continue;
        const written = await writeValue(actor, row.status === "update" ? (row.id ?? null) : null, row.value as V);
        if (!written.ok) failed.push({ line: row.line, errors: { "": written.error } });
        else if (row.status === "update") updated += 1;
        else created += 1;
      }
      failed.sort((a, b) => a.line - b.line);
      await def.auditSink.append({
        actor: `admin:${actor.id}`,
        action: `${def.name}.import`,
        entity,
        entityId: null,
        after: { created, updated, failed: failed.length, rows: plan.rows.length },
      });
      return { ok: true, applied: { created, updated }, failed };
    },
  };
}

function selectValues(root: FieldNode, field: string): string[] | null {
  if (root.kind === "variant" && field === root.discriminator) return (root.options ?? []).map((o) => o.value);
  const node = allFields(root).find((f) => f.key === field);
  return node?.options ? node.options.map((o) => o.value) : null;
}
