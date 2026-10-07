// Integration: the board and the card read what the scenarios wrote, on a real database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getOrderCard, listBoard } from "./read-orders.ts";
import { acceptedOrder, draftOrder, leadOrder, purchasedOrder, reportSentOrder } from "./test-support/flow.ts";
import { createWorld, PC_CATALOG, type World } from "./test-support/world.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

describe("the board", () => {
  it("lists the orders with the name of the customer, the status and the money of the estimate", async () => {
    const o = await draftOrder(w, "Фарход Усманов");
    const rows = await listBoard(w.db);
    const row = rows.find((r) => r.id === o.orderId);
    expect(row).toMatchObject({
      number: o.number,
      status: "estimate_draft",
      customerName: "Фарход Усманов",
      kind: "pc",
      purchaseLimit: o.totals.purchaseLimit,
      feeTotal: o.totals.fee.total,
    });
    expect(row?.leadNumber).toMatch(/^L-2026-\d{4}$/);
  });

  it("shows an order without an estimate with empty sums", async () => {
    const o = await leadOrder(w, "Без сметы");
    const row = (await listBoard(w.db)).find((r) => r.id === o.orderId);
    expect(row).toMatchObject({ purchaseLimit: null, feeTotal: null });
  });

  it("finds by a part of the number or of the name, and by status", async () => {
    const a = await draftOrder(w, "Уникальный Иванов");
    const accepted = await acceptedOrder(w, "Другой Клиент");
    expect((await listBoard(w.db, { q: "Уникальный" })).map((r) => r.id)).toEqual([a.orderId]);
    expect((await listBoard(w.db, { q: a.number.toLowerCase() })).map((r) => r.id)).toEqual([a.orderId]);
    const byStatus = await listBoard(w.db, { status: "accepted" });
    expect(byStatus.map((r) => r.id)).toContain(accepted.orderId);
    expect(byStatus.every((r) => r.status === "accepted")).toBe(true);
  });

  it("treats % and _ typed by a person as letters", async () => {
    await draftOrder(w, "Обычный Клиент");
    expect(await listBoard(w.db, { q: "%" })).toEqual([]);
    expect(await listBoard(w.db, { q: "_" })).toEqual([]);
  });
});

describe("the card", () => {
  it("is empty for an order that does not exist", async () => {
    expect(await getOrderCard(w.db, "0199aaaa-bbbb-7ccc-8ddd-000000000099", { seePhone: false })).toBeNull();
  });

  it("holds the quote with its lines, the totals and the verdict of the compatibility", async () => {
    const o = await draftOrder(w, "Карточка Сметы");
    const card = await getOrderCard(w.db, o.orderId, { seePhone: false });
    expect(card?.order.status).toBe("estimate_draft");
    expect(card?.customer.displayName).toBe("Карточка Сметы");
    expect(card?.quote?.lines).toHaveLength(PC_CATALOG.length);
    expect(card?.quote?.totals).toMatchObject({
      purchaseLimit: o.totals.purchaseLimit,
      feeTotal: o.totals.fee.total,
      advance: o.totals.advance,
      final: o.totals.final,
      grandTotal: o.totals.grandTotal,
      eligibility: o.totals.eligibility.mode,
    });
    expect(card?.quote?.compatVerdict).toMatch(/^(ok|warn|incomplete)$/);
    expect(card?.quote?.shelfLifeHours).toBe(24);
    expect(card?.quoteVersions.map((v) => v.version)).toEqual([1]);
  });

  it("hides the phone of the customer from a role that may not read phones", async () => {
    const o = await draftOrder(w, "Телефонный");
    await w.db.$client.query("update sales.customers set phone_e164 = '+998901234567' where id = $1", [o.customerId]);
    expect((await getOrderCard(w.db, o.orderId, { seePhone: false }))?.customer.phone).toBeNull();
    expect((await getOrderCard(w.db, o.orderId, { seePhone: true }))?.customer.phone).toBe("+998901234567");
  });

  it("shows the purchases with the shop, the receipt and the photo, and the money that the order has", async () => {
    const o = await purchasedOrder(w, "Закупки");
    const card = await getOrderCard(w.db, o.orderId, { seePhone: false });
    expect(card?.order.status).toBe("report_due");
    expect(card?.purchases).toHaveLength(PC_CATALOG.length);
    const first = card?.purchases[0];
    expect(first?.vendorName).toBe("Test shop");
    expect(first?.receiptKind).toBe("fiscal");
    expect(first?.files).toHaveLength(1);
    expect(card?.files[first?.files[0]?.id ?? ""]).toMatchObject({ kind: "receipt" });
    const total = PC_CATALOG.reduce((n, p) => n + p.price, 0);
    expect(card?.money.receiptsTotal).toBe(total);
    expect(card?.money.fundsReceived).toBe(o.totals.purchaseLimit);
    const kinds = card?.payments.map((p) => p.kind).sort();
    expect(kinds).toEqual(["fee_advance", "purchase_funds"]);
    expect(card?.payments.every((p) => p.status === "confirmed")).toBe(true);
    expect(card?.events.map((e) => e.toStatus).at(-1)).toBe("report_due");
  });

  it("shows the report that went out and the expected refund of the remainder", async () => {
    const o = await reportSentOrder(w, "Отчёт");
    const card = await getOrderCard(w.db, o.orderId, { seePhone: false });
    expect(card?.order.status).toBe("report_sent");
    expect(card?.reports).toHaveLength(1);
    expect(card?.reports[0]).toMatchObject({ version: 1, objection: null });
    expect(card?.reports[0]?.sentAt).toBeInstanceOf(Date);
    expect(card?.reports[0]?.objectionUntil).toBeInstanceOf(Date);
    expect(card?.reports[0]?.remainderSum).toBe(o.totals.purchaseLimit - PC_CATALOG.reduce((n, p) => n + p.price, 0));
    expect(card?.payments.find((p) => p.kind === "remainder_refund")).toMatchObject({ status: "expected" });
  });

  it("names the offer status of the order and the consents given", async () => {
    const o = await acceptedOrder(w, "Согласия");
    const card = await getOrderCard(w.db, o.orderId, { seePhone: false });
    expect(card?.offer).toEqual({ uz: "published", ru: "published" });
    expect(card?.consents.map((c) => c.kind).sort()).toEqual(["non_returnable", "supplier_data_transfer"]);
  });
});
