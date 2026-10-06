import { describe, expect, it } from "vitest";
import { assembleSnapshot, lossesBp, purchasesCompleteOf, reportStateFrom, type SnapshotInputs } from "./snapshot.ts";

const sum = (n: number) => n as never;
const T = (iso: string) => new Date(iso);

describe("purchasesCompleteOf", () => {
  const lines = [
    { id: "l1", qty: 1, purchasedByIp: true, customerOwned: false },
    { id: "l2", qty: 2, purchasedByIp: true, customerOwned: false },
    { id: "l3", qty: 1, purchasedByIp: false, customerOwned: false }, // works of the owner: nothing to buy
    { id: "l4", qty: 1, purchasedByIp: false, customerOwned: true }, // the customer's own part
  ];
  const buy = (quoteLineId: string | null, qty: number, amountSum: number, refundOf: string | null = null) => ({
    quoteLineId,
    qty,
    amountSum,
    refundOf,
  });

  it("is complete when every line to buy is bought in full", () => {
    expect(purchasesCompleteOf(lines, [buy("l1", 1, 100), buy("l2", 2, 200)], false)).toBe(true);
  });

  it("counts a line bought in two purchases", () => {
    expect(purchasesCompleteOf(lines, [buy("l1", 1, 100), buy("l2", 1, 100), buy("l2", 1, 100)], false)).toBe(true);
  });

  it("is incomplete while a line is not bought or bought in part", () => {
    expect(purchasesCompleteOf(lines, [buy("l1", 1, 100)], false)).toBe(false);
    expect(purchasesCompleteOf(lines, [buy("l1", 1, 100), buy("l2", 1, 100)], false)).toBe(false);
    expect(purchasesCompleteOf(lines, [], false)).toBe(false);
  });

  it("does not count a line that was returned to the shop in full", () => {
    const bought = [buy("l1", 1, 100), buy("l2", 2, 200), buy("l1", 1, -100, "p1")];
    expect(purchasesCompleteOf(lines, bought, false)).toBe(false);
  });

  it("does not count a purchase that belongs to no line of the quote", () => {
    expect(purchasesCompleteOf(lines, [buy(null, 1, 100), buy("l2", 2, 200)], false)).toBe(false);
  });

  it("lets the customer remove lines with the consent 'replacement', if something was bought", () => {
    expect(purchasesCompleteOf(lines, [buy("l1", 1, 100)], true)).toBe(true);
    expect(purchasesCompleteOf(lines, [], true)).toBe(false);
  });

  it("has nothing to buy when the quote holds only works and the parts of the customer", () => {
    expect(purchasesCompleteOf([lines[2], lines[3]] as never, [], false)).toBe(true);
  });
});

describe("reportStateFrom", () => {
  const ev = (seq: number, type: string, at: string) => ({ seq, type, at: T(at) });
  const until = T("2026-10-16T10:00:00Z");

  it("is absent while there is no report", () => {
    expect(
      reportStateFrom({ events: [], reportExists: false, resolvedAt: null, objectionUntil: null }),
    ).toBeUndefined();
  });

  it("is open and not accepted before the report is sent", () => {
    expect(reportStateFrom({ events: [], reportExists: true, resolvedAt: null, objectionUntil: null })).toEqual({
      accepted: false,
      objectionOpen: false,
      objectionUntil: null,
    });
  });

  it("is accepted by the customer or by the term", () => {
    for (const type of ["REPORT_ACCEPTED", "REPORT_DEEMED_ACCEPTED"]) {
      const state = reportStateFrom({
        events: [ev(1, "SEND_REPORT", "2026-10-13T10:00:00Z"), ev(2, type, "2026-10-14T10:00:00Z")],
        reportExists: true,
        resolvedAt: null,
        objectionUntil: until,
      });
      expect(state).toEqual({ accepted: true, objectionOpen: false, objectionUntil: until });
    }
  });

  it("has an open objection until the owner resolves it", () => {
    const events = [ev(1, "SEND_REPORT", "2026-10-13T10:00:00Z"), ev(2, "OBJECTION", "2026-10-14T10:00:00Z")];
    expect(
      reportStateFrom({ events, reportExists: true, resolvedAt: null, objectionUntil: until })?.objectionOpen,
    ).toBe(true);
    expect(
      reportStateFrom({ events, reportExists: true, resolvedAt: T("2026-10-14T12:00:00Z"), objectionUntil: until })
        ?.objectionOpen,
    ).toBe(false);
  });

  it("opens again when the customer objects after the resolution", () => {
    const events = [
      ev(1, "SEND_REPORT", "2026-10-13T10:00:00Z"),
      ev(2, "OBJECTION", "2026-10-14T10:00:00Z"),
      ev(3, "OBJECTION", "2026-10-15T10:00:00Z"),
    ];
    expect(
      reportStateFrom({ events, reportExists: true, resolvedAt: T("2026-10-14T12:00:00Z"), objectionUntil: until })
        ?.objectionOpen,
    ).toBe(true);
  });

  it("looks only at what happened after the last sending of the report", () => {
    const events = [
      ev(1, "SEND_REPORT", "2026-10-13T10:00:00Z"),
      ev(2, "OBJECTION", "2026-10-14T10:00:00Z"),
      ev(3, "SEND_REPORT", "2026-10-15T10:00:00Z"),
    ];
    expect(reportStateFrom({ events, reportExists: true, resolvedAt: null, objectionUntil: until })).toEqual({
      accepted: false,
      objectionOpen: false,
      objectionUntil: until,
    });
  });
});

describe("lossesBp", () => {
  it("is the share of the losses in what was bought, in basis points, rounded down", () => {
    expect(lossesBp(50_000, 10_000_000)).toBe(50);
    expect(lossesBp(49_999, 10_000_000)).toBe(49);
    expect(lossesBp(0, 10_000_000)).toBe(0);
  });

  it("cannot divide by nothing: no purchases and no losses is no loss, losses without purchases is all of it", () => {
    expect(lossesBp(0, 0)).toBe(0);
    expect(lossesBp(1, 0)).toBe(10_000);
    expect(lossesBp(2_000_000, 1_000_000)).toBe(10_000);
  });
});

describe("assembleSnapshot", () => {
  const base = (): SnapshotInputs => ({
    order: {
      status: "estimate_sent",
      kind: "pc",
      feePrepaid: false,
      fundsReceived: false,
      firstOrderMeetingDone: false,
      purchaseNotBefore: null,
    },
    quote: {
      id: "q1",
      status: "sent",
      validUntil: T("2026-10-13T10:00:00Z"),
      stored: {
        totals: {} as never,
        eligibility: { mode: "full_cycle" },
        compatVerdict: "warn",
        shelfLifeHours: 24,
        quoteKind: "pc",
      },
      purchaseLimit: 12_210_000,
      feeTotal: 1_777_500,
      advance: 533_250,
      final: 1_244_250,
      manuallyChecked: true,
      hasNonReturnable: true,
    },
    money: {
      fundsReceived: sum(0),
      receiptsTotal: sum(0),
      refunded: sum(0),
      documentedLosses: sum(0),
      hasLimitOverrunConsent: false,
    },
    purchasesComplete: false,
    report: undefined,
    firstOrderOfCustomer: true,
    offer: { uz: "published", ru: "published" },
    appMode: "production",
    reserves: { warranty: { balance: sum(0), closedOrders: 0, lossesLast12mBp: 0 as never }, taxRiskActive: true },
  });

  it("carries the flags, the quote and the totals the automaton reads", () => {
    const s = assembleSnapshot(base());
    expect(s.status).toBe("estimate_sent");
    expect(s.flags).toEqual({ feePrepaid: false, fundsReceived: false, firstOrderMeetingDone: false });
    expect(s.quote).toEqual({
      id: "q1",
      status: "sent",
      validUntil: T("2026-10-13T10:00:00Z"),
      compatVerdict: "warn",
      manuallyChecked: true,
      eligibility: { mode: "full_cycle" },
      purchaseLimit: 12_210_000,
      advance: 533_250,
      final: 1_244_250,
      hasNonReturnable: true,
    });
    expect(s.grandTotal).toBe(12_210_000 + 1_777_500);
    expect(s.purchaseNotBefore).toBeUndefined();
    expect(s.reserves.taxRiskActive).toBe(true);
    expect(s.offer).toEqual({ uz: "published", ru: "published" });
    expect(s.appMode).toBe("production");
  });

  it("has no quote and a zero grand total for an order that has none", () => {
    const i = base();
    i.quote = undefined;
    const s = assembleSnapshot(i);
    expect(s.quote).toBeUndefined();
    expect(s.grandTotal).toBe(0);
  });

  it("leaves out the term of a quote that has none instead of inventing one", () => {
    const i = base();
    if (i.quote) i.quote.validUntil = null;
    expect(assembleSnapshot(i).quote).not.toHaveProperty("validUntil");
  });

  it("carries the time before which the purchase may not start", () => {
    const i = base();
    i.order.purchaseNotBefore = T("2026-10-13T05:00:00Z");
    expect(assembleSnapshot(i).purchaseNotBefore).toEqual(T("2026-10-13T05:00:00Z"));
  });

  it("carries the report with the end of the objection window from the order", () => {
    const i = base();
    i.report = { accepted: false, objectionOpen: false, objectionUntil: T("2026-10-16T10:00:00Z") };
    expect(assembleSnapshot(i).report).toEqual({
      accepted: false,
      objectionOpen: false,
      objectionUntil: T("2026-10-16T10:00:00Z"),
    });
  });
});
