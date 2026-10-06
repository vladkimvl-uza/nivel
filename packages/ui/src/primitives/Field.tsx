import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { assertText, cx } from "./cx.ts";

interface FieldBase {
  /** Required and unique on the page: the label, the hint and the error are tied to the control by it. */
  id: string;
  /** Visible label. Texts come from the caller (uz/ru); an empty label is refused. */
  label: string;
  hint?: ReactNode;
  /** An error message; its presence marks the control invalid and announces the text. */
  error?: ReactNode;
}

function describedBy(id: string, hint: ReactNode, error: ReactNode): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function Shell({ base, className, children }: { base: FieldBase; className: string | undefined; children: ReactNode }) {
  const { id, label, hint, error } = base;
  return (
    <div className={cx("nv-field", error ? "nv-field--invalid" : false, className)}>
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

function check({ id, label }: FieldBase, component: string): void {
  assertText(id, "id", component);
  assertText(label, "label", component);
}

export type TextFieldProps = FieldBase &
  Omit<ComponentPropsWithoutRef<"input">, keyof FieldBase | "className"> & { className?: string | undefined };

/** Text input with its label, hint and error tied together for assistive technology. */
export function TextField(props: TextFieldProps) {
  check(props, "TextField");
  const { id, label, hint, error, className, type = "text", ...input } = props;
  return (
    <Shell base={{ id, label, hint, error }} className={className}>
      <input
        className="nv-field__control"
        id={id}
        type={type}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        {...input}
      />
    </Shell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

export type SelectProps = FieldBase &
  Omit<ComponentPropsWithoutRef<"select">, keyof FieldBase | "className" | "children"> & {
    options: readonly SelectOption[];
    /** An empty first option shown until the visitor chooses (selected when no `value` or `defaultValue` is given). */
    placeholder?: string | undefined;
    className?: string | undefined;
  };

/** Native select (works on every phone) with the same label, hint and error semantics as `TextField`. */
export function Select(props: SelectProps) {
  check(props, "Select");
  const { id, label, hint, error, className, options, placeholder, ...select } = props;
  // The placeholder is chosen until the visitor chooses: without it the browser would select the first real option
  // and a `required` select would pass unnoticed. A given `value` or `defaultValue` is never overridden.
  const startsEmpty = placeholder !== undefined && select.value === undefined && select.defaultValue === undefined;
  return (
    <Shell base={{ id, label, hint, error }} className={className}>
      <span className="nv-select">
        <select
          className="nv-field__control"
          id={id}
          aria-describedby={describedBy(id, hint, error)}
          aria-invalid={error ? true : undefined}
          {...(startsEmpty ? { defaultValue: "" } : {})}
          {...select}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </Shell>
  );
}
