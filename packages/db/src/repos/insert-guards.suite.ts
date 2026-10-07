import { bp, sum } from "@nivel/domain/money";
import { taxRiskReserve, WARRANTY_RESERVE, warrantyReserveContribution } from "@nivel/domain/reserve";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectAs,
  createOrder,
  createVendor,
  driveTo,
  insertPurchase,
  one,
  pgError,
  type Role,
  receiveFunds,
} from "./testkit.ts";

// The final review of WP-00, reproduced under the real roles on a clone of the test database. A column grant forbids the
// UPDATE of a value, but an INSERT writes it, and the guards looked at the UPDATE only:
//  (1) the site (and the admin panel) wrote ai.conversations with purge_after = '2999-01-01', so the promise of DATA-MAP
//      "the site does not extend the retention of a dialogue" held for UPDATE alone;
//  (2) the worker wrote sales.reserve_ledger with any sum and any time (five years back).
// The database now sets the term and the time itself, and the worker books only what an order of the journal may owe.
const CHECK = "23514";
const DENIED = "42501";
const NO_DATA = "P0002";

const clients = {} as Record<Role, pg.Client>;
let vendorId: string;

beforeAll(async () => {
  for (const role of ["MIGRATOR", "WEB", "ADMIN", "BOT", "WORKER"] as const) clients[role] = await connectAs(role);
  vendorId = await createVendor(clients.MIGRATOR);
});
afterAll(async () => {
  for (const c of Object.values(clients)) await c.end();
});

const migrator = () => clients.MIGRATOR;
const worker = () => clients.WORKER;
const admin = () => clients.ADMIN;

/** The clock of the database as text: a moment before and one after a statement frame the time it wrote. */
const dbNow = async () => (await one<{ t: string }>(migrator(), "select clock_timestamp()::text as t")).t;

// ---- (1) ai.conversations -------------------------------------------------------------------------------------------

/** The application roles that may INSERT into the table at all: whoever it is (now or after a later grant) is bound. */
async function writersOf(table: string): Promise<Role[]> {
  const found: Role[] = [];
  for (const role of ["WEB", "ADMIN", "BOT", "WORKER"] as const) {
    const r = await one<{ ok: boolean }>(migrator(), "select has_table_privilege($1, $2, 'INSERT') as ok", [
      `nivel_${role.toLowerCase()}`,
      table,
    ]);
    if (r.ok) found.push(role);
  }
  return found;
}

const INSERT_CONVERSATION =
  "insert into ai.conversations (channel, lang, model, purge_after) values ('web', 'uz', 'm', $1) returning id";

/** True when the term of the conversation is 90 days after a moment of the database clock between `from` and `to`. */
async function termIsNinetyDays(id: string, from: string, to: string): Promise<boolean> {
  const r = await one<{ ok: boolean }>(
    migrator(),
    `select purge_after between $2::timestamptz + interval '90 days' and $3::timestamptz + interval '90 days' as ok
       from ai.conversations where id = $1`,
    [id, from, to],
  );
  return r.ok;
}

describe("ai.conversations: the term of the retention is the database's, at INSERT too", () => {
  it("is written by the site and by the admin panel only (the bot and the worker have no right to the table)", async () => {
    expect(await writersOf("ai.conversations")).toEqual(["WEB", "ADMIN"]);
  });

  it.each([
    ["a date far in the future", "2999-01-01"],
    ["infinity", "infinity"],
    ["a date in the past (the term cannot be shortened either)", "2020-01-01"],
    ["nothing (an explicit NULL)", null],
  ])("every application role that may insert gets 90 days from now, whatever it sends: %s", async (_name, value) => {
    for (const role of await writersOf("ai.conversations")) {
      const from = await dbNow();
      const row = await one<{ id: string }>(clients[role], INSERT_CONVERSATION, [value]);
      const to = await dbNow();
      expect(await termIsNinetyDays(row.id, from, to), role).toBe(true);
    }
  });

  it("gives the default term to a conversation that names none, as before", async () => {
    for (const role of await writersOf("ai.conversations")) {
      const from = await dbNow();
      const row = await one<{ id: string }>(
        clients[role],
        "insert into ai.conversations (channel, lang, model) values ('web', 'ru', 'm') returning id",
      );
      expect(await termIsNinetyDays(row.id, from, await dbNow()), role).toBe(true);
    }
  });

  it("sets the term of every row of a multi-row INSERT", async () => {
    const from = await dbNow();
    const { rows } = await clients.WEB.query<{ id: string }>(
      `insert into ai.conversations (channel, lang, model, purge_after)
       values ('web', 'uz', 'm', '2999-01-01'), ('web', 'ru', 'm', 'infinity'), ('web', 'uz', 'm', '2001-01-01') returning id`,
    );
    const to = await dbNow();
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(await termIsNinetyDays(r.id, from, to)).toBe(true);
  });

  it("does not let the site take the term through the conflict path of an INSERT either: it has no UPDATE right on the column", async () => {
    const row = await one<{ id: string }>(clients.WEB, INSERT_CONVERSATION, [null]);
    const e = await pgError(
      clients.WEB,
      `insert into ai.conversations (id, channel, lang, model, purge_after) values ($1, 'web', 'uz', 'm', '2999-01-01')
       on conflict (id) do update set purge_after = excluded.purge_after`,
      [row.id],
    );
    expect(e.code).toBe(DENIED);
  });

  it("does not bind the migrator: an import or a repair writes the term it needs", async () => {
    const row = await one<{ id: string }>(migrator(), INSERT_CONVERSATION, ["2020-01-01"]);
    const kept = await one<{ ok: boolean }>(
      migrator(),
      "select purge_after = '2020-01-01' as ok from ai.conversations where id = $1",
      [row.id],
    );
    expect(kept.ok).toBe(true);
  });

  it("still lets the owner's panel extend the term of one conversation by UPDATE (a dispute), as DATA-MAP says", async () => {
    const row = await one<{ id: string }>(admin(), INSERT_CONVERSATION, [null]);
    await admin().query("update ai.conversations set purge_after = '2999-01-01' where id = $1", [row.id]);
    const kept = await one<{ ok: boolean }>(
      migrator(),
      "select purge_after = '2999-01-01' as ok from ai.conversations where id = $1",
      [row.id],
    );
    expect(kept.ok).toBe(true);
  });
});

// ---- (2) sales.reserve_ledger ----------------------------------------------------------------------------------------

/** An order with `receipts` of purchases that went through the real transitions up to `status` (as the migrator). */
async function orderAt(status: string, receipts: number): Promise<string> {
  const o = await createOrder(migrator(), { purchaseLimit: Math.max(receipts, 1_000_000) });
  if (receipts > 0) {
    // The money received equals the purchases: the order can be closed.
    await receiveFunds(migrator(), o.orderId, receipts);
    await insertPurchase(migrator(), { orderId: o.orderId, vendorId, amount: receipts });
  }
  await driveTo(migrator(), o.orderId, status);
  return o.orderId;
}

const LEDGER = `insert into sales.reserve_ledger (fund, order_id, amount_sum, reason, at)
                values ($1, $2, $3, 'contribution', coalesce($4::timestamptz, now())) returning id`;
const book = (c: pg.Client, fund: string, orderId: string | null, amount: number, at: string | null = null) =>
  c.query<{ id: string }>(LEDGER, [fund, orderId, amount, at]);
const bookError = (c: pg.Client, fund: string, orderId: string | null, amount: number, at: string | null = null) =>
  pgError(c, LEDGER, [fund, orderId, amount, at]);
const booked = async (orderId: string, fund: string) =>
  Number(
    (
      await one<{ s: string }>(
        migrator(),
        "select coalesce(sum(amount_sum), 0)::text as s from sales.reserve_ledger where order_id = $1 and fund = $2",
        [orderId, fund],
      )
    ).s,
  );

/** The fund of a young business: the domain's contribution is the highest it can be (2 %, at least 150 000). */
const YOUNG = { balance: sum(0), closedOrders: 0, lossesLast12mBp: bp(0) };
/** The mature fund pays 1 %: never more than the young one. */
const MATURE = {
  balance: sum(WARRANTY_RESERVE.matureBalance),
  closedOrders: WARRANTY_RESERVE.matureOrders,
  lossesLast12mBp: bp(0),
};

describe("sales.reserve_ledger: the worker books the time of the database and no more than an order may owe", () => {
  it("writes only the worker and the admin panel (the site and the bot have no right to the table)", async () => {
    expect(await writersOf("sales.reserve_ledger")).toEqual(["ADMIN", "WORKER"]);
  });

  it.each([
    ["five years back", "2021-10-07T00:00:00Z"],
    ["five years ahead", "2031-10-07T00:00:00Z"],
    ["infinity", "infinity"],
    ["minus infinity", "-infinity"],
  ])("stamps the entry with the clock of the database, whatever `at` says: %s", async (_name, at) => {
    const orderId = await orderAt("handed_over", 7_500_000);
    const from = await dbNow();
    const row = await book(worker(), "warranty", orderId, 1000, at);
    const to = await dbNow();
    const id = row.rows[0]?.id;
    const stamped = await one<{ ok: boolean }>(
      migrator(),
      "select at between $2::timestamptz and $3::timestamptz as ok from sales.reserve_ledger where id = $1",
      [id, from, to],
    );
    expect(stamped.ok).toBe(true);
  });

  it("stamps the entry that names no time the same way", async () => {
    const orderId = await orderAt("handed_over", 7_500_000);
    const from = await dbNow();
    const row = await worker().query<{ id: string }>(
      "insert into sales.reserve_ledger (fund, order_id, amount_sum, reason) values ('tax_risk', $1, 500, 'contribution') returning id",
      [orderId],
    );
    const stamped = await one<{ ok: boolean }>(
      migrator(),
      "select at between $2::timestamptz and $3::timestamptz as ok from sales.reserve_ledger where id = $1",
      [row.rows[0]?.id, from, await dbNow()],
    );
    expect(stamped.ok).toBe(true);
  });

  it.each([1, 99, 100, 101, 7_499_999, 7_500_000, 7_500_001, 10_000_000, 123_456_789])(
    "receipts %i: the worker may book what the domain computes for a young fund and not one sum more, in either fund",
    async (receipts) => {
      const orderId = await orderAt("handed_over", receipts);
      const due = {
        warranty: warrantyReserveContribution(sum(receipts), YOUNG),
        tax_risk: taxRiskReserve(sum(receipts), true),
      };
      // The mature fund pays less and never more, so the cap above holds for every state of the fund.
      expect(warrantyReserveContribution(sum(receipts), MATURE)).toBeLessThanOrEqual(due.warranty);
      for (const fund of ["warranty", "tax_risk"] as const) {
        await book(worker(), fund, orderId, due[fund]);
        const e = await bookError(worker(), fund, orderId, 1);
        expect(e.code, fund).toBe(CHECK);
        expect(e.message, fund).toMatch(/^reserve_exceeded:/);
        expect(await booked(orderId, fund), fund).toBe(due[fund]);
      }
    },
  );

  it("takes the contribution of a mature fund too (it is lower than the cap)", async () => {
    const orderId = await orderAt("handed_over", 10_000_000);
    const mature = warrantyReserveContribution(sum(10_000_000), MATURE);
    expect(mature).toBe(100_000);
    await book(worker(), "warranty", orderId, mature);
  });

  it("refuses a sum above the cap in one entry, with nothing written", async () => {
    const orderId = await orderAt("handed_over", 7_500_000);
    const e = await bookError(worker(), "warranty", orderId, 5_000_000_000);
    expect(e.code).toBe(CHECK);
    expect(e.message).toMatch(/^reserve_exceeded:/);
    expect(await booked(orderId, "warranty")).toBe(0);
  });

  it("counts what is already booked: two entries together stay within the cap, and a retried job cannot book twice", async () => {
    const orderId = await orderAt("handed_over", 7_500_000); // the cap of the warranty fund is 150 000
    await book(worker(), "warranty", orderId, 100_000);
    const over = await bookError(worker(), "warranty", orderId, 50_001);
    expect(over.message).toMatch(/^reserve_exceeded:/);
    await book(worker(), "warranty", orderId, 50_000);
    const again = await bookError(worker(), "warranty", orderId, 1);
    expect(again.message).toMatch(/^reserve_exceeded:/);
    // The other fund of the same order has its own cap (75 000).
    await book(worker(), "tax_risk", orderId, 75_000);
    expect(await booked(orderId, "warranty")).toBe(150_000);
    expect(await booked(orderId, "tax_risk")).toBe(75_000);
  });

  it("counts the rows of one INSERT as well: two entries that are within the cap one by one and not together are refused", async () => {
    const orderId = await orderAt("handed_over", 7_500_000);
    const e = await pgError(
      worker(),
      `insert into sales.reserve_ledger (fund, order_id, amount_sum, reason)
       values ('warranty', $1, 100000, 'a'), ('warranty', $1, 100000, 'b')`,
      [orderId],
    );
    expect(e.message).toMatch(/^reserve_exceeded:/);
    expect(await booked(orderId, "warranty")).toBe(0);
  });

  it("cannot rewrite a booked entry through the conflict path of an INSERT: no UPDATE right, and the journal is append-only", async () => {
    const orderId = await orderAt("handed_over", 7_500_000);
    const row = await book(worker(), "warranty", orderId, 1000);
    const e = await pgError(
      worker(),
      `insert into sales.reserve_ledger (id, fund, order_id, amount_sum, reason)
       values ($1, 'warranty', $2, 150000, 'x') on conflict (id) do update set amount_sum = excluded.amount_sum`,
      [row.rows[0]?.id, orderId],
    );
    expect(e.code).toBe(DENIED);
    expect(await booked(orderId, "warranty")).toBe(1000);
  });

  it("frees the amount again once the owner has reversed the entry (the correction of a journal is a reversing row)", async () => {
    const orderId = await orderAt("handed_over", 7_500_000);
    await book(worker(), "warranty", orderId, 150_000);
    await book(admin(), "warranty", orderId, -150_000);
    await book(worker(), "warranty", orderId, 150_000);
    expect(await booked(orderId, "warranty")).toBe(150_000);
  });

  it("serialises two writers of one order: together they cannot book more than one may", async () => {
    const second = await connectAs("WORKER");
    try {
      const orderId = await orderAt("handed_over", 7_500_000); // the cap of the warranty fund is 150 000
      await worker().query("begin");
      await second.query("begin");
      try {
        await book(worker(), "warranty", orderId, 100_000);
        // The second writer looks at the same order and fund: it must wait for the first, then see its entry.
        const outcome = book(second, "warranty", orderId, 100_000).then(
          () => "booked" as const,
          (e: unknown) => e as pg.DatabaseError,
        );
        const waiting = async () => {
          for (let i = 0; i < 100; i++) {
            const r = await one<{ n: string }>(
              migrator(),
              "select count(*)::text as n from pg_locks where locktype = 'advisory' and not granted",
            );
            if (Number(r.n) > 0) return true;
            await new Promise((ok) => setTimeout(ok, 50));
          }
          return false;
        };
        const blocked = await Promise.race([waiting(), outcome.then(() => false)]);
        expect(blocked, "the second writer waits for the lock of the first").toBe(true);
        await worker().query("commit");
        const result = await outcome;
        expect(result).not.toBe("booked");
        expect((result as pg.DatabaseError).message).toMatch(/^reserve_exceeded:/);
      } finally {
        await worker()
          .query("rollback")
          .catch(() => undefined);
        await second.query("rollback").catch(() => undefined);
      }
      expect(await booked(orderId, "warranty")).toBe(100_000);
    } finally {
      await second.end();
    }
  });

  it.each([-1000, -1, 0])(
    "books contributions only: the sum %i is refused (spending and reversals are the owner's)",
    async (amount) => {
      const orderId = await orderAt("handed_over", 7_500_000);
      const e = await bookError(worker(), "warranty", orderId, amount);
      expect(e.code).toBe(CHECK);
      expect(await booked(orderId, "warranty")).toBe(0);
    },
  );

  it("books for an order only: an entry with no order or with an unknown one is refused", async () => {
    const none = await bookError(worker(), "warranty", null, 1000);
    expect(none.code).toBe(CHECK);
    expect(none.message).toMatch(/^invalid_reserve:/);
    const unknown = await bookError(worker(), "warranty", "00000000-0000-4000-8000-000000000000", 1000);
    expect(unknown.code).toBe(NO_DATA);
    expect(unknown.message).toMatch(/^order_not_found:/);
  });

  it("refuses a fund that is not one", async () => {
    const orderId = await orderAt("handed_over", 7_500_000);
    expect((await bookError(worker(), "slush", orderId, 1000)).code).toBe(CHECK);
  });

  // The domain books the tax-risk reserve when the order is settled (REMAINDER_SETTLED) and the warranty reserve at the
  // handover (HANDOVER); the worker books after the commit, so an order that has gone on (or been cancelled) still owes it.
  it.each([
    ["estimate_draft", "warranty", false],
    ["estimate_draft", "tax_risk", false],
    ["report_sent", "tax_risk", false],
    ["settled", "tax_risk", true],
    ["settled", "warranty", false],
    ["delivering", "warranty", false],
    ["delivering", "tax_risk", true],
    ["handed_over", "warranty", true],
    ["handed_over", "tax_risk", true],
    ["closed", "warranty", true],
    ["closed", "tax_risk", true],
  ])("an order at %s: the %s reserve is booked %s", async (status, fund, allowed) => {
    const orderId = await orderAt(status, 7_500_000);
    if (allowed) {
      await book(worker(), fund, orderId, 1000);
      expect(await booked(orderId, fund)).toBe(1000);
    } else {
      const e = await bookError(worker(), fund, orderId, 1000);
      expect(e.code).toBe(CHECK);
      expect(e.message).toMatch(/^reserve_not_due:/);
      expect(await booked(orderId, fund)).toBe(0);
    }
  });

  it("books nothing for an order without receipts (the domain writes no zero and no minimum there)", async () => {
    const orderId = await orderAt("handed_over", 0);
    for (const fund of ["warranty", "tax_risk"] as const) {
      const e = await bookError(worker(), fund, orderId, 1);
      expect(e.message, fund).toMatch(/^reserve_exceeded:/);
    }
  });

  describe("the tax-risk reserve runs until the tax authority answers (ops.settings money.tax_risk_active)", () => {
    const KEY = "money.tax_risk_active";
    const setFlag = (value: boolean | null) =>
      value === null
        ? migrator().query("delete from ops.settings where key = $1", [KEY])
        : migrator().query(
            `insert into ops.settings (key, value) values ($1, $2::jsonb)
             on conflict (key) do update set value = excluded.value`,
            [KEY, JSON.stringify(value)],
          );
    const restore = () => setFlag(null);

    it("takes the reserve when the flag is on or was never set (the default of the domain is on)", async () => {
      const orderId = await orderAt("handed_over", 7_500_000);
      try {
        await setFlag(null);
        await book(worker(), "tax_risk", orderId, 10_000);
        await setFlag(true);
        await book(worker(), "tax_risk", orderId, 10_000);
      } finally {
        await restore();
      }
    });

    it("books no tax-risk reserve once the owner has switched it off, and leaves the warranty fund alone", async () => {
      const orderId = await orderAt("handed_over", 7_500_000);
      try {
        await setFlag(false);
        expect(taxRiskReserve(sum(7_500_000), false)).toBe(0);
        const e = await bookError(worker(), "tax_risk", orderId, 1);
        expect(e.message).toMatch(/^reserve_exceeded:/);
        await book(worker(), "warranty", orderId, 150_000);
      } finally {
        await restore();
      }
    });
  });

  it("does not bind the owner's panel and the migrator: a spending, an entry with no order, its own time", async () => {
    const from = "2020-01-01T00:00:00Z";
    const spent = await book(admin(), "warranty", null, -40_000, from);
    const kept = await one<{ ok: boolean }>(
      migrator(),
      "select at = $2::timestamptz as ok from sales.reserve_ledger where id = $1",
      [spent.rows[0]?.id, from],
    );
    expect(kept.ok).toBe(true);
    await book(migrator(), "tax_risk", null, 1_000_000, from);
  });
});
