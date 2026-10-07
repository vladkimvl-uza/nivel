import { describe, expect, it } from "vitest";
import { buildEvent, parseSum, parseTashkentLocal, permissionOf } from "./build-event.ts";

const ID = "0199aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee";
const ID2 = "0199aaaa-bbbb-7ccc-8ddd-ffffffffffff";

function form(entries: Record<string, string | string[]>): {
  get(n: string): string | null;
  getAll(n: string): string[];
} {
  return {
    get: (n) => {
      const v = entries[n];
      return v === undefined ? null : Array.isArray(v) ? (v[0] ?? null) : v;
    },
    getAll: (n) => {
      const v = entries[n];
      return v === undefined ? [] : Array.isArray(v) ? v : [v];
    },
  };
}

describe("parseSum", () => {
  it("reads whole sums typed by a person, with spaces and non-breaking spaces", () => {
    expect(parseSum("1500000")).toBe(1_500_000);
    expect(parseSum("1 500 000")).toBe(1_500_000);
    expect(parseSum("1 500 000")).toBe(1_500_000);
    expect(parseSum(" 0 ")).toBe(0);
  });
  it("refuses a fraction, a sign, letters and an empty field", () => {
    for (const bad of ["1,5", "1.5", "-5", "abc", "", "  ", null, "1e6", "99999999999999999999"]) {
      expect(parseSum(bad), String(bad)).toBeNull();
    }
  });
});

describe("parseTashkentLocal", () => {
  it("reads the time of a datetime-local field as the wall clock of Tashkent", () => {
    expect(parseTashkentLocal("2026-10-12T15:30")?.toISOString()).toBe("2026-10-12T10:30:00.000Z");
  });
  it("refuses what is not a time", () => {
    expect(parseTashkentLocal("")).toBeNull();
    expect(parseTashkentLocal("12.10.2026")).toBeNull();
    expect(parseTashkentLocal("2026-02-31T10:00")).toBeNull();
  });
});

describe("buildEvent", () => {
  it("builds the events without a payload", () => {
    for (const type of [
      "REVISE",
      "MEETING_DONE",
      "START_PURCHASE",
      "PURCHASE_DONE",
      "ASSEMBLED",
      "DISPATCH",
      "CANCEL_SETTLED",
    ]) {
      expect(buildEvent(type, form({}), { orderId: ID })).toEqual({ ok: true, event: { type } });
    }
  });

  it("names the payment of the advance", () => {
    expect(buildEvent("FEE_PREPAID", form({ paymentId: ID }), { orderId: ID2 })).toEqual({
      ok: true,
      event: { type: "FEE_PREPAID", paymentId: ID },
    });
    const missing = buildEvent("FEE_PREPAID", form({}), { orderId: ID2 });
    expect(missing.ok).toBe(false);
  });

  it("collects the payments and the moment the money came", () => {
    const r = buildEvent("FUNDS_RECEIVED", form({ paymentIds: [ID, ID2], receivedAt: "2026-10-12T15:30" }), {
      orderId: ID,
    });
    expect(r).toEqual({
      ok: true,
      event: { type: "FUNDS_RECEIVED", paymentIds: [ID, ID2], receivedAt: new Date("2026-10-12T10:30:00Z") },
    });
    expect(buildEvent("FUNDS_RECEIVED", form({ receivedAt: "2026-10-12T15:30" }), { orderId: ID }).ok).toBe(false);
    expect(buildEvent("FUNDS_RECEIVED", form({ paymentIds: [ID] }), { orderId: ID }).ok).toBe(false);
  });

  it("takes the refund payment of the remainder only when it is named", () => {
    expect(buildEvent("REMAINDER_SETTLED", form({}), { orderId: ID })).toEqual({
      ok: true,
      event: { type: "REMAINDER_SETTLED" },
    });
    expect(buildEvent("REMAINDER_SETTLED", form({ refundPaymentId: ID2 }), { orderId: ID })).toEqual({
      ok: true,
      event: { type: "REMAINDER_SETTLED", refundPaymentId: ID2 },
    });
  });

  it("names the act of the materials and the passport of the order", () => {
    expect(buildEvent("MATERIALS_ACCEPTED", form({ actId: ID2 }), { orderId: ID })).toEqual({
      ok: true,
      event: { type: "MATERIALS_ACCEPTED", actId: ID2 },
    });
    expect(buildEvent("TESTS_PASSED", form({}), { orderId: ID })).toEqual({
      ok: true,
      event: { type: "TESTS_PASSED", passportId: ID },
    });
  });

  it("hands over with an act and the final payment", () => {
    expect(buildEvent("HANDOVER", form({ actId: ID, finalPaymentId: ID2 }), { orderId: ID })).toEqual({
      ok: true,
      event: { type: "HANDOVER", actId: ID, finalPaymentId: ID2 },
    });
    expect(buildEvent("HANDOVER", form({ actId: ID }), { orderId: ID }).ok).toBe(false);
  });

  it("refuses an id that is not an id, so that nothing odd reaches the services", () => {
    expect(buildEvent("FEE_PREPAID", form({ paymentId: "'; drop table" }), { orderId: ID }).ok).toBe(false);
  });

  it("does not know the events of the customer and the system", () => {
    for (const type of ["ACCEPT", "OBJECTION", "REPORT_ACCEPTED", "EXPIRE", "CLOSE", "NOPE"]) {
      expect(buildEvent(type, form({}), { orderId: ID }).ok, type).toBe(false);
    }
  });

  it("does not build CANCEL: it goes through orders.cancel, which counts the settlement", () => {
    expect(buildEvent("CANCEL", form({ reason: "x" }), { orderId: ID }).ok).toBe(false);
  });
});

describe("permissionOf", () => {
  it("puts the money events behind the settle permission and the assembly behind its own", () => {
    expect(permissionOf("FEE_PREPAID")).toBe("orders.settle");
    expect(permissionOf("START_PURCHASE")).toBe("orders.settle");
    expect(permissionOf("HANDOVER")).toBe("orders.settle");
    expect(permissionOf("CANCEL")).toBe("orders.cancel");
    expect(permissionOf("REVISE")).toBe("quotes.write");
    expect(permissionOf("ASSEMBLED")).toBe("assembly.write");
    expect(permissionOf("TESTS_PASSED")).toBe("assembly.write");
    expect(permissionOf("PURCHASE_DONE")).toBe("orders.settle");
  });
  it("is closed for an event it does not know", () => {
    expect(permissionOf("NOPE")).toBeNull();
  });
});
