import { PAYMENT_KINDS, validatePayment } from "@nivel/domain/money";
import { describe, expect, it } from "vitest";
import { FEE_KINDS, FUNDS_KINDS, isPaymentKind, PAYMENT_PAIRS, REFUND_KINDS } from "./pairs.ts";

describe("PAYMENT_PAIRS", () => {
  it("has a pair for every kind of the domain, and the domain accepts every pair", () => {
    expect(Object.keys(PAYMENT_PAIRS).sort()).toEqual([...PAYMENT_KINDS].sort());
    for (const kind of PAYMENT_KINDS) {
      const pair = PAYMENT_PAIRS[kind];
      expect(validatePayment({ kind, direction: pair.direction, method: pair.method }), kind).toMatchObject({
        ok: true,
      });
    }
  });

  it("the domain refuses the two money flows mixed: the fee by transfer, the funds by QR, the other way round", () => {
    for (const kind of FEE_KINDS) {
      expect(validatePayment({ kind, direction: "in", method: "bank_transfer_ip" }).ok, kind).toBe(false);
    }
    for (const kind of FUNDS_KINDS) {
      expect(validatePayment({ kind, direction: "in", method: "xolis_qr" }).ok, kind).toBe(false);
    }
    for (const kind of REFUND_KINDS) {
      expect(validatePayment({ kind, direction: "in", method: "bank_transfer_out" }).ok, kind).toBe(false);
    }
  });

  it("splits the kinds into the three groups without a gap or an overlap", () => {
    expect([...FEE_KINDS, ...FUNDS_KINDS, ...REFUND_KINDS].sort()).toEqual([...PAYMENT_KINDS].sort());
  });

  it("knows a kind from a key of every object", () => {
    expect(isPaymentKind("fee_advance")).toBe(true);
    for (const bad of ["constructor", "toString", "__proto__", "", null, 5]) expect(isPaymentKind(bad)).toBe(false);
  });
});
