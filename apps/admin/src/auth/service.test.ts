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
  /** How many passwords the hasher was asked to check. */
  verifyCount(): number;
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
  const base = createNodeArgon2Hasher({ memoryKiB: 64, passes: 1 });
  let verifies = 0;
  const service = createAuthService({
    store,
    hasher: {
      hash: (password) => base.hash(password),
      verify: (hash, password) => {
        verifies += 1;
        return base.verify(hash, password);
      },
    },
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
    verifyCount: () => verifies,
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

  it("closes the sign-in from the source for 15 minutes on the fifth failure, and says it without a date", async () => {
    for (let i = 1; i <= 4; i += 1) {
      expect(await attempt(h, { password: WRONG })).toEqual({ ok: false, reason: "invalid" });
      expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(i);
    }
    expect(await attempt(h, { code: "111111" })).toEqual({ ok: false, reason: "throttled" });
  });

  it("keeps the source out even with the right password and code, and does not extend the closing", async () => {
    for (let i = 0; i < 5; i += 1) await attempt(h, { password: WRONG });
    h.clock.advance(14 * MS_PER_MINUTE);
    expect(await attempt(h)).toEqual({ ok: false, reason: "throttled" });
    // The refused try did not push the end away: 15 minutes after the fifth failure the source is let in.
    h.clock.advance(MS_PER_MINUTE + 1000);
    expect((await attempt(h)).ok).toBe(true);
  });

  it("lets in again after the 15 minutes and starts the count from zero", async () => {
    for (let i = 0; i < 5; i += 1) await attempt(h, { password: WRONG });
    h.clock.advance(15 * MS_PER_MINUTE + 1);
    // One failure after the closing must not close again at once (the count was 5).
    for (let i = 0; i < 4; i += 1)
      expect(await attempt(h, { password: WRONG })).toEqual({ ok: false, reason: "invalid" });
    expect(await attempt(h, { password: WRONG })).toEqual({ ok: false, reason: "throttled" });
  });

  it("a successful sign-in clears earlier failures", async () => {
    await attempt(h, { password: WRONG });
    await attempt(h, { password: WRONG });
    expect((await attempt(h)).ok).toBe(true);
    expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(0);
  });

  it("checks at most five passwords when many sign-ins arrive at once: the attempt is claimed before it is checked", async () => {
    // Twenty requests read the account before any of them has been counted; the limit must still hold.
    const store = new MemoryAuthStore();
    const inner = createNodeArgon2Hasher({ memoryKiB: 64, passes: 1 });
    let checked = 0;
    const service = createAuthService({
      store,
      hasher: {
        hash: (p) => inner.hash(p),
        verify: async (stored, p) => {
          checked += 1;
          return inner.verify(stored, p);
        },
      },
      dataKey: randomBytes(32),
      now: () => T0,
      issuer: "Nivel admin",
    });
    const made = await service.provisionUser({
      email: "owner@nivel.uz",
      role: "owner",
      password: PASSWORD,
      actor: "cli",
    });
    if (!made.ok) throw new Error("provision failed");
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.login({ email: "owner@nivel.uz", password: PASSWORD, code: "000000", ipHash: null, ua: null }),
      ),
    );
    expect(checked).toBe(AUTH_POLICY.lockAfterFailures);
    expect(results.filter((r) => !r.ok && r.reason === "throttled").length).toBeGreaterThanOrEqual(15);
    expect(store.accounts.get(made.id)?.failedLogins).toBe(AUTH_POLICY.lockAfterFailures);
    expect(store.audit.filter((a) => a.action === "auth.login_failed")).toHaveLength(AUTH_POLICY.lockAfterFailures);
  });

  it("the fifth attempt, if it is right, gets in and clears the claims it made", async () => {
    for (let i = 0; i < 4; i += 1) await attempt(h, { password: WRONG });
    expect((await attempt(h)).ok).toBe(true);
    expect(h.store.accounts.get(h.user.id)).toMatchObject({ failedLogins: 0, lockedUntil: null });
    // The count of the source is clear as well: four more failures do not close it.
    for (let i = 0; i < 4; i += 1)
      expect(await attempt(h, { password: WRONG })).toEqual({ ok: false, reason: "invalid" });
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

  it("journals sign-ins, failures and the closing of the source without any secret in the journal", async () => {
    await attempt(h, { password: WRONG });
    await attempt(h);
    for (let i = 0; i < 5; i += 1) await attempt(h, { password: WRONG });
    const actions = h.store.audit.map((a) => a.action);
    expect(actions).toContain("auth.login_failed");
    expect(actions).toContain("auth.login");
    expect(actions).toContain("auth.login_throttled");
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
    // Every change of the binding asks for the password and a code of a new period, as the other sensitive changes do.
    const bind = (userId: string, telegram: string, over: Partial<{ password: string; code: string }> = {}) => {
      h.clock.advance(31_000);
      return h.service.bindTelegram(userId, {
        telegram,
        password: over.password ?? PASSWORD,
        code: over.code ?? h.codeNow(),
      });
    };
    expect(await bind(h.user.id, " 123456789 ")).toEqual({ ok: true, telegramUserId: 123456789 });
    expect(h.store.accounts.get(h.user.id)?.telegramUserId).toBe(123456789);
    for (const junk of ["abc", "-5", "0", "12.5", "1e3", "9007199254740993", "+123"]) {
      expect(await bind(h.user.id, junk)).toEqual({ ok: false, reason: "format" });
    }
    const other = await h.service.provisionUser({
      email: "helper@nivel.uz",
      role: "assistant",
      password: PASSWORD,
      actor: "cli",
    });
    if (!other.ok) throw new Error("provision failed");
    const otherSecret = base32Decode(other.totpSecret);
    h.clock.advance(31_000);
    expect(
      await h.service.bindTelegram(other.id, {
        telegram: "123456789",
        password: PASSWORD,
        code: generateTotp(otherSecret, h.clock.now),
      }),
    ).toEqual({ ok: false, reason: "taken" });
    expect(await bind(h.user.id, "")).toEqual({ ok: true, telegramUserId: null });
    expect(h.store.accounts.get(h.user.id)?.telegramUserId).toBeNull();
    const journal = h.store.audit.filter((a) => a.action === "auth.telegram_bound");
    expect(journal).toHaveLength(2);
    // The journal keeps what was there and what is there now: a taken-over binding can be seen afterwards.
    expect(journal[1]).toMatchObject({ before: { telegramUserId: 123456789 }, after: { telegramUserId: null } });
  });

  it("does not change the binding without the right password and a fresh code; a wrong try counts toward the lock", async () => {
    const h = await setup();
    const tryBind = (over: Partial<{ password: string; code: string }>) =>
      h.service.bindTelegram(h.user.id, {
        telegram: "123456789",
        password: over.password ?? PASSWORD,
        code: over.code ?? h.codeNow(),
      });
    expect(await tryBind({ password: WRONG })).toEqual({ ok: false, reason: "invalid" });
    expect(await tryBind({ code: "000000" })).toEqual({ ok: false, reason: "invalid" });
    expect(await tryBind({ code: "" })).toEqual({ ok: false, reason: "invalid" });
    expect(h.store.accounts.get(h.user.id)?.telegramUserId).toBeNull();
    expect(h.store.audit.map((a) => a.action)).not.toContain("auth.telegram_bound");
    // A recovery code is not a fresh code of the app: it opens the way in, not this change.
    expect(await tryBind({ code: h.user.recoveryCodes[0] ?? "" })).toEqual({ ok: false, reason: "invalid" });
    // Four failures so far: the fifth locks.
    expect(await tryBind({ code: "000000" })).toEqual({ ok: false, reason: "locked" });
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

describe("people (owner)", () => {
  it("switches an account off, ends its sessions, and switches it on again", async () => {
    const h = await setup();
    const helper = await h.service.provisionUser({
      email: "helper@nivel.uz",
      role: "assistant",
      password: PASSWORD,
      actor: "cli",
    });
    if (!helper.ok) throw new Error("provision failed");
    const secret = base32Decode(helper.totpSecret);
    const session = await h.service.login({
      email: "helper@nivel.uz",
      password: PASSWORD,
      code: generateTotp(secret, h.clock.now),
      ipHash: null,
      ua: null,
    });
    if (!session.ok) throw new Error("expected success");
    const ownerUser = {
      id: h.user.id,
      email: "owner@nivel.uz",
      role: "owner" as const,
      telegramUserId: null,
      sessionExpiresAt: h.clock.now,
    };

    expect(await h.service.setActive(helper.id, false, ownerUser)).toEqual({ ok: true });
    expect(await h.service.authenticate(session.token)).toBeNull();
    expect(h.store.accounts.get(helper.id)?.active).toBe(false);
    expect(await h.service.setActive(helper.id, true, ownerUser)).toEqual({ ok: true });
    expect(h.store.accounts.get(helper.id)?.active).toBe(true);
    expect(h.store.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["auth.user_disabled", "auth.user_enabled"]),
    );
    expect(await h.service.listAccounts()).toHaveLength(2);
  });

  it("does not let the owner switch himself off, nor the last owner be switched off, nor an unknown id", async () => {
    const h = await setup();
    const ownerUser = {
      id: h.user.id,
      email: "owner@nivel.uz",
      role: "owner" as const,
      telegramUserId: null,
      sessionExpiresAt: h.clock.now,
    };
    expect(await h.service.setActive(h.user.id, false, ownerUser)).toEqual({ ok: false, reason: "self" });
    const second = await h.service.provisionUser({
      email: "second@nivel.uz",
      role: "owner",
      password: PASSWORD,
      actor: "cli",
    });
    if (!second.ok) throw new Error("provision failed");
    // The second owner may switch off the first (there is another owner left: himself) but not the other way round after.
    const secondUser = { ...ownerUser, id: second.id, email: "second@nivel.uz" };
    expect(await h.service.setActive(h.user.id, false, secondUser)).toEqual({ ok: true });
    expect(await h.service.setActive(second.id, false, { ...ownerUser, id: "someone-else" })).toEqual({
      ok: false,
      reason: "last_owner",
    });
    expect(await h.service.setActive("no-such-id", false, ownerUser)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("the lock covers the checks inside a live session (bind Telegram, recovery codes, password)", () => {
  const bindWith = (h: Harness, over: Partial<{ password: string; code: string }> = {}) =>
    h.service.bindTelegram(h.user.id, {
      telegram: "123456789",
      password: over.password ?? PASSWORD,
      code: over.code ?? h.codeNow(),
      ipHash: "iphash",
    });

  async function lockedByBinding(h: Harness) {
    for (let i = 0; i < AUTH_POLICY.lockAfterFailures; i += 1) {
      expect(await bindWith(h, { code: "000000" })).toEqual({
        ok: false,
        reason: expect.stringMatching(/invalid|locked/),
      });
    }
  }

  it("refuses the sixth try without checking anything, even with the right password and code", async () => {
    const h = await setup();
    await lockedByBinding(h);
    const before = h.verifyCount();
    h.clock.advance(31_000);
    expect(await bindWith(h)).toEqual({ ok: false, reason: "locked" });
    expect(await h.service.regenerateRecoveryCodes(h.user.id, { password: PASSWORD, code: h.codeNow() })).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(h.verifyCount()).toBe(before);
    expect(h.store.accounts.get(h.user.id)?.telegramUserId).toBeNull();
  });

  it("lets 20 simultaneous tries check no more than five passwords", async () => {
    const h = await setup();
    const results = await Promise.all(Array.from({ length: 20 }, () => bindWith(h, { code: "000000" })));
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(h.verifyCount()).toBeLessThanOrEqual(AUTH_POLICY.lockAfterFailures);
  });

  it("ends the sessions of the account when the lock falls, so that a stolen one does not outlive it", async () => {
    const h = await setup();
    const session = await attempt(h);
    if (!session.ok) throw new Error("expected success");
    await lockedByBinding(h);
    expect(await h.service.authenticate(session.token)).toBeNull();
  });

  it("journals every failure and the lock, with the address hash and without secrets", async () => {
    const h = await setup();
    await lockedByBinding(h);
    const failed = h.store.audit.filter((a) => a.action === "auth.reverify_failed");
    expect(failed).toHaveLength(AUTH_POLICY.lockAfterFailures);
    expect(failed[0]).toMatchObject({ actor: `admin:${h.user.id}`, ipHash: "iphash", after: { reason: "wrong_code" } });
    expect(h.store.audit.map((a) => a.action)).toContain("auth.locked");
    expect(JSON.stringify(h.store.audit)).not.toContain(PASSWORD);
  });

  it("starts the series again from one after the lock has run out", async () => {
    const h = await setup();
    await lockedByBinding(h);
    h.clock.advance(AUTH_POLICY.lockMinutes * MS_PER_MINUTE + 1000);
    for (let i = 0; i < 4; i += 1)
      expect(await bindWith(h, { code: "000000" })).toEqual({ ok: false, reason: "invalid" });
    expect(await bindWith(h, { code: "000000" })).toEqual({ ok: false, reason: "locked" });
  });

  it("clears the count after a right answer, and records the address in the journal of the change", async () => {
    const h = await setup();
    await bindWith(h, { code: "000000" });
    await bindWith(h, { password: WRONG });
    h.clock.advance(31_000);
    expect(await bindWith(h)).toEqual({ ok: true, telegramUserId: 123456789 });
    // The count started again: four failures more are not yet the lock.
    for (let i = 0; i < 4; i += 1)
      expect(await bindWith(h, { code: "000000" })).toEqual({ ok: false, reason: "invalid" });
    expect(h.store.audit.find((a) => a.action === "auth.telegram_bound")?.ipHash).toBe("iphash");
  });

  it("locks the change of the password too: no unlimited guessing of the current one", async () => {
    const h = await setup();
    const change = (current: string, ipHash = "iphash") =>
      h.service.changePassword(h.user.id, { current, next: "a-brand-new-long-password", ipHash });
    for (let i = 0; i < AUTH_POLICY.lockAfterFailures; i += 1) await change(WRONG);
    const before = h.verifyCount();
    expect(await change(PASSWORD)).toEqual({ ok: false, reason: "locked" });
    expect(h.verifyCount()).toBe(before);
    expect(h.store.audit.filter((a) => a.action === "auth.reverify_failed")).toHaveLength(
      AUTH_POLICY.lockAfterFailures,
    );
  });

  it("lets 20 simultaneous password changes check no more than five current passwords", async () => {
    const h = await setup();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        h.service.changePassword(h.user.id, { current: WRONG, next: "a-brand-new-long-password" }),
      ),
    );
    expect(h.verifyCount()).toBeLessThanOrEqual(AUTH_POLICY.lockAfterFailures);
  });

  it("does not count a refused new password as a failure of the current one", async () => {
    const h = await setup();
    for (let i = 0; i < 8; i += 1) {
      expect(await h.service.changePassword(h.user.id, { current: PASSWORD, next: "short" })).toMatchObject({
        ok: false,
        reason: "policy",
      });
    }
  });
});
