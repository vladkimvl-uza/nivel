import pg from "pg";

const pools = new Map<string, pg.Pool>();

/** One small pool per connection string, reused across /healthz calls. */
function poolFor(connectionString: string): pg.Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 30_000 });
    pool.on("error", () => {}); // idle client errors surface on the next ping
    pools.set(connectionString, pool);
  }
  return pool;
}

/** Short public reason; the raw driver message never leaves the server (it may name roles, hosts or ports). */
export type DbHealthError = "not_configured" | "db_auth" | "db_unreachable" | "db_error";

/** `error` is safe to return from /healthz; `detail` is for server-side logs only. */
export type DbHealth =
  | { ok: true; ms: number; queueSchema: boolean }
  | { ok: false; error: DbHealthError; detail?: string };

const NETWORK_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ECONNRESET", "EAI_AGAIN"]);

/** Maps a pg driver or socket error to a public reason code. */
export function classifyDbError(e: unknown): DbHealthError {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  const message = e instanceof Error ? e.message : String(e);
  if (code === "28P01" || code === "28000") return "db_auth";
  if (NETWORK_CODES.has(code) || /timeout/i.test(message)) return "db_unreachable";
  return "db_error";
}

/** select 1 plus presence of the pg-boss schema; never throws. */
export async function pingDatabase(connectionString: string | undefined): Promise<DbHealth> {
  if (!connectionString) return { ok: false, error: "not_configured" };
  const started = performance.now();
  try {
    const { rows } = await poolFor(connectionString).query<{ q: boolean }>(
      "select to_regnamespace('pgboss') is not null as q",
    );
    return { ok: true, ms: Math.round(performance.now() - started), queueSchema: rows[0]?.q === true };
  } catch (e) {
    return { ok: false, error: classifyDbError(e), detail: e instanceof Error ? e.message : String(e) };
  }
}
