// In-memory AuthStore: the rules of the SQL implementation, for unit tests of the service. Not used by the application.
import {
  type AdminAccount,
  type AuditEntry,
  type AuthStore,
  DuplicateAccountError,
  type NewAccount,
  type NewSession,
} from "./store.ts";

interface MemorySession extends NewSession {
  createdAt: Date;
  lastSeenAt: Date;
}

export class MemoryAuthStore implements AuthStore {
  readonly accounts = new Map<string, AdminAccount>();
  readonly sessions = new Map<string, MemorySession>();
  readonly audit: AuditEntry[] = [];
  /** The clock of the "database": sessions are created at this moment. */
  now: () => Date = () => new Date();

  async findByEmail(email: string) {
    const needle = email.toLowerCase();
    return [...this.accounts.values()].find((a) => a.email.toLowerCase() === needle) ?? null;
  }

  async findById(id: string) {
    return this.accounts.get(id) ?? null;
  }

  async createAccount(a: NewAccount) {
    const email = a.email.toLowerCase();
    if ([...this.accounts.values()].some((x) => x.email.toLowerCase() === email)) throw new DuplicateAccountError();
    this.accounts.set(a.id, {
      ...a,
      active: true,
      failedLogins: 0,
      lockedUntil: null,
      createdAt: this.now(),
    });
  }

  async recordFailure(id: string, rule: { lockAfter: number; lockMinutes: number }, now: Date) {
    const a = this.mustGet(id);
    a.failedLogins += 1;
    if (a.failedLogins >= rule.lockAfter) a.lockedUntil = new Date(now.getTime() + rule.lockMinutes * 60_000);
    return { failedLogins: a.failedLogins, lockedUntil: a.lockedUntil };
  }

  async resetFailures(id: string) {
    const a = this.mustGet(id);
    a.failedLogins = 0;
    a.lockedUntil = null;
  }

  async replaceTotpBundle(id: string, expected: string | null, next: string) {
    const a = this.mustGet(id);
    if (a.totpSecretEnc !== expected) return false;
    a.totpSecretEnc = next;
    return true;
  }

  async setPasswordHash(id: string, hash: string) {
    this.mustGet(id).passwordHash = hash;
  }

  async setTelegramUserId(id: string, telegramUserId: number | null) {
    if (
      telegramUserId !== null &&
      [...this.accounts.values()].some((a) => a.id !== id && a.telegramUserId === telegramUserId)
    ) {
      return "taken" as const;
    }
    this.mustGet(id).telegramUserId = telegramUserId;
    return "ok" as const;
  }

  async setActive(id: string, active: boolean) {
    this.mustGet(id).active = active;
  }

  async listAccounts() {
    return [...this.accounts.values()];
  }

  async createSession(s: NewSession) {
    const now = this.now();
    this.sessions.set(s.tokenSha256, { ...s, createdAt: now, lastSeenAt: now });
  }

  async touchSession(tokenSha256: string, now: Date, limits: { idleMs: number; absoluteMs: number }) {
    const s = this.sessions.get(tokenSha256);
    if (!s || s.expiresAt <= now) return null;
    const hardEnd = s.createdAt.getTime() + limits.absoluteMs;
    if (hardEnd <= now.getTime()) return null;
    const account = this.accounts.get(s.userId);
    if (!account?.active) return null;
    s.lastSeenAt = now;
    s.expiresAt = new Date(Math.min(now.getTime() + limits.idleMs, hardEnd));
    return { account, expiresAt: s.expiresAt };
  }

  async deleteSession(tokenSha256: string) {
    this.sessions.delete(tokenSha256);
  }

  async deleteSessionsOf(userId: string, exceptTokenSha256?: string) {
    for (const [token, s] of this.sessions)
      if (s.userId === userId && token !== exceptTokenSha256) this.sessions.delete(token);
  }

  async appendAudit(entry: AuditEntry) {
    this.audit.push(entry);
  }

  private mustGet(id: string): AdminAccount {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`no account ${id}`);
    return a;
  }
}
