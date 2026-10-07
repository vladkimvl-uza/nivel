import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.ts";
import { DbRuleError } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { purgeExpiredFiles, purgeExpiredFilesAndRemoveBytes } from "./ops.ts";
import {
  bindLeadCustomer,
  createLead,
  expectPaymentAsRole,
  purgeExpiredLeads,
  signActByButton,
  warrantyFundState,
} from "./sales.ts";
import { connectAs, createOrder, insertAct, insertFile, one, openDb, uniq } from "./testkit.ts";

// The repositories of the functions added for the bot, the site and the worker (WP-00), run in the sessions of the roles
// that call them: a repository that needs a right its role does not have would roll back the transaction of its scenario.
const dbs = {} as Record<"WEB" | "BOT" | "WORKER" | "ADMIN", Db>;

beforeAll(() => {
  for (const role of ["WEB", "BOT", "WORKER", "ADMIN"] as const) dbs[role] = openDb(role);
});
afterAll(async () => {
  for (const d of Object.values(dbs)) await d.$client.end();
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

async function fixture() {
  const m = await connectAs("MIGRATOR");
  try {
    const o = await createOrder(m);
    const actId = await insertAct(m, o.orderId);
    const c = await one<{ telegram_user_id: string }>(
      m,
      "select telegram_user_id::text from sales.customers where id = $1",
      [o.customerId],
    );
    return { ...o, actId, telegramId: Number(c.telegram_user_id) };
  } finally {
    await m.end();
  }
}

describe.each(["WORKER", "BOT"] as const)("expectPaymentAsRole as %s", (role) => {
  it("writes the expectation and tells a repeat from a first call", async () => {
    const o = await fixture();
    const first = await asRole(role, (tx) =>
      expectPaymentAsRole(tx, { orderId: o.orderId, kind: "fee_advance", amountSum: 450_000 }),
    );
    expect(first.duplicate).toBe(false);
    const again = await asRole(role, (tx) =>
      expectPaymentAsRole(tx, { orderId: o.orderId, kind: "fee_advance", amountSum: 450_000 }),
    );
    expect(again).toEqual({ id: first.id, duplicate: true });
  });

  it("names the method and the payer when the caller does", async () => {
    const o = await fixture();
    const r = await asRole(role, (tx) =>
      expectPaymentAsRole(tx, {
        orderId: o.orderId,
        kind: "fee_extra",
        amountSum: 100_000,
        method: "merchant_card",
        payerIsCustomer: false,
      }),
    );
    const m = await connectAs("MIGRATOR");
    try {
      expect(await one(m, "select method, payer_is_customer from sales.payments where id = $1", [r.id])).toEqual({
        method: "merchant_card",
        payer_is_customer: false,
      });
    } finally {
      await m.end();
    }
  });

  it("turns a refusal of the database into DbRuleError with the key of the rule", async () => {
    const o = await fixture();
    await expect(
      asRole(role, (tx) => expectPaymentAsRole(tx, { orderId: o.orderId, kind: "fee_advance", amountSum: 0 })),
    ).rejects.toMatchObject({ code: "invalid_payment" });
    await expect(
      asRole(role, (tx) =>
        expectPaymentAsRole(tx, { orderId: o.orderId, kind: "fee_advance", amountSum: 1, method: "bank_transfer_ip" }),
      ),
    ).rejects.toBeInstanceOf(DbRuleError);
    await expect(
      asRole(role, (tx) =>
        expectPaymentAsRole(tx, { orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", kind: "fee_advance", amountSum: 1 }),
      ),
    ).rejects.toMatchObject({ code: "order_not_found" });
  });
});

describe("expectPaymentAsRole as the site", () => {
  it("is refused with a permission error: the site queues a job instead", async () => {
    const o = await fixture();
    await expect(
      asRole("WEB", (tx) => expectPaymentAsRole(tx, { orderId: o.orderId, kind: "fee_advance", amountSum: 1000 })),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });
});

describe("signActByButton as the bot", () => {
  it("signs for the customer of the order and answers the time", async () => {
    const o = await fixture();
    const at = await asRole("BOT", (tx) =>
      signActByButton(tx, { actId: o.actId, messageId: 91, telegramUserId: o.telegramId }),
    );
    expect(at).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - at.getTime())).toBeLessThan(60_000);
  });

  it("raises DbRuleError for the press of another person and for a second press", async () => {
    const o = await fixture();
    await expect(
      asRole("BOT", (tx) => signActByButton(tx, { actId: o.actId, messageId: 1, telegramUserId: o.telegramId + 1 })),
    ).rejects.toMatchObject({ code: "evidence_mismatch" });
    await asRole("BOT", (tx) => signActByButton(tx, { actId: o.actId, messageId: 2, telegramUserId: o.telegramId }));
    await expect(
      asRole("BOT", (tx) => signActByButton(tx, { actId: o.actId, messageId: 3, telegramUserId: o.telegramId })),
    ).rejects.toMatchObject({ code: "act_already_signed" });
    await expect(
      asRole("BOT", (tx) =>
        signActByButton(tx, { actId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", messageId: 3, telegramUserId: 1 }),
      ),
    ).rejects.toMatchObject({ code: "act_not_found" });
    await expect(
      asRole("BOT", (tx) => signActByButton(tx, { actId: o.actId, messageId: 0, telegramUserId: o.telegramId })),
    ).rejects.toMatchObject({ code: "invalid_evidence" });
  });

  it("is refused to the other roles", async () => {
    const o = await fixture();
    for (const role of ["WEB", "WORKER", "ADMIN"] as const) {
      await expect(
        asRole(role, (tx) => signActByButton(tx, { actId: o.actId, messageId: 1, telegramUserId: o.telegramId })),
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
  });
});

describe.each(["WEB", "BOT", "WORKER", "ADMIN"] as const)("warrantyFundState as %s", (role) => {
  it("reads the four aggregates as numbers", async () => {
    const s = await asRole(role, (tx) => warrantyFundState(tx));
    expect(Object.keys(s).sort()).toEqual(["balance", "closedOrders", "lossesLast12m", "purchasedLast12m"]);
    for (const v of Object.values(s)) expect(Number.isSafeInteger(v)).toBe(true);
  });

  it("is the same for every role; the admin panel and the worker honour the moment, the site and the bot read the present", async () => {
    const now = await asRole(role, (tx) => warrantyFundState(tx));
    const m = await asRole("ADMIN", (tx) => warrantyFundState(tx));
    expect(now).toEqual(m);
    const old = await asRole(role, (tx) => warrantyFundState(tx, new Date("2001-01-01T00:00:00Z")));
    expect(old).toEqual(
      role === "WEB" || role === "BOT" ? now : { balance: 0, closedOrders: 0, lossesLast12m: 0, purchasedLast12m: 0 },
    );
  });
});

describe.each(["WORKER", "ADMIN"] as const)("the retention functions as %s", (role) => {
  it("purgeExpiredLeads returns the number and takes the moment", async () => {
    await asRole(role, (tx) => purgeExpiredLeads(tx));
    const m = await connectAs("MIGRATOR");
    let id: string;
    try {
      const c = await one<{ id: string }>(
        m,
        "insert into sales.customers (display_name, created_at) values ('Old person', now() - interval '14 months') returning id",
      );
      id = c.id;
      await m.query(
        "insert into sales.leads (number, customer_id, channel, scope, created_at) values ($1, $2, 'web', 'pc', now() - interval '13 months')",
        [`L-2995-${String(uniq()).padStart(4, "0")}`, id],
      );
    } finally {
      await m.end();
    }
    expect(await asRole(role, (tx) => purgeExpiredLeads(tx, new Date("2001-01-01T00:00:00Z")))).toBe(0);
    expect(await asRole(role, (tx) => purgeExpiredLeads(tx))).toBe(1);
    expect(await asRole(role, (tx) => purgeExpiredLeads(tx))).toBe(0);
  });

  it("purgeExpiredFiles returns the storage keys", async () => {
    await asRole(role, (tx) => purgeExpiredFiles(tx));
    const m = await connectAs("MIGRATOR");
    let old: { storageKey: string };
    try {
      old = await insertFile(m, { retention: "ai_90d", age: "100 days" });
    } finally {
      await m.end();
    }
    expect(await asRole(role, (tx) => purgeExpiredFiles(tx, new Date("2001-01-01T00:00:00Z")))).toEqual([]);
    expect(await asRole(role, (tx) => purgeExpiredFiles(tx))).toEqual([old.storageKey]);
    expect(await asRole(role, (tx) => purgeExpiredFiles(tx))).toEqual([]);
  });
});

describe.each(["WORKER", "ADMIN"] as const)("purgeExpiredFilesAndRemoveBytes as %s", (role) => {
  const seed = async (n: number) => {
    const m = await connectAs("MIGRATOR");
    try {
      const out: { id: string; storageKey: string }[] = [];
      for (let i = 0; i < n; i += 1) out.push(await insertFile(m, { retention: "ai_90d", age: "100 days" }));
      return out;
    } finally {
      await m.end();
    }
  };
  const left = async (ids: string[]) => {
    const m = await connectAs("MIGRATOR");
    try {
      return Number(
        (await one<{ n: string }>(m, "select count(*)::text as n from ops.files where id = any ($1::uuid[])", [ids])).n,
      );
    } finally {
      await m.end();
    }
  };

  it("removes the bytes of every key before the rows are committed, and answers the keys", async () => {
    await purgeExpiredFiles(dbs[role]);
    const files = await seed(3);
    const removed: string[] = [];
    const keys = await purgeExpiredFilesAndRemoveBytes(dbs[role], async (k) => {
      // At this moment the rows are gone only inside the transaction of the caller.
      expect(await left(files.map((f) => f.id))).toBe(3);
      removed.push(k);
    });
    expect(keys).toEqual(files.map((f) => f.storageKey).sort());
    expect(removed.sort()).toEqual(keys);
    expect(await left(files.map((f) => f.id))).toBe(0);
  });

  it("keeps every row when the bytes of one key cannot be removed: no key is lost, the next run does it again", async () => {
    await purgeExpiredFiles(dbs[role]);
    const files = await seed(3);
    const failing = files[1]?.storageKey;
    await expect(
      purgeExpiredFilesAndRemoveBytes(dbs[role], async (k) => {
        if (k === failing) throw new Error("disk busy");
      }),
    ).rejects.toThrow("disk busy");
    expect(await left(files.map((f) => f.id))).toBe(3);
    const again = await purgeExpiredFilesAndRemoveBytes(dbs[role], async () => undefined);
    expect(again).toEqual(files.map((f) => f.storageKey).sort());
    expect(await left(files.map((f) => f.id))).toBe(0);
  });

  it("does nothing, and calls nothing, when no file is due", async () => {
    await purgeExpiredFiles(dbs[role]);
    let calls = 0;
    const removeBytes = async () => {
      calls += 1;
    };
    expect(await purgeExpiredFilesAndRemoveBytes(dbs[role], removeBytes)).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("the retention functions are not for the site and the bot", () => {
  it.each(["WEB", "BOT"] as const)("%s gets a permission error", async (role) => {
    await expect(asRole(role, (tx) => purgeExpiredLeads(tx))).rejects.toMatchObject({ code: "permission_denied" });
    await expect(asRole(role, (tx) => purgeExpiredFiles(tx))).rejects.toMatchObject({ code: "permission_denied" });
  });
});

describe("bindLeadCustomer", () => {
  it("sets the customer of a request without one, for the admin panel only, and says whether it did", async () => {
    const o = await fixture();
    const lead = await asRole("WEB", (tx) =>
      createLead(tx, { channel: "web", scope: "pc", contactPhone: "+998901234567" }),
    );
    expect(await asRole("ADMIN", (tx) => bindLeadCustomer(tx, lead.id, o.customerId))).toBe(true);
    // The same customer again: nothing to do.
    expect(await asRole("ADMIN", (tx) => bindLeadCustomer(tx, lead.id, o.customerId))).toBe(false);
  });

  it("raises DbRuleError for another customer, and a permission error for the bot", async () => {
    const a = await fixture();
    const b = await fixture();
    const lead = await asRole("BOT", (tx) => createLead(tx, { channel: "bot", scope: "pc", contactName: "Aziz" }));
    await expect(asRole("BOT", (tx) => bindLeadCustomer(tx, lead.id, a.customerId))).rejects.toMatchObject({
      code: "actor_not_allowed",
    });
    await asRole("ADMIN", (tx) => bindLeadCustomer(tx, lead.id, a.customerId));
    await expect(asRole("ADMIN", (tx) => bindLeadCustomer(tx, lead.id, b.customerId))).rejects.toMatchObject({
      code: "immutable",
    });
  });

  it("says nothing was bound when the request does not exist", async () => {
    const o = await fixture();
    expect(
      await asRole("ADMIN", (tx) => bindLeadCustomer(tx, "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", o.customerId)),
    ).toBe(false);
  });
});
