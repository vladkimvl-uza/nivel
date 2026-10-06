// AuthStore on PostgreSQL: ops.admin_users, ops.admin_sessions and ops.audit_log through the role nivel_admin.
// Where @nivel/db has a repository function it is used; the rest is plain parameterized SQL on the same pool (no string
// concatenation of values anywhere).
import type { Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import { isRole } from "./roles.ts";
import {
  type AdminAccount,
  type AuditEntry,
  type AuthStore,
  DuplicateAccountError,
  type NewAccount,
  type NewSession,
} from "./store.ts";

interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  totp_secret_enc: string | null;
  role: string;
  telegram_user_id: string | number | null;
  active: boolean;
  failed_logins: number;
  locked_until: Date | null;
  created_at: Date;
}

const ACCOUNT_COLUMNS =
  "id, email, password_hash, totp_secret_enc, role, telegram_user_id, active, failed_logins, locked_until, created_at";

function toAccount(row: AccountRow): AdminAccount {
  if (!isRole(row.role)) throw new Error(`admin ${row.id} has an unknown role`);
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    totpSecretEnc: row.totp_secret_enc,
    role: row.role,
    telegramUserId: row.telegram_user_id === null ? null : Number(row.telegram_user_id),
    active: row.active,
    failedLogins: row.failed_logins,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";

export function createPgAuthStore(db: Db): AuthStore {
  const query = <R extends object>(text: string, values: unknown[] = []) => db.$client.query<R>(text, values);

  return {
    async findByEmail(email) {
      const { rows } = await query<AccountRow>(
        `select ${ACCOUNT_COLUMNS} from ops.admin_users where lower(email) = lower($1)`,
        [email],
      );
      return rows[0] ? toAccount(rows[0]) : null;
    },

    async findById(id) {
      const { rows } = await query<AccountRow>(`select ${ACCOUNT_COLUMNS} from ops.admin_users where id = $1`, [id]);
      return rows[0] ? toAccount(rows[0]) : null;
    },

    async createAccount(a: NewAccount) {
      try {
        await query(
          `insert into ops.admin_users (id, email, password_hash, totp_secret_enc, role, telegram_user_id)
           values ($1, $2, $3, $4, $5, $6)`,
          [a.id, a.email, a.passwordHash, a.totpSecretEnc, a.role, a.telegramUserId],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateAccountError();
        throw error;
      }
    },

    async recordFailure(id, rule, now) {
      return ops.recordFailedLogin(db, id, { lockAfter: rule.lockAfter, lockMinutes: rule.lockMinutes, now });
    },

    async resetFailures(id) {
      await ops.resetFailedLogins(db, id);
    },

    async replaceTotpBundle(id, expected, next) {
      const { rowCount } = await query(
        "update ops.admin_users set totp_secret_enc = $3 where id = $1 and totp_secret_enc is not distinct from $2",
        [id, expected, next],
      );
      return rowCount === 1;
    },

    async setPasswordHash(id, hash) {
      await query("update ops.admin_users set password_hash = $2 where id = $1", [id, hash]);
    },

    async setTelegramUserId(id, telegramUserId) {
      try {
        await query("update ops.admin_users set telegram_user_id = $2 where id = $1", [id, telegramUserId]);
        return "ok";
      } catch (error) {
        if (isUniqueViolation(error)) return "taken";
        throw error;
      }
    },

    async setActive(id, active) {
      await query("update ops.admin_users set active = $2 where id = $1", [id, active]);
    },

    async listAccounts() {
      const { rows } = await query<AccountRow>(
        `select ${ACCOUNT_COLUMNS} from ops.admin_users order by created_at, id`,
      );
      return rows.map(toAccount);
    },

    async createSession(s: NewSession) {
      await ops.createAdminSession(db, {
        tokenSha256: s.tokenSha256,
        userId: s.userId,
        expiresAt: s.expiresAt,
        ...(s.ipHash ? { ipHash: s.ipHash } : {}),
        ...(s.ua ? { ua: s.ua.slice(0, 300) } : {}),
      });
    },

    async touchSession(tokenSha256, now, limits) {
      // One statement: the session is alive, its account is active; the idle expiry slides, the absolute one does not.
      const { rows } = await query<AccountRow & { session_expires_at: Date }>(
        `update ops.admin_sessions s
            set last_seen_at = $2::timestamptz,
                expires_at = least($2::timestamptz + make_interval(secs => $3::float8),
                                   s.created_at + make_interval(secs => $4::float8))
           from ops.admin_users u
          where s.token_sha256 = $1
            and u.id = s.user_id
            and u.active
            and s.expires_at > $2::timestamptz
            and s.created_at + make_interval(secs => $4::float8) > $2::timestamptz
        returning s.expires_at as session_expires_at,
                  u.id, u.email, u.password_hash, u.totp_secret_enc, u.role, u.telegram_user_id, u.active,
                  u.failed_logins, u.locked_until, u.created_at`,
        [tokenSha256, now.toISOString(), limits.idleMs / 1000, limits.absoluteMs / 1000],
      );
      const row = rows[0];
      return row ? { account: toAccount(row), expiresAt: row.session_expires_at } : null;
    },

    async deleteSession(tokenSha256) {
      await ops.deleteAdminSession(db, tokenSha256);
    },

    async deleteSessionsOf(userId, exceptTokenSha256) {
      await query("delete from ops.admin_sessions where user_id = $1 and token_sha256 is distinct from $2", [
        userId,
        exceptTokenSha256 ?? null,
      ]);
    },

    async appendAudit(entry: AuditEntry) {
      await ops.appendAudit(db, {
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ipHash: entry.ipHash ?? null,
      });
    },
  };
}
