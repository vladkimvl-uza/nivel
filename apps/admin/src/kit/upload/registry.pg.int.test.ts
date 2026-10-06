// Integration: a phone photo goes through the whole path on a real database and a real folder.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@nivel/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgAuditSink } from "../../auth/audit.ts";
import type { SessionUser } from "../../auth/service.ts";
import { createPgFileRegistry, listRecentFiles } from "./registry.pg.ts";
import { createFsFileSink, saveUpload } from "./save.ts";

let db: Db;
let dir: string;
const owner: SessionUser = {
  id: "owner-9",
  email: "o@nivel.test",
  role: "owner",
  telegramUserId: null,
  sessionExpiresAt: new Date(0),
};

const TINY = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const withGps = (marker: string) => {
  const payload = Buffer.from(`Exif\0\0${marker}`, "latin1");
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), head, payload, TINY.subarray(2), Buffer.from([0xff, 0xd9])]);
};

beforeAll(async () => {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set by the harness");
  db = createDb(url, { max: 3 });
  dir = await mkdtemp(join(tmpdir(), "nivel-files-"));
});

afterAll(async () => {
  await db.$client.end();
  await rm(dir, { recursive: true, force: true });
});

describe("upload on PostgreSQL", () => {
  const deps = () => ({
    files: createFsFileSink(dir),
    registry: createPgFileRegistry(db),
    audit: createPgAuditSink(db),
  });

  it("stores the cleaned photo, registers it in ops.files as private, and journals it", async () => {
    const r = await saveUpload(deps(), { actor: owner, bytes: withGps("SECRET-GPS-41.29N"), kind: "receipt" });
    if (!r.ok) throw new Error(r.error);
    expect((await readFile(join(dir, r.storageKey))).toString("latin1")).not.toContain("SECRET-GPS");
    const { rows } = await db.$client.query<Record<string, unknown>>("select * from ops.files where id = $1", [r.id]);
    expect(rows[0]).toMatchObject({
      sha256: r.sha256,
      mime: "image/jpeg",
      kind: "receipt",
      is_public: false,
      contains_pd: true,
      retention_class: "tax_5y",
      created_by: "admin:owner-9",
    });
    const audit = await db.$client.query(
      "select action from ops.audit_log where entity = 'ops.files' and entity_id = $1",
      [r.id],
    );
    expect(audit.rows).toEqual([{ action: "files.upload" }]);
  });

  it("the same photo again answers with the same row", async () => {
    const a = await saveUpload(deps(), { actor: owner, bytes: withGps("A-EXIF-ONE"), kind: "part_photo" });
    const b = await saveUpload(deps(), { actor: owner, bytes: withGps("A-EXIF-TWO-LONGER"), kind: "part_photo" });
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(b.id).toBe(a.id);
    expect(b.duplicate).toBe(true);
    const recent = await listRecentFiles(db, 10);
    expect(recent.filter((f) => f.id === a.id)).toHaveLength(1);
  });
});
