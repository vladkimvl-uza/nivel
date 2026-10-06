// Runs the shared table packages/testing/fixtures/money-cases.json against the domain code.
// The same file is used against the real database (ADR-004), so the two lines of defence cannot drift apart.
import { describe, expect, it } from "vitest";
import { settleCancellation } from "../cancel/index.ts";
import { computeFee, computeQuote, DEFAULT_FEE_SETTINGS, type QuoteLineInput } from "../fee/index.ts";
import type { WorkCalendar } from "../order/types.ts";
import {
  applyBp,
  bp,
  type PaymentDirection,
  type PaymentKind,
  type PaymentMethod,
  type PaymentStatus,
  splitByShares,
  sum,
  validatePayment,
} from "./index.ts";
import { repoFile } from "./testkit.ts";

interface Cases {
  version: number;
  applyBp: { base: number; rateBp: number; floor: number; half_up: number; ceil: number }[];
  split: { total: number; sharesBp: number[]; parts: number[] }[];
  fee: {
    name: string;
    lines: { group: "pc" | "mount" | "outside_scale"; amount: number; customerOwned?: boolean }[];
    complexBuild: boolean;
    fee: number;
    advance: number;
    final: number;
    commissionLine: number;
    worksLine: number;
  }[];
  payments: {
    kind: PaymentKind;
    direction: PaymentDirection;
    method: PaymentMethod;
    status: PaymentStatus;
    fiscalReceiptNo: string | null;
    valid: boolean;
  }[];
  cancel: {
    name: string;
    point: Parameters<typeof settleCancellation>[0]["point"];
    fee: number;
    feePaid: number;
    fundsReceived: number;
    receiptsTotal: number;
    shopRefunds: number;
    documentedLosses: number;
    assemblyDoneBp?: number;
    expect: { feeEarned: number; feeToRefund: number; feeToInvoice: number; fundsToRefund: number; partsGoTo: string };
  }[];
}

const cases = JSON.parse(repoFile("fixtures/money-cases.json")) as Cases;

const D = DEFAULT_FEE_SETTINGS;
const toLines = (c: Cases["fee"][number]): QuoteLineInput[] =>
  c.lines.map((l, i) => ({
    key: `l${i}`,
    group: l.group,
    qty: 1,
    unitSum: sum(l.amount),
    isRamOrSsd: false,
    isFurnitureLike: false,
    customerOwned: l.customerOwned ?? false,
    purchasedByIp: true,
  }));

describe("money-cases.json", () => {
  it("is version 1 and covers every section", () => {
    expect(cases.version).toBe(1);
    expect(cases.applyBp.length).toBeGreaterThan(0);
    expect(cases.split.length).toBeGreaterThan(0);
    expect(cases.fee.length).toBeGreaterThanOrEqual(15);
    expect(cases.cancel).toHaveLength(5);
  });

  it.each(cases.applyBp)("applyBp($base, $rateBp)", (c) => {
    for (const mode of ["floor", "half_up", "ceil"] as const) {
      expect(applyBp(sum(c.base), bp(c.rateBp), mode)).toBe(c[mode]);
    }
  });

  it.each(cases.split)("splitByShares($total, $sharesBp)", (c) => {
    expect(splitByShares(sum(c.total), c.sharesBp.map(bp))).toEqual(c.parts);
  });

  it.each(cases.fee)("fee: $name", (c) => {
    const f = computeFee(toLines(c), D, { complexBuild: c.complexBuild });
    expect(f.total).toBe(c.fee);
    expect([f.commissionLine, f.worksLine]).toEqual([c.commissionLine, c.worksLine]);
    const q = computeQuote(toLines(c), D, {
      now: new Date("2026-10-06T07:00:00Z"),
      kind: "pc",
      complexBuild: c.complexBuild,
      freeWindowAvailable: true,
      confirmed: false,
    });
    expect([q.advance, q.final]).toEqual([c.advance, c.final]);
  });

  it("payments: every combination of the table is judged as the database CHECK judges it", () => {
    expect(cases.payments.length).toBeGreaterThanOrEqual(72);
    for (const p of cases.payments) {
      const r = validatePayment({
        kind: p.kind,
        direction: p.direction,
        method: p.method,
        status: p.status,
        fiscalReceiptNo: p.fiscalReceiptNo,
      });
      expect({ case: p, ok: r.ok }).toEqual({ case: p, ok: p.valid });
    }
  });

  const calendar: WorkCalendar = {
    isWorkingDay: () => true,
    isResponseHours: () => true,
    nextWorkingDayStart: (d) => d,
    addWorkingDays: (d) => d,
  };
  it.each(cases.cancel)("cancel: $name", (c) => {
    const { name: _name, expect: want, assemblyDoneBp, ...rest } = c;
    const r = settleCancellation(
      {
        point: rest.point,
        fee: sum(rest.fee),
        feePaid: sum(rest.feePaid),
        fundsReceived: sum(rest.fundsReceived),
        receiptsTotal: sum(rest.receiptsTotal),
        shopRefunds: sum(rest.shopRefunds),
        documentedLosses: sum(rest.documentedLosses),
        ...(assemblyDoneBp === undefined ? {} : { assemblyDoneBp: bp(assemblyDoneBp) }),
      },
      D,
      new Date("2026-10-06T07:00:00Z"),
      calendar,
    );
    expect({
      feeEarned: r.feeEarned,
      feeToRefund: r.feeToRefund,
      feeToInvoice: r.feeToInvoice,
      fundsToRefund: r.fundsToRefund,
      partsGoTo: r.partsGoTo,
    }).toEqual(want);
  });
});
