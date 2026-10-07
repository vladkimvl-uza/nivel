import { ops, sales } from "@nivel/db/repos";
import { sum } from "@nivel/domain/money";
import { taxRiskReserve } from "@nivel/domain/reserve";
import { payments } from "@nivel/services";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PermanentJobError } from "../../queues/define.ts";
import { workerRenderer } from "../../queues/render.ts";
import {
  FakeClock,
  FakeJobs,
  FakeTelegram,
  recordingFailures,
  recordingLogger,
} from "../../queues/test-support/fakes.ts";
import {
  acceptedOrder,
  draftOrder,
  ownerActor,
  purchasedOrder,
  reportSentOrder,
  settledOrder,
} from "../../queues/test-support/flow.ts";
import { createWorld, type World } from "../../queues/test-support/world.ts";
import { Throttle } from "../../queues/throttle.ts";
import { createPgDirectory } from "./directory.ts";
import { createPgLedgerPort, handleLedgerAppend } from "./ledger-append.ts";
import { handlePaymentExpect } from "./payment-expect.ts";
import { type RelayDeps, relayOnce } from "./relay.ts";
import { createPgOutboxStore } from "./store.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const q = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  w.db.$client.query<T>(sql, params).then((r) => r.rows);

async function clearOutbox() {
  await q("delete from ops.outbox");
}

describe("the outbox store with the rights of nivel_worker", () => {
  beforeEach(clearOutbox);

  it("leases the rows it takes: a second pass does not take them again, and a row that is not due is left alone", async () => {
    const store = createPgOutboxStore(w.workerDb);
    await ops.enqueueOutbox(w.workerDb, { kind: "job", payload: { job: "threshold.check" }, dedupeKey: "k1" });
    await ops.enqueueOutbox(w.workerDb, { kind: "job", payload: { job: "threshold.check" }, dedupeKey: "k2" });
    await ops.enqueueOutbox(w.workerDb, {
      kind: "job",
      payload: { job: "later" },
      dedupeKey: "k3",
      sendAfter: new Date(Date.now() + 3_600_000),
    });
    const first = await store.claim(10);
    expect(first.map((r) => r.dedupeKey).sort()).toEqual(["k1", "k2"]);
    expect(await store.claim(10)).toEqual([]);
  });

  it("takes the urgent rows first and honours the limit", async () => {
    const store = createPgOutboxStore(w.workerDb);
    await ops.enqueueOutbox(w.workerDb, { kind: "job", payload: { job: "a" }, dedupeKey: "low" });
    await ops.enqueueOutbox(w.workerDb, { kind: "job", payload: { job: "b" }, dedupeKey: "high", priority: 5 });
    const rows = await store.claim(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupeKey).toBe("high");
  });

  it("marks a row sent with the time of the database and clears its error", async () => {
    const store = createPgOutboxStore(w.workerDb);
    await ops.enqueueOutbox(w.workerDb, { kind: "job", payload: { job: "a" }, dedupeKey: "s" });
    const [row] = await store.claim(10);
    await store.markSent(row?.id as string);
    const [after] = await q("select status, sent_at, last_error from ops.outbox where id = $1", [row?.id]);
    expect(after).toMatchObject({ status: "sent", last_error: null });
    expect(after?.sent_at).toBeInstanceOf(Date);
  });

  it("counts an attempt and holds the row back on a failure, and fails it for good at the last attempt", async () => {
    const store = createPgOutboxStore(w.workerDb);
    await ops.enqueueOutbox(w.workerDb, { kind: "job", payload: { job: "a" }, dedupeKey: "r" });
    const [row] = await store.claim(10);
    const id = row?.id as string;
    expect(await store.retryLater(id, "boom 1", 60_000, 2)).toBe("pending");
    const [held] = await q<{ attempts: number; last_error: string; held: boolean }>(
      "select attempts, last_error, send_after > clock_timestamp() + interval '50 seconds' as held from ops.outbox where id = $1",
      [id],
    );
    expect(held).toMatchObject({ attempts: 1, last_error: "boom 1", held: true });
    expect(await store.retryLater(id, "boom 2", 60_000, 2)).toBe("failed");
    const [last] = await q("select status, attempts from ops.outbox where id = $1", [id]);
    expect(last).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("skips a row with the reason on it and without an attempt, fails one for good with an attempt, and defers one without", async () => {
    const store = createPgOutboxStore(w.workerDb);
    for (const key of ["skip", "fail", "defer"]) {
      await ops.enqueueOutbox(w.workerDb, { kind: "job", payload: { job: key }, dedupeKey: key });
    }
    const rows = await store.claim(10);
    const idOf = (k: string) => rows.find((r) => r.dedupeKey === k)?.id as string;
    await store.skip(idOf("skip"), "no BOT_TOKEN");
    await store.fail(idOf("fail"), "payload invalid");
    await store.defer(idOf("defer"), 600_000);
    const out = await q<{
      dedupe_key: string;
      status: string;
      attempts: number;
      last_error: string | null;
      held: boolean;
    }>(
      "select dedupe_key, status, attempts, last_error, send_after > clock_timestamp() + interval '9 minutes' as held from ops.outbox order by dedupe_key",
    );
    expect(out).toEqual([
      { dedupe_key: "defer", status: "pending", attempts: 0, last_error: null, held: true },
      { dedupe_key: "fail", status: "failed", attempts: 1, last_error: "payload invalid", held: false },
      { dedupe_key: "skip", status: "failed", attempts: 0, last_error: "skipped: no BOT_TOKEN", held: false },
    ]);
  });

  it("never hands one row to two relays at once", async () => {
    const store = createPgOutboxStore(w.workerDb);
    for (let i = 0; i < 20; i++)
      await ops.enqueueOutbox(w.workerDb, { kind: "job", payload: { job: "a" }, dedupeKey: `p${i}` });
    const batches = await Promise.all([store.claim(10), store.claim(10), store.claim(10)]);
    const ids = batches.flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
  });
});

describe("the directory of addresses", () => {
  it("reads the Telegram id and language of a customer, not the phone or the address, and skips an erased one", async () => {
    const dir = createPgDirectory(w.workerDb);
    const o = await draftOrder(w, { lang: "ru" });
    const [c] = await q<{ tg: string }>("select telegram_user_id::text as tg from sales.customers where id = $1", [
      o.customerId,
    ]);
    expect(await dir.customer(o.customerId)).toEqual({ chatId: Number(c?.tg), lang: "ru" });
    expect(await dir.customer("not-a-uuid")).toEqual({ skip: "the customer id is not valid" });
    expect(await dir.customer("6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11")).toEqual({ skip: "the customer is not known" });
    await q("update sales.customers set erased_at = now(), telegram_user_id = null where id = $1", [o.customerId]);
    expect(await dir.customer(o.customerId)).toEqual({ skip: "the customer is erased" });
    const o2 = await draftOrder(w, { withTelegram: false });
    expect(await dir.customer(o2.customerId)).toEqual({ skip: "the customer has no Telegram id" });
  });

  it("reads the owner's group from the settings and the topic of an order", async () => {
    const dir = createPgDirectory(w.workerDb);
    expect(await dir.ownerGroup()).toBeNull();
    await ops.setSetting(w.db, "telegram.owner_group", { chatId: -1001234567890 }, "test");
    expect(await dir.ownerGroup()).toBe(-1001234567890);
    const o = await draftOrder(w);
    expect(await dir.topic({ orderId: o.orderId })).toBeNull();
    await q("update sales.orders set tg_topic_id = 4242 where id = $1", [o.orderId]);
    expect(await dir.topic({ orderId: o.orderId })).toBe(4242);
    expect(await dir.topic({ orderId: "not-a-uuid" })).toBeNull();
  });
});

describe("outbox.relay on the real outbox", () => {
  beforeEach(clearOutbox);

  function relayDeps(over: Partial<RelayDeps> = {}) {
    const clock = new FakeClock();
    const telegram = new FakeTelegram(clock);
    const jobs = new FakeJobs();
    const failures = recordingFailures();
    const { log } = recordingLogger();
    const deps: RelayDeps = {
      now: clock.now,
      sleep: clock.sleep,
      log,
      store: createPgOutboxStore(w.workerDb),
      directory: createPgDirectory(w.workerDb),
      flags: { isOn: async () => false },
      telegram,
      throttle: new Throttle(),
      renderer: workerRenderer,
      jobs,
      failures,
      ...over,
    };
    return { deps, telegram, jobs, failures };
  }

  it("sends the message of the order automaton's reminder to the customer, and the alert to the group, and marks them sent", async () => {
    await ops.setSetting(w.db, "telegram.owner_group", { chatId: -1001234567890 }, "test");
    const o = await acceptedOrder(w);
    await clearOutbox();
    const [c] = await q<{ tg: string }>("select telegram_user_id::text as tg from sales.customers where id = $1", [
      o.customerId,
    ]);
    await ops.enqueueOutbox(w.workerDb, {
      kind: "telegram_message",
      dedupeKey: "t-customer",
      payload: {
        target: "customer",
        templateKey: "order.accept_reminder",
        customerId: o.customerId,
        orderId: o.orderId,
        orderNumber: o.number,
        params: { missing: "both" },
        telegramUserId: 1,
      },
    });
    await ops.enqueueOutbox(w.workerDb, {
      kind: "telegram_message",
      dedupeKey: "t-group",
      payload: { target: "group", templateKey: "ops.alert", params: { check: "disk", detail: "85 %" } },
    });
    const t = relayDeps();
    const stats = await relayOnce(t.deps);
    expect(stats).toMatchObject({ claimed: 2, sent: 2 });
    expect(t.telegram.sent.map((s) => s.chatId).sort()).toEqual([-1001234567890, Number(c?.tg)].sort());
    const out = await q("select dedupe_key, status from ops.outbox order by dedupe_key");
    expect(out).toEqual([
      { dedupe_key: "t-customer", status: "sent" },
      { dedupe_key: "t-group", status: "sent" },
    ]);
  });

  it("hands a job to the queue and keeps the row pending-free: sent", async () => {
    const o = await acceptedOrder(w);
    await clearOutbox();
    await ops.enqueueOutbox(w.workerDb, {
      kind: "job",
      dedupeKey: "j-1",
      payload: { job: "payment.expect", orderId: o.orderId, paymentKind: "fee_advance" },
    });
    const t = relayDeps();
    t.jobs.queues.add("payment.expect");
    await relayOnce(t.deps);
    expect(t.jobs.sent).toHaveLength(1);
    expect(t.jobs.sent[0]?.opts?.singletonKey).toBe("j-1");
    // the job carries the id of the row of the database: that is what makes a second hand-over of the row one job
    const [row] = await q<{ id: string }>("select id from ops.outbox where dedupe_key = 'j-1'");
    expect(t.jobs.sent[0]?.opts?.id).toBe(row?.id);
    expect(await q("select status from ops.outbox where dedupe_key = 'j-1'")).toEqual([{ status: "sent" }]);
  });

  it("records a row that fails for good in ops.app_errors through the real failure sink", async () => {
    await ops.enqueueOutbox(w.workerDb, { kind: "job", dedupeKey: "bad", payload: { job: "act.sign", actId: "x" } });
    const { createFailureSink } = await import("../../queues/failures.ts");
    const sink = createFailureSink({ db: w.workerDb, now: () => new Date() });
    const t = relayDeps({ failures: sink });
    await relayOnce(t.deps);
    const errors = await q<{ app: string; message: string; count: number }>(
      "select app, message, count from ops.app_errors",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.app).toBe("worker");
    expect(errors[0]?.message).toContain("outbox.relay");
    expect(errors[0]?.message).toContain("act.sign is reserved");
    // and the owner is told once through the outbox
    const alerts = await q<{ payload: { templateKey: string } }>(
      "select payload from ops.outbox where payload->>'templateKey' = 'ops.job_failed'",
    );
    expect(alerts).toHaveLength(1);
  });
});

/** The jobs the services queued for an order, as the site and the bot wrote them into the outbox. */
const queuedJobs = (orderId: string, job: string) =>
  q<{ payload: Record<string, unknown> }>(
    "select payload from ops.outbox where payload->>'job' = $1 and payload->>'orderId' = $2 order by created_at",
    [job, orderId],
  ).then((rows) => rows.map((r) => r.payload));

describe("payment.expect on the real database, as the role worker", () => {
  const run = (data: Record<string, unknown>) =>
    handlePaymentExpect(
      { log: recordingLogger().log, expectFromJob: (input) => payments.expectFromJob(input, w.worker) },
      data,
    );

  it("runs the jobs the site queued at ACCEPT: the advance and the money for the purchases, with the sums of the accepted quote", async () => {
    const o = await acceptedOrder(w, { via: "web" });
    // The site may not expect payments: nothing is expected yet, two jobs wait in the outbox.
    expect(await q("select 1 from sales.payments where order_id = $1", [o.orderId])).toEqual([]);
    const jobs = await queuedJobs(o.orderId, "payment.expect");
    expect(jobs.map((j) => j.paymentKind).sort()).toEqual(["fee_advance", "purchase_funds"]);
    for (const job of jobs) expect(await run(job)).toMatchObject({ created: true });
    const rows = await q<{ kind: string; amount_sum: string; status: string; method: string }>(
      "select kind, amount_sum::text, status, method from sales.payments where order_id = $1 order by kind",
      [o.orderId],
    );
    expect(rows).toEqual([
      { kind: "fee_advance", amount_sum: String(o.quote.totals.advance), status: "expected", method: "xolis_qr" },
      {
        kind: "purchase_funds",
        amount_sum: String(o.quote.totals.purchaseLimit),
        status: "expected",
        method: "bank_transfer_ip",
      },
    ]);
  });

  it("answers the same expectation when the job is delivered twice", async () => {
    const o = await acceptedOrder(w, { via: "web" });
    const [job] = await queuedJobs(o.orderId, "payment.expect");
    const first = await run(job as Record<string, unknown>);
    const second = await run(job as Record<string, unknown>);
    expect((second as { paymentId: string }).paymentId).toBe((first as { paymentId: string }).paymentId);
    expect(second).toMatchObject({ created: false });
    const [n] = await q("select count(*)::int as n from sales.payments where order_id = $1", [o.orderId]);
    expect(n?.n).toBe(1);
  });

  it("refuses a job that names a sum that is not the quote's, and writes nothing", async () => {
    const o = await acceptedOrder(w, { via: "web" });
    await expect(run({ orderId: o.orderId, paymentKind: "fee_advance", amountSum: 1 })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    await expect(
      run({ orderId: o.orderId, paymentKind: "fee_advance", amountSum: o.quote.totals.advance + 1 }),
    ).rejects.toBeInstanceOf(PermanentJobError);
    const [n] = await q("select count(*)::int as n from sales.payments where order_id = $1", [o.orderId]);
    expect(n?.n).toBe(0);
  });

  it("works without the hint of the sum: the quote has it", async () => {
    const o = await acceptedOrder(w, { via: "web" });
    expect(await run({ orderId: o.orderId, paymentKind: "fee_advance" })).toMatchObject({ created: true });
  });

  it("refuses a kind the events do not expect (a top-up) and an order that is only a draft", async () => {
    const o = await acceptedOrder(w, { via: "web" });
    await expect(run({ orderId: o.orderId, paymentKind: "purchase_topup" })).rejects.toBeInstanceOf(PermanentJobError);
    const draft = await draftOrder(w);
    await expect(run({ orderId: draft.orderId, paymentKind: "fee_advance" })).rejects.toBeInstanceOf(PermanentJobError);
  });

  it("refuses an order that does not exist", async () => {
    await expect(
      run({ orderId: "6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11", paymentKind: "fee_advance" }),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });
});

describe("ledger.append on the real database, as the role worker", () => {
  const port = () => createPgLedgerPort(w.workerDb);
  const run = (data: Record<string, unknown>) => handleLedgerAppend({ log: recordingLogger().log, port: port() }, data);
  const ledger = (orderId: string) =>
    q<{ fund: string; amount_sum: string; reason: string }>(
      "select fund, amount_sum::text, reason from sales.reserve_ledger where order_id = $1 order by fund",
      [orderId],
    );

  it("books the tax-risk reserve of an order the bot settled: 1 % of the receipts rounded up, from the database, whatever the job says", async () => {
    const o = await settledOrder(w, { via: "bot" });
    const [receipts] = await q<{ s: string }>(
      "select coalesce(sum(amount_sum), 0)::text as s from sales.purchases where order_id = $1",
      [o.orderId],
    );
    const expected = taxRiskReserve(sum(Number(receipts?.s)), true);
    expect(expected).toBeGreaterThan(0);
    // The bot cannot write the ledger: it queued the job with its own figure, which is a hint.
    expect(await ledger(o.orderId)).toEqual([]);
    const [queued] = await queuedJobs(o.orderId, "ledger.append");
    expect(queued).toMatchObject({ job: "ledger.append", fund: "tax_risk", amountSum: expected });
    const result = await run({ ...(queued as Record<string, unknown>), amountSum: 1, reason: "free text" });
    expect(result).toEqual({ booked: expected });
    expect(await ledger(o.orderId)).toEqual([
      { fund: "tax_risk", amount_sum: String(expected), reason: `order ${o.number}: REMAINDER_SETTLED` },
    ]);
  });

  it("books once: the same job again writes nothing", async () => {
    const o = await settledOrder(w, { via: "bot" });
    const [queued] = await queuedJobs(o.orderId, "ledger.append");
    await run(queued as Record<string, unknown>);
    expect(await run(queued as Record<string, unknown>)).toEqual({ alreadyBooked: true });
    expect(await ledger(o.orderId)).toHaveLength(1);
  });

  it("books nothing for the tax-risk reserve once the owner has switched it off after the job was queued", async () => {
    const o = await settledOrder(w, { via: "bot" });
    const [queued] = await queuedJobs(o.orderId, "ledger.append");
    await ops.setSetting(w.db, "money.tax_risk_active", false, "test");
    try {
      expect(await run(queued as Record<string, unknown>)).toEqual({ nothingToBook: true });
      expect(await ledger(o.orderId)).toEqual([]);
    } finally {
      await ops.setSetting(w.db, "money.tax_risk_active", true, "test");
    }
  });

  it("waits for the milestone: the warranty reserve of an order that has not been handed over is refused by the database and the job is retried", async () => {
    const o = await purchasedOrder(w);
    const error = await run({ orderId: o.orderId, fund: "warranty" }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentJobError);
    expect(String(error.message)).toContain("reserve_not_due");
    expect(await ledger(o.orderId)).toEqual([]);
  });

  it("books the warranty reserve once the journal of the order has HANDOVER: 2 % of the receipts, not less than 150 000 (a young fund)", async () => {
    const o = await purchasedOrder(w);
    await q(
      `insert into sales.order_events (order_id, seq, actor_kind, actor_id, event, from_status, to_status)
       values ($1, (select coalesce(max(seq), 0) + 1 from sales.order_events where order_id = $1), 'owner', 'test', '{"type":"HANDOVER"}', 'delivering', 'handed_over')`,
      [o.orderId],
    );
    const [receipts] = await q<{ s: string }>(
      "select sum(amount_sum)::text as s from sales.purchases where order_id = $1",
      [o.orderId],
    );
    const expected = Math.max(Math.ceil((Number(receipts?.s) * 200) / 10_000), 150_000);
    expect(await run({ orderId: o.orderId, fund: "warranty" })).toEqual({ booked: expected });
    expect(await ledger(o.orderId)).toEqual([
      { fund: "warranty", amount_sum: String(expected), reason: `order ${o.number}: HANDOVER` },
    ]);
    expect(await sales.reserveBalance(w.workerDb, "warranty")).toBeGreaterThanOrEqual(expected);
  });

  it("is refused by the database when the sum is above the calculation from the receipts, whoever asks (the second line)", async () => {
    const o = await settledOrder(w, { via: "bot" });
    const direct = sales.appendReserve(w.workerDb, {
      fund: "tax_risk",
      amountSum: 10_000_000_000,
      reason: "x",
      orderId: o.orderId,
    });
    await expect(direct).rejects.toThrow(/reserve_exceeded/);
  });

  it("refuses an order that is not there", async () => {
    await expect(run({ orderId: "6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11", fund: "warranty" })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
  });
});

describe("what the report order flow leaves for the other jobs", () => {
  it("has a report with an objection window the calendar jobs can read", async () => {
    const o = await reportSentOrder(w);
    const [row] = await q<{ objection_until: Date | null; status: string }>(
      "select objection_until, status from sales.orders where id = $1",
      [o.orderId],
    );
    expect(row?.status).toBe("report_sent");
    expect(row?.objection_until).toBeInstanceOf(Date);
    void ownerActor;
  });
});
