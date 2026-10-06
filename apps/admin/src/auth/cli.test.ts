import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runCli } from "./cli.ts";
import { createNodeArgon2Hasher } from "./password.ts";
import { createAuthService } from "./service.ts";
import { MemoryAuthStore } from "./store.memory.ts";

function setup() {
  const store = new MemoryAuthStore();
  const service = createAuthService({
    store,
    hasher: createNodeArgon2Hasher({ memoryKiB: 64, passes: 1 }),
    dataKey: randomBytes(32),
    issuer: "Nivel admin",
  });
  const out: string[] = [];
  return { store, service, out, print: (line: string) => void out.push(line) };
}

describe("create-user", () => {
  it("creates the first owner and prints the way in once", async () => {
    const { service, store, out, print } = setup();
    const code = await runCli(["create-user", "--email", "Owner@Nivel.uz", "--role", "owner"], { service, print });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("owner@nivel.uz");
    expect(text).toMatch(/Пароль: \S{20}/);
    expect(text).toMatch(/Ключ для приложения: [A-Z2-7]{32}/);
    expect(text).toContain("otpauth://totp/");
    expect(text.match(/^\s+[a-z2-9]{5}-[a-z2-9]{5}$/gm)).toHaveLength(10);
    expect([...store.accounts.values()][0]).toMatchObject({ email: "owner@nivel.uz", role: "owner" });
    expect(store.audit.at(-1)).toMatchObject({ action: "auth.user_created", actor: "cli" });
  });

  it("takes a password given by the person and a Telegram id", async () => {
    const { service, store, out, print } = setup();
    const code = await runCli(
      [
        "create-user",
        "--email",
        "a@nivel.uz",
        "--role",
        "assistant",
        "--password",
        "a-long-enough-password",
        "--telegram",
        "777000111",
      ],
      { service, print },
    );
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("a-long-enough-password");
    expect([...store.accounts.values()][0]?.telegramUserId).toBe(777000111);
  });

  it("explains a refusal and returns a non-zero code", async () => {
    const { service, out, print } = setup();
    expect(await runCli(["create-user", "--email", "bad", "--role", "owner"], { service, print })).toBe(1);
    expect(out.join("\n")).toContain("Некорректный e-mail.");
    expect(await runCli(["create-user", "--email", "a@nivel.uz", "--role", "king"], { service, print })).toBe(2);
    expect(await runCli(["create-user", "--role", "owner"], { service, print })).toBe(2);
    expect(
      await runCli(["create-user", "--email", "a@nivel.uz", "--role", "owner", "--telegram", "x1"], { service, print }),
    ).toBe(2);
    expect(await runCli(["nonsense"], { service, print })).toBe(2);
    expect(await runCli([], { service, print })).toBe(2);
  });
});

describe("unlock", () => {
  it("lifts the lock of an account, journaled, and refuses an unknown e-mail", async () => {
    const { service, store, out, print } = setup();
    await runCli(["create-user", "--email", "o@nivel.uz", "--role", "owner"], { service, print });
    const account = [...store.accounts.values()][0];
    if (!account) throw new Error("no account");
    account.failedLogins = 20;
    account.lockedUntil = new Date(Date.now() + 600_000);
    out.length = 0;
    expect(await runCli(["unlock", "--email", "O@nivel.uz"], { service, print })).toBe(0);
    expect(account).toMatchObject({ failedLogins: 0, lockedUntil: null });
    expect(store.audit.at(-1)).toMatchObject({ action: "auth.unlocked", actor: "cli", entityId: account.id });
    expect(await runCli(["unlock", "--email", "nobody@nivel.uz"], { service, print })).toBe(1);
    expect(await runCli(["unlock"], { service, print })).toBe(2);
  });
});
