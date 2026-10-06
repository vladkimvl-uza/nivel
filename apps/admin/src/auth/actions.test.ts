// The server actions of sign-in and of the account, called as the forms call them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "./policy.ts";

const app = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./runtime.ts", () => ({ getRuntime: () => app.current }));
vi.mock("next/headers", async () => (await import("../kit/test-support/fake-app.ts")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async () => {
  const { RedirectSignal } = await import("../kit/test-support/fake-app.ts");
  return {
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  };
});

const { createFakeApp, form, jar, PASSWORD, requestHeaders, RedirectSignal } = await import(
  "../kit/test-support/fake-app.ts"
);
const { generateTotp } = await import("./totp.ts");
const actions = await import("./actions.ts");

let fake: Awaited<ReturnType<typeof createFakeApp>>;
beforeEach(() => {
  fake = createFakeApp();
  app.current = fake.runtime;
});

const redirectedTo = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
};

async function newAccount(email: string, role: "owner" | "assistant" = "owner") {
  const made = await fake.runtime.auth.provisionUser({ email, role, password: PASSWORD, actor: "test" });
  if (!made.ok) throw new Error("provision failed");
  const secret = (await import("./totp.ts")).base32Decode(made.totpSecret);
  return { made, secret, code: () => generateTotp(secret, new Date()) };
}

describe("sign in", () => {
  it("sets the cookie of the session and sends the person to the first screen of the role", async () => {
    const owner = await newAccount("o@nivel.test");
    requestHeaders.set("x-forwarded-for", "10.66.0.7, 172.16.0.1");
    const url = await redirectedTo(
      actions.signInAction({}, form({ email: "O@nivel.test", password: PASSWORD, code: owner.code() })),
    );
    expect(url).toBe("/catalog");
    expect(jar.get(SESSION_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fake.authStore.audit.find((a) => a.action === "auth.login")?.ipHash).toBe("hash(10.66.0.7)");
  });

  it("answers with one text for a wrong password, a wrong code and an unknown e-mail", async () => {
    const owner = await newAccount("o@nivel.test");
    const wrong = "Неверный e-mail, пароль или код.";
    expect(
      await actions.signInAction({}, form({ email: "o@nivel.test", password: "x".repeat(20), code: owner.code() })),
    ).toEqual({ error: wrong });
    expect(await actions.signInAction({}, form({ email: "o@nivel.test", password: PASSWORD, code: "000000" }))).toEqual(
      { error: wrong },
    );
    expect(
      await actions.signInAction({}, form({ email: "nobody@nivel.test", password: PASSWORD, code: "000000" })),
    ).toEqual({ error: wrong });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("tells the lock and the time in Tashkent after the fifth failure", async () => {
    await newAccount("o@nivel.test");
    let state = {};
    for (let i = 0; i < 5; i += 1) {
      state = await actions.signInAction({}, form({ email: "o@nivel.test", password: "x".repeat(20), code: "000000" }));
    }
    expect((state as { error: string }).error).toMatch(/^Вход заблокирован до \d{2}:\d{2} \(Ташкент\)/);
  });

  it("signs out: the cookie goes, the session is ended, the journal has it", async () => {
    const { token, user } = await fake.signInAs("owner");
    expect(await redirectedTo(actions.signOutAction())).toBe("/sign-in");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await fake.runtime.auth.authenticate(token)).toBeNull();
    expect(fake.authStore.audit.some((a) => a.action === "auth.logout" && a.actor === `admin:${user.id}`)).toBe(true);
    // Signing out with no session is not an error.
    expect(await redirectedTo(actions.signOutAction())).toBe("/sign-in");
  });
});

describe("the own account", () => {
  it("changes the password, keeps this session and refuses a weak one, a mismatch and a wrong old password", async () => {
    const { token } = await fake.signInAs("owner");
    const good = await actions.changePasswordAction(
      {},
      form({ current: PASSWORD, next: "a-brand-new-long-password", repeat: "a-brand-new-long-password" }),
    );
    expect(good).toEqual({ ok: true, message: "Пароль изменён. Остальные сеансы завершены." });
    expect(await fake.runtime.auth.authenticate(token)).not.toBeNull();
    expect(
      (
        await actions.changePasswordAction(
          {},
          form({ current: "a-brand-new-long-password", next: "short", repeat: "short" }),
        )
      ).message,
    ).toBe("Пароль короче 14 знаков.");
    expect(
      (
        await actions.changePasswordAction(
          {},
          form({ current: "a-brand-new-long-password", next: "another-long-password-1", repeat: "different" }),
        )
      ).message,
    ).toBe("Новый пароль и повтор не совпадают.");
    expect(
      (
        await actions.changePasswordAction(
          {},
          form({ current: "nope-nope-nope-nope", next: "another-long-password-1", repeat: "another-long-password-1" }),
        )
      ).message,
    ).toBe("Текущий пароль неверный.");
  });

  it("binds and unbinds the Telegram id with the password and a fresh code; refuses junk and an id of another account", async () => {
    await newAccount("tg@nivel.test", "assistant").then(async (other) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(Date.now() + 31_000);
        await fake.runtime.auth.bindTelegram(other.made.id, {
          telegram: "555",
          password: PASSWORD,
          code: other.code(),
        });
      } finally {
        vi.useRealTimers();
      }
    });
    const { secret } = await fake.signInAs("owner");
    const base = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let step = 0;
      // Each submission comes a period later than the one before: a code is good for one use.
      const bind = (fields: Record<string, string>, over: { password?: string; code?: string } = {}) => {
        step += 1;
        vi.setSystemTime(base + step * 31_000);
        return actions.bindTelegramAction(
          {},
          form({ password: over.password ?? PASSWORD, code: over.code ?? generateTotp(secret, new Date()), ...fields }),
        );
      };
      expect(await bind({ telegram: "123456789" })).toMatchObject({
        ok: true,
        message: expect.stringContaining("Telegram привязан"),
      });
      expect(await bind({ telegram: "" })).toMatchObject({ ok: true, message: "Привязка Telegram снята." });
      expect(await bind({ telegram: "abc" })).toMatchObject({
        ok: false,
        message: expect.stringContaining("числовой Telegram id"),
      });
      expect(await bind({ telegram: "555" })).toMatchObject({
        ok: false,
        message: expect.stringContaining("уже привязан"),
      });
      // The wrong password or a code that was already used changes nothing and says why.
      expect(await bind({ telegram: "777" }, { password: "nope-nope-nope-nope" })).toMatchObject({
        ok: false,
        message: expect.stringContaining("Пароль или код неверные"),
      });
      expect(await bind({ telegram: "777" }, { code: "000000" })).toMatchObject({ ok: false });
      const owner = [...fake.authStore.accounts.values()].find((a) => a.role === "owner");
      expect(owner?.telegramUserId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stolen session alone cannot take over the binding of the bot", async () => {
    await fake.signInAs("owner");
    const result = await actions.bindTelegramAction({}, form({ telegram: "999000111" }));
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("Пароль или код неверные") });
    expect([...fake.authStore.accounts.values()].every((a) => a.telegramUserId === null)).toBe(true);
  });

  it("issues new recovery codes after a check of the password and a code, shows them once", async () => {
    const { password, secret } = await fake.signInAs("owner");
    const refused = await actions.regenerateCodesAction(
      {},
      form({ password: "nope-nope-nope-nope", code: generateTotp(secret, new Date()) }),
    );
    expect(refused).toEqual({ ok: false, message: "Пароль или код неверные." });
    const issued = await actions.regenerateCodesAction(
      {},
      form({ password, code: generateTotp(secret, new Date(Date.now() + 30_000)) }),
    );
    expect(issued.ok).toBe(true);
    expect(issued.codes).toHaveLength(10);
  });

  it("every account action needs a session", async () => {
    expect(await actions.changePasswordAction({}, form({ current: "a", next: "b", repeat: "b" }))).toEqual({
      ok: false,
      message: "Недостаточно прав для этого действия.",
    });
    expect(await actions.bindTelegramAction({}, form({ telegram: "1" }))).toMatchObject({
      ok: false,
      message: "Недостаточно прав для этого действия.",
    });
    expect(await actions.regenerateCodesAction({}, form({ password: "a", code: "b" }))).toMatchObject({ ok: false });
  });
});

describe("people", () => {
  it("the owner creates an account and sees the way in once; the journal has it", async () => {
    const { user } = await fake.signInAs("owner");
    const state = await actions.createUserAction({}, form({ email: "helper@nivel.test", role: "assistant" }));
    expect(state.ok).toBe(true);
    expect(state.created?.email).toBe("helper@nivel.test");
    expect(state.created?.password).toHaveLength(20);
    expect(state.created?.recoveryCodes).toHaveLength(10);
    expect(fake.authStore.audit.at(-1)).toMatchObject({ action: "auth.user_created", actor: `admin:${user.id}` });
  });

  it("refuses a role that does not exist and an e-mail that is taken", async () => {
    await fake.signInAs("owner");
    expect(await actions.createUserAction({}, form({ email: "x@nivel.test", role: "king" }))).toEqual({
      ok: false,
      message: "Выберите роль.",
    });
    const taken = await actions.createUserAction({}, form({ email: "OWNER@nivel.test", role: "assistant" }));
    expect(taken).toEqual({ ok: false, message: "Учётная запись с таким e-mail уже есть." });
  });

  it("the assistant creates nobody", async () => {
    await fake.signInAs("assistant");
    const state = await actions.createUserAction({}, form({ email: "x@nivel.test", role: "assistant" }));
    expect(state).toEqual({ ok: false, message: "Недостаточно прав для этого действия." });
    expect(fake.audit.map((a) => a.action)).toContain("auth.user_create.denied");
    expect((await fake.runtime.auth.listAccounts()).length).toBe(1);
  });

  it("the owner switches an account off and on, and not himself", async () => {
    const { user } = await fake.signInAs("owner");
    const other = await newAccount("other@nivel.test", "assistant");
    await actions.setUserActiveAction(form({ id: other.made.id, active: "false" }));
    expect(fake.authStore.accounts.get(other.made.id)?.active).toBe(false);
    await actions.setUserActiveAction(form({ id: other.made.id, active: "true" }));
    expect(fake.authStore.accounts.get(other.made.id)?.active).toBe(true);
    await actions.setUserActiveAction(form({ id: user.id, active: "false" }));
    expect(fake.authStore.accounts.get(user.id)?.active).toBe(true);
  });

  it("the assistant cannot switch anybody off, and the attempt is journaled", async () => {
    const owner = await newAccount("boss@nivel.test");
    await fake.signInAs("assistant");
    await actions.setUserActiveAction(form({ id: owner.made.id, active: "false" }));
    expect(fake.authStore.accounts.get(owner.made.id)?.active).toBe(true);
    expect(fake.audit.map((a) => a.action)).toContain("auth.user_switch.denied");
  });
});
