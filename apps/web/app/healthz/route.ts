import { pingDatabase } from "@nivel/db/health";

export const dynamic = "force-dynamic";

/** Liveness and dependencies of the site: 200 when the database answers (ARCHITECTURE 10.3). */
export async function GET(): Promise<Response> {
  const db = await pingDatabase(process.env.DATABASE_URL_WEB);
  const body = {
    app: "web",
    status: db.ok ? "ok" : "degraded",
    db: db.ok ? { ok: true, ms: db.ms } : { ok: false, error: db.error },
    queue: db.ok ? (db.queueSchema ? "ok" : "not_installed") : "unknown",
    time: new Date().toISOString(),
  };
  return Response.json(body, { status: db.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
