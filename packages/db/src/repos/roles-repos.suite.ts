import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.ts";
import type { Executor } from "./executor.ts";
import { appendAudit, consentGranted, enqueueOutbox, latestConsent, recordConsent } from "./ops.ts";
import { createCustomer, createLead, findCustomerByTelegramId, loadOrderContext, orderMoney } from "./sales.ts";
import { connectAs, createOrder, insertConsent, one, openDb, uniq } from "./testkit.ts";

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

/** Runs `fn` in one transaction of the role, after checking that the session really is that role's. */
async function asRole<T>(role: keyof typeof dbs, fn: (tx: Executor) => Promise<T>): Promise<T> {
  const name = `nivel_${role.toLowerCase()}`;
  return dbs[role].transaction(async (tx) => {
    const { rows } = await tx.execute<{ current_user: string; session_user: string }>(
      sql`select current_user, session_user`,
    );
    expect(rows[0]).toEqual({ current_user: name, session_user: name });
    return fn(tx);
  });
}

// The columns the roles may read are not the same: the site reads the fewest (ARCHITECTURE 3.2). A repository that
// reads a column its role has no right to fails with 42501 and rolls back the whole business transaction, so the
// readers below are run in the session of each role, and the session is checked to be that role.
describe.each(["WEB", "BOT", "WORKER"] as const)("the readers of ops.consents and sales.customers, as %s", (role) => {
  let scenario: { orderId: string; customerId: string; telegramId: number };

  beforeAll(async () => {
    const m = await connectAs("MIGRATOR");
    try {
      const { orderId, customerId } = await createOrder(m);
      const telegramId = 7_200_000_000 + uniq();
      // The columns some roles lack: the phone and the address (the site and the worker cannot read the address).
      await m.query(
        "update sales.customers set telegram_user_id = $2, phone_e164 = $3, address = 'Tashkent, secret street 2' where id = $1",
        [customerId, telegramId, `+99890${String(1_000_000 + uniq())}`],
      );
      const consent = { orderId, customerId };
      await insertConsent(m, { ...consent, kind: "non_returnable", granted: true, at: "2026-10-01T10:00:00Z" });
      await insertConsent(m, { ...consent, kind: "non_returnable", granted: false, at: "2026-10-02T10:00:00Z" });
      await insertConsent(m, { ...consent, kind: "limit_overrun", granted: true, at: "2026-10-01T10:00:00Z" });
      scenario = { orderId, customerId, telegramId };
    } finally {
      await m.end();
    }
  });

  it("answers consentGranted by the newest row of the kind", async () => {
    await asRole(role, async (tx) => {
      expect(await consentGranted(tx, scenario.orderId, "limit_overrun")).toBe(true);
      expect(await consentGranted(tx, scenario.orderId, "non_returnable")).toBe(false); // withdrawn later
      expect(await consentGranted(tx, scenario.orderId, "replacement")).toBe(false); // never given
    });
  });

  it("returns the newest consent row with the columns every role may read, and null when there is none", async () => {
    await asRole(role, async (tx) => {
      const row = await latestConsent(tx, scenario.orderId, "non_returnable");
      expect(row).toMatchObject({
        orderId: scenario.orderId,
        customerId: scenario.customerId,
        kind: "non_returnable",
        granted: false,
      });
      expect(Object.keys(row ?? {}).sort()).toEqual(["at", "customerId", "granted", "id", "kind", "orderId"]);
      expect(await latestConsent(tx, scenario.orderId, "replacement")).toBeNull();
    });
  });

  it("finds a customer by the Telegram id with the columns every role may read", async () => {
    await asRole(role, async (tx) => {
      const found = await findCustomerByTelegramId(tx, scenario.telegramId);
      expect(found).toMatchObject({ id: scenario.customerId, telegramUserId: scenario.telegramId, lang: "uz" });
      // Neither the phone, nor the address, nor the Telegram name: the same answer whatever the role.
      expect(Object.keys(found ?? {}).sort()).toEqual([
        "age18Confirmed",
        "createdAt",
        "displayName",
        "district",
        "id",
        "lang",
        "telegramUserId",
      ]);
      expect(await findCustomerByTelegramId(tx, 1)).toBeNull();
    });
  });
});

// The money of an order is read by the bot and the worker (the site reads it only through the views).
describe.each(["BOT", "WORKER"] as const)("the readers of the money and the context of an order, as %s", (role) => {
  it("reads the money with the consent of the limit overrun and loads the context", async () => {
    const m = await connectAs("MIGRATOR");
    let o: { orderId: string; customerId: string };
    try {
      o = await createOrder(m);
      await insertConsent(m, { orderId: o.orderId, customerId: o.customerId, kind: "limit_overrun", granted: true });
    } finally {
      await m.end();
    }
    await asRole(role, async (tx) => {
      expect(await orderMoney(tx, o.orderId)).toMatchObject({ fundsReceived: 0, hasLimitOverrunConsent: true });
      expect((await loadOrderContext(tx, o.orderId))?.order.id).toBe(o.orderId);
    });
  });
});
