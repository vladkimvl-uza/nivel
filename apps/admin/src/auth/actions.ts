"use server";

// Server actions of the account: sign in, sign out, own password, Telegram id, recovery codes, people (owner).
// Each one checks the session itself; the answers are plain objects for the form that called (no stack traces).
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { homeFor } from "../nav/nav.ts";
import {
  endSession,
  forbiddenMessage,
  guardAction,
  NOT_ALLOWED,
  requestInfo,
  requireActionUser,
  startSession,
} from "./next.ts";
import { AUTH_POLICY, SESSION_COOKIE } from "./policy.ts";
import { isRole } from "./roles.ts";
import { getRuntime } from "./runtime.ts";

export interface LoginState {
  error?: string;
}

const MESSAGES = {
  invalid: "Неверный e-mail, пароль или код.",
  locked: `Слишком много неудачных попыток. Повторите через ${AUTH_POLICY.lockMinutes} минут.`,
} as const;

function text(data: FormData, name: string): string {
  const v = data.get(name);
  return typeof v === "string" ? v : "";
}

export async function signInAction(_previous: LoginState, data: FormData): Promise<LoginState> {
  const { auth } = getRuntime();
  const info = await requestInfo();
  const result = await auth.login({
    email: text(data, "email"),
    password: text(data, "password"),
    code: text(data, "code"),
    ...info,
  });
  if (!result.ok) {
    // Without a date and the same for every e-mail: the answer must not tell a stranger whether the account exists.
    return { error: result.reason === "throttled" ? MESSAGES.locked : MESSAGES.invalid };
  }
  await startSession(result.token);
  redirect(homeFor(result.user.role));
}

export async function signOutAction(): Promise<void> {
  const token = await endSession();
  if (token) {
    const user = await getRuntime().auth.authenticate(token);
    await getRuntime().auth.logout(token, user?.id);
  }
  redirect("/sign-in");
}

// ---- the own account --------------------------------------------------------------------------------------------------

export interface AccountState {
  ok?: boolean;
  message?: string;
  /** Shown once: new recovery codes. */
  codes?: string[];
}

export async function changePasswordAction(_previous: AccountState, data: FormData): Promise<AccountState> {
  try {
    const user = await requireActionUser("account.self");
    const next = text(data, "next");
    if (next !== text(data, "repeat")) return { ok: false, message: "Новый пароль и повтор не совпадают." };
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const result = await getRuntime().auth.changePassword(user.id, {
      current: text(data, "current"),
      next,
      ipHash: (await requestInfo()).ipHash,
      ...(token ? { keepToken: token } : {}),
    });
    if (result.ok) return { ok: true, message: "Пароль изменён. Остальные сеансы завершены." };
    if (result.reason === "policy") return { ok: false, message: result.problems.join(" ") };
    if (result.reason === "locked") return { ok: false, message: MESSAGES.locked };
    return { ok: false, message: "Текущий пароль неверный." };
  } catch (error) {
    const denied = forbiddenMessage(error);
    if (denied) return { ok: false, message: denied };
    throw error;
  }
}

export async function bindTelegramAction(_previous: AccountState, data: FormData): Promise<AccountState> {
  try {
    const user = await requireActionUser("account.self");
    const result = await getRuntime().auth.bindTelegram(user.id, {
      telegram: text(data, "telegram"),
      password: text(data, "password"),
      code: text(data, "code"),
      ipHash: (await requestInfo()).ipHash,
    });
    revalidatePath("/account");
    if (result.ok) {
      return {
        ok: true,
        message:
          result.telegramUserId === null
            ? "Привязка Telegram снята."
            : "Telegram привязан: бот узнает вас по этому номеру.",
      };
    }
    const messages = {
      taken: "Этот Telegram-номер уже привязан к другой учётной записи.",
      invalid: "Пароль или код неверные. Код нужен новый: дождитесь, пока в приложении сменятся цифры.",
      locked: MESSAGES.locked,
      format:
        "Нужен числовой Telegram id (только цифры). Его показывает бот @userinfobot или команда /id в нашем боте.",
    } as const;
    return { ok: false, message: messages[result.reason] };
  } catch (error) {
    const denied = forbiddenMessage(error);
    if (denied) return { ok: false, message: denied };
    throw error;
  }
}

export async function regenerateCodesAction(_previous: AccountState, data: FormData): Promise<AccountState> {
  try {
    const user = await requireActionUser("account.self");
    const result = await getRuntime().auth.regenerateRecoveryCodes(user.id, {
      password: text(data, "password"),
      code: text(data, "code"),
      ipHash: (await requestInfo()).ipHash,
    });
    if (!result.ok) {
      return { ok: false, message: result.reason === "locked" ? MESSAGES.locked : "Пароль или код неверные." };
    }
    return {
      ok: true,
      message: `Новые коды восстановления (${AUTH_POLICY.recoveryCodeCount}). Старые больше не действуют. Сохраните эти коды: больше они не покажутся.`,
      codes: result.recoveryCodes,
    };
  } catch (error) {
    const denied = forbiddenMessage(error);
    if (denied) return { ok: false, message: denied };
    throw error;
  }
}

// ---- people (owner) ---------------------------------------------------------------------------------------------------

export interface CreateUserState {
  ok?: boolean;
  message?: string;
  /** Shown once to the owner: the way in for the new person. */
  created?: { email: string; password: string; totpSecret: string; totpUri: string; recoveryCodes: string[] };
}

export async function createUserAction(_previous: CreateUserState, data: FormData): Promise<CreateUserState> {
  const owner = await guardAction("users.manage", "auth.user_create", "ops.admin_users");
  if (!owner) return { ok: false, message: NOT_ALLOWED };
  const role = text(data, "role");
  if (!isRole(role)) return { ok: false, message: "Выберите роль." };
  const result = await getRuntime().auth.provisionUser({
    email: text(data, "email"),
    role,
    actor: `admin:${owner.id}`,
  });
  if (!result.ok) return { ok: false, message: result.problems.join(" ") };
  revalidatePath("/users");
  return {
    ok: true,
    message:
      "Учётная запись создана. Передайте данные человеку лично: пароль, ключ приложения и коды показаны один раз.",
    created: {
      email: result.email,
      password: result.password,
      totpSecret: result.totpSecret,
      totpUri: result.totpUri,
      recoveryCodes: result.recoveryCodes,
    },
  };
}

export async function setUserActiveAction(data: FormData): Promise<void> {
  const owner = await guardAction("users.manage", "auth.user_switch", "ops.admin_users");
  if (!owner) return;
  await getRuntime().auth.setActive(text(data, "id"), text(data, "active") === "true", owner);
  revalidatePath("/users");
}
