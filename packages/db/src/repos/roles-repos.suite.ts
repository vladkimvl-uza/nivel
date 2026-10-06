import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.ts";
import { appendAudit, enqueueOutbox, recordConsent } from "./ops.ts";
import { createCustomer, createLead } from "./sales.ts";
import { connectAs, createOrder, one, openDb, uniq } from "./testkit.ts";

// The repositories run under the role of the application that calls them, not only under the admin: a function that
// needs a right its role does not have would roll back the whole business transaction of that application.
const dbs = {} as Record<"WEB" | "BOT" | "WORKER", Db>;
let order: { orderId: string; customerId: string };

beforeAll(async () => {
  for (const role of ["WEB", "BOT", "WORKER"] as const) dbs[role] = openDb(role);
  const m = await connectAs("MIGRATOR");
  try {
    order = await createOrder(m);
  } finally {
    await m.end();
  }
});
afterAll(async () => {
  for (const d of Object.values(dbs)) await d.$client.end();
});

describe.each(["WEB", "BOT", "WORKER"] as const)("appendAudit as %s", (role) => {
  it("writes the journal row (the roles may insert but not read ops.audit_log)", async () => {
    const entityId = `roles-${role}-${uniq()}`;
    await appendAudit(dbs[role], { actor: `system:${role}`, action: "roles.test", entity: "demo", entityId });
    const m = await connectAs("MIGRATOR");
    try {
      const row = await one<{ n: string }>(m, "select count(*)::text as n from ops.audit_log where entity_id = $1", [
        entityId,
      ]);
      expect(row.n).toBe("1");
    } finally {
      await m.end();
    }
  });

  it("rolls back nothing else: a business row and its audit row commit together", async () => {
    const entityId = `roles-tx-${role}-${uniq()}`;
    await dbs[role].transaction(async (tx) => {
      await appendAudit(tx, { actor: `system:${role}`, action: "roles.tx", entity: "demo", entityId });
      await enqueueOutbox(tx, { kind: "job", payload: { entityId }, dedupeKey: entityId });
    });
    const m = await connectAs("MIGRATOR");
    try {
      const row = await one<{ a: string; o: string }>(
        m,
        `select (select count(*) from ops.audit_log where entity_id = $1)::text as a,
                (select count(*) from ops.outbox where dedupe_key = $1)::text as o`,
        [entityId],
      );
      expect(row).toEqual({ a: "1", o: "1" });
    } finally {
      await m.end();
    }
  });
});

describe.each(["WEB", "BOT"] as const)("repositories the public processes use, as %s", (role) => {
  it("records a consent and reads its id back", async () => {
    const id = await recordConsent(dbs[role], {
      customerId: order.customerId,
      orderId: order.orderId,
      kind: "pd_processing",
      granted: true,
      channel: "test",
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("deduplicates an outbox row by its key", async () => {
    const key = `roles-outbox-${role}-${uniq()}`;
    const a = await enqueueOutbox(dbs[role], { kind: "job", payload: {}, dedupeKey: key });
    const b = await enqueueOutbox(dbs[role], { kind: "job", payload: {}, dedupeKey: key });
    expect(b).toEqual({ id: a.id, duplicate: true });
  });

  it("creates a customer and a lead with the next number", async () => {
    const customerId = await createCustomer(dbs[role], {
      displayName: `Roles ${role}`,
      telegramUserId: 7_100_000_000 + uniq() + (role === "BOT" ? 1000 : 0),
    });
    const lead = await createLead(dbs[role], { customerId, channel: "site", scope: "pc" });
    expect(lead.number).toMatch(/^L-\d{4}-\d{4,}$/);
  });
});
