import type { Effect, OrderEvent } from "@nivel/domain/order";
import { describe, expect, it } from "vitest";
import { buildChanges } from "./changes.ts";
import type { OrderRow } from "./snapshot.ts";

const NOW = new Date("2026-10-13T05:00:00Z");
const empty = {
  acceptedAt: null,
  offerVersionUzId: null,
  offerVersionRuId: null,
  handedOverAt: null,
  warrantyUntil: null,
  purchaseNotBefore: null,
  reportDueAt: null,
  objectionUntil: null,
  refundDueAt: null,
  podborCreditUntil: null,
  documentedLossesSum: 0,
} as unknown as OrderRow;
const offers: { uzId: string | null; ruId: string | null } = { uzId: "uz-1", ruId: "ru-1" };
const at = (iso: string) => new Date(iso);

const run = (
  event: OrderEvent,
  actor: "owner" | "customer" | "system" | "assistant",
  extra: { order?: Partial<OrderRow>; effects?: Effect[]; documentedLosses?: number; offers?: typeof offers } = {},
) =>
  buildChanges({
    order: { ...empty, ...extra.order } as OrderRow,
    event,
    actor,
    effects: extra.effects ?? [],
    now: NOW,
    offers: extra.offers ?? offers,
    ...(extra.documentedLosses === undefined ? {} : { documentedLosses: extra.documentedLosses }),
  });

describe("buildChanges", () => {
  it("writes the flags of the money events", () => {
    expect(run({ type: "FEE_PREPAID", paymentId: "p" }, "owner")).toEqual({ fee_prepaid: true });
    expect(run({ type: "MEETING_DONE" }, "owner")).toEqual({ first_order_meeting_done: true });
    const received = at("2026-10-12T05:00:00Z");
    expect(
      run({ type: "FUNDS_RECEIVED", paymentIds: ["p"], receivedAt: received }, "owner", {
        effects: [{ kind: "set", field: "purchaseNotBefore", at: at("2026-10-13T05:00:00Z") }],
      }),
    ).toEqual({
      funds_received: true,
      funds_received_at: "2026-10-12T05:00:00.000Z",
      purchase_not_before: "2026-10-13T05:00:00.000Z",
    });
  });

  it("gives the customer the acceptance time and the offers it accepts, as empty fields", () => {
    const e: OrderEvent = { type: "ACCEPT", quoteId: "q", consentIds: [], channel: "bot" };
    expect(run(e, "customer")).toEqual({
      accepted_at: "2026-10-13T05:00:00.000Z",
      offer_version_uz_id: "uz-1",
      offer_version_ru_id: "ru-1",
    });
  });

  it("writes no offer version that does not exist", () => {
    const e: OrderEvent = { type: "ACCEPT", quoteId: "q", consentIds: [], channel: "bot" };
    expect(run(e, "customer", { offers: { uzId: null, ruId: null } })).toEqual({
      accepted_at: "2026-10-13T05:00:00.000Z",
    });
    expect(run(e, "customer", { offers: { uzId: "uz-1", ruId: null } })).toHaveProperty("offer_version_uz_id");
  });

  it("never rewrites a field a customer wrote before: the database would refuse it", () => {
    const e: OrderEvent = { type: "ACCEPT", quoteId: "q", consentIds: [], channel: "bot" };
    const out = run(e, "customer", {
      order: { acceptedAt: at("2026-10-12T05:00:00Z"), offerVersionUzId: "old-uz" } as Partial<OrderRow>,
    });
    expect(out).toEqual({ offer_version_ru_id: "ru-1" });
  });

  it("lets the owner correct what is already there", () => {
    const e: OrderEvent = { type: "ACCEPT", quoteId: "q", consentIds: [], channel: "bot" };
    const out = run(e, "owner", { order: { acceptedAt: at("2026-10-12T05:00:00Z") } as Partial<OrderRow> });
    expect(out.accepted_at).toBe("2026-10-13T05:00:00.000Z");
  });

  it("writes the handover and the warranty of the effects, once for a customer", () => {
    const e: OrderEvent = { type: "HANDOVER", actId: "a", finalPaymentId: "p" };
    const effects: Effect[] = [{ kind: "set", field: "warrantyUntil", at: at("2027-10-13T05:00:00Z") }];
    expect(run(e, "customer", { effects })).toEqual({
      handed_over_at: "2026-10-13T05:00:00.000Z",
      warranty_until: "2027-10-13T05:00:00.000Z",
    });
    expect(
      run(e, "customer", {
        effects,
        order: {
          handedOverAt: at("2026-10-01T00:00:00Z"),
          warrantyUntil: at("2027-10-01T00:00:00Z"),
        } as Partial<OrderRow>,
      }),
    ).toEqual({});
  });

  it("maps every field the domain can set to its column", () => {
    const effects: Effect[] = (
      [
        ["purchaseNotBefore", "purchase_not_before"],
        ["warrantyUntil", "warranty_until"],
        ["reportDueAt", "report_due_at"],
        ["objectionUntil", "objection_until"],
        ["refundDueAt", "refund_due_at"],
        ["podborCreditUntil", "podbor_credit_until"],
      ] as const
    ).map(([field]) => ({ kind: "set", field, at: NOW }));
    const out = run({ type: "SEND_REPORT", reportId: "r" }, "owner", { effects });
    expect(Object.keys(out).sort()).toEqual(
      [
        "purchase_not_before",
        "warranty_until",
        "report_due_at",
        "objection_until",
        "refund_due_at",
        "podbor_credit_until",
      ].sort(),
    );
  });

  it("stores the settlement of a cancellation as text, with the reason and the time", () => {
    const settlement = {
      feeEarned: 1,
      feeToRefund: 2,
      feeToInvoice: 0,
      fundsToRefund: 3,
      partsGoTo: "none",
      dueBy: at("2026-10-20T05:00:00Z"),
    };
    const out = run({ type: "CANCEL", point: "before_accept", reason: "x", settlement } as never, "owner");
    expect(out.cancel).toEqual({
      point: "before_accept",
      reason: "x",
      settlement: { ...settlement, dueBy: "2026-10-20T05:00:00.000Z" },
      at: "2026-10-13T05:00:00.000Z",
    });
    expect(out).not.toHaveProperty("documented_losses_sum");
  });

  it("writes the documented losses only when they differ from what the order has", () => {
    const e = { type: "CANCEL", point: "before_accept", reason: "x", settlement: { dueBy: NOW } } as never;
    expect(run(e, "owner", { documentedLosses: 500 }).documented_losses_sum).toBe(500);
    expect(run(e, "owner", { documentedLosses: 0 })).not.toHaveProperty("documented_losses_sum");
    expect(
      run(e, "owner", { documentedLosses: 500, order: { documentedLossesSum: 500 } as Partial<OrderRow> }),
    ).not.toHaveProperty("documented_losses_sum");
  });

  it("writes nothing for the events that change only the status", () => {
    for (const e of [
      { type: "EXPIRE" },
      { type: "CLOSE" },
      { type: "DISPATCH" },
      { type: "ASSEMBLED" },
    ] as OrderEvent[]) {
      expect(run(e, "system")).toEqual({});
    }
  });
});
