// admin kit: the fields of a form drawn from the tree of `describeSchema`. Pure components (no hooks, no server
// imports), so a server page and a client form can both use them. The names of the inputs are the dotted paths that
// `readFields` reads back; the checkbox "unknown" and the hidden row counters follow its conventions.
import { Select, TextField } from "@nivel/ui/react";
import type { ReactNode } from "react";
import { COUNT_SUFFIX, nameOf, PRESENT_SUFFIX, UNKNOWN_SUFFIX, valueAt } from "../form.ts";
import { type FieldNode, humanize } from "../schema.ts";

export interface FieldsContext {
  /** The value being edited (nested object, as `readFields` returns it). */
  values: unknown;
  /** Messages by dotted name; a message of a group is shown at its top. */
  errors: Record<string, string>;
  /** Russian captions by dotted path (without row numbers) or by last key. */
  labels: Record<string, string>;
  /** Words for option values by field key (or dotted path): `{ color: { black: "Чёрный" } }`. */
  optionLabels?: Record<string, Record<string, string>>;
  /** Names of fields that are not shown now (their condition does not hold). */
  hiddenNames?: string[];
  /** Blank rows offered after the existing rows of a repeated group. */
  spareRows?: number;
  /** A group (by dotted name) drawn as titled sections: `{ spec: [{ title: "Питание", keys: ["tgpW"] }] }`. */
  sections?: Record<string, { title: string; keys: string[] }[]>;
}

const idOf = (name: string) => `f-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
const withoutIndexes = (path: string[]) => path.filter((s) => !/^\d+$/.test(s));

export function labelOf(ctx: Pick<FieldsContext, "labels">, path: string[], key: string): string {
  const clean = withoutIndexes(path);
  return ctx.labels[clean.join(".")] ?? ctx.labels[clean.slice(-2).join(".")] ?? ctx.labels[key] ?? humanize(key);
}

function optionLabel(ctx: FieldsContext, node: FieldNode, path: string[], value: string): string {
  const table = ctx.optionLabels?.[withoutIndexes(path).join(".")] ?? ctx.optionLabels?.[node.key];
  return table?.[value] ?? value;
}

const asText = (v: unknown): string =>
  v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

function rangeHint(node: FieldNode): string | undefined {
  if (node.min !== undefined && node.max !== undefined) return `от ${node.min} до ${node.max}`;
  if (node.min !== undefined) return `от ${node.min}`;
  if (node.max !== undefined) return `до ${node.max}`;
  return undefined;
}

function UnknownBox({ name, checked }: { name: string; checked: boolean }) {
  const id = `${idOf(name)}-unknown`;
  return (
    <label className="adm-unknown" htmlFor={id}>
      <input type="checkbox" id={id} name={`${name}.${UNKNOWN_SUFFIX}`} defaultChecked={checked} />
      <span>неизвестно</span>
    </label>
  );
}

function Frame({
  name,
  label,
  error,
  children,
  hint,
}: {
  name: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  const id = idOf(name);
  return (
    <div className={`nv-field${error ? " nv-field--invalid" : ""}`}>
      <label className="nv-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="nv-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="nv-field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Field({ node, at, ctx }: { node: FieldNode; at: string[]; ctx: FieldsContext }): ReactNode {
  const name = nameOf(at);
  if (ctx.hiddenNames?.includes(name)) return null;
  const label = labelOf(ctx, at, node.key);
  const value = valueAt(ctx.values, at);
  const error = ctx.errors[name];
  const id = idOf(name);

  switch (node.kind) {
    case "literal":
      return <input type="hidden" name={name} value={asText(node.literal)} />;

    case "text":
    case "date":
      return (
        <TextField
          id={id}
          name={name}
          label={label}
          type={node.kind === "date" ? "date" : "text"}
          defaultValue={asText(value)}
          error={error}
          hint={node.nullable ? "пусто — неизвестно" : undefined}
          maxLength={node.maxLength}
        />
      );

    case "number":
    case "integer":
      return (
        <TextField
          id={id}
          name={name}
          label={label}
          type="text"
          inputMode={node.kind === "integer" ? "numeric" : "decimal"}
          defaultValue={asText(value)}
          error={error}
          hint={
            [rangeHint(node), node.nullable ? "пусто — неизвестно" : undefined].filter(Boolean).join(" · ") || undefined
          }
        />
      );

    case "longtext":
    case "json":
      return (
        <Frame name={name} label={label} error={error} hint={node.kind === "json" ? "JSON" : undefined}>
          <textarea
            className={`nv-field__control adm-textarea${node.kind === "json" ? " adm-mono" : ""}`}
            id={id}
            name={name}
            rows={node.kind === "json" ? 5 : 4}
            defaultValue={
              node.kind === "json" && value !== undefined && value !== null
                ? JSON.stringify(value, null, 2)
                : asText(value)
            }
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </Frame>
      );

    case "list":
      return (
        <Frame name={name} label={label} error={error} hint="по одному значению в строке">
          <textarea
            className="nv-field__control adm-textarea"
            id={id}
            name={name}
            rows={3}
            defaultValue={Array.isArray(value) ? value.map(asText).join("\n") : ""}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </Frame>
      );

    case "boolean": {
      const current = typeof value === "boolean" ? String(value) : "";
      const options = [
        ...(node.nullable
          ? [{ value: "", label: "неизвестно" }]
          : node.optional
            ? [{ value: "", label: "по умолчанию" }]
            : []),
        { value: "true", label: "да" },
        { value: "false", label: "нет" },
      ];
      return <Select id={id} name={name} label={label} options={options} defaultValue={current} error={error} />;
    }

    case "select": {
      const current = value === null || value === undefined ? "" : String(value);
      const options = [
        ...(node.nullable || node.optional ? [{ value: "", label: node.nullable ? "неизвестно" : "—" }] : []),
        ...(node.options ?? []).map((o) => ({ value: o.value, label: optionLabel(ctx, node, at, o.value) })),
      ];
      return (
        <Select
          id={id}
          name={name}
          label={label}
          options={options}
          defaultValue={current}
          placeholder={node.nullable || node.optional ? undefined : "Выберите"}
          error={error}
        />
      );
    }

    case "multiselect": {
      const picked = Array.isArray(value) ? value.map(String) : [];
      return (
        <fieldset className="adm-group" aria-describedby={error ? `${id}-error` : undefined}>
          <legend>{label}</legend>
          <input type="hidden" name={`${name}.${PRESENT_SUFFIX}`} value="1" />
          <div className="adm-checks">
            {(node.options ?? []).map((o) => (
              <label key={o.value} className="adm-check">
                <input type="checkbox" name={name} value={o.value} defaultChecked={picked.includes(o.value)} />
                <span>{optionLabel(ctx, node, at, o.value)}</span>
              </label>
            ))}
          </div>
          {node.nullable ? <UnknownBox name={name} checked={value === null || value === undefined} /> : null}
          {error ? (
            <p className="nv-field__error" id={`${id}-error`} role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
      );
    }

    case "localized": {
      const text = (value ?? {}) as { uz?: string; ru?: string };
      return (
        <fieldset className="adm-group adm-localized">
          <legend>{label}</legend>
          <TextField
            id={`${id}-uz`}
            name={`${name}.uz`}
            label="uz"
            defaultValue={text.uz ?? ""}
            error={ctx.errors[`${name}.uz`]}
          />
          <TextField
            id={`${id}-ru`}
            name={`${name}.ru`}
            label="ru"
            defaultValue={text.ru ?? ""}
            error={ctx.errors[`${name}.ru`]}
          />
        </fieldset>
      );
    }

    case "group": {
      const unknown = node.nullable && (value === null || value === undefined);
      return (
        <fieldset className="adm-group">
          <legend>{label}</legend>
          {error ? (
            <p className="nv-field__error" role="alert">
              {error}
            </p>
          ) : null}
          {node.nullable ? <UnknownBox name={name} checked={unknown} /> : null}
          <Sections node={node} at={at} ctx={ctx} />
        </fieldset>
      );
    }

    case "tuple":
    case "record": {
      const unknown = node.nullable && (value === null || value === undefined);
      return (
        <fieldset className="adm-group">
          <legend>{label}</legend>
          {node.nullable ? <UnknownBox name={name} checked={unknown} /> : null}
          <div className="adm-grid">
            {(node.children ?? []).map((child) => (
              <Field key={child.key} node={child} at={[...at, child.key]} ctx={ctx} />
            ))}
          </div>
        </fieldset>
      );
    }

    case "array": {
      const rows = Array.isArray(value) ? value : [];
      const total = rows.length + (ctx.spareRows ?? 1);
      const item = node.item;
      if (!item) return null;
      return (
        <fieldset className="adm-group">
          <legend>{label}</legend>
          {error ? (
            <p className="nv-field__error" role="alert">
              {error}
            </p>
          ) : null}
          <input type="hidden" name={`${name}.${COUNT_SUFFIX}`} value={total} />
          {node.nullable ? <UnknownBox name={name} checked={value === null || value === undefined} /> : null}
          {Array.from({ length: total }, (_, i) => (
            <div className="adm-row" key={i}>
              <span className="adm-row__n">{i + 1}</span>
              <div className="adm-grid">
                {(item.children ?? []).map((child) => (
                  <Field key={child.key} node={child} at={[...at, String(i), child.key]} ctx={ctx} />
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      );
    }

    default:
      return null;
  }
}

/** The children of a group: in titled sections when the context has them for this group, otherwise in one grid. */
function Sections({ node, at, ctx }: { node: FieldNode; at: string[]; ctx: FieldsContext }): ReactNode {
  const children = node.children ?? [];
  const plan = ctx.sections?.[nameOf(at)];
  const draw = (items: FieldNode[]) => (
    <div className="adm-grid">
      {items.map((child) => (
        <Field key={child.key} node={child} at={[...at, child.key]} ctx={ctx} />
      ))}
    </div>
  );
  if (!plan) return draw(children);
  const used = new Set(plan.flatMap((s) => s.keys));
  const rest = children.filter((c) => !used.has(c.key));
  return (
    <>
      {plan
        .map((section) => ({ title: section.title, items: children.filter((c) => section.keys.includes(c.key)) }))
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <fieldset className="adm-group" key={section.title}>
            <legend>{section.title}</legend>
            {draw(section.items)}
          </fieldset>
        ))}
      {rest.length > 0 ? (
        <fieldset className="adm-group">
          <legend>Прочее</legend>
          {draw(rest)}
        </fieldset>
      ) : null}
    </>
  );
}

/** The fields of a form, one after another. */
export function FormFields({ fields, ctx }: { fields: FieldNode[]; ctx: FieldsContext }): ReactNode {
  return (
    <>
      {fields.map((node) => (
        <Field key={node.key} node={node} at={[node.key]} ctx={ctx} />
      ))}
    </>
  );
}
