import { describe, expect, it } from "vitest";
import { windowOf } from "./dispatch.ts";
import { eventDigest, eventIdentity } from "./keys.ts";

const owner = { kind: "owner" as const, id: "o-1" };
const row = (
  seq: number,
  event: Record<string, unknown>,
  from: string,
  to: string,
  actor: { kind: "owner" | "customer"; id: string } = owner,
) => ({
  seq,
  actorKind: actor.kind,
  actorId: actor.id,
  event,
  fromStatus: from,
  toStatus: to,
});
const digest = (e: Record<string, unknown>) => eventDigest(eventIdentity(e));

describe("windowOf: when an event is a repeat", () => {
  it("is a repeat when the same event by the same actor is in the window of the current status", () => {
    const journal = [
      row(1, { type: "SEND_ESTIMATE", quoteId: "q" }, "estimate_draft", "estimate_sent"),
      row(2, { type: "REVISE" }, "estimate_sent", "estimate_draft"),
    ];
    expect(windowOf(journal, digest({ type: "REVISE" }), owner)).toEqual({ anchor: 2, repeat: true });
  });

  it("is new when the same event came in an older window (the second REVISE of a revised estimate)", () => {
    const journal = [
      row(1, { type: "SEND_ESTIMATE", quoteId: "q1" }, "estimate_draft", "estimate_sent"),
      row(2, { type: "REVISE" }, "estimate_sent", "estimate_draft"),
      row(3, { type: "SEND_ESTIMATE", quoteId: "q2" }, "estimate_draft", "estimate_sent"),
    ];
    expect(windowOf(journal, digest({ type: "REVISE" }), owner)).toEqual({ anchor: 3, repeat: false });
  });

  it("is new when another actor sent it", () => {
    const journal = [row(1, { type: "REVISE" }, "estimate_sent", "estimate_draft")];
    expect(windowOf(journal, digest({ type: "REVISE" }), { kind: "owner", id: "o-2" }).repeat).toBe(false);
    expect(windowOf(journal, digest({ type: "REVISE" }), { kind: "assistant", id: "o-1" }).repeat).toBe(false);
  });

  it("tells the events that stay in the status apart by what they carry", () => {
    const journal = [
      row(1, { type: "START_PURCHASE" }, "accepted", "purchasing"),
      row(2, { type: "PURCHASE_RECORDED", purchaseId: "p1" }, "purchasing", "purchasing"),
      row(3, { type: "PURCHASE_RECORDED", purchaseId: "p2" }, "purchasing", "purchasing"),
    ];
    expect(windowOf(journal, digest({ type: "PURCHASE_RECORDED", purchaseId: "p1" }), owner).repeat).toBe(true);
    expect(windowOf(journal, digest({ type: "PURCHASE_RECORDED", purchaseId: "p3" }), owner).repeat).toBe(false);
  });

  it("has no window and no repeat on an empty journal", () => {
    expect(windowOf([], digest({ type: "SEND_ESTIMATE" }), owner)).toEqual({ anchor: 0, repeat: false });
  });

  it("recognises a repeated cancellation whatever amounts it carried", () => {
    const stored = { type: "CANCEL", point: "before_accept", reason: "x", settlement: { feeEarned: 5 } };
    const journal = [row(1, stored, "estimate_sent", "cancelling")];
    const incoming = { type: "CANCEL", point: "before_accept", reason: "x", settlement: { feeEarned: 0 } };
    expect(windowOf(journal, digest(incoming), owner).repeat).toBe(true);
  });

  it("is new when the same objection comes after the owner answered the earlier one", () => {
    const customer = { kind: "customer" as const, id: "c-1" };
    const journal = [
      row(1, { type: "SEND_REPORT", reportId: "r" }, "report_due", "report_sent"),
      row(2, { type: "OBJECTION", text: "Savol bor" }, "report_sent", "report_sent", customer),
    ];
    const d = digest({ type: "OBJECTION", text: "Savol bor" });
    expect(windowOf(journal, d, customer)).toEqual({ anchor: 1, repeat: true });
    expect(windowOf(journal, d, customer, 1)).toEqual({ anchor: 1, repeat: true });
    expect(windowOf(journal, d, customer, 2)).toEqual({ anchor: 1, repeat: false });
  });
});
