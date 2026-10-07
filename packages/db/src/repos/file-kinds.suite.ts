import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FILE_KINDS } from "../schema/ops.ts";
import { connectAs, insertFile, pgError } from "./testkit.ts";

// WP-00, kinds of files: the kind of a registered file is a short name of the registry (DATA-MAP 3), and `act_photo` is
// the kind of the photo of a paper act: acts.sign takes no other file as the evidence of that way.
let migrator: pg.Client;
let admin: pg.Client;
let worker: pg.Client;

beforeAll(async () => {
  [migrator, admin, worker] = await Promise.all([connectAs("MIGRATOR"), connectAs("ADMIN"), connectAs("WORKER")]);
});
afterAll(async () => {
  for (const c of [migrator, admin, worker]) await c.end();
});

const INSERT = `insert into ops.files (sha256, mime, bytes, storage_key, kind, retention_class)
                values (repeat('b', 64), 'image/jpeg', 1, $1, $2, 'order_warranty_plus_3y')`;
let n = 0;
const key = () => `kinds/${++n}-${Math.random().toString(36).slice(2, 8)}`;

describe("the kinds of ops.files", () => {
  it("names the photo of a paper act, and every name once", () => {
    expect(FILE_KINDS).toContain("act_photo");
    expect(new Set(FILE_KINDS).size).toBe(FILE_KINDS.length);
  });

  it("registers a file of every named kind, by the worker and by the admin panel", async () => {
    for (const kind of FILE_KINDS) {
      await worker.query(INSERT, [key(), kind]);
      await admin.query(INSERT, [key(), kind]);
    }
  });

  it("keeps the photo of a paper act under the class that outlives the order", async () => {
    const f = await insertFile(migrator, { retention: "order_warranty_plus_3y", age: "1 day", kind: "act_photo" });
    expect(f.id).toBeTruthy();
  });

  it.each(["", "Act Photo", "act-photo", "ACT_PHOTO", "1act", "a", "x".repeat(41), "act photo; drop table", "aktа"])(
    "refuses the kind %j: a name of small letters, digits and underscores that begins with a letter",
    async (kind) => {
      const e = await pgError(worker, INSERT, [key(), kind]);
      expect(e.code).toBe("23514");
      expect(e.constraint).toBe("files_kind_chk");
    },
  );
});

describe("the storage key of a file", () => {
  // The purge returns the keys to the worker, which removes them from the disk: a key that climbs out of the directory of
  // the files would make that removal reach any file the worker can write.
  it.each([
    "../etc/passwd",
    "a/../../b",
    "/abs/path",
    "a/./b",
    "a//b",
    "a/b/",
    "..",
    "a\\b",
    "C:\\windows",
    "a\tb",
    "a\nb",
    "",
    "x".repeat(301),
  ])("refuses the key %j", async (storageKey) => {
    const e = await pgError(worker, INSERT, [storageKey, "quote_pdf"]);
    expect(e.code).toBe("23514");
    expect(e.constraint).toBe("files_storage_key_chk");
  });

  it.each(["receipts/2026/10/0190a1b2-c3d4.pdf", "quote_pdf/a-b_c.d/file.1", "a", "x".repeat(250)])(
    "accepts the key %j",
    async (storageKey) => {
      // The keys of the registry are unique: the fixture adds its own tail.
      await worker.query(INSERT, [`${storageKey}-${++n}-${Math.random().toString(36).slice(2, 8)}`, "quote_pdf"]);
    },
  );
});
