// ops.files on PostgreSQL: the registry of stored files. The storage key is unique and made of the content hash, so a
// second upload of the same picture finds the first row instead of failing.
import type { Db } from "@nivel/db";
import type { FileRegistry } from "./save.ts";

export function createPgFileRegistry(db: Db): FileRegistry {
  return {
    async register(file) {
      const { rows } = await db.$client.query<{ id: string }>(
        `insert into ops.files (sha256, mime, bytes, storage_key, kind, is_public, contains_pd, retention_class, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (storage_key) do nothing
         returning id`,
        [
          file.sha256,
          file.mime,
          file.bytes,
          file.storageKey,
          file.kind,
          file.isPublic,
          file.containsPd,
          file.retentionClass,
          file.createdBy,
        ],
      );
      if (rows[0]) return { id: rows[0].id, duplicate: false };
      const existing = await db.$client.query<{ id: string }>("select id from ops.files where storage_key = $1", [
        file.storageKey,
      ]);
      const id = existing.rows[0]?.id;
      if (!id) throw new Error("file row vanished");
      return { id, duplicate: true };
    },
  };
}

/** Latest registered files for the screen of uploads. */
export async function listRecentFiles(db: Db, limit = 20) {
  const { rows } = await db.$client.query<{
    id: string;
    kind: string;
    mime: string;
    bytes: string;
    sha256: string;
    created_at: Date;
    created_by: string | null;
  }>(
    "select id, kind, mime, bytes, sha256, created_at, created_by from ops.files order by created_at desc, id desc limit $1",
    [limit],
  );
  return rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
}
