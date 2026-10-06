"use client";

// Forms of the sign-in page and of the own account. Client components only because `useActionState` keeps the
// answer of the server action next to the form; they send nothing but the form.
import { Button, TextField } from "@nivel/ui/react";
import { useActionState } from "react";
import {
  type AccountState,
  bindTelegramAction,
  type CreateUserState,
  changePasswordAction,
  createUserAction,
  type LoginState,
  regenerateCodesAction,
  signInAction,
} from "./actions.ts";
import { ROLE_LABELS, ROLES } from "./roles.ts";

function Flash({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className={ok ? "adm-flash adm-flash--ok" : "adm-flash adm-flash--error"} role={ok ? "status" : "alert"}>
      {children}
    </p>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInAction, {});
  return (
    <form action={action} className="adm-form" data-testid="sign-in-form">
      {state.error ? <Flash ok={false}>{state.error}</Flash> : null}
      <TextField id="email" name="email" label="E-mail" type="email" autoComplete="username" required />
      <TextField
        id="password"
        name="password"
        label="Пароль"
        type="password"
        autoComplete="current-password"
        required
      />
      <TextField
        id="code"
        name="code"
        label="Код из приложения"
        autoComplete="one-time-code"
        inputMode="text"
        required
        hint="Шесть цифр из приложения-аутентификатора или один код восстановления."
      />
      <div className="adm-actions">
        <Button type="submit" disabled={pending} mark>
          {pending ? "Проверяю…" : "Войти"}
        </Button>
      </div>
    </form>
  );
}

export function TelegramForm({ current }: { current: number | null }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(bindTelegramAction, {});
  return (
    <form action={action} className="adm-form" data-testid="telegram-form">
      {state.message ? <Flash ok={state.ok === true}>{state.message}</Flash> : null}
      <TextField
        id="telegram"
        name="telegram"
        label="Telegram id"
        inputMode="numeric"
        defaultValue={current === null ? "" : String(current)}
        hint="Число. Бот проверяет по нему, что команды владельца пишет именно этот человек. Пусто — отвязать."
      />
      <div className="adm-actions">
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="adm-form" data-testid="password-form">
      {state.message ? <Flash ok={state.ok === true}>{state.message}</Flash> : null}
      <TextField
        id="current"
        name="current"
        label="Текущий пароль"
        type="password"
        autoComplete="current-password"
        required
      />
      <TextField
        id="next"
        name="next"
        label="Новый пароль"
        type="password"
        autoComplete="new-password"
        required
        hint="От 14 знаков."
      />
      <TextField
        id="repeat"
        name="repeat"
        label="Новый пароль ещё раз"
        type="password"
        autoComplete="new-password"
        required
      />
      <div className="adm-actions">
        <Button type="submit" disabled={pending}>
          Сменить пароль
        </Button>
      </div>
    </form>
  );
}

export function RecoveryForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(regenerateCodesAction, {});
  return (
    <form action={action} className="adm-form" data-testid="recovery-form">
      {state.message ? <Flash ok={state.ok === true}>{state.message}</Flash> : null}
      {state.codes ? (
        <ol className="adm-codes" data-testid="recovery-codes">
          {state.codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
      ) : null}
      <TextField
        id="rc-password"
        name="password"
        label="Пароль"
        type="password"
        autoComplete="current-password"
        required
      />
      <TextField
        id="rc-code"
        name="code"
        label="Код из приложения"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
      />
      <div className="adm-actions">
        <Button type="submit" disabled={pending} variant="ghost">
          Выпустить новые коды
        </Button>
      </div>
    </form>
  );
}

export function CreateUserForm() {
  const [state, action, pending] = useActionState<CreateUserState, FormData>(createUserAction, {});
  return (
    <form action={action} className="adm-form" data-testid="create-user-form">
      {state.message ? <Flash ok={state.ok === true}>{state.message}</Flash> : null}
      {state.created ? (
        <dl className="adm-kv" data-testid="created-user">
          <dt>E-mail</dt>
          <dd>{state.created.email}</dd>
          <dt>Пароль</dt>
          <dd>
            <code className="adm-secret">{state.created.password}</code>
          </dd>
          <dt>Ключ для приложения</dt>
          <dd>
            <code className="adm-secret">{state.created.totpSecret}</code>
          </dd>
          <dt>Коды восстановления</dt>
          <dd>
            <ol className="adm-codes">
              {state.created.recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ol>
          </dd>
        </dl>
      ) : null}
      <TextField id="new-email" name="email" label="E-mail" type="email" required />
      <div className="nv-field">
        <label className="nv-field__label" htmlFor="new-role">
          Роль
        </label>
        <span className="nv-select">
          <select className="nv-field__control" id="new-role" name="role" defaultValue="assistant">
            {ROLES.filter((r) => r !== "owner").map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="adm-actions">
        <Button type="submit" disabled={pending}>
          Создать учётную запись
        </Button>
      </div>
    </form>
  );
}
