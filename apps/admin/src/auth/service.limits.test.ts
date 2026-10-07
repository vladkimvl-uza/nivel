// The limits of failed attempts (adversarial review of WP-10): what one kind of attempt can and cannot do to the counters
// of another. The sign-in counts per source and over all sources; the sensitive changes inside a session count apart.
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createNodeArgon2Hasher } from "./password.ts";
import { AUTH_POLICY, MS_PER_MINUTE } from "./policy.ts";
import { type AuthService, createAuthService } from "./service.ts";
import { MemoryAuthStore } from "./store.memory.ts";
import { base32Decode, generateTotp } from "./totp.ts";

const PASSWORD = "correct-horse-battery-staple";
const WRONG = "wrong-password-number-1";
const NEW_PASSWORD = "a-brand-new-long-password";
const T0 = new Date("2026-10-06T08:00:00.000Z");

interface Harness {
  store: MemoryAuthStore;
  service: AuthService;
  clock: { now: Date; advance(ms: number): void };
  user: { id: string; secret: Uint8Array };
  /** The next check of a password waits for this promise (then the gate is empty again). */
  gate: { wait: Promise<void> | null };
  codeNow(): string;
  verifyCount(): number;
}

async function setup(): Promise<Harness> {
  const store = new MemoryAuthStore();
  const clock = {
    now: new Date(T0),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
  };
  store.now = () => clock.now;
  const base = createNodeArgon2Hasher({ memoryKiB: 64, passes: 1 });
  const gate: { wait: Promise<void> | null } = { wait: null };
  let verifies = 0;
  const service = createAuthService({
    store,
    hasher: {
      hash: (password) => base.hash(password),
      verify: async (hash, password) => {
        verifies += 1;
        const held = gate.wait;
        gate.wait = null;
        if (held) await held;
        return base.verify(hash, password);
      },
    },
    dataKey: randomBytes(32),
    now: () => clock.now,
    issuer: "Nivel admin",
  });
  const created = await service.provisionUser({
    email: "owner@nivel.uz",
    role: "owner",
    password: PASSWORD,
    actor: "cli",
  });
  if (!created.ok) throw new Error(`provision failed: ${created.problems.join(" ")}`);
  const secret = base32Decode(created.totpSecret);
  return {
    store,
    service,
    clock,
    gate,
    user: { id: created.id, secret },
    codeNow: () => generateTotp(secret, clock.now),
    verifyCount: () => verifies,
  };
}

const signIn = (
  h: Harness,
  over: Partial<{ email: string; password: string; code: string; ipHash: string | null }> = {},
) =>
  h.service.login({
    email: over.email ?? "owner@nivel.uz",
    password: over.password ?? PASSWORD,
    code: over.code ?? h.codeNow(),
    ipHash: over.ipHash === undefined ? "source-1" : over.ipHash,
    ua: "vitest",
  });

const bind = (h: Harness, over: Partial<{ password: string; code: string }> = {}) =>
  h.service.bindTelegram(h.user.id, {
    telegram: "123456789",
    password: over.password ?? PASSWORD,
    code: over.code ?? h.codeNow(),
    ipHash: "session-source",
  });

const THROTTLED = { ok: false, reason: "throttled" } as const;
const INVALID = { ok: false, reason: "invalid" } as const;
const LOCKED = { ok: false, reason: "locked" } as const;

describe("a right password alone never clears the count of failed codes", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });

  it("keeps the lock when 4 wrong codes are followed by a change of password with the right current one, round after round", async () => {
    const before = h.verifyCount();
    for (let round = 0; round < 50; round += 1) {
      for (let i = 0; i < 4; i += 1) await bind(h, { code: "000000" });
      await h.service.changePassword(h.user.id, { current: PASSWORD, next: "short" });
    }
    // Five checks in all (the lock came at the fifth attempt of the first round), not two hundred.
    expect(h.verifyCount() - before).toBeLessThanOrEqual(AUTH_POLICY.lockAfterFailures);
    expect(await bind(h)).toEqual(LOCKED);
  });

  it("refuses the change that itself was the fifth attempt, with the right password", async () => {
    for (let i = 0; i < 4; i += 1) await bind(h, { code: "000000" });
    const result = await h.service.changePassword(h.user.id, { current: PASSWORD, next: NEW_PASSWORD });
    expect(result).toEqual(LOCKED);
    // The password was not changed.
    expect(h.store.accounts.get(h.user.id)?.passwordHash).not.toContain("changed");
    expect((await signIn(h, { ipHash: "other" })).ok).toBe(true);
    expect(await h.service.changePassword(h.user.id, { current: PASSWORD, next: NEW_PASSWORD })).toEqual(LOCKED);
  });

  it("does not let a slow change of password lift the lock that other attempts made while it was checking", async () => {
    let release: () => void = () => {};
    h.gate.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = h.service.changePassword(h.user.id, { current: PASSWORD, next: "short" });
    for (let i = 0; i < 4; i += 1) expect((await bind(h, { code: "000000" })).ok).toBe(false);
    release();
    expect(await slow).toEqual(LOCKED);
    expect(await bind(h)).toEqual(LOCKED);
  });

  it("gives back the attempt of a change that went through, so that the owner is not locked by his own changes", async () => {
    let password = PASSWORD;
    for (let i = 0; i < 8; i += 1) {
      const next = `${NEW_PASSWORD}-${i}`;
      expect(await h.service.changePassword(h.user.id, { current: password, next })).toEqual({ ok: true });
      password = next;
    }
    // And the failures made so far still count: four wrong codes and the next one is the fifth.
    for (let i = 0; i < 4; i += 1) await bind(h, { code: "000000", password });
    expect(await bind(h, { code: "000000", password })).toEqual(LOCKED);
  });

  it("a right password with a right code clears the count (the second factor was proven)", async () => {
    for (let i = 0; i < 3; i += 1) await bind(h, { code: "000000" });
    h.clock.advance(31_000);
    expect(await bind(h)).toEqual({ ok: true, telegramUserId: 123456789 });
    for (let i = 0; i < 4; i += 1) expect(await bind(h, { code: "000000" })).toEqual(INVALID);
  });

  it("starts a new series after the window: failures of long ago do not stand next to today's", async () => {
    for (let i = 0; i < 4; i += 1) await bind(h, { code: "000000" });
    h.clock.advance(AUTH_POLICY.lockMinutes * MS_PER_MINUTE + 1);
    expect(await bind(h, { code: "000000" })).toEqual(INVALID);
  });
});

describe("the lock ends the sessions, whichever way it came", () => {
  it("failed sign-ins from many sources lock the account, end its sessions and refuse a session that is left", async () => {
    const h = await setup();
    const session = await signIn(h);
    if (!session.ok) throw new Error("expected success");
    for (let i = 0; i < AUTH_POLICY.accountCeilingFailures; i += 1) {
      await signIn(h, { password: WRONG, ipHash: `source-${i}` });
    }
    expect(h.store.accounts.get(h.user.id)?.lockedUntil).not.toBeNull();
    expect(await h.service.authenticate(session.token)).toBeNull();
    expect(h.store.audit.map((a) => a.action)).toContain("auth.locked");
  });

  it("a session is refused while the account is locked, even if the row of the session is still there", async () => {
    const h = await setup();
    const session = await signIn(h);
    if (!session.ok) throw new Error("expected success");
    const account = h.store.accounts.get(h.user.id);
    if (!account) throw new Error("no account");
    account.lockedUntil = new Date(h.clock.now.getTime() + MS_PER_MINUTE);
    expect(await h.service.authenticate(session.token)).toBeNull();
    h.clock.advance(2 * MS_PER_MINUTE);
    expect(await h.service.authenticate(session.token)).not.toBeNull();
  });

  it("failed changes inside a session end the sessions at the lock", async () => {
    const h = await setup();
    const session = await signIn(h);
    if (!session.ok) throw new Error("expected success");
    for (let i = 0; i < AUTH_POLICY.lockAfterFailures; i += 1) await bind(h, { code: "000000" });
    expect(await h.service.authenticate(session.token)).toBeNull();
  });

  it("journals the attempts that are refused during a lock, but not without end", async () => {
    const h = await setup();
    for (let i = 0; i < AUTH_POLICY.lockAfterFailures; i += 1) await bind(h, { code: "000000" });
    for (let i = 0; i < 30; i += 1) await bind(h);
    const refused = h.store.audit.filter((a) => a.action === "auth.reverify_blocked");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ actor: `admin:${h.user.id}`, ipHash: "session-source" });
    h.clock.advance(2 * MS_PER_MINUTE);
    await bind(h);
    expect(h.store.audit.filter((a) => a.action === "auth.reverify_blocked")).toHaveLength(2);
  });
});

describe("a stranger cannot keep the owner out, and learns nothing about the e-mail", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });

  it("five failures from one source close the sign-in for that source only", async () => {
    for (let i = 0; i < 4; i += 1) expect(await signIn(h, { password: WRONG, ipHash: "stranger" })).toEqual(INVALID);
    expect(await signIn(h, { password: WRONG, ipHash: "stranger" })).toEqual(THROTTLED);
    // Even the right credentials from that source wait, and the owner from his own address gets in.
    expect(await signIn(h, { ipHash: "stranger" })).toEqual(THROTTLED);
    expect((await signIn(h, { ipHash: "owner-home" })).ok).toBe(true);
    expect(h.store.accounts.get(h.user.id)?.lockedUntil).toBeNull();
  });

  it("a source that is closed does not cost a check of a password", async () => {
    for (let i = 0; i < 5; i += 1) await signIn(h, { password: WRONG, ipHash: "stranger" });
    const before = h.verifyCount();
    for (let i = 0; i < 20; i += 1) await signIn(h, { ipHash: "stranger" });
    expect(h.verifyCount()).toBe(before);
  });

  it("opens again after 15 minutes and starts the count from zero", async () => {
    for (let i = 0; i < 5; i += 1) await signIn(h, { password: WRONG, ipHash: "stranger" });
    h.clock.advance(AUTH_POLICY.lockMinutes * MS_PER_MINUTE + 1);
    expect(await signIn(h, { password: WRONG, ipHash: "stranger" })).toEqual(INVALID);
    expect((await signIn(h, { ipHash: "stranger" })).ok).toBe(true);
  });

  it("answers an unknown e-mail, a switched-off account and an existing one in the same way, at every step", async () => {
    await h.service.provisionUser({ email: "off@nivel.uz", role: "assistant", password: PASSWORD, actor: "cli" });
    const off = [...h.store.accounts.values()].find((a) => a.email === "off@nivel.uz");
    if (!off) throw new Error("no account");
    await h.store.setActive(off.id, false);
    const trace = async (email: string) => {
      const answers: unknown[] = [];
      for (let i = 0; i < 6; i += 1) answers.push(await signIn(h, { email, password: WRONG, ipHash: "stranger" }));
      return answers;
    };
    const known = await trace("owner@nivel.uz");
    expect(await trace("nobody@nivel.uz")).toEqual(known);
    expect(await trace("off@nivel.uz")).toEqual(known);
    expect(known).toEqual([INVALID, INVALID, INVALID, INVALID, THROTTLED, THROTTLED]);
  });

  it("over all sources the account is locked after the ceiling; an unknown e-mail meets the same wall, without a date", async () => {
    const answers = async (email: string) => {
      const out: unknown[] = [];
      for (let i = 0; i < AUTH_POLICY.accountCeilingFailures + 2; i += 1) {
        out.push(await signIn(h, { email, password: WRONG, ipHash: `s-${i}` }));
      }
      return out;
    };
    const known = await answers("owner@nivel.uz");
    expect(await answers("nobody@nivel.uz")).toEqual(known);
    expect(
      known
        .slice(0, AUTH_POLICY.accountCeilingFailures - 1)
        .every((a) => JSON.stringify(a) === JSON.stringify(INVALID)),
    ).toBe(true);
    expect(known.slice(AUTH_POLICY.accountCeilingFailures - 1)).toEqual([THROTTLED, THROTTLED, THROTTLED]);
    // The right credentials are refused while the lock lasts, in the same words, and it runs out.
    expect(await signIn(h, { ipHash: "owner-home" })).toEqual(THROTTLED);
    h.clock.advance(AUTH_POLICY.lockMinutes * MS_PER_MINUTE + 1);
    expect((await signIn(h, { ipHash: "owner-home" })).ok).toBe(true);
  });

  it("journals the sign-ins that are refused, without letting a flood fill the journal", async () => {
    for (let i = 0; i < 5; i += 1) await signIn(h, { password: WRONG, ipHash: "stranger" });
    for (let i = 0; i < 50; i += 1) await signIn(h, { ipHash: "stranger" });
    const actions = h.store.audit.map((a) => a.action);
    expect(actions).toContain("auth.login_throttled");
    expect(actions.filter((a) => a === "auth.login_blocked")).toHaveLength(1);
    // The refused attempts carry a hash of the e-mail, never the e-mail.
    expect(JSON.stringify(h.store.audit.filter((a) => a.action !== "auth.user_created"))).not.toContain(
      "owner@nivel.uz",
    );
  });

  it("the failures of strangers do not stand next to the owner's typos inside a session (separate counters)", async () => {
    const session = await signIn(h, { ipHash: "owner-home" });
    if (!session.ok) throw new Error("expected success");
    for (let i = 0; i < 4; i += 1) await signIn(h, { password: WRONG, ipHash: "stranger" });
    expect(await bind(h, { code: "000000" })).toEqual(INVALID);
    expect(await h.service.authenticate(session.token)).not.toBeNull();
    for (let i = 0; i < 3; i += 1) expect(await bind(h, { code: "000000" })).toEqual(INVALID);
    expect(await bind(h, { code: "000000" })).toEqual(LOCKED);
  });

  it("failed changes inside a session do not close the sign-in", async () => {
    for (let i = 0; i < 5; i += 1) await bind(h, { code: "000000" });
    expect((await signIn(h, { ipHash: "owner-home" })).ok).toBe(true);
  });

  it("twenty sign-ins at once from one source check no more than five passwords", async () => {
    const before = h.verifyCount();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => signIn(h, { code: "000000", ipHash: "stranger" })),
    );
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(h.verifyCount() - before).toBe(AUTH_POLICY.lockAfterFailures);
  });

  it("can be unlocked from the command line, journaled", async () => {
    for (let i = 0; i < AUTH_POLICY.accountCeilingFailures; i += 1) {
      await signIn(h, { password: WRONG, ipHash: `s-${i}` });
    }
    expect(await signIn(h, { ipHash: "owner-home" })).toEqual(THROTTLED);
    expect(await h.service.unlock("OWNER@nivel.uz", "cli")).toEqual({ ok: true });
    expect((await signIn(h, { ipHash: "owner-home" })).ok).toBe(true);
    expect(h.store.audit.find((a) => a.action === "auth.unlocked")).toMatchObject({
      actor: "cli",
      entityId: h.user.id,
    });
    expect(await h.service.unlock("nobody@nivel.uz", "cli")).toEqual({ ok: false, reason: "not_found" });
  });
});

// Second adversarial round: what one address can do with requests that name e-mails it does not own.
describe("one address cannot flood the journal, evict its own counters or wear down the account", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });

  const rows = (action: string) => h.store.audit.filter((a) => a.action === action).length;
  const unknownRows = () =>
    h.store.audit.filter((a) => (a.after as { reason?: string } | undefined)?.reason === "unknown_email").length;

  it("limits the requests of one address over all e-mails: few checks of a password, few rows in the journal", async () => {
    const before = h.verifyCount();
    const auditBefore = h.store.audit.length;
    const answers = new Set<string>();
    for (let i = 0; i < 3000; i += 1) {
      answers.add(JSON.stringify(await signIn(h, { email: `nobody-${i}@nivel.uz`, password: WRONG, ipHash: "flood" })));
    }
    expect(answers).toEqual(new Set([JSON.stringify(INVALID), JSON.stringify(THROTTLED)]));
    expect(h.verifyCount() - before).toBeLessThanOrEqual(AUTH_POLICY.addressCeilingFailures);
    expect(h.store.audit.length - auditBefore).toBeLessThanOrEqual(10);
  });

  it("writes at most one row a minute per address for unknown e-mails, and again when the minute has passed", async () => {
    for (let i = 0; i < 10; i += 1) {
      await signIn(h, { email: `nobody-${i}@nivel.uz`, password: WRONG, ipHash: "flood" });
    }
    expect(unknownRows()).toBe(1);
    h.clock.advance(MS_PER_MINUTE + 1);
    await signIn(h, { email: "nobody-x@nivel.uz", password: WRONG, ipHash: "flood" });
    expect(unknownRows()).toBe(2);
  });

  it("opens the address again after the window, and another address was never closed", async () => {
    for (let i = 0; i < AUTH_POLICY.addressCeilingFailures + 5; i += 1) {
      await signIn(h, { email: `nobody-${i}@nivel.uz`, password: WRONG, ipHash: "flood" });
    }
    expect(await signIn(h, { email: "other@nivel.uz", password: WRONG, ipHash: "flood" })).toEqual(THROTTLED);
    expect((await signIn(h, { ipHash: "owner-home" })).ok).toBe(true);
    h.clock.advance(AUTH_POLICY.lockMinutes * MS_PER_MINUTE + 1);
    expect(await signIn(h, { email: "other@nivel.uz", password: WRONG, ipHash: "flood" })).toEqual(INVALID);
  });

  it("does not count the requests that the source limit refuses", async () => {
    for (let i = 0; i < 5; i += 1) await signIn(h, { password: WRONG, ipHash: "stranger" });
    for (let i = 0; i < 100; i += 1) await signIn(h, { password: WRONG, ipHash: "stranger" });
    // Only the five checked attempts stand against the address: fifteen more e-mails are still answered, not refused.
    for (let i = 0; i < AUTH_POLICY.addressCeilingFailures - 6; i += 1) {
      expect(await signIn(h, { email: `x-${i}@nivel.uz`, password: WRONG, ipHash: "stranger" })).toEqual(INVALID);
    }
  });

  it("gives back the attempt of a good sign-in: many sessions of one office are not a flood", async () => {
    for (let i = 0; i < AUTH_POLICY.addressCeilingFailures * 2; i += 1) {
      expect((await signIn(h, { ipHash: "office" })).ok).toBe(true);
      h.clock.advance(31_000); // a code of the app is not used twice
    }
  });

  it("the flood of unknown e-mails cannot push the counters of the owner's e-mail out of memory", async () => {
    for (let i = 0; i < 4; i += 1) expect(await signIn(h, { password: WRONG, ipHash: "stranger" })).toEqual(INVALID);
    for (let i = 0; i < 12_000; i += 1) {
      await signIn(h, { email: `nobody-${i}@nivel.uz`, password: WRONG, ipHash: "stranger" });
    }
    for (let i = 0; i < 6; i += 1) {
      expect(await signIn(h, { password: WRONG, ipHash: "stranger" })).toEqual(THROTTLED);
    }
    expect(h.store.accounts.get(h.user.id)?.failedLogins).toBe(4);
  });

  it("journals the refusals of a locked account at most once a minute per account, whatever the sources", async () => {
    for (let i = 0; i < AUTH_POLICY.accountCeilingFailures; i += 1) {
      await signIn(h, { password: WRONG, ipHash: `s-${i}` });
    }
    const before = rows("auth.login_blocked");
    for (let i = 0; i < 300; i += 1) await signIn(h, { ipHash: `late-${i}` });
    expect(rows("auth.login_blocked") - before).toBe(1);
    h.clock.advance(MS_PER_MINUTE + 1);
    await signIn(h, { ipHash: "late-again" });
    expect(rows("auth.login_blocked") - before).toBe(2);
  });

  it("one address cannot reach the ceiling of the account over the hours, lock the owner out or end his sessions", async () => {
    const session = await signIn(h, { ipHash: "owner-home" });
    if (!session.ok) throw new Error("expected success");
    for (let cycle = 0; cycle < 8; cycle += 1) {
      for (let i = 0; i < 5; i += 1) await signIn(h, { password: WRONG, ipHash: "stranger" });
      expect(h.store.accounts.get(h.user.id)?.lockedUntil).toBeNull();
      expect(await h.service.authenticate(session.token)).not.toBeNull();
      h.clock.advance(AUTH_POLICY.lockMinutes * MS_PER_MINUTE + 1);
    }
    expect(h.store.audit.map((a) => a.action)).not.toContain("auth.locked");
  });

  it("the typos of the owner over days do not add up to a lock", async () => {
    for (let day = 0; day < 10; day += 1) {
      for (let i = 0; i < 3; i += 1)
        expect(await signIn(h, { password: WRONG, ipHash: "owner-home" })).toEqual(INVALID);
      h.clock.advance(24 * 60 * MS_PER_MINUTE);
    }
    expect(h.store.audit.map((a) => a.action)).not.toContain("auth.locked");
    expect(h.store.accounts.get(h.user.id)?.lockedUntil).toBeNull();
    expect((await signIn(h, { ipHash: "owner-home" })).ok).toBe(true);
  });

  it("still locks the account when several addresses together reach the ceiling inside one window", async () => {
    for (let i = 0; i < AUTH_POLICY.accountCeilingFailures; i += 1) {
      await signIn(h, { password: WRONG, ipHash: `s-${i}` });
      h.clock.advance(10_000);
    }
    expect(h.store.accounts.get(h.user.id)?.lockedUntil).not.toBeNull();
  });
});
