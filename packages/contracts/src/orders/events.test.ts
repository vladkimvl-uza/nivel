import { describe, expect, it } from "vitest";
import { ActorRefSchema, DispatchInputSchema, OrderEventSchema } from "./index.ts";

const uuid = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("ActorRefSchema", () => {
  it("accepts the four kinds with a non-empty id", () => {
    for (const kind of ["system", "customer", "owner", "assistant"]) {
      expect(ActorRefSchema.safeParse({ kind, id: "123456789" }).success).toBe(true);
    }
  });

  it.each([{ kind: "owner", id: "" }, { kind: "owner", id: "   " }, { kind: "root", id: "1" }, { kind: "owner" }])(
    "rejects %j",
    (actor) => {
      expect(ActorRefSchema.safeParse(actor).success).toBe(false);
    },
  );

  it("trims the id", () => {
    expect(ActorRefSchema.parse({ kind: "owner", id: " 42 " }).id).toBe("42");
  });
});

describe("OrderEventSchema", () => {
  it("parses events without payload", () => {
    for (const type of ["EXPIRE", "REVISE", "MEETING_DONE", "START_PURCHASE", "PURCHASE_DONE", "CLOSE", "DISPATCH"]) {
      expect(OrderEventSchema.parse({ type })).toEqual({ type });
    }
  });

  it("parses ACCEPT with consent ids and a channel", () => {
    const e = { type: "ACCEPT", quoteId: uuid, consentIds: [uuid, uuid], channel: "bot" };
    expect(OrderEventSchema.parse(e)).toEqual(e);
    expect(OrderEventSchema.safeParse({ ...e, channel: "fax" }).success).toBe(false);
    expect(OrderEventSchema.safeParse({ ...e, consentIds: ["x"] }).success).toBe(false);
  });

  it("turns an ISO string of receivedAt into a Date", () => {
    const e = OrderEventSchema.parse({
      type: "FUNDS_RECEIVED",
      paymentIds: [uuid],
      receivedAt: "2026-10-12T09:30:00+05:00",
    });
    expect(e.type === "FUNDS_RECEIVED" && e.receivedAt.toISOString()).toBe("2026-10-12T04:30:00.000Z");
  });

  it("rejects FUNDS_RECEIVED without payments or with an invalid date", () => {
    expect(OrderEventSchema.safeParse({ type: "FUNDS_RECEIVED", paymentIds: [], receivedAt: new Date() }).success).toBe(
      false,
    );
    expect(OrderEventSchema.safeParse({ type: "FUNDS_RECEIVED", paymentIds: [uuid], receivedAt: "soon" }).success).toBe(
      false,
    );
  });

  it("requires a non-blank text for OBJECTION and a reason for CANCEL", () => {
    expect(OrderEventSchema.safeParse({ type: "OBJECTION", text: " " }).success).toBe(false);
    expect(OrderEventSchema.safeParse({ type: "OBJECTION", text: "Price of the SSD" }).success).toBe(true);
    const cancel = {
      type: "CANCEL",
      point: "before_accept",
      reason: "changed my mind",
      settlement: {
        feeEarned: 0,
        feeToRefund: 0,
        feeToInvoice: 0,
        fundsToRefund: 0,
        partsGoTo: "none",
        dueBy: "2026-10-13T00:00:00Z",
      },
    };
    expect(OrderEventSchema.safeParse(cancel).success).toBe(true);
    expect(OrderEventSchema.safeParse({ ...cancel, reason: "" }).success).toBe(false);
    expect(OrderEventSchema.safeParse({ ...cancel, point: "later" }).success).toBe(false);
  });

  it("rejects sums that are not whole numbers inside the settlement", () => {
    const base = {
      type: "CANCEL",
      point: "before_accept",
      reason: "x",
      settlement: {
        feeEarned: 0.5,
        feeToRefund: 0,
        feeToInvoice: 0,
        fundsToRefund: 0,
        partsGoTo: "none",
        dueBy: new Date(),
      },
    };
    expect(OrderEventSchema.safeParse(base).success).toBe(false);
  });

  it("rejects an unknown event type and unknown keys", () => {
    expect(OrderEventSchema.safeParse({ type: "TELEPORT" }).success).toBe(false);
    expect(OrderEventSchema.safeParse({ type: "CLOSE", status: "closed" }).success).toBe(false);
  });

  it("requires the ids of documents where the automaton does", () => {
    expect(OrderEventSchema.safeParse({ type: "HANDOVER", actId: uuid }).success).toBe(false);
    expect(OrderEventSchema.safeParse({ type: "HANDOVER", actId: uuid, finalPaymentId: uuid }).success).toBe(true);
    expect(OrderEventSchema.safeParse({ type: "MATERIALS_ACCEPTED", actId: "" }).success).toBe(false);
    expect(OrderEventSchema.safeParse({ type: "TESTS_PASSED", passportId: uuid }).success).toBe(true);
  });
});

describe("DispatchInputSchema", () => {
  it("parses a whole dispatch call", () => {
    const input = DispatchInputSchema.parse({
      orderId: uuid,
      event: { type: "DISPATCH" },
      actor: { kind: "owner", id: "1" },
    });
    expect(input.actor.kind).toBe("owner");
  });

  it("rejects an order id that is not a uuid", () => {
    expect(
      DispatchInputSchema.safeParse({
        orderId: "NV-2026-0001",
        event: { type: "DISPATCH" },
        actor: { kind: "owner", id: "1" },
      }).success,
    ).toBe(false);
  });
});
