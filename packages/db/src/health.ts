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

export type DbHealth = { ok: true; ms: number; queueSchema: boolean } | { ok: false; error: string };

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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
