// The journal read from ops.audit_log (the role nivel_admin may read it; nobody may change it).
import type { Db } from "@nivel/db";
import { requirePermission } from "../../auth/roles.ts";
import type { SessionUser } from "../../auth/service.ts";
import { actionTitle, changedPaths, type JournalQuery, type JournalRow, redact } from "./journal.ts";

interface Row {
  id: string;
  at: Date;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
}

/** `%` and `_` typed by a person are letters, not wildcards. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const WHERE = `
  ($1::text is null or entity = $1)
  and ($2::text is null or actor = $2)
  and ($3::text is null or action like $3 || '%' escape '\\')
  and ($4::timestamptz is null or at >= $4)
  and ($5::timestamptz is null or at < $5)`;

export async function listJournal(
  db: Db,
  actor: SessionUser,
  q: JournalQuery,
): Promise<{ rows: JournalRow[]; total: number; pages: number }> {
  requirePermission(actor, "journal.read");
  const filters = [
    q.entity ?? null,
    q.actor ?? null,
    q.action ? escapeLike(q.action) : null,
    q.from ?? null,
    q.to ?? null,
  ];
  const [{ rows }, count] = await Promise.all([
    db.$client.query<Row>(
      `select id, at, actor, action, entity, entity_id, before, after from ops.audit_log
        where ${WHERE} order by at desc, id desc limit $6 offset $7`,
      [...filters, q.pageSize, (q.page - 1) * q.pageSize],
    ),
    db.$client.query<{ n: string }>(`select count(*) as n from ops.audit_log where ${WHERE}`, filters),
  ]);
  const total = Number(count.rows[0]?.n ?? 0);
  return {
    total,
    pages: Math.max(1, Math.ceil(total / q.pageSize)),
    rows: rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      action: r.action,
      title: actionTitle(r.action),
      entity: r.entity,
      entityId: r.entity_id,
      changed: changedPaths(r.before, r.after),
      before: redact(r.before),
      after: redact(r.after),
    })),
  };
}

/** Entities that have entries, for the filter. */
export async function listJournalEntities(db: Db, actor: SessionUser): Promise<string[]> {
  requirePermission(actor, "journal.read");
  const { rows } = await db.$client.query<{ entity: string }>(
    "select distinct entity from ops.audit_log order by entity limit 200",
  );
  return rows.map((r) => r.entity);
}

/** The history of one record, newest first (the form of a catalog position shows it). */
export async function listHistory(
  db: Db,
  actor: SessionUser,
  entity: string,
  entityId: string,
  limit = 20,
): Promise<JournalRow[]> {
  requirePermission(actor, "catalog.read");
  const { rows } = await db.$client.query<Row>(
    `select id, at, actor, action, entity, entity_id, before, after from ops.audit_log
      where entity = $1 and entity_id = $2 order by at desc, id desc limit $3`,
    [entity, entityId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    actor: r.actor,
    action: r.action,
    title: actionTitle(r.action),
    entity: r.entity,
    entityId: r.entity_id,
    changed: changedPaths(r.before, r.after),
    before: redact(r.before),
    after: redact(r.after),
  }));
}
