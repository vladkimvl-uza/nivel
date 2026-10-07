"use client";

// admin kit: a form on fields drawn from a schema. The server action gets the FormData, validates and answers with the
// state to draw next: errors by field, the values typed (so nothing typed is lost), a message. No state of its own.
import { Button } from "@nivel/ui/react";
import { type ReactNode, useActionState } from "react";
import type { FieldNode } from "../schema.ts";
import { FormFields } from "./fields.tsx";

export interface FormState {
  ok?: boolean;
  message?: string;
  errors: Record<string, string>;
  values: unknown;
  /** A new set of fields when the answer changes which fields are shown. */
  fields?: FieldNode[];
  hiddenNames?: string[];
}

export interface SchemaFormProps {
  action: (previous: FormState, data: FormData) => Promise<FormState>;
  initial: FormState;
  fields: FieldNode[];
  labels: Record<string, string>;
  optionLabels?: Record<string, Record<string, string>>;
  hiddenNames?: string[];
  submitLabel: string;
  /** Values the action needs and the person does not edit: the id, the version the screen was opened with. */
  hidden?: Record<string, string>;
  /** What goes after the fields (extra buttons, notes). */
  children?: ReactNode;
  spareRows?: number;
  /** Titled sections of a group, by its dotted name (the specification of a position). */
  sections?: Record<string, { title: string; keys: string[] }[]>;
  testId?: string;
}

export function SchemaForm(props: SchemaFormProps) {
  const [state, formAction, pending] = useActionState(props.action, props.initial);
  const fields = state.fields ?? props.fields;
  const failed = state.ok === false || Object.keys(state.errors).length > 0;
  return (
    <form action={formAction} className="adm-form" data-testid={props.testId} noValidate>
      {state.message ? (
        <p
          className={failed ? "adm-flash adm-flash--error" : "adm-flash adm-flash--ok"}
          role={failed ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
      {state.errors[""] ? (
        <p className="adm-flash adm-flash--error" role="alert">
          {state.errors[""]}
        </p>
      ) : null}
      {Object.entries(props.hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormFields
        fields={fields}
        ctx={{
          values: state.values,
          errors: state.errors,
          labels: props.labels,
          ...(props.optionLabels ? { optionLabels: props.optionLabels } : {}),
          hiddenNames: state.hiddenNames ?? props.hiddenNames ?? [],
          ...(props.spareRows !== undefined ? { spareRows: props.spareRows } : {}),
          ...(props.sections ? { sections: props.sections } : {}),
        }}
      />
      {props.children}
      <div className="adm-actions">
        <Button type="submit" disabled={pending} mark>
          {pending ? "Сохраняю…" : props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
