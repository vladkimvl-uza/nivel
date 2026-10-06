import { describe, expect, it } from "vitest";
import { MAX_PURCHASE_SUM, RecordPurchaseInputSchema } from "./index.ts";

const uuid = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const base = {
  orderId: uuid,
  vendorId: uuid,
  qty: 1,
  amountSum: 3_200_000,
  paidVia: "bank_transfer",
  receiptKind: "fiscal",
  receiptNo: "CH-1",
  receiptFileIds: [uuid],
} as const;

const { receiptNo: _receiptNo, ...noReceiptNo } = base;

describe("RecordPurchaseInputSchema", () => {
  it("accepts a purchase with a fiscal receipt and its photo", () => {
    expect(RecordPurchaseInputSchema.safeParse(base).success).toBe(true);
  });

  it("needs the number of a fiscal receipt", () => {
    expect(RecordPurchaseInputSchema.safeParse(noReceiptNo).success).toBe(false);
  });

  it("needs the ESF status of an ESF purchase", () => {
    expect(RecordPurchaseInputSchema.safeParse({ ...noReceiptNo, receiptKind: "esf" }).success).toBe(false);
    expect(
      RecordPurchaseInputSchema.safeParse({ ...noReceiptNo, receiptKind: "esf", esfStatus: "pending" }).success,
    ).toBe(true);
  });

  it("needs a photo of the receipt unless the customer agreed to a purchase without one", () => {
    expect(RecordPurchaseInputSchema.safeParse({ ...base, receiptFileIds: [] }).success).toBe(false);
    expect(
      RecordPurchaseInputSchema.safeParse({ ...noReceiptNo, receiptKind: "none_with_consent", receiptFileIds: [] })
        .success,
    ).toBe(true);
  });

  it.each([0, -3_200_000, 1.5, MAX_PURCHASE_SUM + 1])("rejects the amount %s", (amountSum) => {
    expect(RecordPurchaseInputSchema.safeParse({ ...base, amountSum }).success).toBe(false);
  });

  it.each([0, -1, 100, 1.5])("rejects the quantity %s", (qty) => {
    expect(RecordPurchaseInputSchema.safeParse({ ...base, qty }).success).toBe(false);
  });

  it("rejects a way of payment outside the two the database knows", () => {
    expect(RecordPurchaseInputSchema.safeParse({ ...base, paidVia: "personal_card" }).success).toBe(false);
  });

  it("limits the serial numbers to the quantity", () => {
    expect(RecordPurchaseInputSchema.safeParse({ ...base, qty: 2, serials: ["a", "b"] }).success).toBe(true);
    expect(RecordPurchaseInputSchema.safeParse({ ...base, qty: 1, serials: ["a", "b"] }).success).toBe(false);
  });
});
