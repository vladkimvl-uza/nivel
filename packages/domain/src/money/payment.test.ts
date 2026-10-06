import { describe, expect, it } from "vitest";
import {
  PAYMENT_DIRECTIONS,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  type PaymentDirection,
  type PaymentInput,
  type PaymentKind,
  type PaymentMethod,
  validatePayment,
} from "./index.ts";

const base = (p: Partial<PaymentInput> & Pick<PaymentInput, "kind" | "direction" | "method">): PaymentInput => p;

describe("validatePayment: kind x method x direction (ARCHITECTURE 3.4)", () => {
  const FEE_KINDS: PaymentKind[] = ["fee_advance", "fee_final", "fee_extra", "podbor_fee"];
  const FUNDS_KINDS: PaymentKind[] = ["purchase_funds", "purchase_topup"];
  const OUT_KINDS: PaymentKind[] = ["remainder_refund", "fee_refund", "funds_refund"];

  it("lists the nine kinds, two directions and four methods of the schema", () => {
    expect([...PAYMENT_KINDS].sort()).toEqual([...FEE_KINDS, ...FUNDS_KINDS, ...OUT_KINDS].sort());
    expect([...PAYMENT_DIRECTIONS].sort()).toEqual(["in", "out"]);
    expect([...PAYMENT_METHODS].sort()).toEqual(["bank_transfer_ip", "bank_transfer_out", "merchant_card", "xolis_qr"]);
  });

  it.each(FEE_KINDS)("%s: allowed only as incoming Xolis QR or merchant card", (kind) => {
    expect(validatePayment(base({ kind, direction: "in", method: "xolis_qr" }))).toEqual({ ok: true });
    expect(validatePayment(base({ kind, direction: "in", method: "merchant_card" }))).toEqual({ ok: true });
    expect(validatePayment(base({ kind, direction: "in", method: "bank_transfer_ip" }))).toEqual({
      ok: false,
      errorKey: "payment.pair_invalid",
    });
    expect(validatePayment(base({ kind, direction: "out", method: "xolis_qr" })).ok).toBe(false);
  });

  it.each(FEE_KINDS)("%s: a confirmed payment needs a fiscal receipt number", (kind) => {
    const confirmed = base({ kind, direction: "in", method: "xolis_qr", status: "confirmed" });
    expect(validatePayment(confirmed)).toEqual({ ok: false, errorKey: "payment.receipt_required" });
    expect(validatePayment({ ...confirmed, fiscalReceiptNo: null })).toEqual({
      ok: false,
      errorKey: "payment.receipt_required",
    });
    expect(validatePayment({ ...confirmed, fiscalReceiptNo: "" })).toEqual({
      ok: false,
      errorKey: "payment.receipt_required",
    });
    expect(validatePayment({ ...confirmed, fiscalReceiptNo: "   " }).ok).toBe(false);
    expect(validatePayment({ ...confirmed, fiscalReceiptNo: "FM-000123" })).toEqual({ ok: true });
  });

  it.each(["expected", "void"] as const)("fee payment in status %s needs no receipt yet", (status) => {
    expect(validatePayment(base({ kind: "fee_final", direction: "in", method: "xolis_qr", status }))).toEqual({
      ok: true,
    });
  });

  it.each(FUNDS_KINDS)("%s: only incoming bank transfer to the IP account", (kind) => {
    expect(validatePayment(base({ kind, direction: "in", method: "bank_transfer_ip" }))).toEqual({ ok: true });
    // never the fee flow (QR / card) and never outgoing: the two money flows do not mix
    expect(validatePayment(base({ kind, direction: "in", method: "xolis_qr" })).ok).toBe(false);
    expect(validatePayment(base({ kind, direction: "in", method: "merchant_card" })).ok).toBe(false);
    expect(validatePayment(base({ kind, direction: "out", method: "bank_transfer_ip" })).ok).toBe(false);
    expect(validatePayment(base({ kind, direction: "out", method: "bank_transfer_out" })).ok).toBe(false);
  });

  it("purchase funds need no fiscal receipt when confirmed", () => {
    expect(
      validatePayment(
        base({ kind: "purchase_funds", direction: "in", method: "bank_transfer_ip", status: "confirmed" }),
      ),
    ).toEqual({ ok: true });
  });

  it.each(OUT_KINDS)("%s: only outgoing bank transfer", (kind) => {
    expect(validatePayment(base({ kind, direction: "out", method: "bank_transfer_out" }))).toEqual({ ok: true });
    expect(validatePayment(base({ kind, direction: "in", method: "bank_transfer_out" })).ok).toBe(false);
    expect(validatePayment(base({ kind, direction: "out", method: "xolis_qr" })).ok).toBe(false);
    expect(validatePayment(base({ kind, direction: "out", method: "bank_transfer_ip" })).ok).toBe(false);
  });

  it("exhaustive table: exactly 13 of 72 combinations are valid (before the receipt rule)", () => {
    let valid = 0;
    for (const kind of PAYMENT_KINDS)
      for (const direction of PAYMENT_DIRECTIONS)
        for (const method of PAYMENT_METHODS) {
          const r = validatePayment({ kind, direction, method });
          if (r.ok) valid++;
        }
    // fee: 4 kinds x 2 methods = 8; funds: 2 x 1 = 2; out: 3 x 1 = 3
    expect(valid).toBe(13);
  });

  it("rejects unknown values coming from outside the type system", () => {
    expect(
      validatePayment({
        kind: "gift" as PaymentKind,
        direction: "in" as PaymentDirection,
        method: "xolis_qr" as PaymentMethod,
      }),
    ).toEqual({ ok: false, errorKey: "payment.kind_unknown" });
  });

  it("does not take object prototype members for payment kinds", () => {
    for (const kind of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(
        validatePayment({ kind: kind as PaymentKind, direction: "in", method: "xolis_qr", status: "expected" }),
      ).toEqual({ ok: false, errorKey: "payment.kind_unknown" });
    }
  });
});
