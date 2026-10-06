// Integration: the sign-in service on a real database (the worker copy of the test template, role nivel_admin).
import { randomBytes } from "node:crypto";
import { createDb, type Db } from "@nivel/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeArgon2Hasher } from "./password.ts";
import { type AuthService, createAuthService } from "./service.ts";
import { createPgAuthStore } from "./store.pg.ts";
import { DuplicateAccountError } from "./store.ts";
import { base32Decode, generateTotp } from "./totp.ts";

const PASSWORD = "correct-horse-battery-staple";
const WRONG = "wrong-password-number-1";

let db: Db;
let service: AuthService;
/** The service clock runs ahead of the real one by this much: a test moves to the next TOTP step without waiting. */
let skewMs = 0;
const clock = () => new Date(Date.now() + skewMs);
const nextStep = () => {
  skewMs += 31_000;
};
const store = () => createPgAuthStore(db);

beforeAll(() => {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set by the harness");
  db = createDb(url, { max: 4 });
  service = createAuthService({
    store: store(),
    hasher: createNodeArgon2Hasher({ memoryKiB: 64, passes: 1 }),
    dataKey: randomBytes(32),
    now: clock,
    issuer: "Nivel admin",
  });
});

afterAll(async () => {
  await db.$client.end();
});

async function newUser(email: string, role: "owner" | "assistant" = "owner") {
  const r = await service.provisionUser({ email, role, password: PASSWORD, actor: "int-test" });
  if (!r.ok) throw new Error(r.problems.join(" "));
  const secret = base32Decode(r.totpSecret);
  return { ...r, code: () => generateTotp(secret, clock()) };
}

const login = (email: string, password: string, code: string) =>
  service.login({ email, password, code, ipHash: "h".repeat(8), ua: "int" });

async function auditActions(entityId: string): Promise<string[]> {
  const { rows } = await db.$client.query<{ action: string }>(
    "select action from ops.audit_log where entity_id = $1 order by at, id",
    [entityId],
  );
  return rows.map((r) => r.action);
}

describe("sign-in on PostgreSQL", () => {
  it("creates an account, signs in, recognizes the session and signs out", async () => {
    const u = await newUser("owner-1@nivel.test");
    const r = await login("OWNER-1@nivel.test", PASSWORD, u.code());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await service.authenticate(r.token)).toMatchObject({ id: u.id, role: "owner", email: "owner-1@nivel.test" });
    await service.logout(r.token, u.id);
    expect(await service.authenticate(r.token)).toBeNull();
    expect(await auditActions(u.id)).toEqual(["auth.user_created", "auth.login", "auth.logout"]);
  });

  it("stores the password as argon2id and the second factor sealed, never in the clear", async () => {
    const u = await newUser("owner-2@nivel.test");
    const { rows } = await db.$client.query<{ password_hash: string; totp_secret_enc: string }>(
      "select password_hash, totp_secret_enc from ops.admin_users where id = $1",
      [u.id],
    );
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.totp_secret_enc).toMatch(/^v1\./);
    expect(rows[0]?.totp_secret_enc).not.toContain(u.totpSecret);
  });

  it("locks after five failures for 15 minutes by the database clock of the lock and releases it later", async () => {
    const u = await newUser("owner-3@nivel.test");
    for (let i = 0; i < 4; i += 1)
      expect(await login("owner-3@nivel.test", WRONG, "000000")).toEqual({ ok: false, reason: "invalid" });
    const fifth = await login("owner-3@nivel.test", WRONG, "000000");
    expect(fifth).toMatchObject({ ok: false, reason: "locked" });
    // Even the right credentials are refused while the lock lasts.
    expect(await login("owner-3@nivel.test", PASSWORD, u.code())).toMatchObject({ ok: false, reason: "locked" });
    const { rows } = await db.$client.query<{ failed_logins: number; minutes: number }>(
      "select failed_logins, extract(epoch from locked_until - now()) / 60 as minutes from ops.admin_users where id = $1",
      [u.id],
    );
    expect(rows[0]?.failed_logins).toBe(5);
    expect(Number(rows[0]?.minutes)).toBeGreaterThan(14);
    expect(Number(rows[0]?.minutes)).toBeLessThanOrEqual(15);
    // The lock runs out (moved into the past): the owner can sign in again.
    await db.$client.query("update ops.admin_users set locked_until = now() - interval '1 minute' where id = $1", [
      u.id,
    ]);
    expect((await login("owner-3@nivel.test", PASSWORD, u.code())).ok).toBe(true);
    expect(await auditActions(u.id)).toContain("auth.locked");
  });

  it("twenty sign-ins at once count five attempts, not twenty: the attempt is claimed in one statement", async () => {
    const u = await newUser("burst@nivel.test");
    const results = await Promise.all(Array.from({ length: 20 }, () => login("burst@nivel.test", PASSWORD, "000000")));
    expect(results.every((r) => !r.ok)).toBe(true);
    const { rows } = await db.$client.query<{ failed_logins: number }>(
      "select failed_logins from ops.admin_users where id = $1",
      [u.id],
    );
    expect(rows[0]?.failed_logins).toBe(5);
    expect((await auditActions(u.id)).filter((a) => a === "auth.login_failed")).toHaveLength(5);
    expect(await login("burst@nivel.test", PASSWORD, u.code())).toMatchObject({ ok: false, reason: "locked" });
  });

  it("claims again from one once the lock has run out", async () => {
    const u = await newUser("burst-2@nivel.test");
    for (let i = 0; i < 5; i += 1) await login("burst-2@nivel.test", WRONG, "000000");
    await db.$client.query("update ops.admin_users set locked_until = now() - interval '1 minute' where id = $1", [
      u.id,
    ]);
    expect(await login("burst-2@nivel.test", WRONG, "000000")).toEqual({ ok: false, reason: "invalid" });
    const { rows } = await db.$client.query<{ failed_logins: number; locked_until: Date | null }>(
      "select failed_logins, locked_until from ops.admin_users where id = $1",
      [u.id],
    );
    expect(rows[0]).toEqual({ failed_logins: 1, locked_until: null });
  });

  it("a session ends by idleness and by the absolute limit", async () => {
    const u = await newUser("owner-4@nivel.test");
    const idle = await login("owner-4@nivel.test", PASSWORD, u.code());
    if (!idle.ok) throw new Error("expected success");
    const hash = (await import("./service.ts")).sha256(idle.token);
    await db.$client.query(
      "update ops.admin_sessions set expires_at = now() - interval '1 second' where token_sha256 = $1",
      [hash],
    );
    expect(await service.authenticate(idle.token)).toBeNull();

    nextStep();
    const aged = await login("owner-4@nivel.test", PASSWORD, u.code());
    if (!aged.ok) throw new Error("expected success");
    const hash2 = (await import("./service.ts")).sha256(aged.token);
    await db.$client.query(
      "update ops.admin_sessions set created_at = now() - interval '8 days' where token_sha256 = $1",
      [hash2],
    );
    expect(await service.authenticate(aged.token)).toBeNull();
  });

  it("slides the idle expiry forward on use", async () => {
    const u = await newUser("owner-5@nivel.test");
    const r = await login("owner-5@nivel.test", PASSWORD, u.code());
    if (!r.ok) throw new Error("expected success");
    const hash = (await import("./service.ts")).sha256(r.token);
    await db.$client.query(
      "update ops.admin_sessions set expires_at = now() + interval '1 minute' where token_sha256 = $1",
      [hash],
    );
    expect(await service.authenticate(r.token)).not.toBeNull();
    const { rows } = await db.$client.query<{ hours: number }>(
      "select extract(epoch from expires_at - now()) / 3600 as hours from ops.admin_sessions where token_sha256 = $1",
      [hash],
    );
    expect(Number(rows[0]?.hours)).toBeGreaterThan(7.9);
  });

  it("refuses the same e-mail twice in any letter case, and the same Telegram id for two accounts", async () => {
    await newUser("dup@nivel.test");
    await expect(
      store().createAccount({
        id: crypto.randomUUID(),
        email: "DUP@nivel.test",
        passwordHash: "x",
        totpSecretEnc: "y",
        role: "assistant",
        telegramUserId: null,
      }),
    ).rejects.toBeInstanceOf(DuplicateAccountError);

    const a = await newUser("tg-a@nivel.test");
    const b = await newUser("tg-b@nivel.test", "assistant");
    const bind = (u: typeof a, telegram: string, password = PASSWORD) =>
      service.bindTelegram(u.id, { telegram, password, code: u.code() });
    expect(await bind(a, "7000000001", WRONG)).toEqual({ ok: false, reason: "invalid" });
    expect(await bind(a, "7000000001")).toEqual({ ok: true, telegramUserId: 7000000001 });
    expect(await bind(b, "7000000001")).toEqual({ ok: false, reason: "taken" });
    const { rows } = await db.$client.query<{ telegram_user_id: string }>(
      "select telegram_user_id from ops.admin_users where id = $1",
      [a.id],
    );
    expect(rows[0]?.telegram_user_id).toBe("7000000001");
  });

  it("a compare-and-swap of the sealed bundle lets only one of two concurrent writers win", async () => {
    const u = await newUser("cas@nivel.test");
    const current = (await store().findById(u.id))?.totpSecretEnc ?? null;
    const [one, two] = await Promise.all([
      store().replaceTotpBundle(u.id, current, "v1.one"),
      store().replaceTotpBundle(u.id, current, "v1.two"),
    ]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
  });

  it("burns a recovery code even if two sign-ins race with it", async () => {
    const u = await newUser("race@nivel.test");
    const code = u.recoveryCodes[0] ?? "";
    const results = await Promise.all([
      login("race@nivel.test", PASSWORD, code),
      login("race@nivel.test", PASSWORD, code),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("changing the password ends the other sessions; switching an account off ends them all", async () => {
    const u = await newUser("pw@nivel.test");
    const first = await login("pw@nivel.test", PASSWORD, u.code());
    nextStep();
    const second = await login("pw@nivel.test", PASSWORD, u.code());
    if (!first.ok || !second.ok) throw new Error("expected success");
    expect(
      await service.changePassword(u.id, {
        current: PASSWORD,
        next: "another-long-password-1",
        keepToken: second.token,
      }),
    ).toEqual({
      ok: true,
    });
    expect(await service.authenticate(first.token)).toBeNull();
    expect(await service.authenticate(second.token)).not.toBeNull();
    await store().setActive(u.id, false);
    expect(await service.authenticate(second.token)).toBeNull();
  });
});
