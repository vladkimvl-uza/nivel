import { QUEUE_INSTALLED_SQL } from "@nivel/db/health";
import { PgBoss } from "pg-boss";
import { describe, expect, it } from "vitest";
import { queueOptions } from "./queue.ts";

// The worker starts pg-boss with the rights of nivel_worker on a clone of the test database, which carries the rights of the
// production one: no CREATE on the database, and the schema `pgboss` made by the migration (packages/db, wp00_db_rights).
// The first start of a clone installs pg-boss, so the test that must see an empty schema comes first.
const workerUrl = (): string => {
  const url = process.env.DATABASE_URL_WORKER;
  if (!url) throw new Error("DATABASE_URL_WORKER is not set (integration project only)");
  return url;
};

describe("the queue of the worker, with the rights of nivel_worker", () => {
  it("cannot be started the default way: pg-boss would run CREATE SCHEMA IF NOT EXISTS, which asks for CREATE on the database", async () => {
    const boss = new PgBoss({ ...queueOptions(workerUrl()), createSchema: true });
    boss.on("error", () => undefined);
    try {
      await expect(boss.start()).rejects.toThrow(/permission denied for database/);
    } finally {
      await boss.stop({ graceful: false });
    }
  });

  it("installs pg-boss into the schema the migration made, with no CREATE on the database, and runs a job", async () => {
    const boss = new PgBoss(queueOptions(workerUrl()));
    const errors: unknown[] = [];
    boss.on("error", (e) => errors.push(e));
    try {
      await boss.start();
      const db = boss.getDb();
      const who = await db.executeSql(
        "select current_user as role, has_database_privilege(current_user, current_database(), 'CREATE') as can_create",
      );
      expect(who.rows[0]).toEqual({ role: "nivel_worker", can_create: false });
      const installed = await db.executeSql("select to_regclass('pgboss.version') is not null as q");
      expect(installed.rows[0]).toEqual({ q: true });
      // The probe of /healthz of the site and the admin panel (roles with no right on the schema) sees the queue now.
      expect((await db.executeSql(QUEUE_INSTALLED_SQL)).rows[0]).toEqual({ q: true });

      await boss.createQueue("wp00-probe");
      const id = await boss.send("wp00-probe", { n: 1 });
      expect(id).toEqual(expect.any(String));
      const [job] = await boss.fetch<{ n: number }>("wp00-probe");
      expect(job?.id).toBe(id);
      expect(job?.data).toEqual({ n: 1 });
      await boss.complete("wp00-probe", job?.id ?? "");
    } finally {
      await boss.stop({ graceful: false });
    }
    expect(errors).toEqual([]);
  });

  it("starts again on the installed schema (a restart of the worker)", async () => {
    const boss = new PgBoss(queueOptions(workerUrl()));
    boss.on("error", () => undefined);
    try {
      await boss.start();
      const queue = await boss.getQueue("wp00-probe");
      expect(queue?.name).toBe("wp00-probe");
    } finally {
      await boss.stop({ graceful: false });
    }
  });

  it("is told by the options alone: the schema is pgboss and pg-boss is not asked to create it", () => {
    expect(queueOptions("postgres://worker@127.0.0.1:54339/x_test")).toMatchObject({
      schema: "pgboss",
      createSchema: false,
      application_name: "nivel-worker",
    });
  });
});
