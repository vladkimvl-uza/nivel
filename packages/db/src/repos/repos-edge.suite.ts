import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../client.ts";
import { addConversationUsage, addDailyUsage } from "./ai.ts";
import { subscribe } from "./bot.ts";
import { publishLegalDocument, revokeIdeaPermission } from "./content.ts";
import { claimOutbox, enqueueOutbox, getSetting, markOutboxSent, recordConsent, setSetting } from "./ops.ts";
import { excludeObservation, restoreObservation } from "./pricing.ts";
import {
  confirmPayment,
  expectPayment,
  markQuoteAccepted,
  markQuoteSent,
  reversePayment,
  setLeadStatus,
  setQuoteStatus,
  voidPayment,
} from "./sales.ts";
import { connectAs, createOrder, openDb, uniq } from "./testkit.ts";

// Edge cases of the repository functions: a wrong id is an error and not a silent success; counters and links are
// not lost on a repeated write; concurrent writers cannot overwrite each other.
let db: Db;
let order: { orderId: string; customerId: string };

beforeAll(async () => {
  db = openDb("ADMIN");
  const m = await connectAs("MIGRATOR");
  try {
    order = await createOrder(m);
  } finally {
    await m.end();
  }
});
afterAll(async () => {
  await db.$client.end();
});

const MISSING = "00000000-0000-7000-8000-0000000000aa";

describe("an update of an unknown id is an error", () => {
  const CASES: [string, () => Promise<unknown>][] = [
    ["voidPayment", () => voidPayment(db, MISSING)],
    ["markQuoteSent", () => markQuoteSent(db, MISSING, { checkedBy: MISSING })],
    ["markQuoteAccepted", () => markQuoteAccepted(db, MISSING, {})],
    ["setQuoteStatus", () => setQuoteStatus(db, MISSING, "expired")],
    ["setLeadStatus", () => setLeadStatus(db, MISSING, "spam")],
    ["publishLegalDocument", () => publishLegalDocument(db, MISSING, "2026-10-06")],
    ["revokeIdeaPermission", () => revokeIdeaPermission(db, MISSING)],
    ["excludeObservation", () => excludeObservation(db, MISSING, "manual")],
    ["restoreObservation", () => restoreObservation(db, MISSING)],
    ["markOutboxSent", () => markOutboxSent(db, MISSING)],
    ["addConversationUsage", () => addConversationUsage(db, MISSING, { costMicroUsd: 1 })],
    ["reversePayment", () => reversePayment(db, MISSING, { by: "x" })],
  ];
  it.each(CASES)("%s", async (_name, run) => {
    await expect(run()).rejects.toThrow(/not found/);
  });
});

describe("payments are reversed once", () => {
  const pay = async (amount: number) => {
    const id = await expectPayment(db, {
      orderId: order.orderId,
      kind: "purchase_funds",
      direction: "in",
      method: "bank_transfer_ip",
      amountSum: amount,
    });
    await confirmPayment(db, id, { by: "owner", bankDocNo: `PP-${uniq()}` });
    return id;
  };

  it("reads the original from the database, refuses a repeat and reverses a part when asked", async () => {
    const whole = await pay(2_000_000);
    await reversePayment(db, whole, { by: "owner", bankDocNo: "PP-R1" });
    await expect(reversePayment(db, whole, { by: "owner", bankDocNo: "PP-R2" })).rejects.toMatchObject({
      code: "invalid_reversal",
    });
    const part = await pay(1_000_000);
    await reversePayment(db, part, { by: "owner", amountSum: 400_000 });
    await expect(reversePayment(db, part, { by: "owner", amountSum: 700_000 })).rejects.toMatchObject({
      code: "invalid_reversal",
    });
    await reversePayment(db, part, { by: "owner", amountSum: 600_000 });
    const net = await db.$client.query<{ s: string }>(
      "select sum(amount_sum)::text as s from sales.payments where id in ($1, $2) or reversal_of in ($1, $2)",
      [whole, part],
    );
    expect(net.rows[0]?.s).toBe("0");
  });

  it("refuses a reversal of an unconfirmed payment", async () => {
    const id = await expectPayment(db, {
      orderId: order.orderId,
      kind: "purchase_funds",
      direction: "in",
      method: "bank_transfer_ip",
      amountSum: 500_000,
    });
    await expect(reversePayment(db, id, { by: "owner" })).rejects.toMatchObject({ code: "invalid_reversal" });
  });
});

describe("settings changed at the same time", () => {
  it("lets exactly one of two writers with the same expected version win", async () => {
    const key = `ops.test.race.${uniq()}`;
    await setSetting(db, key, "a", "owner");
    const results = await Promise.allSettled([
      setSetting(db, key, "b", "writer-1", { expectedVersion: 1 }),
      setSetting(db, key, "c", "writer-2", { expectedVersion: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "stale_status" } });
    expect((await getSetting(db, key))?.version).toBe(2);
  });

  it("lets exactly one of two first writers of a new key win", async () => {
    const key = `ops.test.race-new.${uniq()}`;
    const results = await Promise.allSettled([
      setSetting(db, key, "b", "writer-1", { expectedVersion: 0 }),
      setSetting(db, key, "c", "writer-2", { expectedVersion: 0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "stale_status" } });
  });

  it("journals the value the winner replaced, not a stale read", async () => {
    const key = `ops.test.journal.${uniq()}`;
    await setSetting(db, key, 1, "owner");
    await setSetting(db, key, 2, "owner", { expectedVersion: 1 });
    const { rows } = await db.$client.query<{ before: unknown; after: unknown }>(
      "select before, after from ops.audit_log where entity_id = $1 order by at, id",
      [key],
    );
    expect(rows.map((r) => [r.before, r.after])).toEqual([
      [null, 1],
      [1, 2],
    ]);
  });
});

describe("counters and links survive a repeated write", () => {
  it("adds the tokens of a day and a model on every call", async () => {
    const day = "2037-02-03";
    await addDailyUsage(db, { day, model: "m", costMicroUsd: 10, tokens: { input: 100, output: 20 } });
    await addDailyUsage(db, { day, model: "m", costMicroUsd: 5, tokens: { input: 50, cached: 7 } });
    await addDailyUsage(db, { day, model: "m", costMicroUsd: 1 });
    const { rows } = await db.$client.query<{ tokens: Record<string, number>; cost: string }>(
      "select tokens, cost_micro_usd::text as cost from ai.usage_daily where day = $1 and model = 'm'",
      [day],
    );
    expect(rows[0]).toEqual({ tokens: { input: 150, output: 20, cached: 7 }, cost: "16" });
  });

  it("keeps the consent of a subscription when the person subscribes again without one", async () => {
    const tg = 7_300_000_000 + uniq();
    const consent = await recordConsent(db, {
      customerId: order.customerId,
      kind: "marketing",
      granted: true,
      channel: "test",
    });
    await subscribe(db, tg, "news", consent);
    await subscribe(db, tg, "news");
    const { rows } = await db.$client.query<{ consent_id: string | null }>(
      "select consent_id from bot.subscriptions where telegram_user_id = $1 and topic = 'news'",
      [tg],
    );
    expect(rows[0]?.consent_id).toBe(consent);
    const other = await recordConsent(db, {
      customerId: order.customerId,
      kind: "marketing",
      granted: true,
      channel: "test",
    });
    await subscribe(db, tg, "news", other);
    const again = await db.$client.query<{ consent_id: string | null }>(
      "select consent_id from bot.subscriptions where telegram_user_id = $1 and topic = 'news'",
      [tg],
    );
    expect(again.rows[0]?.consent_id).toBe(other);
  });
});

describe("the relay claims rows inside a transaction", () => {
  it("is called with a transaction handle, so that the lock lasts until the batch is done", async () => {
    await db.$client.query("delete from ops.outbox");
    const a = await enqueueOutbox(db, { kind: "job", payload: { n: 1 } });
    const batches = await db.transaction(async (tx) => {
      const mine = await claimOutbox(tx, 5);
      const theirs = await db.transaction((other) => claimOutbox(other, 5));
      return { mine, theirs };
    });
    expect(batches.mine.map((r) => r.id)).toEqual([a.id]);
    expect(batches.theirs).toEqual([]);
  });

  // send_after is stamped by the clock of the database (default now()). Comparing it with the clock of the caller made
  // a row enqueued a millisecond ago "not yet due" whenever the caller's clock was a hair behind or rounded down to
  // the millisecond: a flake of every test that claims at once, and a skipped poll for the relay.
  it("judges a row due by the clock of the database, not by the clock of the caller", async () => {
    await db.$client.query("delete from ops.outbox");
    const a = await enqueueOutbox(db, { kind: "job", payload: { n: 2 } });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(Date.now() - 3_600_000) }); // the caller is an hour behind
    try {
      const batch = await db.transaction((tx) => claimOutbox(tx, 5));
      expect(batch.map((r) => r.id)).toEqual([a.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still lets the caller name the moment: a row due later is claimed when `now` is later", async () => {
    await db.$client.query("delete from ops.outbox");
    const later = await enqueueOutbox(db, {
      kind: "job",
      payload: { n: 3 },
      sendAfter: new Date(Date.now() + 3_600_000),
    });
    expect(await db.transaction((tx) => claimOutbox(tx, 5))).toEqual([]);
    const batch = await db.transaction((tx) => claimOutbox(tx, 5, new Date(Date.now() + 7_200_000)));
    expect(batch.map((r) => r.id)).toEqual([later.id]);
  });
});
