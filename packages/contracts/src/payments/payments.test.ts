import { PAYMENT_KINDS, validatePayment } from "@nivel/domain/money";
import { describe, expect, it } from "vitest";
import {
  ConfirmPaymentInputSchema,
  DEFAULT_PAYMENT_PAIR,
  ExpectPaymentInputSchema,
  MAX_PAYMENT_SUM,
  VoidPaymentInputSchema,
} from "./index.ts";

const uuid = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("default pair of a payment kind", () => {
  it("covers every kind and is a valid pair for the domain rule", () => {
    for (const kind of PAYMENT_KINDS) {
      const pair = DEFAULT_PAYMENT_PAIR[kind];
      expect(validatePayment({ kind, direction: pair.direction, method: pair.method })).toEqual({ ok: true });
    }
  });
});

describe("ExpectPaymentInputSchema", () => {
  it("accepts a fee advance and fills the pair of the kind", () => {
    const p = ExpectPaymentInputSchema.parse({ orderId: uuid, kind: "fee_advance", amountSum: 450_000 });
    expect(p.direction).toBe("in");
    expect(p.method).toBe("xolis_qr");
  });

  it("fills a bank transfer to the sole proprietor for purchase funds and an outgoing transfer for refunds", () => {
    expect(ExpectPaymentInputSchema.parse({ orderId: uuid, kind: "purchase_funds", amountSum: 1 }).method).toBe(
      "bank_transfer_ip",
    );
    expect(ExpectPaymentInputSchema.parse({ orderId: uuid, kind: "remainder_refund", amountSum: 1 }).direction).toBe(
      "out",
    );
  });

  it("refuses the two money flows mixed: purchase funds through the QR, a fee by bank transfer", () => {
    expect(
      ExpectPaymentInputSchema.safeParse({ orderId: uuid, kind: "purchase_funds", amountSum: 1, method: "xolis_qr" })
        .success,
    ).toBe(false);
    expect(
      ExpectPaymentInputSchema.safeParse({ orderId: uuid, kind: "fee_final", amountSum: 1, method: "bank_transfer_ip" })
        .success,
    ).toBe(false);
  });

  it("allows the card of the merchant for a fee", () => {
    expect(
      ExpectPaymentInputSchema.safeParse({ orderId: uuid, kind: "fee_final", amountSum: 1, method: "merchant_card" })
        .success,
    ).toBe(true);
  });

  it.each([0, -1, 1.5, MAX_PAYMENT_SUM + 1, Number.NaN])("rejects the amount %s", (amountSum) => {
    expect(ExpectPaymentInputSchema.safeParse({ orderId: uuid, kind: "fee_advance", amountSum }).success).toBe(false);
  });

  it("rejects an unknown kind and an order id that is not a uuid", () => {
    expect(ExpectPaymentInputSchema.safeParse({ orderId: uuid, kind: "gift", amountSum: 1 }).success).toBe(false);
    expect(ExpectPaymentInputSchema.safeParse({ orderId: "x", kind: "fee_advance", amountSum: 1 }).success).toBe(false);
  });
});

describe("ConfirmPaymentInputSchema", () => {
  it("accepts a receipt and a time given as text", () => {
    const c = ConfirmPaymentInputSchema.parse({
      paymentId: uuid,
      fiscalReceiptNo: " 12345 ",
      at: "2026-10-12T10:00:00+05:00",
    });
    expect(c.fiscalReceiptNo).toBe("12345");
    expect(c.at?.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("rejects an empty receipt number and an invalid time", () => {
    expect(ConfirmPaymentInputSchema.safeParse({ paymentId: uuid, fiscalReceiptNo: "  " }).success).toBe(false);
    expect(ConfirmPaymentInputSchema.safeParse({ paymentId: uuid, at: "yesterday" }).success).toBe(false);
  });

  it("accepts the statement of a third party as a file id", () => {
    expect(
      ConfirmPaymentInputSchema.safeParse({
        paymentId: uuid,
        payerIsCustomer: false,
        thirdPartyStatementFileId: uuid,
      }).success,
    ).toBe(true);
  });
});

describe("VoidPaymentInputSchema", () => {
  it("needs a reason", () => {
    expect(VoidPaymentInputSchema.safeParse({ paymentId: uuid }).success).toBe(false);
    expect(VoidPaymentInputSchema.safeParse({ paymentId: uuid, reason: " " }).success).toBe(false);
    expect(VoidPaymentInputSchema.safeParse({ paymentId: uuid, reason: "paid twice by mistake" }).success).toBe(true);
  });
});
