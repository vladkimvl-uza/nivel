"use client";

// A form of the orders screens that calls a server action and shows its answer next to itself: the text of a refusal in
// Russian, or what was done. It holds no business state; the action comes bound to its ids by the page.
import { Button } from "@nivel/ui/react";
import { type FormEvent, type ReactNode, startTransition, useActionState, useEffect, useRef } from "react";
import { type ActionState, IDLE } from "../action-state.ts";

export interface ActionFormProps {
  action: (previous: ActionState, data: FormData) => Promise<ActionState>;
  submit: string;
  children?: ReactNode;
  testId?: string;
  variant?: "primary" | "ghost";
  /** Clears the fields after a success (a new payment, a new purchase); a button without fields has nothing to clear. */
  resetOnSuccess?: boolean;
  /** Words of the person for a question before a risky press. */
  className?: string;
}

export function ActionForm({
  action,
  submit,
  children,
  testId,
  variant = "ghost",
  resetOnSuccess = true,
  className = "adm-form",
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, IDLE);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state.ok, state.at, resetOnSuccess]);
  const failed = state.ok === false;
  // React empties the uncontrolled fields of a form after its action, a refusal too: the person would retype everything.
  // The action is therefore started by hand, and the fields are cleared only after a success (the effect above).
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter instanceof HTMLElement ? submitter : null);
    startTransition(() => formAction(data));
  }
  return (
    <form ref={ref} onSubmit={onSubmit} className={className} data-testid={testId} noValidate>
      {state.message ? (
        <p
          className={failed ? "adm-flash adm-flash--error" : "adm-flash adm-flash--ok"}
          role={failed ? "alert" : "status"}
          data-testid={testId ? `${testId}-message` : undefined}
        >
          {state.message}
        </p>
      ) : null}
      {children}
      <div className="adm-actions">
        <Button type="submit" variant={variant} size="sm" disabled={pending}>
          {pending ? "Выполняю…" : submit}
        </Button>
      </div>
    </form>
  );
}
