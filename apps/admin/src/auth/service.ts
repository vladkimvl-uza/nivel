// Sign-in, sessions and the own account (ARCHITECTURE 6.1, 10.1 A07). Pure logic over ports: storage, password hasher,
// clock. Messages for people are Russian; the reasons returned to the screens are codes.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkPasswordPolicy, type PasswordHasher, randomPassword } from "./password.ts";
import { AUTH_POLICY, MS_PER_DAY, MS_PER_HOUR } from "./policy.ts";
import type { Role } from "./roles.ts";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  openSecret,
  parseRecoveryInput,
  sealSecret,
  type TotpBundle,
} from "./secrets.ts";
import { type AdminAccount, type AuditEntry, type AuthStore, DuplicateAccountError } from "./store.ts";
import { base32Decode, base32Encode, findTotpStep, newTotpSecret, otpauthUri } from "./totp.ts";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  telegramUserId: number | null;
  /** When the session ends if it is not used again. */
  sessionExpiresAt: Date;
}

export interface LoginInput {
  email: string;
  password: string;
  /** A TOTP code from the app or one recovery code. */
  code: string;
  ipHash: string | null;
  ua: string | null;
}

export type LoginResult =
  | { ok: true; token: string; user: SessionUser; usedRecoveryCode: boolean; recoveryLeft: number }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; lockedUntil: Date };

export interface ProvisionInput {
  email: string;
  role: Role;
  /** Generated when absent: shown once to the person who creates the account. */
  password?: string;
  telegramUserId?: number | null;
  /** Who creates the account: `admin:<id>` or `cli`. */
  actor: string;
}

export type ProvisionResult =
  | {
      ok: true;
      id: string;
      email: string;
      password: string;
      totpSecret: string;
      totpUri: string;
      recoveryCodes: string[];
    }
  | { ok: false; problems: string[] };

export interface AuthServiceDeps {
  store: AuthStore;
  hasher: PasswordHasher;
  /** DATA_ENC_KEY (32 bytes). */
  dataKey: Buffer;
  now?: () => Date;
  /** Name shown in the authenticator app. */
  issuer: string;
}

export interface AuthService {
  login(input: LoginInput): Promise<LoginResult>;
  authenticate(token: string | undefined | null): Promise<SessionUser | null>;
  logout(token: string, userId?: string): Promise<void>;
  provisionUser(input: ProvisionInput): Promise<ProvisionResult>;
  changePassword(
    userId: string,
    input: { current: string; next: string; keepToken?: string; ipHash?: string | null },
  ): Promise<
    { ok: true } | { ok: false; reason: "invalid" | "locked" } | { ok: false; reason: "policy"; problems: string[] }
  >;
  /**
   * The Telegram id is what the bot trusts to say "this is the owner": changing it asks for the password and a code of
   * the app, as issuing recovery codes does. An empty `telegram` unbinds.
   */
  bindTelegram(
    userId: string,
    input: { telegram: string; password: string; code: string; ipHash?: string | null },
  ): Promise<
    { ok: true; telegramUserId: number | null } | { ok: false; reason: "format" | "taken" | "invalid" | "locked" }
  >;
  regenerateRecoveryCodes(
    userId: string,
    input: { password: string; code: string; ipHash?: string | null },
  ): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; reason: "invalid" | "locked" }>;
  setActive(
    id: string,
    active: boolean,
    actor: SessionUser,
  ): Promise<{ ok: true } | { ok: false; reason: "self" | "last_owner" | "not_found" }>;
  listAccounts(): Promise<AdminAccount[]>;
}

const INVALID = { ok: false, reason: "invalid" } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_LENGTH = 43; // 32 random bytes in base64url

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { store, hasher, dataKey, issuer } = deps;
  const now = deps.now ?? (() => new Date());
  const lockRule = { lockAfter: AUTH_POLICY.lockAfterFailures, lockMinutes: AUTH_POLICY.lockMinutes };
  const limits = {
    idleMs: AUTH_POLICY.idleHours * MS_PER_HOUR,
    absoluteMs: AUTH_POLICY.absoluteDays * MS_PER_DAY,
  };

  // A hash to compare against when the e-mail is unknown, so that a missing account costs the same time as a wrong password.
  let dummy: Promise<string> | undefined;
  const dummyHash = () => {
    dummy ??= hasher.hash(randomBytes(18).toString("base64url"));
    return dummy;
  };

  const audit = (entry: AuditEntry) => store.appendAudit(entry);
  const actorOf = (account: AdminAccount) => `admin:${account.id}`;

  const toUser = (account: AdminAccount, expiresAt: Date): SessionUser => ({
    id: account.id,
    email: account.email,
    role: account.role,
    telegramUserId: account.telegramUserId,
    sessionExpiresAt: expiresAt,
  });

  /**
   * Journals the failure of an attempt that was claimed before it was checked (`claimAttempt`). The date until which the
   * account is locked when this attempt was the last allowed one, otherwise null.
   */
  async function journalFailure(
    account: AdminAccount,
    action: "auth.login_failed" | "auth.reverify_failed",
    reason: string,
    ipHash: string | null,
    state: { failedLogins: number; lockedUntil: Date | null },
  ): Promise<Date | null> {
    const at = now();
    await audit({
      actor: actorOf(account),
      action,
      entity: "ops.admin_users",
      entityId: account.id,
      after: { reason, failedLogins: state.failedLogins },
      ipHash,
    });
    if (!state.lockedUntil || state.lockedUntil <= at) return null;
    await audit({
      actor: actorOf(account),
      action: "auth.locked",
      entity: "ops.admin_users",
      entityId: account.id,
      after: { until: state.lockedUntil.toISOString() },
      ipHash,
    });
    return state.lockedUntil;
  }

  async function fail(
    account: AdminAccount,
    reason: string,
    ipHash: string | null,
    state: { failedLogins: number; lockedUntil: Date | null },
  ): Promise<LoginResult> {
    const lockedUntil = await journalFailure(account, "auth.login_failed", reason, ipHash, state);
    return lockedUntil ? { ok: false, reason: "locked", lockedUntil } : INVALID;
  }

  /**
   * The second factor: a TOTP code of a time step newer than the last accepted one, or an unspent recovery code.
   * The sealed bundle is rewritten (compare-and-swap), which spends the code.
   */
  async function checkSecondFactor(
    account: AdminAccount,
    code: string,
    allowRecovery: boolean,
  ): Promise<{ ok: true; usedRecovery: boolean; recoveryLeft: number } | { ok: false; reason: string }> {
    if (!account.totpSecretEnc) return { ok: false, reason: "no_totp" };
    const bundle = openSecret(account.totpSecretEnc, dataKey, account.id);
    if (!bundle) return { ok: false, reason: "totp_unreadable" };
    const typed = code.trim();
    const compact = typed.replace(/\s/g, "");
    let next: TotpBundle;
    let usedRecovery = false;
    if (/^\d{6}$/.test(compact)) {
      const step = findTotpStep(base32Decode(bundle.secret), compact, now());
      if (step === null) return { ok: false, reason: "wrong_code" };
      if (bundle.lastStep !== undefined && step <= bundle.lastStep) return { ok: false, reason: "code_reused" };
      next = { ...bundle, lastStep: step };
    } else {
      const candidate = parseRecoveryInput(typed);
      if (!allowRecovery || candidate === null) return { ok: false, reason: "wrong_code" };
      const hash = hashRecoveryCode(candidate);
      if (!bundle.recovery.includes(hash)) return { ok: false, reason: "wrong_code" };
      next = { ...bundle, recovery: bundle.recovery.filter((h) => h !== hash) };
      usedRecovery = true;
    }
    const swapped = await store.replaceTotpBundle(
      account.id,
      account.totpSecretEnc,
      sealSecret(next, dataKey, account.id),
    );
    if (!swapped) return { ok: false, reason: "concurrent_use" };
    return { ok: true, usedRecovery, recoveryLeft: next.recovery.length };
  }

  /**
   * The attempt of a sensitive change inside a live session, taken the way a sign-in takes it: before anything is
   * checked, in one statement of the database. A stolen session then cannot guess the password or the code without
   * limit, and requests that arrive together cannot check more than the rule allows. A locked account gives nothing.
   * When the lock falls, the sessions of the account end (a stolen one does not outlive it).
   */
  async function takeAttempt(
    userId: string,
    ipHash: string | null,
  ): Promise<
    | {
        ok: true;
        account: AdminAccount;
        failed(reason: string): Promise<"invalid" | "locked">;
        passed(): Promise<void>;
      }
    | { ok: false; reason: "invalid" | "locked" }
  > {
    const account = await store.findById(userId);
    if (!account?.active) return { ok: false, reason: "invalid" };
    const at = now();
    const claim = await store.claimAttempt(account.id, lockRule, at);
    if (!claim.claimed) {
      return { ok: false, reason: claim.lockedUntil && claim.lockedUntil > at ? "locked" : "invalid" };
    }
    return {
      ok: true,
      account,
      async failed(reason) {
        const lockedUntil = await journalFailure(account, "auth.reverify_failed", reason, ipHash, claim);
        if (!lockedUntil) return "invalid";
        await store.deleteSessionsOf(account.id);
        return "locked";
      },
      passed: () => store.resetFailures(account.id),
    };
  }

  /**
   * A sensitive change inside a live session asks again for the password and a code of a new period of the app (not a
   * recovery code). The account when both are right.
   */
  async function reverify(
    userId: string,
    input: { password: string; code: string; ipHash?: string | null },
  ): Promise<{ ok: true; account: AdminAccount } | { ok: false; reason: "invalid" | "locked" }> {
    const taken = await takeAttempt(userId, input.ipHash ?? null);
    if (!taken.ok) return taken;
    if (!(await hasher.verify(taken.account.passwordHash, input.password))) {
      return { ok: false, reason: await taken.failed("wrong_password") };
    }
    const factor = await checkSecondFactor(taken.account, input.code, false);
    if (!factor.ok) return { ok: false, reason: await taken.failed(factor.reason) };
    await taken.passed();
    return { ok: true, account: taken.account };
  }

  return {
    async login(input) {
      const email = normalizeEmail(input.email);
      const tooLong = input.password.length > AUTH_POLICY.maxPasswordLength * 4 || email.length > 254;
      if (email === "" || input.password === "" || input.code.trim() === "" || tooLong) return INVALID;
      if ([...input.password].length > AUTH_POLICY.maxPasswordLength) return INVALID;

      const account = await store.findByEmail(email);
      if (!account) {
        await hasher.verify(await dummyHash(), input.password);
        await audit({
          actor: "anonymous",
          action: "auth.login_failed",
          entity: "ops.admin_users",
          entityId: null,
          after: { reason: "unknown_email", emailHash: sha256(email).slice(0, 16) },
          ipHash: input.ipHash,
        });
        return INVALID;
      }

      const at = now();
      if (account.lockedUntil && account.lockedUntil > at) {
        return { ok: false, reason: "locked", lockedUntil: account.lockedUntil };
      }
      if (!account.active) {
        await hasher.verify(await dummyHash(), input.password);
        await audit({
          actor: actorOf(account),
          action: "auth.login_failed",
          entity: "ops.admin_users",
          entityId: account.id,
          after: { reason: "inactive" },
          ipHash: input.ipHash,
        });
        return INVALID;
      }

      // The attempt is taken before anything is checked: requests that arrive together read the same account, and only
      // the claim in the database decides how many of them may check a password and a code.
      const claim = await store.claimAttempt(account.id, lockRule, at);
      if (!claim.claimed) {
        return claim.lockedUntil && claim.lockedUntil > at
          ? { ok: false, reason: "locked", lockedUntil: claim.lockedUntil }
          : INVALID;
      }
      if (!(await hasher.verify(account.passwordHash, input.password)))
        return fail(account, "wrong_password", input.ipHash, claim);
      const factor = await checkSecondFactor(account, input.code, true);
      if (!factor.ok) return fail(account, factor.reason, input.ipHash, claim);

      await store.resetFailures(account.id);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(at.getTime() + limits.idleMs);
      await store.createSession({
        tokenSha256: sha256(token),
        userId: account.id,
        expiresAt,
        ipHash: input.ipHash,
        ua: input.ua,
      });
      if (factor.usedRecovery) {
        await audit({
          actor: actorOf(account),
          action: "auth.recovery_used",
          entity: "ops.admin_users",
          entityId: account.id,
          after: { left: factor.recoveryLeft },
          ipHash: input.ipHash,
        });
      }
      await audit({
        actor: actorOf(account),
        action: "auth.login",
        entity: "ops.admin_users",
        entityId: account.id,
        ipHash: input.ipHash,
      });
      return {
        ok: true,
        token,
        user: toUser(account, expiresAt),
        usedRecoveryCode: factor.usedRecovery,
        recoveryLeft: factor.recoveryLeft,
      };
    },

    async authenticate(token) {
      if (!token || token.length !== TOKEN_LENGTH) return null;
      const found = await store.touchSession(sha256(token), now(), limits);
      return found ? toUser(found.account, found.expiresAt) : null;
    },

    async logout(token, userId) {
      await store.deleteSession(sha256(token));
      if (userId) {
        await audit({ actor: `admin:${userId}`, action: "auth.logout", entity: "ops.admin_users", entityId: userId });
      }
    },

    async provisionUser(input) {
      const email = normalizeEmail(input.email);
      const problems: string[] = [];
      if (!EMAIL_RE.test(email) || email.length > 254) problems.push("Некорректный e-mail.");
      const password = input.password ?? randomPassword();
      if (input.password !== undefined) problems.push(...checkPasswordPolicy(password, { email }));
      if (problems.length === 0 && (await store.findByEmail(email)))
        problems.push("Учётная запись с таким e-mail уже есть.");
      if (problems.length > 0) return { ok: false, problems };

      const id = randomUUID();
      const secret = newTotpSecret();
      const recoveryCodes = generateRecoveryCodes();
      const bundle: TotpBundle = { v: 1, secret: base32Encode(secret), recovery: recoveryCodes.map(hashRecoveryCode) };
      try {
        await store.createAccount({
          id,
          email,
          passwordHash: await hasher.hash(password),
          totpSecretEnc: sealSecret(bundle, dataKey, id),
          role: input.role,
          telegramUserId: input.telegramUserId ?? null,
        });
      } catch (error) {
        if (error instanceof DuplicateAccountError) {
          return { ok: false, problems: ["Учётная запись с таким e-mail уже есть."] };
        }
        throw error;
      }
      await audit({
        actor: input.actor,
        action: "auth.user_created",
        entity: "ops.admin_users",
        entityId: id,
        after: { email, role: input.role },
      });
      return {
        ok: true,
        id,
        email,
        password,
        totpSecret: bundle.secret,
        totpUri: otpauthUri({ secret, account: email, issuer }),
        recoveryCodes,
      };
    },

    async changePassword(userId, input) {
      const taken = await takeAttempt(userId, input.ipHash ?? null);
      if (!taken.ok) return taken;
      const { account } = taken;
      if (!(await hasher.verify(account.passwordHash, input.current))) {
        return { ok: false, reason: await taken.failed("wrong_password") };
      }
      // The current password is right: this series ends, whatever the answer about the new one is.
      await taken.passed();
      const problems = checkPasswordPolicy(input.next, { email: account.email });
      if (input.next === input.current) problems.push("Новый пароль совпадает со старым.");
      if (problems.length > 0) return { ok: false, reason: "policy", problems };
      await store.setPasswordHash(userId, await hasher.hash(input.next));
      await store.deleteSessionsOf(userId, input.keepToken ? sha256(input.keepToken) : undefined);
      await audit({
        actor: actorOf(account),
        action: "auth.password_changed",
        entity: "ops.admin_users",
        entityId: userId,
        ipHash: input.ipHash ?? null,
      });
      return { ok: true };
    },

    async bindTelegram(userId, input) {
      const raw = input.telegram.trim();
      let value: number | null = null;
      if (raw !== "") {
        if (!/^[1-9]\d{0,15}$/.test(raw)) return { ok: false, reason: "format" };
        value = Number(raw);
        if (!Number.isSafeInteger(value)) return { ok: false, reason: "format" };
      }
      const checked = await reverify(userId, input);
      if (!checked.ok) return checked;
      const { account } = checked;
      const before = account.telegramUserId;
      const result = await store.setTelegramUserId(userId, value);
      if (result === "taken") return { ok: false, reason: "taken" };
      await audit({
        actor: actorOf(account),
        action: "auth.telegram_bound",
        entity: "ops.admin_users",
        entityId: userId,
        before: { telegramUserId: before },
        after: { telegramUserId: value },
        ipHash: input.ipHash ?? null,
      });
      return { ok: true, telegramUserId: value };
    },

    async regenerateRecoveryCodes(userId, input) {
      const checked = await reverify(userId, input);
      if (!checked.ok) return checked;
      const { account } = checked;
      const fresh = await store.findById(userId);
      const bundle = fresh?.totpSecretEnc ? openSecret(fresh.totpSecretEnc, dataKey, userId) : null;
      if (!fresh?.totpSecretEnc || !bundle) return INVALID;
      const codes = generateRecoveryCodes();
      const next: TotpBundle = { ...bundle, recovery: codes.map(hashRecoveryCode) };
      if (!(await store.replaceTotpBundle(userId, fresh.totpSecretEnc, sealSecret(next, dataKey, userId))))
        return INVALID;
      await audit({
        actor: actorOf(account),
        action: "auth.recovery_regenerated",
        entity: "ops.admin_users",
        entityId: userId,
        ipHash: input.ipHash ?? null,
      });
      return { ok: true, recoveryCodes: codes };
    },

    async setActive(id, active, actor) {
      if (id === actor.id && !active) return { ok: false, reason: "self" };
      const target = await store.findById(id);
      if (!target) return { ok: false, reason: "not_found" };
      if (!active && target.role === "owner") {
        const owners = (await store.listAccounts()).filter((a) => a.role === "owner" && a.active && a.id !== id);
        if (owners.length === 0) return { ok: false, reason: "last_owner" };
      }
      await store.setActive(id, active);
      if (!active) await store.deleteSessionsOf(id);
      await audit({
        actor: `admin:${actor.id}`,
        action: active ? "auth.user_enabled" : "auth.user_disabled",
        entity: "ops.admin_users",
        entityId: id,
      });
      return { ok: true };
    },

    listAccounts: () => store.listAccounts(),
  };
}
