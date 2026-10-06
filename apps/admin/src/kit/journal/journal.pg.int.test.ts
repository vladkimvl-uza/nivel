import { createDb, type Db } from "@nivel/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../../auth/service.ts";
import { listHistory, listJournal, listJournalEntities } from "./journal.pg.ts";
import { parseJournalQuery } from "./journal.ts";

let db: Db;
const owner: SessionUser = {
  id: "o1",
  email: "o@nivel.test",
  role: "owner",
  telegramUserId: null,
  sessionExpiresAt: new Date(0),
};
const assistant: SessionUser = { ...owner, id: "a1", role: "assistant" };

beforeAll(async () => {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set by the harness");
  db = createDb(url, { max: 3 });
  const rows: [string, string, string, string | null, unknown, unknown][] = [
    ["admin:o1", "setting.set", "ops.settings", "money.fee_settings", { pcLowRateBp: 1500 }, { pcLowRateBp: 1400 }],
    ["admin:o1", "auth.login", "ops.admin_users", "o1", null, { password: "must-not-show", ok: true }],
    ["anonymous", "auth.login_failed", "ops.admin_users", null, null, { reason: "unknown_email" }],
    ["admin:o1", "catalog.update", "catalog.products", "p-1", { a: 1 }, { a: 2 }],
    ["admin:o1", "setting.set", "ops.settings", "calendar.work", null, { from: "10:00" }],
  ];
  for (const [actor, action, entity, entityId, before, after] of rows) {
    await db.$client.query(
      "insert into ops.audit_log (actor, action, entity, entity_id, before, after) values ($1, $2, $3, $4, $5, $6)",
      [actor, action, entity, entityId, before === null ? null : JSON.stringify(before), JSON.stringify(after)],
    );
  }
});

afterAll(async () => {
  await db.$client.end();
});

const q = (raw: Record<string, string>) => parseJournalQuery(raw);

describe("journal on PostgreSQL", () => {
  it("lists newest first with a Russian title and the changed fields", async () => {
    const page = await listJournal(db, owner, q({}));
    expect(page.total).toBe(5);
    expect(page.rows[0]).toMatchObject({
      action: "setting.set",
      title: "Изменение настройки",
      entityId: "calendar.work",
      changed: ["from"],
    });
    const fee = page.rows.find((r) => r.entityId === "money.fee_settings");
    expect(fee?.changed).toEqual(["pcLowRateBp"]);
  });

  it("filters by entity, actor and action prefix, and a percent sign is not a wildcard", async () => {
    expect((await listJournal(db, owner, q({ entity: "ops.settings" }))).total).toBe(2);
    expect((await listJournal(db, owner, q({ actor: "anonymous" }))).total).toBe(1);
    expect((await listJournal(db, owner, q({ action: "auth." }))).total).toBe(2);
    expect((await listJournal(db, owner, q({ action: "%" }))).total).toBe(0);
    expect((await listJournal(db, owner, q({ action: "a_th" }))).total).toBe(0);
  });

  it("filters by day in Tashkent time", async () => {
    const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
    expect((await listJournal(db, owner, q({ from: today, to: today }))).total).toBe(5);
    expect((await listJournal(db, owner, q({ to: "2020-01-01" }))).total).toBe(0);
  });

  it("never shows what looks like a secret", async () => {
    const page = await listJournal(db, owner, q({ action: "auth.login" }));
    const dump = JSON.stringify(page.rows);
    expect(dump).not.toContain("must-not-show");
    expect(dump).toContain("***");
  });

  it("pages", async () => {
    const page = await listJournal(db, owner, { ...q({}), pageSize: 2, page: 3 });
    expect(page.rows).toHaveLength(1);
    expect(page.pages).toBe(3);
  });

  it("the assistant has no journal; the history of one record needs only the catalog right", async () => {
    await expect(listJournal(db, assistant, q({}))).rejects.toThrow(/forbidden/);
    await expect(listJournalEntities(db, assistant)).rejects.toThrow(/forbidden/);
    const history = await listHistory(db, assistant, "catalog.products", "p-1");
    expect(history).toHaveLength(1);
    expect(history[0]?.changed).toEqual(["a"]);
    expect(await listJournalEntities(db, owner)).toEqual(["catalog.products", "ops.admin_users", "ops.settings"]);
  });
});
