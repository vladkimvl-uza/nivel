// The SQL of the jobs about warranty, maintenance and ESF, on the real database as the role nivel_worker. Statuses and dates of
// finished orders are set by the owner of the database with the guard of the status switched off for one statement: the only
// other way is to walk the whole life of an order, which the tests of the orders do.
import { createDb, type Db } from "@nivel/db";
import { ops } from "@nivel/db/repos";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purchasedOrder } from "../../queues/test-support/flow.ts";
import { testRuntime } from "../../queues/test-support/runtime.ts";
import { createWorld, theRow, type World } from "../../queues/test-support/world.ts";
import { createPgMaintenanceReader, handleMaintenance } from "../aftercare/maintenance.ts";
import { createPgEsfReader, handleEsfReminders } from "../orders/esf.ts";
import { warrantyDepsOf } from "./register.ts";
import { handleVendorExpiry, handleWarrantySla } from "./sla.ts";

let w: World;
let migrator: Db;
beforeAll(async () => {
  w = await createWorld();
  migrator = createDb(process.env.DATABASE_URL_MIGRATOR as string, { max: 2 });
});
afterAll(async () => {
  await migrator.$client.end();
  await w.close();
});

const q = <T extends Record<string, unknown> = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) =>
  db.$client.query<T>(sql, params).then((r) => r.rows);

async function finish(orderId: string, status: "handed_over" | "closed", handedOverAt: string): Promise<void> {
  const c = await migrator.$client.connect();
  try {
    await c.query("alter table sales.orders disable trigger orders_guard");
    await c.query("update sales.orders set status = $2, handed_over_at = $3::timestamptz where id = $1", [
      orderId,
      status,
      handedOverAt,
    ]);
    await c.query("alter table sales.orders enable trigger orders_guard");
  } finally {
    c.release();
  }
}

const outbox = (like: string) =>
  q<{ dedupe_key: string; payload: { templateKey: string; orderId: string; params: Record<string, unknown> } }>(
    w.db,
    "select dedupe_key, payload from ops.outbox where dedupe_key like $1 order by dedupe_key",
    [like],
  );

describe("warranty.sla on the real database", () => {
  it("tells the owner of the terms of an open case that have passed, once, and not of a resolved case", async () => {
    const o = await purchasedOrder(w);
    const year = 2026;
    const open = await ops.nextNumber(w.db, "G", year);
    const done = await ops.nextNumber(w.db, "G", year);
    await q(
      w.db,
      `insert into sales.warranty_cases (number, order_id, description, opened_at, due_reply, due_diagnosis, due_fix, status)
       values ($1, $3, 'does not boot', now() - interval '5 days', now() - interval '4 days', now() - interval '3 days', now() + interval '5 days', 'opened'),
              ($2, $3, 'fan noise', now() - interval '30 days', now() - interval '29 days', now() - interval '28 days', now() - interval '20 days', 'resolved')`,
      [open, done, o.orderId],
    );
    const t = testRuntime(w, { realClock: true });
    const deps = warrantyDepsOf(t.rt);
    expect(await handleWarrantySla(deps)).toEqual({ reminded: 2 });
    const rows = await outbox("warranty:%");
    expect(rows.map((r) => r.payload.params.kind).sort()).toEqual(["diagnosis", "reply"]);
    expect(new Set(rows.map((r) => r.payload.params.caseNumber))).toEqual(new Set([open]));
    expect(new Set(rows.map((r) => r.payload.orderId))).toEqual(new Set([o.orderId]));
    expect(await handleWarrantySla(deps)).toEqual({ reminded: 0 });
  });
});

describe("warranty.vendor_expiry on the real database", () => {
  it("tells the owner, once for the order and the day, of the warranty of the shop that ends within 30 days, for an order that was handed over", async () => {
    const o = await purchasedOrder(w);
    const rows = await q<{ id: string }>(w.db, "select id from sales.purchases where order_id = $1 order by id", [
      o.orderId,
    ]);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    await q(w.db, "update sales.purchases set vendor_warranty_until = current_date + 10 where id = any($1)", [
      rows.slice(0, 2).map((r) => r.id),
    ]);
    await q(w.db, "update sales.purchases set vendor_warranty_until = current_date + 90 where id = $1", [
      theRow(rows.slice(2, 3)).id,
    ]);
    const t = testRuntime(w, { realClock: true });
    const deps = warrantyDepsOf(t.rt);
    const today = new Date().toISOString().slice(0, 10);
    // before the handover nothing is told
    expect(await handleVendorExpiry(deps, today)).toEqual({ reminded: 0 });
    await finish(o.orderId, "handed_over", new Date().toISOString());
    expect(await handleVendorExpiry(deps, today)).toEqual({ reminded: 1 });
    const out = await outbox(`order:${o.orderId}:vendor_warranty:%`);
    expect(out).toHaveLength(1);
    expect(out[0]?.payload.params.items).toBe(2);
    expect(out[0]?.payload.params.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await handleVendorExpiry(deps, today)).toEqual({ reminded: 0 });
  });
});

describe("the ESF of a purchase on the real database", () => {
  it("tells the owner once when a pending ESF is due, and not about a signed one or one that is not due", async () => {
    const o = await purchasedOrder(w);
    const rows = await q<{ id: string }>(w.db, "select id from sales.purchases where order_id = $1 order by id", [
      o.orderId,
    ]);
    const [due, signed, later] = rows;
    await q(w.db, "update sales.purchases set esf_status = 'pending', esf_due = current_date where id = $1", [
      theRow(due ? [due] : []).id,
    ]);
    await q(w.db, "update sales.purchases set esf_status = 'signed', esf_due = current_date - 1 where id = $1", [
      theRow(signed ? [signed] : []).id,
    ]);
    await q(w.db, "update sales.purchases set esf_status = 'pending', esf_due = current_date + 3 where id = $1", [
      theRow(later ? [later] : []).id,
    ]);
    const t = testRuntime(w, { realClock: true });
    const deps = {
      now: () => new Date(),
      log: t.rt.log,
      esfDue: createPgEsfReader(w.workerDb),
      enqueue: (i: ops.OutboxInput) => ops.enqueueOutbox(w.workerDb, i),
    };
    expect(await handleEsfReminders(deps)).toEqual({ reminded: 1 });
    const out = await outbox(`purchase:${theRow(due ? [due] : []).id}:esf_due`);
    expect(out).toHaveLength(1);
    expect(out[0]?.payload.orderId).toBe(o.orderId);
    expect(await handleEsfReminders(deps)).toEqual({ reminded: 0 });
  });
});

describe("the maintenance of a PC on the real database", () => {
  it("tells the owner six months after the handover, for an order that was handed over or closed", async () => {
    const o = await purchasedOrder(w);
    await finish(o.orderId, "closed", new Date(Date.now() - 183 * 86_400_000).toISOString());
    const t = testRuntime(w, { realClock: true });
    const deps = {
      now: () => new Date(),
      log: t.rt.log,
      candidates: createPgMaintenanceReader(w.workerDb),
      enqueue: (i: ops.OutboxInput) => ops.enqueueOutbox(w.workerDb, i),
    };
    expect(await handleMaintenance(deps)).toEqual({ reminded: 1 });
    expect(await outbox(`order:${o.orderId}:maintenance:6`)).toHaveLength(1);
    expect(await handleMaintenance(deps)).toEqual({ reminded: 0 });
  });
});
