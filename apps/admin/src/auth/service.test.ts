import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createNodeArgon2Hasher } from "./password.ts";
import { AUTH_POLICY, MS_PER_HOUR, MS_PER_MINUTE } from "./policy.ts";
import { type AuthService, createAuthService } from "./service.ts";
import { MemoryAuthStore } from "./store.memory.ts";
import { base32Decode, generateTotp } from "./totp.ts";

const PASSWORD = "correct-horse-battery-staple";
const WRONG = "wrong-password-number-1";
const T0 = new Date("2026-10-06T08:00:00.000Z");

interface Harness {
  store: MemoryAuthStore;
  service: AuthService;
  clock: { now: Date; advance(ms: number): void };
  user: { id: string; secret: Uint8Array; recoveryCodes: string[] };
  codeNow(): string;
}

async function setup(role: "owner" | "assistant" = "owner"): Promise<Harness> {
  const store = new MemoryAuthStore();
  const clock = {
    now: new Date(T0),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
  };
  store.now = () => clock.now;
  const service = createAuthService({
    store,
    hasher: createNodeArgon2Hasher({ memoryKiB: 64, passes: 1 }),
    dataKey: randomBytes(32),
    now: () => clock.now,
    issuer: "Nivel admin",
  });
  const created = await service.provisionUser({
    email: "Owner@Nivel.uz",
    role,
    password: PASSWORD,
    actor: "cli",
  });
  if (!created.ok) throw new Error(`provision failed: ${created.problems.join(" ")}`);
  const secret = base32Decode(created.totpSecret);
  return {
    store,
    service,
    clock,
    user: { id: created.id, secret, recoveryCodes: created.recoveryCodes },
    codeNow: () => generateTotp(secret, clock.now),
  };
}

const attempt = (h: Harness, over: Partial<{ email: string; password: string; code: string }> = {}) =>
  h.service.login({
    email: over.email ?? "owner@nivel.uz",
    password: over.password ?? PASSWORD,
    code: over.code ?? h.codeNow(),
    ipHash: "iphash",
    ua: "vitest",
  });

describe("sign-in", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });

  it("lets in with e-mail, password and the current code, in any letter case of the e-mail", async () => {
    const r = await attempt(h, { email: "  OWNER@nivel.UZ " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user).toMatchObject({ email: "owner@nivel.uz", role: "owner", id: h.user.id });
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.usedRecoveryCode).toBe(false);
  });

  it("stores only the hash of the session token, never the token", async () => {
    const r = await attempt(h);
    if (!r.ok) throw new Error("expected success");
    expect(h.store.sessions.has(r.token)).toBe(false);
    expect([...h.store.sessions.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers the same for an unknown e-mail, a wrong password and a wrong code", async () => {
    const results = [
      await attempt(h, { email: "nobody@nivel.uz" }),
      await attempt(h, { password: `${PASSWORD}!` }),
      await attempt(h, { code: "000000" }),
    ];
    for (const r of results) expect(r).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses empty and oversized input without counting a failure", async () => {
    expect(await attempt(h, { email: "" })).toEqual({ ok: false, reason: "invalid" });
    expect(await attempt(h, { password: "" })).toEqual({ ok: false, reason: "invalid" });
    expect(await attempt(h, { password: "x".repeat(AUTH_POLICY.maxPasswordLength + 1) })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(0);
  });

  it("locks the account for 15 minutes on the fifth failure and tells until when", async () => {
    for (let i = 1; i <= 4; i += 1) {
      expect(await attempt(h, { password: WRONG })).toEqual({ ok: false, reason: "invalid" });
      expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(i);
    }
    const fifth = await attempt(h, { code: "111111" });
    expect(fifth.ok).toBe(false);
    if (fifth.ok) return;
    if (fifth.reason !== "locked") throw new Error("expected the lock");
    expect(fifth.lockedUntil).toEqual(new Date(T0.getTime() + 15 * MS_PER_MINUTE));
  });

  it("keeps a locked account out even with the right password and code, and does not extend the lock", async () => {
    for (let i = 0; i < 5; i += 1) await attempt(h, { password: WRONG });
    h.clock.advance(14 * MS_PER_MINUTE);
    const during = await attempt(h);
    expect(during).toMatchObject({ ok: false, reason: "locked" });
    expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(5);
    expect(h.store.accounts.get(h.user.id)?.lockedUntil).toEqual(new Date(T0.getTime() + 15 * MS_PER_MINUTE));
  });

  it("lets in again after the 15 minutes and starts the count from zero", async () => {
    for (let i = 0; i < 5; i += 1) await attempt(h, { password: WRONG });
    h.clock.advance(15 * MS_PER_MINUTE + 1);
    // One failure after the lock must not lock again at once (the stored count was 5).
    expect(await attempt(h, { password: WRONG })).toEqual({ ok: false, reason: "invalid" });
    expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(1);
    const ok = await attempt(h);
    expect(ok.ok).toBe(true);
    expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(0);
  });

  it("a successful sign-in clears earlier failures", async () => {
    await attempt(h, { password: WRONG });
    await attempt(h, { password: WRONG });
    expect((await attempt(h)).ok).toBe(true);
    expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(0);
  });

  it("does not let a switched-off account in", async () => {
    await h.store.setActive(h.user.id, false);
    expect(await attempt(h)).toEqual({ ok: false, reason: "invalid" });
  });

  it("does not let in an account without a readable second factor", async () => {
    const account = h.store.accounts.get(h.user.id);
    if (!account) throw new Error("no account");
    account.totpSecretEnc = "v1.AAAA.BBBB.CCCC";
    expect(await attempt(h)).toEqual({ ok: false, reason: "invalid" });
    account.totpSecretEnc = null;
    expect(await attempt(h)).toEqual({ ok: false, reason: "invalid" });
  });

  it("does not accept the same TOTP code twice, but accepts the next period", async () => {
    const code = h.codeNow();
    expect((await attempt(h, { code: code ?? "" })).ok).toBe(true);
    expect(await attempt(h, { code: code ?? "" })).toEqual({ ok: false, reason: "invalid" });
    h.clock.advance(30_000);
    expect((await attempt(h, { code: h.codeNow() })).ok).toBe(true);
  });

  it("journals sign-ins, failures and the lock without any secret in the journal", async () => {
    await attempt(h, { password: WRONG });
    await attempt(h);
    for (let i = 0; i < 5; i += 1) await attempt(h, { password: WRONG });
    const actions = h.store.audit.map((a) => a.action);
    expect(actions).toContain("auth.login_failed");
    expect(actions).toContain("auth.login");
    expect(actions).toContain("auth.locked");
    const dump = JSON.stringify(h.store.audit);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(WRONG);
    expect(h.store.audit.find((a) => a.action === "auth.login")?.actor).toBe(`admin:${h.user.id}`);
  });
});

describe("recovery codes", () => {
  it("lets in once with a recovery code instead of the TOTP code, then burns it", async () => {
    const h = await setup();
    const [code] = h.user.recoveryCodes;
    expect(h.user.recoveryCodes).toHaveLength(10);
    const first = await attempt(h, { code: (code ?? "").toUpperCase() });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.usedRecoveryCode).toBe(true);
      expect(first.recoveryLeft).toBe(9);
    }
    expect(await attempt(h, { code: code ?? "" })).toEqual({ ok: false, reason: "invalid" });
    expect(h.store.audit.map((a) => a.action)).toContain("auth.recovery_used");
  });

  it("a wrong recovery code counts as a failure", async () => {
    const h = await setup();
    await attempt(h, { code: "zzzzz-zzzzz" });
    expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(1);
  });

  it("regenerates the codes after a check of the password and a code, and the old ones stop working", async () => {
    const h = await setup();
    const fresh = await h.service.regenerateRecoveryCodes(h.user.id, { password: PASSWORD, code: h.codeNow() });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.recoveryCodes).toHaveLength(10);
    h.clock.advance(60_000);
    expect(await attempt(h, { code: h.user.recoveryCodes[0] ?? "" })).toEqual({ ok: false, reason: "invalid" });
    h.clock.advance(60_000);
    expect((await attempt(h, { code: fresh.recoveryCodes[0] ?? "" })).ok).toBe(true);
  });

  it("does not regenerate without the right password or the right code", async () => {
    const h = await setup();
    const wrongPassword = await h.service.regenerateRecoveryCodes(h.user.id, {
      password: "nope-nope-nope-nope",
      code: h.codeNow(),
    });
    expect(wrongPassword).toEqual({ ok: false, reason: "invalid" });
    const wrongCode = await h.service.regenerateRecoveryCodes(h.user.id, { password: PASSWORD, code: "123456" });
    expect(wrongCode).toEqual({ ok: false, reason: "invalid" });
    expect(await h.service.regenerateRecoveryCodes("no-such-user", { password: PASSWORD, code: "123456" })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("sessions", () => {
  it("recognizes the token and slides the idle expiry by 8 hours", async () => {
    const h = await setup();
    const r = await attempt(h);
    if (!r.ok) throw new Error("expected success");
    h.clock.advance(7 * MS_PER_HOUR);
    const seen = await h.service.authenticate(r.token);
    expect(seen).toMatchObject({ id: h.user.id, role: "owner" });
    h.clock.advance(7 * MS_PER_HOUR);
    expect(await h.service.authenticate(r.token)).not.toBeNull();
  });

  it("ends after 8 hours without a request", async () => {
    const h = await setup();
    const r = await attempt(h);
    if (!r.ok) throw new Error("expected success");
    h.clock.advance(8 * MS_PER_HOUR + 1);
    expect(await h.service.authenticate(r.token)).toBeNull();
  });

  it("ends after 7 days even when it is used all the time", async () => {
    const h = await setup();
    const r = await attempt(h);
    if (!r.ok) throw new Error("expected success");
    for (let i = 1; i <= 27; i += 1) {
      h.clock.advance(6 * MS_PER_HOUR); // never idle for 8 hours
      expect(await h.service.authenticate(r.token)).not.toBeNull();
    }
    h.clock.advance(6 * MS_PER_HOUR); // 168 hours since the sign-in
    expect(await h.service.authenticate(r.token)).toBeNull();
  });

  it("knows nothing about a made-up or empty token", async () => {
    const h = await setup();
    expect(await h.service.authenticate("")).toBeNull();
    expect(await h.service.authenticate("x".repeat(43))).toBeNull();
    expect(await h.service.authenticate(undefined)).toBeNull();
  });

  it("logout destroys the session", async () => {
    const h = await setup();
    const r = await attempt(h);
    if (!r.ok) throw new Error("expected success");
    await h.service.logout(r.token, h.user.id);
    expect(await h.service.authenticate(r.token)).toBeNull();
    expect(h.store.audit.map((a) => a.action)).toContain("auth.logout");
  });

  it("switching an account off ends its sessions at the next request", async () => {
    const h = await setup();
    const r = await attempt(h);
    if (!r.ok) throw new Error("expected success");
    await h.store.setActive(h.user.id, false);
    expect(await h.service.authenticate(r.token)).toBeNull();
  });
});

describe("account", () => {
  it("changes the password after checking the old one, and ends the other sessions", async () => {
    const h = await setup();
    const a = await attempt(h);
    h.clock.advance(31_000);
    const b = await attempt(h);
    if (!a.ok || !b.ok) throw new Error("expected success");
    const changed = await h.service.changePassword(h.user.id, {
      current: PASSWORD,
      next: "a-brand-new-long-password",
      keepToken: b.token,
    });
    expect(changed).toEqual({ ok: true });
    expect(await h.service.authenticate(a.token)).toBeNull();
    expect(await h.service.authenticate(b.token)).not.toBeNull();
    h.clock.advance(31_000);
    expect(await attempt(h, { password: PASSWORD })).toEqual({ ok: false, reason: "invalid" });
    h.clock.advance(31_000);
    expect((await attempt(h, { password: "a-brand-new-long-password" })).ok).toBe(true);
  });

  it("refuses a weak new password and a wrong old one", async () => {
    const h = await setup();
    const weak = await h.service.changePassword(h.user.id, { current: PASSWORD, next: "short" });
    expect(weak).toEqual({ ok: false, reason: "policy", problems: ["Пароль короче 14 знаков."] });
    const wrong = await h.service.changePassword(h.user.id, {
      current: "not-the-old-password",
      next: "a-brand-new-long-password",
    });
    expect(wrong).toEqual({ ok: false, reason: "invalid" });
  });

  it("binds a Telegram id, rejects junk and an id of another account, and unbinds with an empty value", async () => {
    const h = await setup();
    expect(await h.service.bindTelegram(h.user.id, " 123456789 ")).toEqual({ ok: true, telegramUserId: 123456789 });
    expect(h.store.accounts.get(h.user.id)?.telegramUserId).toBe(123456789);
    for (const junk of ["abc", "-5", "0", "12.5", "1e3", "9007199254740993", "+123"]) {
      expect(await h.service.bindTelegram(h.user.id, junk)).toEqual({ ok: false, reason: "format" });
    }
    const other = await h.service.provisionUser({
      email: "helper@nivel.uz",
      role: "assistant",
      password: PASSWORD,
      actor: "cli",
    });
    if (!other.ok) throw new Error("provision failed");
    expect(await h.service.bindTelegram(other.id, "123456789")).toEqual({ ok: false, reason: "taken" });
    expect(await h.service.bindTelegram(h.user.id, "")).toEqual({ ok: true, telegramUserId: null });
    expect(h.store.accounts.get(h.user.id)?.telegramUserId).toBeNull();
    expect(h.store.audit.filter((a) => a.action === "auth.telegram_bound")).toHaveLength(2);
  });
});

describe("provisioning", () => {
  it("creates an account with a second factor and ten recovery codes, journaled", async () => {
    const h = await setup();
    const r = await h.service.provisionUser({ email: "tr@nivel.uz", role: "translator", actor: "admin:x" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.password).toBeTruthy(); // generated when none is given
    expect(r.totpUri).toMatch(/^otpauth:\/\/totp\/Nivel%20admin:tr%40nivel\.uz\?secret=[A-Z2-7]+&/);
    expect(r.recoveryCodes).toHaveLength(10);
    const account = h.store.accounts.get(r.id);
    expect(account?.totpSecretEnc).toMatch(/^v1\./);
    expect(account?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(account)).not.toContain(r.totpSecret);
    expect(h.store.audit.at(-1)).toMatchObject({ action: "auth.user_created", actor: "admin:x", entityId: r.id });
  });

  it("refuses a weak password, a bad e-mail and a repeated e-mail", async () => {
    const h = await setup();
    const weak = await h.service.provisionUser({
      email: "a@nivel.uz",
      role: "assistant",
      password: "short",
      actor: "cli",
    });
    expect(weak).toMatchObject({ ok: false });
    const bad = await h.service.provisionUser({ email: "not-an-email", role: "assistant", actor: "cli" });
    expect(bad).toMatchObject({ ok: false, problems: ["Некорректный e-mail."] });
    const dup = await h.service.provisionUser({ email: "OWNER@nivel.uz", role: "assistant", actor: "cli" });
    expect(dup).toMatchObject({ ok: false, problems: ["Учётная запись с таким e-mail уже есть."] });
  });
});
