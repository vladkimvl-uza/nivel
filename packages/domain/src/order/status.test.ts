import { describe, expect, it } from "vitest";
import { customerStatus, customerStatusFor, orderApi } from "./index.ts";
import { ALL_STATUSES } from "./testkit.ts";
import type { CustomerStatus, OrderStatus } from "./types.ts";

// ARCHITECTURE 4.9: the projection for the customer (CONCEPT 5.9).
const PROJECTION: Record<OrderStatus, CustomerStatus> = {
  estimate_draft: "submitted",
  estimate_sent: "submitted",
  estimate_expired: "submitted",
  accepted: "estimate_confirmed",
  purchasing: "purchasing",
  report_due: "purchasing",
  report_sent: "receipts_summary",
  settled: "receipts_summary",
  assembling: "assembly_test",
  testing: "assembly_test",
  ready: "ready",
  delivering: "ready",
  handed_over: "handed_over",
  closed: "handed_over",
  podbor_delivered: "handed_over",
  cancelling: "cancelled",
  cancelled: "cancelled",
};

describe("customerStatus", () => {
  it.each(ALL_STATUSES)("%s", (status) => {
    expect(customerStatus(status)).toBe(PROJECTION[status]);
  });

  it("covers every status of the contract", () => {
    expect(Object.keys(PROJECTION).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("throws RangeError for an unknown status", () => {
    expect(() => customerStatus("nope" as OrderStatus)).toThrow(RangeError);
    expect(() => customerStatus("constructor" as OrderStatus)).toThrow(RangeError);
  });

  it("is part of the order contract object", () => {
    expect(orderApi.customerStatus).toBe(customerStatus);
  });
});

describe("customerStatusFor: accepted splits into waiting and prepaid", () => {
  const flags = { feePrepaid: false, fundsReceived: false, firstOrderMeetingDone: false };

  it("accepted without the advance: estimate_confirmed (waiting for the prepayment)", () => {
    expect(customerStatusFor("accepted", flags)).toBe("estimate_confirmed");
  });

  it("accepted with the advance: prepaid", () => {
    expect(customerStatusFor("accepted", { ...flags, feePrepaid: true })).toBe("prepaid");
    expect(customerStatusFor("accepted", { ...flags, feePrepaid: true, fundsReceived: true })).toBe("prepaid");
  });

  it("only the advance counts, purchase funds alone do not", () => {
    expect(customerStatusFor("accepted", { ...flags, fundsReceived: true })).toBe("estimate_confirmed");
  });

  it.each(ALL_STATUSES.filter((s) => s !== "accepted"))("%s ignores the flags", (status) => {
    expect(customerStatusFor(status, { ...flags, feePrepaid: true })).toBe(PROJECTION[status]);
  });
});
