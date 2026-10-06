// Integration: the change and its journal entry commit together on a real database.
import { createDb, type Db } from "@nivel/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgAuditSink, withAudit } from "./audit.ts";

let db: Db;

beforeAll(() => {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set by the harness");
  db = createDb(url, { max: 3 });
});

afterAll(async () => {
  await db.$client.end();
});

const settingExists = async (key: string) =>
  (await db.$client.query("select 1 from ops.settings where key = $1", [key])).rowCount === 1;

const writeSetting = (tx: unknown, key: string) =>
  (tx as Db).execute(
    sql`insert into ops.settings (key, value, updated_by) values (${key}, ${JSON.stringify({ n: 1 })}::jsonb, 'int-test')`,
  );

describe("withAudit on PostgreSQL", () => {
  const meta = { actor: "admin:int", action: "int.change", entity: "ops.settings" };

  it("commits the change and its entry together", async () => {
    await withAudit(createPgAuditSink(db), { ...meta, entityId: "int.atomic.ok" }, async (tx) => {
      await writeSetting(tx, "int.atomic.ok");
      return { value: 1, after: { n: 1 } };
    });
    expect(await settingExists("int.atomic.ok")).toBe(true);
    const { rows } = await db.$client.query(
      "select 1 from ops.audit_log where action = 'int.change' and entity_id = $1",
      ["int.atomic.ok"],
    );
    expect(rows).toHaveLength(1);
  });

  it("takes the change back when the entry cannot be written", async () => {
    await expect(
      withAudit(
        createPgAuditSink(db),
        // An entity that is null violates NOT NULL of the journal: the write of the entry fails.
        { ...meta, entity: null as unknown as string, entityId: "int.atomic.fail" },
        async (tx) => {
          await writeSetting(tx, "int.atomic.fail");
          return { value: 1 };
        },
      ),
    ).rejects.toThrow();
    expect(await settingExists("int.atomic.fail")).toBe(false);
  });

  it("leaves nothing behind when the action itself fails", async () => {
    await expect(
      withAudit(createPgAuditSink(db), meta, async (tx) => {
        await writeSetting(tx, "int.atomic.half");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await settingExists("int.atomic.half")).toBe(false);
  });
});
