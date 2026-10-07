import { describe, expect, it } from "vitest";
import { workerRenderer } from "../../queues/render.ts";
import { TelegramError } from "../../queues/telegram.ts";
import {
  FakeClock,
  FakeJobs,
  FakeTelegram,
  recordingFailures,
  recordingLogger,
} from "../../queues/test-support/fakes.ts";
import { Throttle } from "../../queues/throttle.ts";
import { type ChatDirectory, type FlagReader, RELAY_MAX_ATTEMPTS, type RelayDeps, relayOnce } from "./relay.ts";
import { MemoryOutbox } from "./test-support/memory-store.ts";

const GROUP = -1001234567890;

function setup(over: { flags?: Record<string, boolean>; group?: number | null } = {}) {
  const clock = new FakeClock();
  const store = new MemoryOutbox();
  const telegram = new FakeTelegram(clock);
  const jobs = new FakeJobs();
  const failures = recordingFailures();
  const { log, lines } = recordingLogger();
  const topics = new Map<string, number>([["order-1", 4242]]);
  const customers = new Map<string, { chatId: number; lang: "uz" | "ru" } | { skip: string }>([
    ["cust-1", { chatId: 555, lang: "uz" }],
    ["cust-2", { chatId: 556, lang: "ru" }],
    ["cust-no-tg", { skip: "the customer has no Telegram id" }],
  ]);
  const directory: ChatDirectory = {
    async customer(id) {
      return customers.get(id) ?? { skip: "the customer is not known" };
    },
    async ownerGroup() {
      return over.group === undefined ? GROUP : over.group;
    },
    async topic(ref) {
      return topics.get(ref.orderId ?? ref.leadId ?? "") ?? null;
    },
  };
  const flags: FlagReader = { isOn: async (key) => over.flags?.[key] === true };
  const deps: RelayDeps = {
    now: clock.now,
    sleep: clock.sleep,
    log,
    store,
    directory,
    flags,
    telegram,
    throttle: new Throttle(),
    renderer: workerRenderer,
    jobs,
    failures,
  };
  return { deps, clock, store, telegram, jobs, failures, lines, customers, topics };
}

const customerMessage = (over: Record<string, unknown> = {}) => ({
  target: "customer",
  templateKey: "order.accept_reminder",
  customerId: "cust-1",
  orderId: "order-1",
  orderNumber: "NV-2026-0001",
  lang: "ru",
  params: { missing: "fee" },
  ...over,
});

describe("relayOnce: messages to Telegram", () => {
  it("sends to the chat of the customer from the database, not to the id the payload names, in the language of the customer", async () => {
    const t = setup();
    const row = t.store.add("telegram_message", customerMessage({ telegramUserId: 999, lang: "ru" }));
    const stats = await relayOnce(t.deps);
    expect(stats).toMatchObject({ claimed: 1, sent: 1 });
    expect(t.telegram.sent).toHaveLength(1);
    expect(t.telegram.sent[0]?.chatId).toBe(555);
    expect(t.telegram.sent[0]?.threadId).toBeUndefined();
    expect(t.telegram.sent[0]?.text).toContain("NV-2026-0001");
    expect(t.telegram.sent[0]?.text).toContain("oldindan toʻlov"); // cust-1 is an uz customer whatever the payload says
    expect(t.store.get(row.id).status).toBe("sent");
  });

  it("sends the message of an order to the owner into the topic of the order that the database has, not the one the payload names", async () => {
    const t = setup();
    t.store.add("telegram_message", {
      target: "owner_topic",
      templateKey: "reminder.lead_no_answer",
      orderId: "order-1",
      topicId: 777,
      params: { number: "L-2026-0007", minutes: 15 },
    });
    await relayOnce(t.deps);
    expect(t.telegram.sent[0]).toMatchObject({ chatId: GROUP, threadId: 4242 });
    expect(t.telegram.sent[0]?.text).toContain("L-2026-0007");
  });

  it("sends to the group itself when the message has no order or the order has no topic yet", async () => {
    const t = setup();
    t.store.add("telegram_message", {
      target: "owner_topic",
      templateKey: "lead.created",
      params: { number: "L-2026-0007", scope: "pc" },
    });
    t.store.add("telegram_message", {
      target: "owner_topic",
      templateKey: "lead.created",
      orderId: "order-without-topic",
      params: { number: "L-2026-0008", scope: "pc" },
    });
    t.store.add("telegram_message", {
      target: "group",
      templateKey: "ops.alert",
      params: { check: "disk", detail: "85 %" },
    });
    await relayOnce(t.deps);
    expect(t.telegram.sent.map((s) => [s.chatId, s.threadId])).toEqual([
      [GROUP, undefined],
      [GROUP, undefined],
      [GROUP, undefined],
    ]);
  });

  it("sends the message about a request into the topic of the request", async () => {
    const t = setup();
    t.topics.set("lead-1", 99);
    t.store.add("telegram_message", {
      target: "owner_topic",
      templateKey: "reminder.lead_no_answer",
      leadId: "lead-1",
      params: { number: "L-2026-0007", minutes: 15 },
    });
    await relayOnce(t.deps);
    expect(t.telegram.sent[0]).toMatchObject({ chatId: GROUP, threadId: 99 });
  });

  it("takes the number of the order from the row when the params do not carry it", async () => {
    const t = setup();
    t.store.add("telegram_message", {
      target: "owner_topic",
      templateKey: "reminder.refund_due",
      orderId: "order-1",
      orderNumber: "NV-2026-0042",
    });
    await relayOnce(t.deps);
    expect(t.telegram.sent[0]?.text).toContain("NV-2026-0042");
  });

  it("skips with a record, and sends nothing, when there is no BOT_TOKEN", async () => {
    const t = setup();
    t.telegram.enabled = false;
    const row = t.store.add("telegram_message", customerMessage());
    const stats = await relayOnce(t.deps);
    expect(stats.skipped).toBe(1);
    expect(t.telegram.sent).toEqual([]);
    expect(t.store.get(row.id)).toMatchObject({ status: "failed", lastError: "skipped: no BOT_TOKEN" });
    expect(t.failures.recorded).toEqual([]);
  });

  it("skips a message to the owner when no group of the owner is set", async () => {
    const t = setup({ group: null });
    const row = t.store.add("telegram_message", {
      target: "group",
      templateKey: "ops.alert",
      params: { check: "disk" },
    });
    await relayOnce(t.deps);
    expect(t.store.get(row.id).lastError).toBe("skipped: the owner group is not set (telegram.owner_group)");
    expect(t.telegram.sent).toEqual([]);
  });

  it("skips a customer who has no Telegram id or is gone, with the reason", async () => {
    const t = setup();
    const a = t.store.add("telegram_message", customerMessage({ customerId: "cust-no-tg" }));
    const b = t.store.add("telegram_message", customerMessage({ customerId: "nobody" }));
    const stats = await relayOnce(t.deps);
    expect(stats.skipped).toBe(2);
    expect(t.store.get(a.id).lastError).toBe("skipped: the customer has no Telegram id");
    expect(t.store.get(b.id).lastError).toBe("skipped: the customer is not known");
  });

  it("skips a template the worker does not know (the order templates come with the bot) and names it", async () => {
    const t = setup();
    const row = t.store.add("telegram_message", customerMessage({ templateKey: "order.estimate_sent" }));
    await relayOnce(t.deps);
    expect(t.store.get(row.id)).toMatchObject({
      status: "failed",
      lastError: "skipped: no template order.estimate_sent",
    });
    expect(t.telegram.sent).toEqual([]);
  });

  it("refuses a message with a malformed payload for good, once, and tells the owner through the failure record", async () => {
    const t = setup();
    const noTarget = t.store.add("telegram_message", { templateKey: "x" });
    const badTarget = t.store.add("telegram_message", { target: "everyone", templateKey: "x" });
    const noTemplate = t.store.add("telegram_message", { target: "group" });
    const noCustomer = t.store.add("telegram_message", { target: "customer", templateKey: "order.accept_reminder" });
    const stats = await relayOnce(t.deps);
    expect(stats.dead).toBe(4);
    for (const r of [noTarget, badTarget, noTemplate, noCustomer]) expect(t.store.get(r.id).status).toBe("failed");
    expect(t.failures.recorded).toHaveLength(4);
    expect(t.failures.recorded[0]?.queue).toBe("outbox.relay");
  });
});

describe("relayOnce: the limits of Telegram", () => {
  it("holds a second message to the same chat for the rest of the second, and sends it then", async () => {
    const t = setup();
    t.store.add("telegram_message", customerMessage());
    t.store.add("telegram_message", customerMessage({ params: { missing: "funds" } }));
    const started = t.clock.ms();
    await relayOnce(t.deps);
    expect(t.telegram.sent).toHaveLength(2);
    expect((t.telegram.sent[1]?.at ?? 0) - (t.telegram.sent[0]?.at ?? 0)).toBeGreaterThanOrEqual(1000);
    expect(t.telegram.sent[0]?.at).toBe(started);
  });

  it("does not hold messages to different chats", async () => {
    const t = setup();
    t.store.add("telegram_message", customerMessage());
    t.store.add("telegram_message", customerMessage({ customerId: "cust-2" }));
    await relayOnce(t.deps);
    expect(t.telegram.sent.map((s) => s.at)).toEqual([t.telegram.sent[0]?.at, t.telegram.sent[0]?.at]);
  });

  it("sends twenty messages a minute to the group and puts the rest back for the time the limit asks, without counting an attempt", async () => {
    const t = setup();
    const rows = Array.from({ length: 22 }, (_, i) =>
      t.store.add("telegram_message", {
        target: "group",
        templateKey: "ops.alert",
        params: { check: "disk", detail: `n${i}` },
      }),
    );
    const stats = await relayOnce(t.deps, { limit: 30 });
    expect(stats).toMatchObject({ claimed: 22, sent: 20, deferred: 2 });
    expect(t.telegram.sent).toHaveLength(20);
    const [late1, late2] = [rows[20], rows[21]];
    for (const r of [late1, late2]) {
      const row = t.store.get(r?.id as string);
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(0);
      // the first message went at T0, the twentieth about 19 s later; the 21st may go a minute after the first
      expect(row.heldMs).toBeGreaterThan(30_000);
      expect(row.heldMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("puts a message back for the pause Telegram asks (429) without counting an attempt", async () => {
    const t = setup();
    t.telegram.failures.push(new TelegramError("sendMessage: HTTP 429: Too Many Requests", 429, 7));
    const row = t.store.add("telegram_message", customerMessage());
    const stats = await relayOnce(t.deps);
    expect(stats.deferred).toBe(1);
    expect(t.store.get(row.id)).toMatchObject({ status: "pending", attempts: 0 });
    expect(t.store.get(row.id).heldMs).toBe(7500);
  });
});

describe("relayOnce: failures of the send", () => {
  it("skips a customer who has blocked the bot (403): there is nobody to retry for", async () => {
    const t = setup();
    t.telegram.failures.push(new TelegramError("sendMessage: HTTP 403: Forbidden: bot was blocked by the user", 403));
    const row = t.store.add("telegram_message", customerMessage());
    const stats = await relayOnce(t.deps);
    expect(stats.skipped).toBe(1);
    expect(t.store.get(row.id).lastError).toBe("skipped: telegram 403 (the bot is blocked or removed)");
    expect(t.failures.recorded).toEqual([]);
  });

  it("gives up on a refusal that a retry cannot mend (400, 401) and records it", async () => {
    const t = setup();
    t.telegram.failures.push(new TelegramError("sendMessage: HTTP 400: Bad Request: chat not found", 400));
    t.telegram.failures.push(new TelegramError("sendMessage: HTTP 401: Unauthorized", 401));
    const a = t.store.add("telegram_message", customerMessage());
    const b = t.store.add("telegram_message", customerMessage({ customerId: "cust-2" }));
    const stats = await relayOnce(t.deps);
    expect(stats.dead).toBe(2);
    expect(t.store.get(a.id).status).toBe("failed");
    expect(t.store.get(b.id).status).toBe("failed");
    expect(t.failures.recorded.map((f) => f.queue)).toEqual(["outbox.relay", "outbox.relay"]);
  });

  it("tries again later after a failure of the network or a 5xx, with a pause that grows, and fails for good after the last attempt", async () => {
    const t = setup();
    const row = t.store.add("telegram_message", customerMessage());
    const holds: (number | null)[] = [];
    for (let i = 0; i < RELAY_MAX_ATTEMPTS; i++) {
      t.telegram.failures.push(new TelegramError("sendMessage: network error", null));
      t.store.release();
      t.clock.advance(60 * 60 * 1000);
      await relayOnce(t.deps);
      holds.push(t.store.get(row.id).heldMs);
    }
    expect(holds[0]).toBe(30_000);
    expect(holds[1]).toBe(60_000);
    expect(holds[2]).toBe(120_000);
    expect(t.store.get(row.id)).toMatchObject({ status: "failed", attempts: RELAY_MAX_ATTEMPTS });
    expect(t.failures.recorded).toHaveLength(1);
    expect(t.failures.recorded[0]).toMatchObject({ queue: "outbox.relay", attempts: RELAY_MAX_ATTEMPTS });
  });

  it("goes on with the next row when one row throws: the error is the row's, not the pass's", async () => {
    const t = setup();
    t.telegram.failures.push(new Error("socket hang up"));
    const a = t.store.add("telegram_message", customerMessage());
    const b = t.store.add("telegram_message", customerMessage({ customerId: "cust-2" }));
    const stats = await relayOnce(t.deps);
    expect(stats).toMatchObject({ claimed: 2, sent: 1, retried: 1 });
    expect(t.store.get(a.id)).toMatchObject({ status: "pending", attempts: 1 });
    expect(t.store.get(b.id).status).toBe("sent");
  });

  it("does not put a secret into the record of a failed send: the text is cleaned", async () => {
    const t = setup();
    t.telegram.failures.push(new Error("failed for +998 90 123-45-67"));
    const row = t.store.add("telegram_message", customerMessage());
    await relayOnce(t.deps);
    expect(t.store.get(row.id).lastError).not.toContain("123-45-67");
  });
});

describe("relayOnce: jobs", () => {
  it("hands a job to the queue of pg-boss with the key of the row, and the row is done", async () => {
    const t = setup();
    t.jobs.queues.add("payment.expect");
    const row = t.store.add(
      "job",
      { job: "payment.expect", orderId: "order-1", paymentKind: "fee_advance", amountSum: 1_000_000 },
      { dedupeKey: "ord:1:pay:fee_advance" },
    );
    const stats = await relayOnce(t.deps);
    expect(stats).toMatchObject({ sent: 1 });
    expect(t.jobs.sent).toEqual([
      {
        queue: "payment.expect",
        data: { job: "payment.expect", orderId: "order-1", paymentKind: "fee_advance", amountSum: 1_000_000 },
        opts: { id: row.id, singletonKey: "ord:1:pay:fee_advance" },
      },
    ]);
    expect(t.store.get(row.id).status).toBe("sent");
  });

  it("gives pg-boss the id of the row as the id of the job: a second hand-over of the same row cannot make a second job", async () => {
    const t = setup();
    t.jobs.queues.add("ledger.append");
    const row = t.store.add("job", { job: "ledger.append", orderId: "order-1", fund: "warranty" });
    await relayOnce(t.deps);
    expect(t.jobs.sent[0]?.opts?.id).toBe(row.id);
  });

  it("refuses a job whose name is not a plain name of a queue, without putting the name into the error whole", async () => {
    const t = setup();
    const long = "a".repeat(150_000);
    t.store.add("job", { job: long });
    t.store.add("job", { job: "pay ment;drop" });
    t.store.add("job", { job: "outbox.relay" });
    const started = performance.now();
    const stats = await relayOnce(t.deps);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(stats.dead).toBe(3);
    expect(t.jobs.sent).toEqual([]);
    for (const r of t.store.rows) expect((r.lastError ?? "").length).toBeLessThanOrEqual(500);
  });

  it("uses the id of the row as the key when the row has no dedupe key", async () => {
    const t = setup();
    t.jobs.queues.add("threshold.check");
    const row = t.store.add("job", { job: "threshold.check", orderId: "order-1" });
    await relayOnce(t.deps);
    expect(t.jobs.sent[0]?.opts).toEqual({ id: row.id, singletonKey: row.id });
  });

  it("sends the jobs of the order calendar to one queue and keeps the name of the job in the data", async () => {
    const t = setup();
    t.jobs.queues.add("orders.scheduled");
    for (const job of [
      "accept_reminder",
      "estimate_expiry",
      "objection_window",
      "report_due",
      "refund_due",
      "warranty_end",
      "aftercare",
    ]) {
      t.store.add("job", { job, orderId: "order-1", at: "2026-10-12T10:00:00.000Z" });
    }
    const stats = await relayOnce(t.deps, { limit: 20 });
    expect(stats.sent).toBe(7);
    expect(new Set(t.jobs.sent.map((s) => s.queue))).toEqual(new Set(["orders.scheduled"]));
    expect(t.jobs.sent.map((s) => (s.data as { job: string }).job)).toContain("objection_window");
  });

  it("takes a job that pg-boss already has queued under the same key as done", async () => {
    const t = setup();
    t.jobs.queues.add("ledger.append");
    t.jobs.answers.push(null);
    const row = t.store.add("job", { job: "ledger.append", orderId: "order-1", fund: "warranty" });
    await relayOnce(t.deps);
    expect(t.store.get(row.id).status).toBe("sent");
  });

  it("refuses act.sign: nothing queues it any more and a signature is never made from a job", async () => {
    const t = setup();
    t.jobs.queues.add("act.sign");
    const row = t.store.add("job", { job: "act.sign", actId: "act-1", evidence: { telegramUserId: 1, messageId: 2 } });
    const stats = await relayOnce(t.deps);
    expect(stats.dead).toBe(1);
    expect(t.jobs.sent).toEqual([]);
    expect(t.store.get(row.id)).toMatchObject({ status: "failed" });
    expect(t.store.get(row.id).lastError).toContain("act.sign");
    expect(t.failures.recorded).toHaveLength(1);
  });

  it("holds pdf.render while the flag feature.pdf is off, and does not count an attempt", async () => {
    const t = setup();
    t.jobs.queues.add("pdf.render");
    const row = t.store.add("job", { job: "pdf.render", orderId: "order-1", doc: "quote", watermarkDraft: false });
    const stats = await relayOnce(t.deps);
    expect(stats.deferred).toBe(1);
    expect(t.jobs.sent).toEqual([]);
    expect(t.store.get(row.id)).toMatchObject({ status: "pending", attempts: 0 });
    expect(t.store.get(row.id).heldMs).toBe(10 * 60_000);
  });

  it("holds pdf.render while the flag is on but nobody has made the queue yet (WP-12 is not deployed)", async () => {
    const t = setup({ flags: { "feature.pdf": true } });
    const row = t.store.add("job", { job: "pdf.render", orderId: "order-1", doc: "quote" });
    await relayOnce(t.deps);
    expect(t.jobs.sent).toEqual([]);
    expect(t.store.get(row.id)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("sends pdf.render to its queue when the flag is on, without the hint about the watermark: the renderer decides it from the offer", async () => {
    const t = setup({ flags: { "feature.pdf": true } });
    t.jobs.queues.add("pdf.render");
    t.store.add("job", {
      job: "pdf.render",
      orderId: "order-1",
      orderNumber: "NV-2026-0001",
      doc: "act_handover",
      actId: "act-1",
      watermarkDraft: false,
    });
    await relayOnce(t.deps);
    expect(t.jobs.sent).toHaveLength(1);
    expect(t.jobs.sent[0]?.queue).toBe("pdf.render");
    expect(t.jobs.sent[0]?.data).toEqual({
      job: "pdf.render",
      orderId: "order-1",
      orderNumber: "NV-2026-0001",
      doc: "act_handover",
      actId: "act-1",
    });
  });

  it("tries a job again later when its queue does not exist (another domain is not deployed), and fails it for good at the end", async () => {
    const t = setup();
    const row = t.store.add("job", { job: "prices.import.file", fileId: "f-1" });
    for (let i = 0; i < RELAY_MAX_ATTEMPTS; i++) {
      t.store.release();
      await relayOnce(t.deps);
    }
    expect(t.jobs.sent).toEqual([]);
    expect(t.store.get(row.id)).toMatchObject({ status: "failed", attempts: RELAY_MAX_ATTEMPTS });
    expect(t.store.get(row.id).lastError).toContain("prices.import.file");
    expect(t.failures.recorded).toHaveLength(1);
  });

  it("forwards a job of another domain by its own name when the queue exists", async () => {
    const t = setup();
    t.jobs.queues.add("prices.import.file");
    t.store.add("job", { job: "prices.import.file", fileId: "f-1" });
    await relayOnce(t.deps);
    expect(t.jobs.sent[0]?.queue).toBe("prices.import.file");
  });

  it("refuses a job row without a name", async () => {
    const t = setup();
    t.store.add("job", { orderId: "order-1" });
    t.store.add("job", { job: "", orderId: "order-1" });
    t.store.add("job", { job: 42 });
    const stats = await relayOnce(t.deps);
    expect(stats.dead).toBe(3);
  });
});

describe("relayOnce: the pass", () => {
  it("sends the urgent rows first", async () => {
    const t = setup();
    t.store.add("telegram_message", {
      target: "group",
      templateKey: "ops.alert",
      params: { check: "a", detail: "low" },
    });
    t.store.add(
      "telegram_message",
      { target: "group", templateKey: "ops.alert", params: { check: "b", detail: "high" } },
      { priority: 5 },
    );
    await relayOnce(t.deps);
    expect(t.telegram.sent[0]?.text).toContain("high");
  });

  it("does nothing on an empty outbox", async () => {
    const t = setup();
    expect(await relayOnce(t.deps)).toEqual({
      claimed: 0,
      sent: 0,
      deferred: 0,
      skipped: 0,
      retried: 0,
      dead: 0,
    });
  });

  it("takes only as many rows as the limit says", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) t.store.add("job", { job: "threshold.check", orderId: `o-${i}` });
    t.jobs.queues.add("threshold.check");
    const stats = await relayOnce(t.deps, { limit: 3 });
    expect(stats.claimed).toBe(3);
    t.store.release();
    expect((await relayOnce(t.deps, { limit: 3 })).claimed).toBe(2);
  });
});
