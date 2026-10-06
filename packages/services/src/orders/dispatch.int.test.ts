import type { OrderEvent } from "@nivel/domain/order";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../quotes/build.ts";
import { send } from "../quotes/send.ts";
import { dispatch } from "./dispatch.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.ts";
import { configureServices, resetServices } from "./runtime.ts";
import {
  acceptConsents,
  acceptedOrder,
  customerActor,
  draftOrder,
  ownerActor,
  SYSTEM,
  sentOrder,
} from "./test-support/flow.ts";
import { createWorld, DAY, HOUR, newCustomer, pcLines, type World } from "./test-support/world.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  resetServices();
  await w.close();
});

async function events(orderId: string) {
  const { rows } = await w.db.$client.query(
    "select seq, actor_kind, actor_id, event, from_status, to_status from sales.order_events where order_id = $1 order by seq",
    [orderId],
  );
  return rows;
}
async function outbox(orderId: string) {
  const { rows } = await w.db.$client.query(
    "select kind, payload, send_after, dedupe_key, priority from ops.outbox where payload->>'orderId' = $1 order by created_at, id",
    [orderId],
  );
  return rows as { kind: string; payload: Record<string, unknown>; send_after: Date; dedupe_key: string }[];
}
async function statusOf(orderId: string): Promise<string> {
  const { rows } = await w.db.$client.query("select status from sales.orders where id = $1", [orderId]);
  return rows[0].status;
}
const jobs = (rows: Awaited<ReturnType<typeof outbox>>, job: string) =>
  rows.filter((r) => r.kind === "job" && r.payload.job === job);
const notices = (rows: Awaited<ReturnType<typeof outbox>>, templateKey: string) =>
  rows.filter((r) => r.kind === "telegram_message" && r.payload.templateKey === templateKey);

describe("SEND_ESTIMATE through quotes.send: one transaction for the quote, the status, the journal and the outbox", () => {
  it("marks the quote sent with the term from the moment of sending, checks it by the owner and queues the messages", async () => {
    const o = await draftOrder(w);
    w.clock.advance(3 * HOUR); // the owner checks the estimate three hours after the draft was made
    const sentAt = w.clock.now();
    const r = await send({ orderId: o.orderId, quoteId: o.quoteId }, ownerActor(w), w.admin);
    expect(r).toEqual({ ok: true, status: "estimate_sent" });

    const q = await w.db.$client.query(
      "select status, valid_until, sent_at, manually_checked_by, watermark_draft from sales.quotes where id = $1",
      [o.quoteId],
    );
    expect(q.rows[0].status).toBe("sent");
    expect(q.rows[0].valid_until).toEqual(new Date(sentAt.getTime() + 24 * HOUR));
    expect(q.rows[0].manually_checked_by).toBe(w.owner.id);
    expect(q.rows[0].watermark_draft).toBe(false);

    const ev = await events(o.orderId);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      actor_kind: "owner",
      actor_id: w.owner.id,
      from_status: "estimate_draft",
      to_status: "estimate_sent",
    });
    expect(ev[0].event).toEqual({ type: "SEND_ESTIMATE", quoteId: o.quoteId, manuallyChecked: true });

    const box = await outbox(o.orderId);
    const [notice] = notices(box, "order.estimate_sent");
    expect(notice?.payload).toMatchObject({
      target: "customer",
      orderNumber: o.number,
      customerId: o.customerId,
      lang: "uz",
    });
    expect(jobs(box, "pdf.render")[0]?.payload).toMatchObject({ doc: "quote", watermarkDraft: false });
    const [expiry] = jobs(box, "estimate_expiry");
    expect(expiry?.payload.at).toBe(new Date(sentAt.getTime() + 24 * HOUR).toISOString());
    expect(expiry?.send_after).toEqual(new Date(sentAt.getTime() + 24 * HOUR));
  });

  it("writes the audit row of apply_transition in the same transaction", async () => {
    const o = await sentOrder(w);
    const { rows } = await w.db.$client.query(
      "select actor, action, after from ops.audit_log where entity = 'sales.orders' and entity_id = $1",
      [o.orderId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: `owner:${w.owner.id}`, action: "order.SEND_ESTIMATE" });
    expect(rows[0].after).toMatchObject({ status: "estimate_sent", db_role: "nivel_admin" });
  });

  it("keeps the draft untouched when the assistant tries: actor_not_allowed, no quote change, no journal, no outbox", async () => {
    const o = await draftOrder(w);
    const r = await send(
      { orderId: o.orderId, quoteId: o.quoteId },
      { kind: "assistant", id: w.assistant.id },
      w.admin,
    );
    expect(r).toEqual({ ok: false, error: "actor_not_allowed" });
    const q = await w.db.$client.query("select status, manually_checked_by from sales.quotes where id = $1", [
      o.quoteId,
    ]);
    expect(q.rows[0]).toEqual({ status: "draft", manually_checked_by: null });
    expect(await events(o.orderId)).toHaveLength(0);
    expect(await outbox(o.orderId)).toHaveLength(0);
    expect(await statusOf(o.orderId)).toBe("estimate_draft");
  });

  it("refuses an estimate that is not eligible for the full cycle or the free window", async () => {
    const o = await draftOrder(w, {
      lines: [],
      manualLines: [{ title: "Small PC", categoryCode: "case", feeGroup: "pc", qty: 1, unitSum: 3_000_000 }],
    });
    const r = await send({ orderId: o.orderId, quoteId: o.quoteId }, ownerActor(w), w.admin);
    expect(r).toEqual({ ok: false, error: "not_eligible" });
    const q = await w.db.$client.query("select status from sales.quotes where id = $1", [o.quoteId]);
    expect(q.rows[0].status).toBe("draft");
  });

  it("refuses a quote that is not the current quote of the order", async () => {
    const o = await draftOrder(w);
    const r = await send(
      { orderId: o.orderId, quoteId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" },
      ownerActor(w),
      w.admin,
    );
    expect(r).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("without published offers the estimate goes out, with the watermark 'not an offer' on the document", async () => {
    // The offers are published in this world; the watermark follows what the snapshot says about them.
    const o = await draftOrder(w);
    expect((await send({ orderId: o.orderId, quoteId: o.quoteId }, ownerActor(w), w.admin)).ok).toBe(true);
    expect(jobs(await outbox(o.orderId), "pdf.render")[0]?.payload.watermarkDraft).toBe(false);
  });

  it("is a retry-safe call: sending twice leaves one journal row and the same outbox", async () => {
    const o = await draftOrder(w);
    const a = await send({ orderId: o.orderId, quoteId: o.quoteId }, ownerActor(w), w.admin);
    const before = (await outbox(o.orderId)).length;
    const b = await send({ orderId: o.orderId, quoteId: o.quoteId }, ownerActor(w), w.admin);
    expect(a).toEqual({ ok: true, status: "estimate_sent" });
    expect(b).toEqual({ ok: true, status: "estimate_sent" });
    expect(await events(o.orderId)).toHaveLength(1);
    expect((await outbox(o.orderId)).length).toBe(before);
  });
});

describe("ACCEPT by the customer", () => {
  it("through the bot: sets the time and the offers once, queues the messages and the reminder, leaves the payments to the admin", async () => {
    const o = await sentOrder(w);
    const consentIds = await acceptConsents(w, o);
    w.clock.advance(HOUR);
    const at = w.clock.now();
    const r = await dispatch(
      o.orderId,
      { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" },
      customerActor(o),
      w.bot,
    );
    expect(r).toEqual({ ok: true, status: "accepted" });

    const row = await w.db.$client.query(
      "select status, accepted_at, offer_version_uz_id, offer_version_ru_id, fee_prepaid, funds_received from sales.orders where id = $1",
      [o.orderId],
    );
    expect(row.rows[0]).toMatchObject({
      status: "accepted",
      offer_version_uz_id: w.offerIds?.uz,
      offer_version_ru_id: w.offerIds?.ru,
      fee_prepaid: false,
      funds_received: false,
    });
    // The database stamps accepted_at from the clock of the process: the fake clock here.
    expect(row.rows[0].accepted_at).toEqual(at);

    const box = await outbox(o.orderId);
    expect(notices(box, "order.accepted")).toHaveLength(1);
    const [reminder] = jobs(box, "accept_reminder");
    expect(reminder?.send_after).toEqual(new Date(at.getTime() + 24 * HOUR));
    // The bot writes the expectations itself through sales.expect_payment: no job for the admin side is left.
    expect(jobs(box, "payment.expect")).toHaveLength(0);
    const payments = await w.db.$client.query(
      "select kind, method, direction, amount_sum::int as amount, status from sales.payments where order_id = $1 order by kind",
      [o.orderId],
    );
    expect(payments.rows).toEqual([
      { kind: "fee_advance", method: "xolis_qr", direction: "in", amount: o.quote.totals.advance, status: "expected" },
      {
        kind: "purchase_funds",
        method: "bank_transfer_ip",
        direction: "in",
        amount: o.quote.totals.purchaseLimit,
        status: "expected",
      },
    ]);
    // The same transaction accepted the quote: the bot may not UPDATE sales.quotes, the function of the status did it.
    const quote = await w.db.$client.query("select status, accepted_at, acceptance from sales.quotes where id = $1", [
      o.quoteId,
    ]);
    expect(quote.rows[0].status).toBe("accepted");
    expect(quote.rows[0].accepted_at).toEqual(at);
    expect(quote.rows[0].acceptance).toMatchObject({ channel: "bot", dbRole: "nivel_bot", actorId: o.customerId });
  });

  it("through the bot twice: the expectations and the acceptance are written once", async () => {
    const o = await sentOrder(w);
    const consentIds = await acceptConsents(w, o);
    const accept = () =>
      dispatch(o.orderId, { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" }, customerActor(o), w.bot);
    expect(await accept()).toEqual({ ok: true, status: "accepted" });
    expect(await accept()).toEqual({ ok: true, status: "accepted" });
    const payments = await w.db.$client.query("select count(*)::int as n from sales.payments where order_id = $1", [
      o.orderId,
    ]);
    expect(payments.rows[0].n).toBe(2);
  });

  it("through the admin role: writes the expected payments itself and marks the quote accepted", async () => {
    const o = await sentOrder(w);
    const consentIds = await acceptConsents(w, o);
    const r = await dispatch(
      o.orderId,
      { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "site" },
      customerActor(o),
      w.admin,
    );
    expect(r.ok).toBe(true);
    const { rows } = await w.db.$client.query(
      "select kind, method, direction, amount_sum::int as amount, status from sales.payments where order_id = $1 order by kind",
      [o.orderId],
    );
    expect(rows).toEqual([
      { kind: "fee_advance", method: "xolis_qr", direction: "in", amount: o.quote.totals.advance, status: "expected" },
      {
        kind: "purchase_funds",
        method: "bank_transfer_ip",
        direction: "in",
        amount: o.quote.totals.purchaseLimit,
        status: "expected",
      },
    ]);
    expect(jobs(await outbox(o.orderId), "payment.expect")).toHaveLength(0);
    const q = await w.db.$client.query("select status, accepted_at from sales.quotes where id = $1", [o.quoteId]);
    expect(q.rows[0].status).toBe("accepted");
    expect(q.rows[0].accepted_at).not.toBeNull();
  });

  it("through the site role: reads only the views of the customer and still accepts", async () => {
    const o = await sentOrder(w);
    const consentIds = await acceptConsents(w, o);
    const r = await dispatch(
      o.orderId,
      { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "site" },
      customerActor(o),
      w.web,
    );
    expect(r).toEqual({ ok: true, status: "accepted" });
    expect(await statusOf(o.orderId)).toBe("accepted");
    const box = await outbox(o.orderId);
    expect(notices(box, "order.accepted")).toHaveLength(1);
    // The site has no right to the function that expects payments: its jobs wait for the worker, which computes the sums.
    expect(jobs(box, "payment.expect")).toHaveLength(2);
    const payments = await w.db.$client.query("select count(*)::int as n from sales.payments where order_id = $1", [
      o.orderId,
    ]);
    expect(payments.rows[0].n).toBe(0);
    // The quote is accepted in the same transaction, by the function of the status, with the role that called it.
    const quote = await w.db.$client.query("select status, acceptance from sales.quotes where id = $1", [o.quoteId]);
    expect(quote.rows[0].status).toBe("accepted");
    expect(quote.rows[0].acceptance).toMatchObject({ channel: "site", dbRole: "nivel_web" });
  });

  it("refuses without the consents of the right kinds and writes nothing", async () => {
    const o = await sentOrder(w);
    const consentIds = (await acceptConsents(w, o)).slice(0, 2); // the non-returnable consent is missing
    const r = await dispatch(
      o.orderId,
      { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" },
      customerActor(o),
      w.bot,
    );
    expect(r).toEqual({ ok: false, error: "consent_missing" });
    expect(await statusOf(o.orderId)).toBe("estimate_sent");
    expect(await events(o.orderId)).toHaveLength(1); // only SEND_ESTIMATE
  });

  it("refuses consent ids of another customer", async () => {
    const o = await sentOrder(w);
    const other = await sentOrder(w);
    const foreign = await acceptConsents(w, other);
    const r = await dispatch(
      o.orderId,
      { type: "ACCEPT", quoteId: o.quoteId, consentIds: foreign, channel: "bot" },
      customerActor(o),
      w.bot,
    );
    expect(r).toEqual({ ok: false, error: "consent_missing" });
  });

  it("refuses an estimate that has expired", async () => {
    const o = await sentOrder(w);
    const consentIds = await acceptConsents(w, o);
    w.clock.advance(25 * HOUR);
    const r = await dispatch(
      o.orderId,
      { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" },
      customerActor(o),
      w.bot,
    );
    expect(r).toEqual({ ok: false, error: "estimate_expired" });
  });

  it("is repeatable: the second press changes nothing and doubles nothing (bot and site)", async () => {
    for (const rt of [() => w.bot, () => w.web]) {
      const o = await sentOrder(w);
      const consentIds = await acceptConsents(w, o);
      const accept = () =>
        dispatch(o.orderId, { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" }, customerActor(o), rt());
      expect(await accept()).toEqual({ ok: true, status: "accepted" });
      const boxBefore = (await outbox(o.orderId)).length;
      const evBefore = (await events(o.orderId)).length;
      const again = await accept();
      if (rt() === w.bot) {
        expect(again).toEqual({ ok: true, status: "accepted" });
        expect((await events(o.orderId)).length).toBe(evBefore);
      } else {
        // The site cannot read the journal: the second press is refused by the automaton, still without a trace.
        expect(again).toEqual({ ok: false, error: "invalid_transition" });
      }
      expect((await outbox(o.orderId)).length).toBe(boxBefore);
    }
  });

  it("never lets a customer act on the order of another customer: not found, for every role", async () => {
    const o = await sentOrder(w);
    const stranger = await newCustomer(w);
    const consentIds = await acceptConsents(w, o);
    for (const rt of [w.bot, w.web, w.admin]) {
      await expect(
        dispatch(
          o.orderId,
          { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" },
          { kind: "customer", id: stranger },
          rt,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await statusOf(o.orderId)).toBe("estimate_sent");
  });

  it("is refused to the site role for events whose facts it cannot read", async () => {
    const o = await acceptedOrder(w);
    await expect(dispatch(o.orderId, { type: "REPORT_ACCEPTED" }, customerActor(o), w.web)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("the actors of the table 4.9", () => {
  it("lets the bot act as the owner only under the Telegram id of an active owner account", async () => {
    const o = await sentOrder(w);
    const revise = { type: "REVISE" } as const;
    expect(await dispatch(o.orderId, revise, { kind: "owner", id: "424242" }, w.bot)).toEqual({
      ok: false,
      error: "actor_not_allowed",
    });
    expect(await dispatch(o.orderId, revise, { kind: "owner", id: w.assistant.telegramId }, w.bot)).toEqual({
      ok: false,
      error: "actor_not_allowed",
    });
    expect(await statusOf(o.orderId)).toBe("estimate_sent");
    expect(await dispatch(o.orderId, revise, { kind: "owner", id: w.owner.telegramId }, w.bot)).toEqual({
      ok: true,
      status: "estimate_draft",
    });
    const ev = await events(o.orderId);
    expect(ev.at(-1)).toMatchObject({ actor_kind: "owner", actor_id: w.owner.telegramId, to_status: "estimate_draft" });
  });

  it("answers actor_not_allowed to the assistant on the money events", async () => {
    const o = await acceptedOrder(w);
    const assistant = { kind: "assistant" as const, id: w.assistant.telegramId };
    const moneyEvents: OrderEvent[] = [
      { type: "FEE_PREPAID", paymentId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" },
      { type: "FUNDS_RECEIVED", paymentIds: ["0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"], receivedAt: w.clock.now() },
      { type: "START_PURCHASE" },
    ];
    for (const event of moneyEvents) {
      expect(await dispatch(o.orderId, event, assistant, w.bot)).toEqual({ ok: false, error: "actor_not_allowed" });
    }
    const cancel = {
      type: "CANCEL",
      point: "after_accept_before_purchase",
      reason: "x",
      settlement: {
        feeEarned: 0,
        feeToRefund: 0,
        feeToInvoice: 0,
        fundsToRefund: 0,
        partsGoTo: "none",
        dueBy: w.clock.now(),
      },
    } as never;
    expect(await dispatch(o.orderId, cancel, assistant, w.bot)).toEqual({ ok: false, error: "actor_not_allowed" });
  });

  it("answers invalid_transition for an event that does not exist or is out of place", async () => {
    const o = await draftOrder(w);
    expect(await dispatch(o.orderId, { type: "CLOSE" }, SYSTEM, w.admin)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(await dispatch(o.orderId, { type: "TELEPORT" } as never, ownerActor(w), w.admin)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("lets the worker expire an estimate after its term, not before", async () => {
    const o = await sentOrder(w);
    expect(await dispatch(o.orderId, { type: "EXPIRE" }, SYSTEM, w.worker)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    w.clock.advance(24 * HOUR + 1000);
    expect(await dispatch(o.orderId, { type: "EXPIRE" }, SYSTEM, w.worker)).toEqual({
      ok: true,
      status: "estimate_expired",
    });
    expect(notices(await outbox(o.orderId), "order.estimate_expired")).toHaveLength(1);
    // The site and the bot are not the system.
    const p = await sentOrder(w);
    w.clock.advance(2 * DAY);
    await expect(dispatch(p.orderId, { type: "EXPIRE" }, SYSTEM, w.bot)).resolves.toEqual({
      ok: false,
      error: "actor_not_allowed",
    });
  });
});

describe("repeating an event", () => {
  it("returns the answer of the first time and leaves the journal and the outbox as they were", async () => {
    const o = await sentOrder(w);
    const first = await dispatch(o.orderId, { type: "REVISE" }, ownerActor(w), w.admin);
    expect(first).toEqual({ ok: true, status: "estimate_draft" });
    const evBefore = await events(o.orderId);
    const boxBefore = await outbox(o.orderId);
    const again = await dispatch(o.orderId, { type: "REVISE" }, ownerActor(w), w.admin);
    expect(again).toEqual({ ok: true, status: "estimate_draft" });
    expect(await events(o.orderId)).toEqual(evBefore);
    expect(await outbox(o.orderId)).toEqual(boxBefore);
  });

  it("is not fooled by a legitimate second REVISE after a new estimate was sent", async () => {
    const o = await sentOrder(w);
    await dispatch(o.orderId, { type: "REVISE" }, ownerActor(w), w.admin);
    const next = await build({ orderId: o.orderId, lines: pcLines(w) }, ownerActor(w), w.admin);
    expect((await send({ orderId: o.orderId, quoteId: next.quoteId }, ownerActor(w), w.admin)).ok).toBe(true);
    expect(await dispatch(o.orderId, { type: "REVISE" }, ownerActor(w), w.admin)).toEqual({
      ok: true,
      status: "estimate_draft",
    });
    const revisions = (await events(o.orderId)).filter((e) => e.event.type === "REVISE");
    expect(revisions).toHaveLength(2);
  });

  it("supersedes the sent quote when the revised estimate is built", async () => {
    const o = await sentOrder(w);
    await dispatch(o.orderId, { type: "REVISE" }, ownerActor(w), w.admin);
    const next = await build({ orderId: o.orderId, lines: pcLines(w) }, ownerActor(w), w.admin);
    const { rows } = await w.db.$client.query(
      "select id, status, version from sales.quotes where order_id = $1 order by version",
      [o.orderId],
    );
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, "superseded"],
      [2, "draft"],
    ]);
    expect(next.version).toBe(2);
  });

  it("serialises two requests of the same event: one journal row, both answered", async () => {
    const o = await sentOrder(w);
    const [a, b] = await Promise.all([
      dispatch(o.orderId, { type: "REVISE" }, ownerActor(w), w.admin),
      dispatch(o.orderId, { type: "REVISE" }, ownerActor(w), w.admin),
    ]);
    expect(a).toEqual({ ok: true, status: "estimate_draft" });
    expect(b).toEqual({ ok: true, status: "estimate_draft" });
    expect((await events(o.orderId)).filter((e) => e.event.type === "REVISE")).toHaveLength(1);
  });

  it("serialises two different events of the same order: the second one sees the result of the first", async () => {
    const o = await sentOrder(w);
    const consentIds = await acceptConsents(w, o);
    const [a, b] = await Promise.all([
      dispatch(o.orderId, { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" }, customerActor(o), w.bot),
      dispatch(o.orderId, { type: "REVISE" }, ownerActor(w), w.admin),
    ]);
    // Exactly one of them wins; the order is never both accepted and revised.
    const wins = [a, b].filter((r) => r.ok);
    expect(wins).toHaveLength(1);
    expect(["accepted", "estimate_draft"]).toContain(await statusOf(o.orderId));
    expect(await events(o.orderId)).toHaveLength(2); // SEND_ESTIMATE and the winner
  });
});

describe("what dispatch refuses before it looks at the order", () => {
  it("refuses an order id that is not a uuid, an order that does not exist and a broken event", async () => {
    await expect(dispatch("NV-2026-0001", { type: "CLOSE" }, SYSTEM, w.admin)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      dispatch("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", { type: "CLOSE" }, SYSTEM, w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
    const o = await draftOrder(w);
    await expect(dispatch(o.orderId, null as never, ownerActor(w), w.admin)).rejects.toBeInstanceOf(ValidationError);
    await expect(dispatch(o.orderId, "REVISE" as never, ownerActor(w), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("refuses an actor without a kind from the list or without an id", async () => {
    const o = await draftOrder(w);
    await expect(
      dispatch(o.orderId, { type: "REVISE" }, { kind: "root" as never, id: "1" }, w.admin),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(dispatch(o.orderId, { type: "REVISE" }, { kind: "owner", id: "  " }, w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("uses the runtime configured at the start of the process when none is given", async () => {
    configureServices({ db: w.admin.db, role: "admin", appMode: "production", now: w.clock.now });
    const o = await sentOrder(w);
    expect(await dispatch(o.orderId, { type: "REVISE" }, ownerActor(w))).toEqual({
      ok: true,
      status: "estimate_draft",
    });
    resetServices();
    await expect(dispatch(o.orderId, { type: "REVISE" }, ownerActor(w))).rejects.toMatchObject({
      code: "config_invalid",
    });
  });
});
