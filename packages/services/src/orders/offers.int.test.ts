// The offer is a stub until the lawyer approves it (DECISIONS R-25): an estimate goes out with the watermark "not an
// offer", the acceptance is refused in production and allowed in development, so that the flow can be tested.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { send } from "../quotes/send.ts";
import { dispatch } from "./dispatch.ts";
import { createRuntime } from "./runtime.ts";
import { acceptConsents, customerActor, draftOrder, ownerActor, sentOrder } from "./test-support/flow.ts";
import { createWorld, type World } from "./test-support/world.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld({ offers: "stub", appMode: "production" });
});
afterAll(async () => {
  await w.close();
});

describe("with the offers still stubs", () => {
  it("sends the estimate with the watermark on the quote and on its document", async () => {
    const o = await draftOrder(w);
    expect((await send({ orderId: o.orderId, quoteId: o.quoteId }, ownerActor(w), w.admin)).ok).toBe(true);
    const q = await w.db.$client.query("select watermark_draft from sales.quotes where id = $1", [o.quoteId]);
    expect(q.rows[0].watermark_draft).toBe(true);
    const pdf = await w.db.$client.query(
      "select payload from ops.outbox where payload->>'orderId' = $1 and payload->>'job' = 'pdf.render'",
      [o.orderId],
    );
    expect(pdf.rows[0].payload).toMatchObject({ doc: "quote", watermarkDraft: true });
  });

  it("does not let the customer accept in production", async () => {
    const o = await sentOrder(w);
    const consentIds = await acceptConsents(w, o);
    const r = await dispatch(
      o.orderId,
      { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" },
      customerActor(o),
      w.bot,
    );
    expect(r).toEqual({ ok: false, error: "offer_not_published" });
    const { rows } = await w.db.$client.query("select status, accepted_at from sales.orders where id = $1", [
      o.orderId,
    ]);
    expect(rows[0]).toEqual({ status: "estimate_sent", accepted_at: null });
  });

  it("lets it accept in development and fixes the stub versions on the order", async () => {
    const o = await sentOrder(w);
    const consentIds = await acceptConsents(w, o);
    const dev = createRuntime({ db: w.bot.db, role: "bot", appMode: "development", now: w.clock.now });
    const r = await dispatch(
      o.orderId,
      { type: "ACCEPT", quoteId: o.quoteId, consentIds, channel: "bot" },
      customerActor(o),
      dev,
    );
    expect(r).toEqual({ ok: true, status: "accepted" });
    const { rows } = await w.db.$client.query(
      "select offer_version_uz_id, offer_version_ru_id from sales.orders where id = $1",
      [o.orderId],
    );
    expect(rows[0]).toEqual({ offer_version_uz_id: w.offerIds?.uz, offer_version_ru_id: w.offerIds?.ru });
  });
});
