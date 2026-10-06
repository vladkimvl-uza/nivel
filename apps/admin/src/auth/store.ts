// What the sign-in service needs from storage. Two implementations: `store.pg.ts` (ops.admin_users, ops.admin_sessions,
// ops.audit_log through the role nivel_admin) and `store.memory.ts` (the same rules in memory, for fast tests).
import type { Role } from "./roles.ts";

export interface AdminAccount {
  id: string;
  email: string;
  passwordHash: string;
  /** Sealed TOTP bundle (secrets.ts) or null while no second factor is set up. */
  totpSecretEnc: string | null;
  role: Role;
  telegramUserId: number | null;
  active: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
  createdAt: Date;
}

export interface NewAccount {
  id: string;
  email: string;
  passwordHash: string;
  totpSecretEnc: string;
  role: Role;
  telegramUserId: number | null;
}

export interface NewSession {
  tokenSha256: string;
  userId: string;
  expiresAt: Date;
  ipHash: string | null;
  ua: string | null;
}

export interface AuditEntry {
  /** `admin:<id>`, or `anonymous` before the person is known. */
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ipHash?: string | null;
}

/** A second account with the same e-mail (case-insensitive). */
export class DuplicateAccountError extends Error {
  constructor() {
    super("an account with this e-mail already exists");
    this.name = "DuplicateAccountError";
  }
}

export interface AuthStore {
  findByEmail(email: string): Promise<AdminAccount | null>;
  findById(id: string): Promise<AdminAccount | null>;
  createAccount(a: NewAccount): Promise<void>;
  /**
   * Takes one attempt (a sign-in, or a sensitive change inside a session) before the password is checked, in one statement: an account that is locked (the lock has
   * not run out) gives nothing; otherwise the count goes up by one (from zero after a lock that has run out) and the
   * account is locked when the count reaches `lockAfter`. Concurrent requests therefore cannot check more passwords
   * than the rule allows. A right sign-in then clears the claim with `resetFailures`.
   */
  claimAttempt(
    id: string,
    rule: { lockAfter: number; lockMinutes: number },
    now: Date,
  ): Promise<
    { claimed: true; failedLogins: number; lockedUntil: Date | null } | { claimed: false; lockedUntil: Date | null }
  >;
  resetFailures(id: string): Promise<void>;
  /** Replaces the sealed bundle only when it still is `expected`: two sign-ins cannot both spend one recovery code. */
  replaceTotpBundle(id: string, expected: string | null, next: string): Promise<boolean>;
  setPasswordHash(id: string, hash: string): Promise<void>;
  /** `taken` when another account already holds this Telegram id (unique index). */
  setTelegramUserId(id: string, telegramUserId: number | null): Promise<"ok" | "taken">;
  setActive(id: string, active: boolean): Promise<void>;
  listAccounts(): Promise<AdminAccount[]>;

  createSession(s: NewSession): Promise<void>;
  /**
   * The session of the token while it lives (not expired by idleness, not older than the absolute limit) and its account
   * while that is active; moves the idle expiry forward. Null otherwise.
   */
  touchSession(
    tokenSha256: string,
    now: Date,
    limits: { idleMs: number; absoluteMs: number },
  ): Promise<{ account: AdminAccount; expiresAt: Date } | null>;
  deleteSession(tokenSha256: string): Promise<void>;
  deleteSessionsOf(userId: string, exceptTokenSha256?: string): Promise<void>;

  appendAudit(entry: AuditEntry): Promise<void>;
}
