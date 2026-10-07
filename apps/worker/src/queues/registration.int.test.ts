// The worker as main.ts starts it: pg-boss on the schema the migration made, with the rights of nivel_worker (no CREATE on the
// database), every domain registered with its runtime, the schedules in the calendar of Tashkent, a job that goes from the
// outbox through pg-boss to its handler, and a job that fails five times and is written to ops.app_errors.
import { ops } from "@nivel/db/repos";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerAll } from "../jobs/index.ts";
import { relayDepsOf } from "../jobs/outbox/register.ts";
import { relayOnce } from "../jobs/outbox/relay.ts";
import { queueOptions } from "../queue.ts";
import { registerQueue } from "./define.ts";
import { jobIdOf } from "./ids.ts";
import { Lifecycle, type WorkerContext } from "./runtime.ts";
import { acceptedOrder } from "./test-support/flow.ts";
import { testRuntime } from "./test-support/runtime.ts";
import { createWorld, type World } from "./test-support/world.ts";

let w: World;
let boss: PgBoss;
let ctx: WorkerContext;
let t: ReturnType<typeof testRuntime>;
const lifecycle = new Lifecycle();
let domains: string[] = [];

const q = <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  w.db.$client.query<R>(sql, params).then((r) => r.rows);

async function until<T>(read: () => Promise<T | undefined | false>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 250));
  }
}

beforeAll(async () => {
  w = await createWorld();
  const url = process.env.DATABASE_URL_WORKER;
  if (!url) throw new Error("DATABASE_URL_WORKER is not set");
  boss = new PgBoss(queueOptions(url));
  boss.on("error", () => undefined);
  await boss.start();
  t = testRuntime(w, { boss, realClock: true });
  ctx = { boss, log: t.rt.log, runtime: t.rt, onStart: lifecycle.onStart, onStop: lifecycle.onStop };
  domains = await registerAll(ctx);
}, 60_000);

afterAll(async () => {
  await lifecycle.stop().catch(() => undefined);
  await boss.stop({ graceful: false });
  await w.close();
});

const QUEUES = [
  "outbox.relay",
  "payment.expect",
  "ledger.append",
  "web.revalidate",
  "orders.scheduled",
  "orders.estimate.expiry",
  "orders.reminders",
  "threshold.check",
  "retention.purge",
  "ops.selfcheck",
  "ops.error_digest",
  "ops.fee_scale.promote",
  "warranty.sla",
  "warranty.vendor_expiry",
  "aftercare",
  "crm.collect",
  "crm.sync",
];

describe("registration with the rights of nivel_worker", () => {
  it("registers all twelve domains of the frozen list", () => {
    expect(domains).toEqual([
      "outbox",
      "fx",
      "prices",
      "orders",
      "warranty",
      "aftercare",
      "threshold",
      "pdf",
      "ideas",
      "retention",
      "ops",
      "ai",
    ]);
  });

  it("has made every queue of the card, with five attempts and a growing pause", async () => {
    for (const name of QUEUES) {
      const queue = await boss.getQueue(name);
      expect(queue, name).not.toBeNull();
      expect(queue?.retryBackoff, name).toBe(true);
      expect(queue?.retryLimit, name).toBe(["web.revalidate", "crm.sync"].includes(name) ? 6 : 4);
    }
  });

  it("runs as nivel_worker, which has no CREATE on the database", async () => {
    const who = await boss
      .getDb()
      .executeSql("select current_user as u, has_database_privilege(current_user, current_database(), 'CREATE') as c");
    expect(who.rows[0]).toEqual({ u: "nivel_worker", c: false });
  });
});

describe("the schedules, in the calendar of Tashkent, on a fake clock", () => {
  const FROM = new Date("2026-10-12T00:00:00+05:00");
  const cases: [string, string, string[]][] = [
    ["retention.purge", "30 3 * * *", ["2026-10-12T03:30:00+05:00", "2026-10-13T03:30:00+05:00"]],
    ["threshold.check", "0 6 * * *", ["2026-10-12T06:00:00+05:00", "2026-10-13T06:00:00+05:00"]],
    ["ops.error_digest", "0 20 * * *", ["2026-10-12T20:00:00+05:00", "2026-10-13T20:00:00+05:00"]],
    ["ops.fee_scale.promote", "5 0 * * *", ["2026-10-12T00:05:00+05:00", "2026-10-13T00:05:00+05:00"]],
    ["ops.selfcheck", "*/10 * * * *", ["2026-10-12T00:10:00+05:00", "2026-10-12T00:20:00+05:00"]],
    ["orders.reminders", "*/5 * * * *", ["2026-10-12T00:05:00+05:00", "2026-10-12T00:10:00+05:00"]],
    ["orders.estimate.expiry", "*/5 * * * *", ["2026-10-12T00:05:00+05:00", "2026-10-12T00:10:00+05:00"]],
    ["outbox.relay", "* * * * *", ["2026-10-12T00:01:00+05:00", "2026-10-12T00:02:00+05:00"]],
    ["warranty.sla", "*/15 * * * *", ["2026-10-12T00:15:00+05:00", "2026-10-12T00:30:00+05:00"]],
    ["warranty.vendor_expiry", "0 9 * * *", ["2026-10-12T09:00:00+05:00", "2026-10-13T09:00:00+05:00"]],
    ["crm.collect", "* * * * *", ["2026-10-12T00:01:00+05:00", "2026-10-12T00:02:00+05:00"]],
    ["aftercare", "0 10 * * *", ["2026-10-12T10:00:00+05:00", "2026-10-13T10:00:00+05:00"]],
  ];

  it.each(cases)("%s runs on %s", async (name, cron, expected) => {
    const schedule = await boss.getSchedule(name);
    expect(schedule?.cron).toBe(cron);
    expect(schedule?.timezone).toBe("Asia/Tashkent");
    const next = boss.previewSchedule(cron, { tz: "Asia/Tashkent", from: FROM, count: expected.length });
    expect(next.map((d) => d.toISOString())).toEqual(expected.map((e) => new Date(e).toISOString()));
  });

  it("schedules only the queues that run by the clock", async () => {
    for (const name of ["payment.expect", "ledger.append", "web.revalidate", "orders.scheduled"]) {
      expect(await boss.getSchedule(name), name).toBeNull();
    }
  });
});

describe("a job from the outbox to its handler through pg-boss", () => {
  it("runs payment.expect: the site queued it, the relay hands it to the queue, the worker expects the payment with the quote's sum", async () => {
    const o = await acceptedOrder(w, { via: "web" });
    expect(await q("select 1 from sales.payments where order_id = $1", [o.orderId])).toEqual([]);

    // the relay as the loop runs it: one pass on the real outbox, jobs to the real queues
    const relay = relayDepsOf(t.rt);
    const stats = await relayOnce(relay, { limit: 50 });
    expect(stats.sent).toBeGreaterThanOrEqual(2);

    const rows = await until(async () => {
      const found = await q<{ kind: string; amount_sum: string; status: string }>(
        "select kind, amount_sum::text, status from sales.payments where order_id = $1 order by kind",
        [o.orderId],
      );
      return found.length === 2 ? found : undefined;
    });
    expect(rows).toEqual([
      { kind: "fee_advance", amount_sum: String(o.quote.totals.advance), status: "expected" },
      { kind: "purchase_funds", amount_sum: String(o.quote.totals.purchaseLimit), status: "expected" },
    ]);
  }, 60_000);
});

describe("one fact, one job: the id of the job", () => {
  it("makes one job when the same row of the outbox is handed over twice (a crash between the send and markSent)", async () => {
    const id = jobIdOf("test:hand-over:1");
    await boss.createQueue("test.once");
    const first = await t.rt.jobs.send("test.once", { n: 1 }, { id, singletonKey: "k" });
    const second = await t.rt.jobs.send("test.once", { n: 1 }, { id, singletonKey: "k" });
    expect(first).toBe(id);
    expect(second).toBeNull();
    const counted = await boss.getDb().executeSql("select count(*)::int as n from pgboss.job where name = 'test.once'");
    expect(counted.rows[0]).toEqual({ n: 1 });
  });

  it("does not make one job of two sends that only share a singletonKey on a standard queue: that is why the id is passed", async () => {
    await boss.createQueue("test.key.only");
    const a = await t.rt.jobs.send("test.key.only", { n: 1 }, { singletonKey: "same" });
    const b = await t.rt.jobs.send("test.key.only", { n: 1 }, { singletonKey: "same" });
    expect([a, b].every((v) => typeof v === "string")).toBe(true);
  });
});

describe("a job that fails every time", () => {
  it("is tried five times and then written to ops.app_errors, with an alert for the owner in the outbox", async () => {
    let runs = 0;
    await registerQueue(ctx, {
      name: "test.always.fails",
      retry: { limit: 4, delaySec: 1, backoff: false, maxDelaySec: 1 },
      pollSeconds: 0.5,
      handler: async () => {
        runs += 1;
        throw new Error("the database of the test is down for order 6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11");
      },
    });
    await boss.send("test.always.fails", { orderId: "x" });
    const rows = await until(async () => {
      const found = await q<{ app: string; message: string; count: number }>(
        "select app, message, count from ops.app_errors where message like '[test.always.fails]%'",
      );
      return found.length > 0 ? found : undefined;
    }, 45_000);
    expect(runs).toBe(5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app: "worker", count: 1 });
    expect(rows[0]?.message).toContain("[test.always.fails] the database of the test is down for order");
    const alerts = await q<{ payload: { templateKey: string; params: { queue: string; attempts: number } } }>(
      "select payload from ops.outbox where payload->>'templateKey' = 'ops.job_failed' and payload->'params'->>'queue' = 'test.always.fails'",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.payload.params.attempts).toBe(5);
  }, 60_000);
});

describe("the loop of the relay, started after the domains have registered", () => {
  it("sends a message that appears in the outbox within a few seconds, and stops with the worker", async () => {
    await ops.setSetting(w.db, "telegram.owner_group", { chatId: -1001234567890 }, "test");
    await lifecycle.start();
    await ops.enqueueOutbox(w.workerDb, {
      kind: "telegram_message",
      dedupeKey: "loop-1",
      payload: { target: "group", templateKey: "ops.alert", params: { check: "disk", detail: "85 %" } },
    });
    const sentTo = () => t.telegram.sent.filter((m) => m.chatId === -1001234567890);
    await until(async () => sentTo().some((m) => m.text.includes("85 %")));
    // the alert of the job that failed five times (the test above) is in the same outbox, and goes to the same group
    await until(async () => sentTo().some((m) => m.text.includes("test.always.fails упала 5 раз")));
    await until(
      async () => (await q("select status from ops.outbox where dedupe_key = 'loop-1'"))[0]?.status === "sent",
    );
    await lifecycle.stop();
  }, 60_000);
});
