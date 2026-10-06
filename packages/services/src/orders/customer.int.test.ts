// The customer sees only his own orders. The site role reads the views of ALL customers (DATA-MAP 2), so the service
// puts the customer of the checked session into every query; a request for the order of another customer is "not found".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptedOrder, paidOrder, sentOrder, type TestOrder } from "../test-support/flow.ts";
import { createWorld, PC_COMPONENTS_SUM, type World } from "../test-support/world.ts";
import { getCustomerOrder, listCustomerOrders } from "./customer.ts";
import { NotFoundError, ValidationError } from "./errors.ts";

let w: World;
let mine: TestOrder;
let paid: TestOrder;
let theirs: TestOrder;
beforeAll(async () => {
  w = await createWorld();
  mine = await sentOrder(w);
  theirs = await acceptedOrder(w);
  paid = await paidOrder(w);
});
afterAll(async () => {
  await w.close();
});

describe.each([
  ["the site role", () => w.web],
  ["the bot role", () => w.bot],
])("customer orders through %s", (_name, rt) => {
  it("shows the order of the customer by its id and by its number", async () => {
    const byId = await getCustomerOrder({ customerId: mine.customerId, orderId: mine.orderId }, rt());
    const byNumber = await getCustomerOrder({ customerId: mine.customerId, number: mine.number }, rt());
    expect(byNumber).toEqual(byId);
    expect(byId).toMatchObject({
      orderId: mine.orderId,
      number: mine.number,
      kind: "pc",
      status: "estimate_sent",
      customerStatus: "submitted",
    });
  });

  it("shows the quote that was sent: the sums and the lines, with the term", async () => {
    const view = await getCustomerOrder({ customerId: mine.customerId, orderId: mine.orderId }, rt());
    expect(view.quote).toMatchObject({
      status: "sent",
      componentsSum: PC_COMPONENTS_SUM,
      purchaseLimit: mine.quote.totals.purchaseLimit,
      feeTotal: mine.quote.totals.fee.total,
      feeAdvance: mine.quote.totals.advance,
      feeFinal: mine.quote.totals.final,
    });
    expect(view.quote?.validUntil).toBeInstanceOf(Date);
    expect(view.quote?.lines).toHaveLength(8);
    expect(view.quote?.lines[0]).toHaveProperty("title");
  });

  it("never shows a draft quote to the customer", async () => {
    const draft = await (await import("../test-support/flow.ts")).draftOrder(w);
    const view = await getCustomerOrder({ customerId: draft.customerId, orderId: draft.orderId }, rt());
    expect(view.quote).toBeNull();
  });

  it("shows the payments: the expected ones too, without the numbers of the bank documents", async () => {
    const view = await getCustomerOrder({ customerId: paid.customerId, orderId: paid.orderId }, rt());
    expect(view.status).toBe("accepted");
    expect(view.customerStatus).toBe("prepaid");
    expect(view.flags).toEqual({ feePrepaid: true, fundsReceived: true });
    const kinds = view.payments.map((p) => [p.kind, p.status]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["fee_advance", "confirmed"],
        ["purchase_funds", "confirmed"],
      ]),
    );
    for (const p of view.payments) expect(p).not.toHaveProperty("bankDocNo");
  });

  it("does not show the order of another customer: not found, as for an order that does not exist", async () => {
    await expect(
      getCustomerOrder({ customerId: mine.customerId, orderId: theirs.orderId }, rt()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCustomerOrder({ customerId: mine.customerId, number: theirs.number }, rt())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      getCustomerOrder({ customerId: mine.customerId, orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, rt()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists only the orders of the customer", async () => {
    const list = await listCustomerOrders({ customerId: mine.customerId }, rt());
    expect(list.map((o) => o.orderId)).toEqual([mine.orderId]);
    const other = await listCustomerOrders({ customerId: theirs.customerId }, rt());
    expect(other.map((o) => o.orderId)).toEqual([theirs.orderId]);
    expect(await listCustomerOrders({ customerId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, rt())).toEqual([]);
  });

  it("refuses a request that names no order, both, or a bad id", async () => {
    await expect(getCustomerOrder({ customerId: mine.customerId }, rt())).rejects.toBeInstanceOf(ValidationError);
    await expect(getCustomerOrder({ customerId: "x", orderId: mine.orderId }, rt())).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(getCustomerOrder({ customerId: mine.customerId, orderId: "x" }, rt())).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      getCustomerOrder({ customerId: mine.customerId, number: "NV-1; drop table sales.orders" }, rt()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
