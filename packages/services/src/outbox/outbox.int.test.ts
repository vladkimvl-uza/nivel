import { ops } from "@nivel/db/repos";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValidationError } from "../orders/errors.ts";
import { createWorld, HOUR, type World } from "../test-support/world.ts";
import { enqueue } from "./index.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const message = (over: Record<string, unknown> = {}) => ({
  kind: "telegram_message" as const,
  payload: { target: "customer", templateKey: "order.accepted", orderId: "o-1" },
  ...over,
});
const rowOf = async (id: string) => (await w.db.$client.query("select * from ops.outbox where id = $1", [id])).rows[0];

describe("outbox.enqueue", () => {
  it("queues a message for the relay: pending, no attempts, due now", async () => {
    const { id, duplicate } = await enqueue(message(), {}, w.bot);
    expect(duplicate).toBe(false);
    const row = await rowOf(id);
    expect(row).toMatchObject({
      kind: "telegram_message",
      status: "pending",
      attempts: 0,
      priority: 0,
      dedupe_key: null,
    });
    expect(row.payload).toEqual({ target: "customer", templateKey: "order.accepted", orderId: "o-1" });
  });

  it("a repeat with the same key is not queued again and answers with the first row", async () => {
    const a = await enqueue(message({ dedupeKey: "k-1" }), {}, w.bot);
    const b = await enqueue(
      message({ dedupeKey: "k-1", payload: { target: "customer", templateKey: "other" } }),
      {},
      w.web,
    );
    expect(b).toEqual({ id: a.id, duplicate: true });
    expect(
      (await w.db.$client.query("select count(*)::int as n from ops.outbox where dedupe_key = 'k-1'")).rows[0].n,
    ).toBe(1);
  });

  it("holds a delayed message until its time, by the time named, not by the clock of the caller", async () => {
    const at = new Date(w.clock.now().getTime() + 24 * HOUR);
    const { id } = await enqueue(
      { kind: "job", payload: { job: "accept_reminder", orderId: "o-2" }, sendAfter: at },
      {},
      w.worker,
    );
    expect((await rowOf(id)).send_after).toEqual(at);
    const claimed = async (now: Date) =>
      w.db.transaction(async (tx) => (await ops.claimOutbox(tx, 100, now)).map((r) => r.id));
    expect(await claimed(new Date(at.getTime() - 1))).not.toContain(id);
    expect(await claimed(at)).toContain(id);
  });

  it("a more urgent message goes first", async () => {
    const low = await enqueue(
      message({ priority: 0, payload: { target: "customer", templateKey: "a", n: 1 } }),
      {},
      w.bot,
    );
    const high = await enqueue(
      message({ priority: 5, payload: { target: "customer", templateKey: "b", n: 2 } }),
      {},
      w.bot,
    );
    const batch = await w.db.transaction(async (tx) => (await ops.claimOutbox(tx, 1000)).map((r) => r.id));
    expect(batch.indexOf(high.id)).toBeLessThan(batch.indexOf(low.id));
  });

  it("joins the transaction of the caller: it is queued with the status change or not at all", async () => {
    const key = `tx-${Date.now()}`;
    await w.db
      .transaction(async (tx) => {
        await enqueue(message({ dedupeKey: key }), { executor: tx }, w.admin);
        throw new Error("the status change failed");
      })
      .catch(() => undefined);
    expect(
      (await w.db.$client.query("select count(*)::int as n from ops.outbox where dedupe_key = $1", [key])).rows[0].n,
    ).toBe(0);
    await w.db.transaction(async (tx) => {
      await enqueue(message({ dedupeKey: key }), { executor: tx }, w.admin);
    });
    expect(
      (await w.db.$client.query("select count(*)::int as n from ops.outbox where dedupe_key = $1", [key])).rows[0].n,
    ).toBe(1);
  });

  it("refuses what the relay could not send: a kind, a target, a template, a job name, a payload that is not an object", async () => {
    const bad = (m: unknown) => enqueue(m as never, {}, w.bot);
    await expect(bad({ kind: "sms", payload: {} })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ kind: "telegram_message", payload: { templateKey: "x" } })).rejects.toMatchObject({
      issues: [{ path: "payload.target" }],
    });
    await expect(bad({ kind: "telegram_message", payload: { target: "customer" } })).rejects.toMatchObject({
      issues: [{ path: "payload.templateKey" }],
    });
    await expect(
      bad({ kind: "telegram_message", payload: { target: "everyone", templateKey: "x" } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ kind: "job", payload: {} })).rejects.toMatchObject({ issues: [{ path: "payload.job" }] });
    await expect(bad({ kind: "job", payload: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ kind: "job", payload: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad(null)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a key, a priority, a time and a payload that are out of bounds", async () => {
    await expect(enqueue(message({ dedupeKey: "k".repeat(201) }), {}, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(enqueue(message({ dedupeKey: "" }), {}, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(enqueue(message({ priority: 1.5 }), {}, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(enqueue(message({ priority: 100 }), {}, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(enqueue(message({ sendAfter: new Date("x") }), {}, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      enqueue(message({ payload: { target: "customer", templateKey: "x", blob: "y".repeat(20_000) } }), {}, w.bot),
    ).rejects.toMatchObject({ issues: [{ code: "payload_too_large" }] });
  });

  it("keeps the number of a card out of the queue", async () => {
    await expect(
      enqueue(
        message({ payload: { target: "customer", templateKey: "x", text: "pay to 8600 1234 5678 9012" } }),
        {},
        w.bot,
      ),
    ).rejects.toMatchObject({ issues: [{ code: "card_number" }] });
  });
});
