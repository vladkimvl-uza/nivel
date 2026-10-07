// Integration: the card of an order at the far end of its road (acts, passport, warranty, objection) and the lists of choice.
import { reports } from "@nivel/services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgAuditSink } from "../auth/audit.ts";
import { fromFormData } from "./build-event.ts";
import { getOrderCard } from "./read-orders.ts";
import { listCategories, listVendors, searchCatalog } from "./read-quote.ts";
import { customerOf, handedOverOrder, ownerOf, reportSentOrder } from "./test-support/flow.ts";
import { createWorld, newFile, type World } from "./test-support/world.ts";
import { openWarrantyCase, savePassport } from "./writes.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const form = (entries: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return fromFormData(f);
};

describe("the card of a handed over order", () => {
  it("holds the signed acts with the photo of the paper, the passport with its photos, the warranty cases, the report", async () => {
    const o = await handedOverOrder(w, "Дальний конец");
    const writer = {
      db: w.db,
      audit: createPgAuditSink(w.db),
      user: { id: w.owner.id, role: "owner" as const },
      now: w.clock.now,
    };
    const photo = await newFile(w.db, { kind: "part_photo", retention: "order_warranty_plus_3y" });
    const seal = await newFile(w.db, { kind: "serial_photo", retention: "order_warranty_plus_3y" });
    await savePassport(
      writer,
      o.orderId,
      form({
        serials: "Процессор: SN-1",
        minutes: "420",
        photoIds: photo,
        sealPhotoIds: seal,
        notes: "Пломбы на месте",
        labelCode: "L-1",
      }),
    );
    const kase = await openWarrantyCase(writer, o.orderId, form({ description: "Не включается" }));
    expect(kase.ok).toBe(true);

    const card = await getOrderCard(w.db, o.orderId, { seePhone: false });
    expect(card?.order.status).toBe("handed_over");
    expect(card?.order.warrantyUntil).toBeInstanceOf(Date);
    expect(card?.acts.map((a) => a.kind).sort()).toEqual(["handover", "material_acceptance"]);
    for (const a of card?.acts ?? []) {
      expect(a.signedVia).toBe("paper_photo");
      expect(a.evidenceFileId).toBeTruthy();
      expect(card?.files[a.evidenceFileId ?? ""]).toMatchObject({ kind: "act_photo" });
    }
    expect(card?.passport).toMatchObject({
      serials: { Процессор: "SN-1" },
      photoIds: [photo],
      sealPhotoIds: [seal],
      labelCode: "L-1",
      notes: "Пломбы на месте",
    });
    expect(card?.passport?.tests?.minutes).toBe(420);
    expect(card?.files[photo]).toMatchObject({ kind: "part_photo" });
    expect(card?.warranty).toHaveLength(1);
    expect(card?.warranty[0]).toMatchObject({ status: "opened", description: "Не включается" });
    expect(card?.reports).toHaveLength(1);
    expect(card?.payments.find((p) => p.kind === "fee_final")).toMatchObject({ status: "confirmed" });
    expect(card?.events.at(-1)).toMatchObject({ toStatus: "handed_over" });
  });
});

describe("the objection of the customer to the report", () => {
  it("is shown open with its text, and as answered after the owner answers", async () => {
    const o = await reportSentOrder(w, "Возражающий");
    const said = await reports.object({ orderId: o.orderId, text: "Не сходится сумма по SSD" }, customerOf(o), w.bot);
    expect(said.ok).toBe(true);
    const open = await getOrderCard(w.db, o.orderId, { seePhone: false });
    expect(open?.reports[0]?.objection).toEqual({ text: "Не сходится сумма по SSD", resolved: false });
    await reports.resolveObjection({ orderId: o.orderId, note: "Чек приложен" }, ownerOf(w), w.admin);
    const answered = await getOrderCard(w.db, o.orderId, { seePhone: false });
    expect(answered?.reports[0]?.objection).toEqual({ note: "Чек приложен", resolved: true });
    // The automaton does not move on an objection: the order stays where it was.
    expect(answered?.order.status).toBe("report_sent");
  });
});

describe("the lists to choose from", () => {
  it("finds a position by its category, lists the active shops and the categories with their fee group", async () => {
    expect((await searchCatalog(w.db, "cooler")).map((p) => p.title)).toEqual(["Thermalright PA120"]);
    expect((await searchCatalog(w.db, "ryzen", 1)).length).toBe(1);
    expect(await listVendors(w.db)).toEqual([{ id: w.vendorId, name: "Test shop" }]);
    const categories = await listCategories(w.db);
    expect(categories.find((c) => c.code === "gpu")).toMatchObject({ feeGroup: "pc" });
    expect(categories.find((c) => c.code === "cable_mgmt")).toMatchObject({ feeGroup: "mount" });
  });

  it("offers a position with no price at all as a position without a price", async () => {
    const { catalog } = await import("@nivel/db/repos");
    const like = await w.db.query.products.findFirst({ where: (t, { eq }) => eq(t.categoryCode, "cpu") });
    await catalog.createProduct(w.db, {
      slug: "no-price-test",
      categoryCode: "cpu",
      brand: "Nobody",
      model: "No price",
      specs: like?.specs ?? {},
      status: "verified",
    });
    const found = await searchCatalog(w.db, "Nobody");
    expect(found[0]).toMatchObject({ title: "Nobody No price", priceSum: null, confidence: null, priceDate: null });
  });
});
