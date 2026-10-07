import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDb, type Db } from "@nivel/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFileStore } from "../../queues/files.ts";
import { testRuntime } from "../../queues/test-support/runtime.ts";
import { createWorld, theRow, type World } from "../../queues/test-support/world.ts";
import { handleRetention } from "./purge.ts";
import { retentionDepsOf } from "./register.ts";

// The data of the old days is made by the owner of the database (nivel_migrator): no application role may write the date of a
// request, a file or a conversation (DATA-MAP 2). The worker then runs the retention with its own rights.
let w: World;
let migrator: Db;
let dir: string;
beforeAll(async () => {
  w = await createWorld();
  migrator = createDb(process.env.DATABASE_URL_MIGRATOR as string, { max: 2 });
  dir = mkdtempSync(join(tmpdir(), "nivel-retention-"));
});
afterAll(async () => {
  await migrator.$client.end();
  await w.close();
  rmSync(dir, { recursive: true, force: true });
});

const q = <T extends Record<string, unknown> = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) =>
  db.$client.query<T>(sql, params).then((r) => r.rows);
let n = 0;

function bytes(key: string): void {
  mkdirSync(dirname(join(dir, key)), { recursive: true });
  writeFileSync(join(dir, key), "x");
}

async function oldFile(age: string, retention = "lead_12m"): Promise<string> {
  n += 1;
  const key = `retention/${retention}/${n}.pdf`;
  bytes(key);
  await q(
    migrator,
    `insert into ops.files (sha256, mime, bytes, storage_key, kind, retention_class, created_at)
     values (repeat('a', 64), 'application/pdf', 10, $1, 'quote_pdf', $2, now() - $3::interval)`,
    [key, retention, age],
  );
  return key;
}

const filesLeft = async (keys: string[]) =>
  (await q<{ storage_key: string }>(w.db, "select storage_key from ops.files where storage_key = any($1)", [keys]))
    .map((r) => r.storage_key)
    .sort();

function runtime(
  over: {
    filesDir?: string | undefined;
    files?: Parameters<typeof testRuntime>[1] extends infer O ? (O extends { files?: infer F } ? F : never) : never;
  } = {},
) {
  const t = testRuntime(w, {
    settings: { filesDir: "filesDir" in over ? over.filesDir : dir },
    ...(over.files ? { files: over.files } : {}),
  });
  return retentionDepsOf(t.rt);
}

describe("retention.purge on the real database, as the role worker", () => {
  it("erases a request without an order after 12 months and keeps a young one, with the customer anonymised", async () => {
    const old = theRow(
      await q<{ id: string }>(
        migrator,
        `insert into sales.customers (display_name, phone_e164, telegram_user_id, address, district, created_at)
         values ('Old Customer', '+998901234567', 7800000001, 'Tashkent, street 7', 'Yunusabad', now() - interval '14 months') returning id`,
      ),
    ).id;
    const oldLead = theRow(
      await q<{ id: string }>(
        migrator,
        `insert into sales.leads (number, customer_id, channel, scope, comment, contact_phone, created_at)
         values ('L-2990-0001', $1, 'web', 'pc', 'call me after six', '+998901234567', now() - interval '14 months') returning id`,
        [old],
      ),
    ).id;
    const youngLead = theRow(
      await q<{ id: string }>(
        migrator,
        `insert into sales.leads (number, channel, scope, comment, created_at)
         values ('L-2990-0002', 'web', 'pc', 'young comment', now() - interval '2 months') returning id`,
      ),
    ).id;
    const summary = await handleRetention(runtime());
    expect(summary.leads).toBeGreaterThanOrEqual(1);
    const [lead] = await q<{ comment: string | null; contact_phone: string | null }>(
      w.db,
      "select comment, contact_phone from sales.leads where id = $1",
      [oldLead],
    );
    expect(lead).toEqual({ comment: null, contact_phone: null });
    const [customer] = await q<{
      display_name: string | null;
      phone_e164: string | null;
      telegram_user_id: string | null;
      address: string | null;
      district: string;
      erased: boolean;
    }>(
      w.db,
      "select display_name, phone_e164, telegram_user_id::text, address, district, erased_at is not null as erased from sales.customers where id = $1",
      [old],
    );
    expect(customer).toEqual({
      display_name: null,
      phone_e164: null,
      telegram_user_id: null,
      address: null,
      district: "Yunusabad",
      erased: true,
    });
    const [young] = await q<{ comment: string | null }>(w.db, "select comment from sales.leads where id = $1", [
      youngLead,
    ]);
    expect(young?.comment).toBe("young comment");
  });

  it("deletes the rows of the files that are due and removes their bytes from the disk, and keeps the young ones", async () => {
    const dueKey = await oldFile("13 months");
    const aiKey = await oldFile("91 days", "ai_90d");
    const youngKey = await oldFile("2 months");
    const summary = await handleRetention(runtime());
    expect(summary.files).toBeGreaterThanOrEqual(2);
    expect(await filesLeft([dueKey, aiKey, youngKey])).toEqual([youngKey]);
    expect(existsSync(join(dir, dueKey))).toBe(false);
    expect(existsSync(join(dir, aiKey))).toBe(false);
    expect(existsSync(join(dir, youngKey))).toBe(true);
  });

  it("takes a file whose bytes are already gone as removed: a retry after a crash finds the same keys", async () => {
    const key = await oldFile("13 months");
    rmSync(join(dir, key));
    await expect(handleRetention(runtime())).resolves.toBeDefined();
    expect(await filesLeft([key])).toEqual([]);
  });

  it("removes the bytes BEFORE the commit: when the disk fails the rows stay and the next run offers the same keys", async () => {
    const a = await oldFile("13 months");
    const b = await oldFile("13 months");
    const real = createFileStore(dir);
    let failing = true;
    const flaky = {
      async remove(key: string) {
        if (failing && key === b) throw new Error("EIO: the disk failed");
        await real.remove(key);
      },
    };
    await expect(handleRetention(runtime({ files: flaky }))).rejects.toThrow(/EIO/);
    // the transaction rolled back: both rows are there, the key that did not fail is offered again
    expect(await filesLeft([a, b])).toEqual([a, b].sort());
    failing = false;
    await handleRetention(runtime({ files: flaky }));
    expect(await filesLeft([a, b])).toEqual([]);
    expect(existsSync(join(dir, a))).toBe(false);
    expect(existsSync(join(dir, b))).toBe(false);
  });

  it("does not delete the rows of files when there is no directory for the bytes", async () => {
    const key = await oldFile("13 months");
    const summary = await handleRetention(runtime({ filesDir: undefined }));
    expect(summary.filesSkipped).toBe(true);
    expect(await filesLeft([key])).toEqual([key]);
    expect(existsSync(join(dir, key))).toBe(true);
    // and with the directory the file goes
    await handleRetention(runtime());
    expect(await filesLeft([key])).toEqual([]);
  });

  it("removes the conversations of the AI past their 90 days with their messages", async () => {
    const conv = theRow(
      await q<{ id: string }>(
        migrator,
        `insert into ai.conversations (channel, lang, model, purge_after)
         values ('web', 'uz', 'test-model', now() - interval '1 day') returning id`,
      ),
    ).id;
    await q(
      migrator,
      `insert into ai.messages (conversation_id, seq, role, content) values ($1, 1, 'user', '{"text":"salom"}'::jsonb)`,
      [conv],
    );
    const keep = theRow(
      await q<{ id: string }>(
        migrator,
        `insert into ai.conversations (channel, lang, model) values ('web', 'uz', 'test-model') returning id`,
      ),
    ).id;
    const summary = await handleRetention(runtime());
    expect(summary.aiConversations).toBe(1);
    expect(await q(w.db, "select 1 from ai.conversations where id = $1", [conv])).toEqual([]);
    expect(await q(w.db, "select 1 from ai.messages where conversation_id = $1", [conv])).toEqual([]);
    expect(await q(w.db, "select 1 from ai.conversations where id = $1", [keep])).toHaveLength(1);
  });

  it("forgets the updates of Telegram older than 7 days and the sessions idle for 30 days", async () => {
    await q(
      migrator,
      "insert into bot.processed_updates (update_id, at) values (9001, now() - interval '8 days'), (9002, now() - interval '1 day')",
    );
    await q(
      migrator,
      `insert into bot.sessions (key, value, updated_at)
       values ('old-chat', '{}', now() - interval '40 days'), ('live-chat', '{}', now() - interval '1 day')`,
    );
    const summary = await handleRetention(runtime());
    expect(summary.processedUpdates).toBe(1);
    expect(summary.botSessions).toBe(1);
    expect(
      (await q<{ update_id: string }>(w.db, "select update_id::text from bot.processed_updates order by 1")).map(
        (r) => r.update_id,
      ),
    ).toEqual(["9002"]);
    expect((await q<{ key: string }>(migrator, "select key from bot.sessions order by 1")).map((r) => r.key)).toEqual([
      "live-chat",
    ]);
  });

  it("does not let a clock of the worker that runs ahead erase what the database still holds young (sessions, updates)", async () => {
    await q(migrator, "insert into bot.processed_updates (update_id, at) values (9101, now() - interval '2 days')");
    await q(
      migrator,
      "insert into bot.sessions (key, value, updated_at) values ('young-chat', '{}', now() - interval '2 days')",
    );
    const [dbNow] = await q<{ t: Date }>(w.db, "select now() as t");
    const before = w.clock.now();
    w.clock.set(new Date((dbNow?.t ?? new Date()).getTime() + 90 * 86_400_000));
    try {
      await handleRetention(runtime());
    } finally {
      w.clock.set(before);
    }
    expect(await q(w.db, "select 1 from bot.processed_updates where update_id = 9101")).toHaveLength(1);
    expect(await q(migrator, "select 1 from bot.sessions where key = 'young-chat'")).toHaveLength(1);
  });

  it("writes the audit rows of the erasure without personal data", async () => {
    const rows = await q<{ action: string; after: Record<string, unknown> | null }>(
      migrator,
      "select action, after from ops.audit_log where action in ('retention.purge_leads', 'retention.purge_files') order by at",
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(rows)).not.toMatch(/998901234567|Old Customer|retention\//);
  });
});
