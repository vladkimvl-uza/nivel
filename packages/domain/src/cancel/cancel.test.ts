import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_SETTINGS, type FeeSettings } from "../fee/index.ts";
import { bp, type Sum, sum } from "../money/index.ts";
import { forAll } from "../money/testkit.ts";
import type { WorkCalendar } from "../order/types.ts";
import { type CancelInput, type CancelPoint, settleCancellation } from "./index.ts";

const S = sum;
const D = DEFAULT_FEE_SETTINGS;
const NOW = new Date("2026-10-06T07:00:00.000Z"); // Tuesday

/** Mon-Sat calendar without holidays: enough to see that the due date comes from the calendar. */
function fakeCalendar(): WorkCalendar & { calls: { from: Date; n: number }[] } {
  const calls: { from: Date; n: number }[] = [];
  return {
    calls,
    isWorkingDay: () => true,
    isResponseHours: () => true,
    nextWorkingDayStart: (from) => from,
    addWorkingDays(from, n) {
      calls.push({ from, n });
      const d = new Date(from);
      let left = n;
      while (left > 0) {
        d.setUTCDate(d.getUTCDate() + 1);
        if (d.getUTCDay() !== 0) left--;
      }
      return d;
    },
  };
}

function input(point: CancelPoint, over: Partial<CancelInput> = {}): CancelInput {
  return {
    point,
    fee: S(1_000_000),
    feePaid: S(300_000),
    fundsReceived: S(10_300_000),
    receiptsTotal: S(0),
    shopRefunds: S(0),
    documentedLosses: S(0),
    ...over,
  };
}
const settle = (i: CancelInput, s: FeeSettings = D) => settleCancellation(i, s, NOW, fakeCalendar());

describe("settleCancellation: five cancellation points (ARCHITECTURE 4.7)", () => {
  it("before_accept: nothing earned, everything returns", () => {
    const r = settle(input("before_accept", { feePaid: S(0) }));
    expect(r).toMatchObject({
      feeEarned: 0,
      feeToRefund: 0,
      feeToInvoice: 0,
      fundsToRefund: 10_300_000,
      partsGoTo: "none",
    });
  });

  it("before_accept: a prepaid fee comes back in full", () => {
    const r = settle(input("before_accept", { feePaid: S(300_000) }));
    expect(r.feeEarned).toBe(0);
    expect(r.feeToRefund).toBe(300_000);
  });

  it("after_accept_before_purchase: 20 % earned, 10 % of the fee returns from the 30 % advance", () => {
    const r = settle(input("after_accept_before_purchase"));
    expect(r).toMatchObject({
      feeEarned: 200_000,
      feeToRefund: 100_000,
      feeToInvoice: 0,
      fundsToRefund: 10_300_000,
      partsGoTo: "none",
    });
  });

  it("after_purchase_before_assembly: 50 % earned, the rest of the 50 % is invoiced separately", () => {
    const r = settle(
      input("after_purchase_before_assembly", {
        receiptsTotal: S(9_900_000),
        shopRefunds: S(200_000),
        documentedLosses: S(50_000),
      }),
    );
    expect(r).toMatchObject({
      feeEarned: 500_000,
      feeToRefund: 0,
      feeToInvoice: 200_000,
      fundsToRefund: 550_000, // 10 300 000 - 9 900 000 + 200 000 - 50 000
      partsGoTo: "shop_or_client",
    });
  });

  it("during_assembly: 50 % plus the assembly share times the done share", () => {
    const r = settle(input("during_assembly", { assemblyDoneBp: bp(5000), receiptsTotal: S(10_000_000) }));
    expect(r).toMatchObject({
      feeEarned: 675_000, // 500 000 + 35 % x 50 %
      feeToRefund: 0,
      feeToInvoice: 375_000,
      fundsToRefund: 300_000,
      partsGoTo: "client",
    });
  });

  it("during_assembly: done 0 equals the purchase point, done 100 % equals the after-tests retention", () => {
    expect(settle(input("during_assembly", { assemblyDoneBp: bp(0) })).feeEarned).toBe(500_000);
    expect(settle(input("during_assembly", { assemblyDoneBp: bp(10_000) })).feeEarned).toBe(850_000);
  });

  it("during_assembly: the owner input is required", () => {
    expect(() => settle(input("during_assembly"))).toThrow(RangeError);
  });

  it("after_tests_before_handover: 85 % retained, the handover stage is not done", () => {
    const r = settle(input("after_tests_before_handover", { feePaid: S(300_000), receiptsTotal: S(10_000_000) }));
    expect(r).toMatchObject({
      feeEarned: 850_000,
      feeToRefund: 0,
      feeToInvoice: 550_000,
      fundsToRefund: 300_000,
      partsGoTo: "client",
    });
  });

  it("the invoice is never netted against the purchase funds", () => {
    const r = settle(input("after_tests_before_handover", { receiptsTotal: S(9_000_000) }));
    expect(r.feeToInvoice).toBe(550_000);
    expect(r.fundsToRefund).toBe(1_300_000); // untouched by the fee debt
  });

  it("a fully paid fee after tests: refund of the 15 % of the handover stage", () => {
    const r = settle(input("after_tests_before_handover", { feePaid: S(1_000_000) }));
    expect(r).toMatchObject({ feeEarned: 850_000, feeToRefund: 150_000, feeToInvoice: 0 });
  });
});

describe("settleCancellation: rounding and settings", () => {
  it("rounds earned fee down to a whole sum", () => {
    expect(settle(input("after_accept_before_purchase", { fee: S(999_999) })).feeEarned).toBe(199_999); // 199 999.8
    expect(settle(input("after_tests_before_handover", { fee: S(1_005_001) })).feeEarned).toBe(854_250); // 854 250.85
    const r = settle(input("during_assembly", { fee: S(1_005_001), assemblyDoneBp: bp(3333) }));
    // one rounding for the sum: floor(1 005 001 x (50 % + 35 % x 33.33 %)) = 619 738.89 -> 619 738
    expect(r.feeEarned).toBe(619_738);
  });

  it("follows configured stage shares and the after-tests retention", () => {
    const s: FeeSettings = {
      ...D,
      stageSharesBp: { selection: bp(1000), purchase: bp(4000), assembly: bp(3000), handover: bp(2000) },
      afterTestsRetainBp: bp(9000),
    };
    expect(settle(input("after_accept_before_purchase"), s).feeEarned).toBe(100_000);
    expect(settle(input("after_purchase_before_assembly"), s).feeEarned).toBe(500_000);
    expect(settle(input("during_assembly", { assemblyDoneBp: bp(10_000) }), s).feeEarned).toBe(800_000);
    expect(settle(input("after_tests_before_handover"), s).feeEarned).toBe(900_000);
  });

  it("works for a zero fee", () => {
    const r = settle(input("after_tests_before_handover", { fee: S(0), feePaid: S(0) }));
    expect(r).toMatchObject({ feeEarned: 0, feeToRefund: 0, feeToInvoice: 0 });
  });

  it("is exact for fees where fee x shares exceeds 2^53", () => {
    const fee = S(900_000_000_000_001);
    const r = settle(input("during_assembly", { fee, feePaid: S(0), assemblyDoneBp: bp(9999) }));
    const exact = (BigInt(fee) * (50_000_000n + 3500n * 9999n)) / 100_000_000n;
    expect(r.feeEarned).toBe(Number(exact));
  });
});

describe("settleCancellation: funds and deadline", () => {
  it("returns the remainder: received - receipts + shop refunds - documented losses", () => {
    const r = settle(
      input("after_purchase_before_assembly", {
        fundsReceived: S(20_600_000),
        receiptsTotal: S(19_000_000),
        shopRefunds: S(500_000),
        documentedLosses: S(100_000),
      }),
    );
    expect(r.fundsToRefund).toBe(2_000_000);
  });

  it("refuses when documented losses exceed the remaining funds (no own money for the client)", () => {
    expect(() =>
      settle(input("after_purchase_before_assembly", { receiptsTotal: S(10_300_000), documentedLosses: S(1) })),
    ).toThrow(RangeError);
  });

  it("rejects negative amounts: a reversal must not raise the refund above what was paid", () => {
    const fields = ["fee", "feePaid", "fundsReceived", "receiptsTotal", "shopRefunds", "documentedLosses"] as const;
    for (const field of fields) {
      expect(() => settle(input("after_accept_before_purchase", { [field]: S(-1) })), field).toThrow(RangeError);
    }
    // the case from the review: losses of -5 000 000 would turn 10 300 000 received into 15 300 000 to refund
    expect(() => settle(input("before_accept", { fee: S(1_000_000), documentedLosses: S(-5_000_000) }))).toThrow(
      RangeError,
    );
    expect(() => settle(input("after_accept_before_purchase", { fee: S(-1_000_000) }))).toThrow(RangeError);
  });

  it("rejects shop refunds above the receipts they refund", () => {
    expect(() =>
      settle(input("after_purchase_before_assembly", { receiptsTotal: S(0), shopRefunds: S(5_000_000) })),
    ).toThrow(/shop refunds/i);
    expect(
      settle(input("after_purchase_before_assembly", { receiptsTotal: S(5_000_000), shopRefunds: S(5_000_000) }))
        .fundsToRefund,
    ).toBe(10_300_000);
  });

  it("names the real cause: receipts above the money received, or losses above the remainder", () => {
    expect(() => settle(input("after_purchase_before_assembly", { receiptsTotal: S(10_300_001) }))).toThrow(
      /receipts/i,
    );
    expect(() =>
      settle(input("after_purchase_before_assembly", { receiptsTotal: S(10_000_000), documentedLosses: S(300_001) })),
    ).toThrow(/losses/i);
    // the boundary: everything spent or lost, nothing left to refund
    expect(
      settle(input("after_purchase_before_assembly", { receiptsTotal: S(10_000_000), documentedLosses: S(300_000) }))
        .fundsToRefund,
    ).toBe(0);
  });

  it("never refunds more than was received", () => {
    forAll((g) => {
      const fundsReceived = g.int(0, 50_000_000);
      const receiptsTotal = g.int(0, 60_000_000);
      const shopRefunds = g.int(0, 60_000_000);
      const documentedLosses = g.int(0, 60_000_000);
      const i = input("after_purchase_before_assembly", {
        fundsReceived: S(fundsReceived),
        receiptsTotal: S(receiptsTotal),
        shopRefunds: S(shopRefunds),
        documentedLosses: S(documentedLosses),
      });
      const valid = shopRefunds <= receiptsTotal && fundsReceived - receiptsTotal + shopRefunds - documentedLosses >= 0;
      if (!valid) {
        expect(() => settle(i)).toThrow(RangeError);
        return;
      }
      const r = settle(i);
      expect(r.fundsToRefund).toBeGreaterThanOrEqual(0);
      expect(r.fundsToRefund).toBeLessThanOrEqual(fundsReceived);
    });
  });

  it("refuses stage shares that earn more than the fee", () => {
    const greedy: FeeSettings = {
      ...D,
      stageSharesBp: { selection: bp(2000), purchase: bp(3000), assembly: bp(7000), handover: bp(0) },
    };
    expect(() => settle(input("during_assembly", { assemblyDoneBp: bp(10_000) }), greedy)).toThrow(/exceeds the fee/);
    expect(settle(input("during_assembly", { assemblyDoneBp: bp(5000) }), greedy).feeEarned).toBeLessThanOrEqual(
      1_000_000,
    );
  });

  it("is due in five working days by the calendar", () => {
    const cal = fakeCalendar();
    const r = settleCancellation(input("before_accept"), D, NOW, cal);
    expect(cal.calls).toEqual([{ from: NOW, n: 5 }]);
    expect(r.dueBy.toISOString()).toBe("2026-10-12T07:00:00.000Z"); // Sunday skipped
  });

  it("rejects inputs that are not whole sums or basis points", () => {
    expect(() => settle(input("before_accept", { fee: 1.5 as unknown as Sum }))).toThrow(RangeError);
    expect(() =>
      settle(input("during_assembly", { assemblyDoneBp: 12_000 as unknown as ReturnType<typeof bp> })),
    ).toThrow(RangeError);
  });

  it("rejects an unknown point", () => {
    expect(() => settle(input("later" as CancelPoint))).toThrow(RangeError);
  });
});

describe("settleCancellation: properties", () => {
  const points: CancelPoint[] = [
    "before_accept",
    "after_accept_before_purchase",
    "after_purchase_before_assembly",
    "during_assembly",
    "after_tests_before_handover",
  ];

  it("earned <= fee; refund and invoice are exclusive; paid - refund + invoice = earned", () => {
    forAll((g) => {
      const fee = S(g.int(0, 10_000_000));
      const feePaid = S(g.int(0, fee));
      const i = input(g.pick(points), {
        fee,
        feePaid,
        assemblyDoneBp: bp(g.int(0, 10_000)),
        fundsReceived: S(50_000_000),
        receiptsTotal: S(g.int(0, 50_000_000)),
      });
      const r = settle(i);
      expect(r.feeEarned).toBeLessThanOrEqual(fee);
      expect(r.feeToRefund * r.feeToInvoice).toBe(0);
      expect(feePaid - r.feeToRefund + r.feeToInvoice).toBe(r.feeEarned);
      expect(r.fundsToRefund).toBe(50_000_000 - i.receiptsTotal);
    });
  });

  it("earned fee never decreases along the order lifecycle", () => {
    forAll((g) => {
      const fee = S(g.int(0, 100_000_000));
      const done = bp(g.int(0, 10_000));
      const earned = points.map((p) => settle(input(p, { fee, feePaid: S(0), assemblyDoneBp: done })).feeEarned);
      for (let k = 1; k < earned.length; k++) {
        expect(earned[k] as number).toBeGreaterThanOrEqual(earned[k - 1] as number);
      }
    });
  });
});
