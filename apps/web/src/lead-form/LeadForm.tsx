"use client";

import { Button, Select, TextField } from "@nivel/ui/react";
import { type ReactNode, useActionState } from "react";
import { submitLead } from "./actions.ts";
import { type FieldErrorCode, type FieldName, FORM_SCOPES, IDLE, type LeadActionState } from "./types.ts";

/** All the words of the form in the language of the page: the server reads them from the messages, the form only shows them. */
export interface LeadFormLabels {
  name: string;
  phone: string;
  phoneHint: string;
  telegram: string;
  telegramHint: string;
  scope: string;
  scopePlaceholder: string;
  scopes: Record<(typeof FORM_SCOPES)[number], string>;
  district: string;
  budget: string;
  budgetHint: string;
  comment: string;
  commentHint: string;
  website: string;
  consent: string;
  submit: string;
  sending: string;
  /** With the placeholder `{number}`. */
  okTitle: string;
  okTitleNoNumber: string;
  okText: string;
  or: string;
  telegramButton: string;
  errors: Record<"invalid" | "rate_limited" | "unavailable" | "failed", string>;
  fieldErrors: Record<FieldErrorCode, string>;
}

export interface LeadFormProps {
  labels: LeadFormLabels;
  locale: "uz" | "ru";
  /** Campaign marks of the address (`utm_source` ...), carried with the request. */
  utm: Record<string, string>;
  /** «What we collect and why», with the links to the policy and the consent text. */
  consentNote: ReactNode;
  botUrl: string;
}

const textareaId = "lead-comment";

/**
 * The request form of the one-page site. It checks nothing itself (`noValidate`): the server reads every field again and answers
 * with the words of the visitor's language, next to the field. Without a script the form still posts (a server action).
 */
export function LeadForm(props: LeadFormProps) {
  const [state, action, pending] = useActionState<LeadActionState, FormData>(submitLead, IDLE);
  return <LeadFormView {...props} state={state} action={action} pending={pending} />;
}

export interface LeadFormViewProps extends LeadFormProps {
  state: LeadActionState;
  action: (formData: FormData) => void;
  pending: boolean;
}

/** What the visitor sees for a state of the form: the form itself, the form with the answer of the server, or the thanks. */
export function LeadFormView({ labels, locale, utm, consentNote, botUrl, state, action, pending }: LeadFormViewProps) {
  if (state.status === "ok") {
    return (
      <div className="lead-ok" role="status">
        <h3>{state.number ? labels.okTitle.replace("{number}", state.number) : labels.okTitleNoNumber}</h3>
        <p>{labels.okText}</p>
        <Button href={botUrl} target="_blank" rel="noopener" mark>
          {labels.telegramButton}
        </Button>
      </div>
    );
  }

  const values = state.status === "error" ? state.values : {};
  const fields = state.status === "error" ? state.fields : {};
  const err = (name: FieldName) => {
    const code = fields[name];
    return code ? labels.fieldErrors[code] : undefined;
  };
  const text = (name: keyof typeof values) => {
    const v = values[name];
    return v === undefined ? {} : { defaultValue: v };
  };
  const scopeOptions = FORM_SCOPES.map((s) => ({ value: s, label: labels.scopes[s] }));
  const commentError = err("comment");

  return (
    <form className="lead-form" action={action} noValidate>
      {state.status === "error" ? (
        <p className="lead-error" role="alert">
          {labels.errors[state.code]}
        </p>
      ) : null}
      <input type="hidden" name="locale" value={locale} />
      {Object.entries(utm).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="hp" aria-hidden="true">
        <label>
          {labels.website}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="lead-grid">
        <TextField
          id="lead-name"
          name="name"
          label={labels.name}
          autoComplete="name"
          maxLength={120}
          error={err("name")}
          {...text("name")}
        />
        <TextField
          id="lead-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          label={labels.phone}
          hint={labels.phoneHint}
          autoComplete="tel"
          error={err("phone")}
          {...text("phone")}
        />
        <TextField
          id="lead-telegram"
          name="telegram"
          label={labels.telegram}
          hint={labels.telegramHint}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={err("telegram")}
          {...text("telegram")}
        />
        <Select
          id="lead-scope"
          name="scope"
          label={labels.scope}
          placeholder={labels.scopePlaceholder}
          options={scopeOptions}
          error={err("scope")}
          {...(values.scope ? { defaultValue: values.scope } : {})}
        />
        <TextField
          id="lead-district"
          name="district"
          label={labels.district}
          maxLength={80}
          error={err("district")}
          {...text("district")}
        />
        <TextField
          id="lead-budget"
          name="budget"
          inputMode="decimal"
          label={labels.budget}
          hint={labels.budgetHint}
          error={err("budget")}
          {...text("budget")}
        />
        <div className={`nv-field lead-wide${commentError ? " nv-field--invalid" : ""}`}>
          <label className="nv-field__label" htmlFor={textareaId}>
            {labels.comment}
          </label>
          <textarea
            className="nv-field__control"
            id={textareaId}
            name="comment"
            rows={4}
            maxLength={2000}
            aria-describedby={`${textareaId}-hint`}
            aria-invalid={commentError ? true : undefined}
            {...text("comment")}
          />
          <p className="nv-field__hint" id={`${textareaId}-hint`}>
            {labels.commentHint}
          </p>
          {commentError ? (
            <p className="nv-field__error" role="alert">
              {commentError}
            </p>
          ) : null}
        </div>
      </div>
      <div className={`lead-consent${err("consent") ? " is-invalid" : ""}`}>
        <label>
          <input
            type="checkbox"
            name="consent"
            value="on"
            aria-invalid={err("consent") ? true : undefined}
            {...(values.consent === "on" ? { defaultChecked: true } : {})}
          />
          <span>{labels.consent}</span>
        </label>
        <p className="nv-field__hint">{consentNote}</p>
        {err("consent") ? (
          <p className="nv-field__error" role="alert">
            {err("consent")}
          </p>
        ) : null}
      </div>
      <div className="lead-actions">
        <Button type="submit" mark disabled={pending}>
          {pending ? labels.sending : labels.submit}
        </Button>
        <span className="lead-or">{labels.or}</span>
        <Button href={botUrl} variant="ghost" target="_blank" rel="noopener">
          {labels.telegramButton}
        </Button>
      </div>
    </form>
  );
}
