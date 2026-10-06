import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { record as recordConsent } from "../consents/index.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import { customerActor, ownerActor, purchasingOrder, type TestOrder } from "../orders/test-support/flow.ts";
import { createWorld, newFile, type World } from "../orders/test-support/world.ts";
import { type RecordPurchaseInput, record } from "./index.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(() => w.clock.set(new Date("2026-10-13T10:00:00+05:00")));

const owner = () => ownerActor(w);
let receiptNo = 1000;

async function lineOf(o: TestOrder, key: "cpu" | "gpu" | "ram" | "ssd" | "mb"): Promise<string> {
  const { rows } = await w.db.$client.query(
    "select id from sales.quote_lines where quote_id = $1 and product_id = $2",
    [o.quoteId, w.products[key].id],
  );
  return rows[0].id;
}

async function input(
  o: TestOrder,
  key: "cpu" | "gpu" | "ram" | "ssd" | "mb",
  over: Partial<RecordPurchaseInput> = {},
): Promise<RecordPurchaseInput> {
  receiptNo += 1;
  return {
    orderId: o.orderId,
    vendorId: w.vendorId,
    quoteLineId: await lineOf(o, key),
    productId: w.products[key].id,
    qty: 1,
    amountSum: w.products[key].price,
    paidVia: "bank_transfer",
    receiptKind: "fiscal",
    receiptNo: `CH-${receiptNo}`,
    receiptFileIds: [await newFile(w)],
    ...over,
  };
}

const count = async (sql: string, args: unknown[]) => (await w.db.$client.query(sql, args)).rows[0].n as number;

describe("purchases.record", () => {
  it("records a purchase with its receipt and photo and the event PURCHASE_RECORDED in one transaction", async () => {
    const o = await purchasingOrder(w);
    const i = await input(o, "cpu");
    const r = await record(i, owner(), w.admin);
    expect(r).toMatchObject({ ok: true, status: "purchasing" });
    if (!r.ok) return;

    const p = (await w.db.$client.query("select * from sales.purchases where id = $1", [r.purchaseId])).rows[0];
    expect(p).toMatchObject({
      order_id: o.orderId,
      vendor_id: w.vendorId,
      qty: 1,
      receipt_kind: "fiscal",
      bought_by: w.owner.id,
    });
    expect(p.amount_sum).toBe(String(w.products.cpu.price));
    const files = await w.db.$client.query("select kind from sales.purchase_files where purchase_id = $1", [
      r.purchaseId,
    ]);
    expect(files.rows).toEqual([{ kind: "receipt" }]);
    const ev = await w.db.$client.query(
      "select event from sales.order_events where order_id = $1 order by seq desc limit 1",
      [o.orderId],
    );
    expect(ev.rows[0].event).toEqual({ type: "PURCHASE_RECORDED", purchaseId: r.purchaseId });
    const notice = await w.db.$client.query(
      "select payload from ops.outbox where payload->>'orderId' = $1 and payload->>'templateKey' = 'order.purchase_recorded'",
      [o.orderId],
    );
    expect(notice.rows).toHaveLength(1);
    expect(
      await count("select count(*)::int as n from ops.outbox where dedupe_key = $1", [
        `payment:${r.purchaseId}:threshold`,
      ]),
    ).toBe(0);
    expect(
      await count("select count(*)::int as n from ops.outbox where dedupe_key = $1", [
        `purchase:${r.purchaseId}:threshold`,
      ]),
    ).toBe(1);
  });

  it("lets the assistant record a purchase: it is not a money event of the table 4.9", async () => {
    const o = await purchasingOrder(w);
    const r = await record(await input(o, "mb"), { kind: "assistant", id: w.assistant.id }, w.admin);
    expect(r.ok).toBe(true);
  });

  it("refuses a purchase above the limit without the consent, and writes nothing", async () => {
    const o = await purchasingOrder(w);
    const before = await count("select count(*)::int as n from sales.purchases where order_id = $1", [o.orderId]);
    const r = await record(await input(o, "gpu", { amountSum: o.quote.totals.purchaseLimit + 1 }), owner(), w.admin);
    expect(r).toEqual({ ok: false, error: "limit_exceeded" });
    expect(await count("select count(*)::int as n from sales.purchases where order_id = $1", [o.orderId])).toBe(before);
    expect(
      await count(
        "select count(*)::int as n from sales.purchase_files pf join sales.purchases p on p.id = pf.purchase_id where p.order_id = $1",
        [o.orderId],
      ),
    ).toBe(0);
  });

  it("never spends more than the money received, even with the consent to exceed the limit", async () => {
    const o = await purchasingOrder(w);
    await recordConsent(
      { kind: "limit_overrun", customerId: o.customerId, orderId: o.orderId, granted: true, channel: "bot" },
      w.bot,
    );
    const r = await record(await input(o, "gpu", { amountSum: o.quote.totals.purchaseLimit + 1 }), owner(), w.admin);
    expect(r).toEqual({ ok: false, error: "funds_exceeded" });
  });

  it("a purchase without a receipt needs the consent of the customer, and with it goes through", async () => {
    const o = await purchasingOrder(w);
    const base = await input(o, "ram", { receiptKind: "none_with_consent", receiptFileIds: [] });
    const { receiptNo: _drop, ...noReceipt } = base;
    expect(await record(noReceipt, owner(), w.admin)).toEqual({ ok: false, error: "consent_missing" });
    await recordConsent(
      { kind: "no_receipt_purchase", customerId: o.customerId, orderId: o.orderId, granted: true, channel: "bot" },
      w.bot,
    );
    expect((await record(noReceipt, owner(), w.admin)).ok).toBe(true);
  });

  it("needs the photo of the receipt: a receipt number alone is not enough", async () => {
    const o = await purchasingOrder(w);
    await expect(record(await input(o, "cpu", { receiptFileIds: [] }), owner(), w.admin)).rejects.toMatchObject({
      issues: [{ path: "receiptFileIds", code: "photo_required" }],
    });
  });

  it("needs the number of a fiscal receipt and the status of an ESF", async () => {
    const o = await purchasingOrder(w);
    const base = await input(o, "cpu");
    const { receiptNo: _r, ...noNumber } = base;
    await expect(record(noNumber, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ path: "receiptNo", code: "receipt_no_required" }],
    });
    await expect(record({ ...noNumber, receiptKind: "esf" }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ path: "esfStatus", code: "esf_status_required" }],
    });
  });

  it("sets the day by which the ESF is due: ten days after the purchase, by the calendar of Tashkent", async () => {
    const o = await purchasingOrder(w);
    const base = await input(o, "ssd");
    const { receiptNo: _r, ...rest } = base;
    const r = await record({ ...rest, receiptKind: "esf", esfStatus: "pending", esfNo: "ESF-1" }, owner(), w.admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = (
      await w.db.$client.query("select esf_due::text as due, esf_status from sales.purchases where id = $1", [
        r.purchaseId,
      ])
    ).rows[0];
    expect(p).toEqual({ due: "2026-10-23", esf_status: "pending" });
  });

  it("does not take the same receipt of the same shop twice", async () => {
    const o = await purchasingOrder(w);
    const first = await input(o, "cpu");
    expect((await record(first, owner(), w.admin)).ok).toBe(true);
    await expect(record({ ...first, receiptFileIds: [await newFile(w)] }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "purchase_duplicate" }],
    });
  });

  it("refuses a line that is not a line of the current quote of the order, an unknown shop and an unknown photo", async () => {
    const o = await purchasingOrder(w);
    const other = await purchasingOrder(w);
    w.clock.set(new Date("2026-10-13T10:00:00+05:00"));
    await expect(
      record(await input(o, "cpu", { quoteLineId: await lineOf(other, "cpu") }), owner(), w.admin),
    ).rejects.toMatchObject({
      issues: [{ path: "quoteLineId", code: "quote_line_unknown" }],
    });
    await expect(
      record(await input(o, "cpu", { vendorId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }), owner(), w.admin),
    ).rejects.toMatchObject({ issues: [{ path: "vendorId", code: "vendor_unknown" }] });
    await expect(
      record(await input(o, "cpu", { receiptFileIds: ["0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"] }), owner(), w.admin),
    ).rejects.toMatchObject({ issues: [{ path: "receiptFileIds", code: "file_unknown" }] });
  });

  it("refuses sums and quantities that are not whole and positive, and serial numbers beyond the quantity", async () => {
    const o = await purchasingOrder(w);
    for (const amountSum of [0, -1, 1.5, Number.NaN]) {
      await expect(record(await input(o, "cpu", { amountSum }), owner(), w.admin)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    for (const qty of [0, -1, 100, 1.5]) {
      await expect(record(await input(o, "cpu", { qty }), owner(), w.admin)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(record(await input(o, "cpu", { serials: ["a", "b"] }), owner(), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("is refused by the automaton before the purchase has started, and nothing stays written", async () => {
    const { acceptedOrder } = await import("../orders/test-support/flow.ts");
    const o = await acceptedOrder(w);
    const r = await record(await input(o, "cpu"), owner(), w.admin);
    expect(r).toMatchObject({ ok: false });
    expect(await count("select count(*)::int as n from sales.purchases where order_id = $1", [o.orderId])).toBe(0);
  });

  it("is a job of the staff in the admin role", async () => {
    const o = await purchasingOrder(w);
    await expect(record(await input(o, "cpu"), owner(), w.bot)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(record(await input(o, "cpu"), customerActor(o), w.admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      record({ ...(await input(o, "cpu")), orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, owner(), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
