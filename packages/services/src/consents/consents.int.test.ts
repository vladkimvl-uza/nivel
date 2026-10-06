import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../orders/errors.ts";
import { createWorld, newCustomer, type World } from "../orders/test-support/world.ts";
import { consentsRequiredForAccept, record, verifyAcceptConsents } from "./index.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

let orderSeq = 0;
async function newOrder(): Promise<{ orderId: string; customerId: string }> {
  const customerId = await newCustomer(w);
  const { rows } = await w.db.$client.query(
    "insert into sales.orders (number, customer_id, kind) values ($1, $2, 'pc') returning id",
    [`NV-2998-${String(++orderSeq).padStart(4, "0")}`, customerId],
  );
  return { orderId: rows[0].id as string, customerId };
}

describe("consentsRequiredForAccept", () => {
  it("asks for data processing and the transfer to the shops, and for non-returnable goods only when there are some", () => {
    expect(consentsRequiredForAccept(false)).toEqual(["pd_processing", "supplier_data_transfer"]);
    expect(consentsRequiredForAccept(true)).toEqual(["pd_processing", "supplier_data_transfer", "non_returnable"]);
  });
});

describe("consents.record", () => {
  it("refuses a customer or an order that does not exist with a validation error, not with an error of the database", async () => {
    const unknown = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    await expect(
      record({ kind: "pd_processing", customerId: unknown, granted: true, channel: "bot" }, w.bot),
    ).rejects.toMatchObject({ name: "ValidationError", issues: [{ code: "reference_unknown" }] });
    const { customerId } = await newOrder();
    await expect(
      record({ kind: "non_returnable", customerId, orderId: unknown, granted: true, channel: "bot" }, w.bot),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("writes a consent of the customer for the order and returns its id", async () => {
    const { orderId, customerId } = await newOrder();
    const r = await record({ kind: "non_returnable", customerId, orderId, granted: true, channel: "bot" }, w.bot);
    const { rows } = await w.db.$client.query(
      "select kind, granted, channel, order_id from ops.consents where id = $1",
      [r.id],
    );
    expect(rows[0]).toEqual({ kind: "non_returnable", granted: true, channel: "bot", order_id: orderId });
  });

  it("takes the hash and the language of the text from the document, never from the caller", async () => {
    const { customerId } = await newOrder();
    const docId = w.offerIds?.uz as string;
    const r = await record(
      { kind: "pd_processing", customerId, granted: true, channel: "site", documentId: docId },
      w.web,
    );
    const { rows } = await w.db.$client.query("select text_sha256, lang, document_id from ops.consents where id = $1", [
      r.id,
    ]);
    const doc = await w.db.$client.query("select text_sha256, lang from content.legal_documents where id = $1", [
      docId,
    ]);
    expect(rows[0]).toEqual({ text_sha256: doc.rows[0].text_sha256, lang: "uz", document_id: docId });
  });

  it("records a withdrawal as a new row and keeps the old one", async () => {
    const { orderId, customerId } = await newOrder();
    await record({ kind: "non_returnable", customerId, orderId, granted: true, channel: "bot" }, w.bot);
    await record({ kind: "non_returnable", customerId, orderId, granted: false, channel: "bot" }, w.bot);
    const { rows } = await w.db.$client.query("select granted from ops.consents where order_id = $1 order by at, id", [
      orderId,
    ]);
    expect(rows.map((r) => r.granted)).toEqual([true, false]);
  });

  it("needs the order for the consents that belong to an order", async () => {
    const { customerId } = await newOrder();
    for (const kind of [
      "limit_overrun",
      "non_returnable",
      "replacement",
      "no_receipt_purchase",
      "third_party_payer",
    ] as const) {
      await expect(record({ kind, customerId, granted: true, channel: "bot" }, w.bot)).rejects.toMatchObject({
        issues: [{ path: "orderId", code: "order_required" }],
      });
    }
  });

  it("refuses a consent of another customer for the order", async () => {
    const { orderId } = await newOrder();
    const stranger = await newCustomer(w);
    await expect(
      record({ kind: "non_returnable", customerId: stranger, orderId, granted: true, channel: "bot" }, w.bot),
    ).rejects.toMatchObject({ issues: [{ code: "consent_mismatch" }] });
  });

  it("does not take the consents that move money from the site, only from the bot and the admin", async () => {
    const { orderId, customerId } = await newOrder();
    await expect(
      record({ kind: "limit_overrun", customerId, orderId, granted: true, channel: "site" }, w.web),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await record({ kind: "limit_overrun", customerId, orderId, granted: true, channel: "bot" }, w.bot)).id,
    ).toBeTruthy();
    expect(
      (await record({ kind: "no_receipt_purchase", customerId, orderId, granted: true, channel: "admin" }, w.admin)).id,
    ).toBeTruthy();
  });

  it("refuses an unknown kind, a blank channel, a bad id and an evidence that is not an object", async () => {
    const { orderId, customerId } = await newOrder();
    const ok = { kind: "pd_processing", customerId, granted: true, channel: "bot" } as const;
    await expect(record({ ...ok, kind: "everything" as never }, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(record({ ...ok, channel: " " }, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(record({ ...ok, customerId: "x" }, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(record({ ...ok, orderId: "x" }, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(record({ ...ok, evidence: [1] as never }, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(record({ ...ok, granted: "yes" as never }, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      record({ ...ok, orderId, documentId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, w.bot),
    ).rejects.toMatchObject({
      issues: [{ path: "documentId", code: "document_unknown" }],
    });
  });
});

describe("verifyAcceptConsents", () => {
  it("accepts the consents named by the event when they are the latest of their kinds", async () => {
    const { orderId, customerId } = await newOrder();
    const pd = await record({ kind: "pd_processing", customerId, granted: true, channel: "bot" }, w.bot);
    const sup = await record(
      { kind: "supplier_data_transfer", customerId, orderId, granted: true, channel: "bot" },
      w.bot,
    );
    const nr = await record({ kind: "non_returnable", customerId, orderId, granted: true, channel: "bot" }, w.bot);
    const ids = [pd.id, sup.id, nr.id];
    expect(await verifyAcceptConsents(w.db, { orderId, customerId, consentIds: ids, hasNonReturnable: true })).toEqual({
      ok: true,
    });
    expect(
      await verifyAcceptConsents(w.db, { orderId, customerId, consentIds: [pd.id, sup.id], hasNonReturnable: false }),
    ).toEqual({ ok: true });
  });

  it("names the kinds that are missing", async () => {
    const { orderId, customerId } = await newOrder();
    const pd = await record({ kind: "pd_processing", customerId, granted: true, channel: "bot" }, w.bot);
    expect(
      await verifyAcceptConsents(w.db, { orderId, customerId, consentIds: [pd.id], hasNonReturnable: true }),
    ).toEqual({
      ok: false,
      missing: ["supplier_data_transfer", "non_returnable"],
    });
    expect(await verifyAcceptConsents(w.db, { orderId, customerId, consentIds: [], hasNonReturnable: false })).toEqual({
      ok: false,
      missing: ["pd_processing", "supplier_data_transfer"],
    });
  });

  it("does not take a consent that was withdrawn afterwards, even if the event names it", async () => {
    const { orderId, customerId } = await newOrder();
    const pd = await record({ kind: "pd_processing", customerId, granted: true, channel: "bot" }, w.bot);
    const sup = await record(
      { kind: "supplier_data_transfer", customerId, orderId, granted: true, channel: "bot" },
      w.bot,
    );
    await record({ kind: "supplier_data_transfer", customerId, orderId, granted: false, channel: "bot" }, w.bot);
    expect(
      await verifyAcceptConsents(w.db, { orderId, customerId, consentIds: [pd.id, sup.id], hasNonReturnable: false }),
    ).toEqual({
      ok: false,
      missing: ["supplier_data_transfer"],
    });
  });

  it("does not take the id of another customer or of another order, or an id of the wrong kind", async () => {
    const a = await newOrder();
    const b = await newOrder();
    const bPd = await record({ kind: "pd_processing", customerId: b.customerId, granted: true, channel: "bot" }, w.bot);
    const bSup = await record(
      { kind: "supplier_data_transfer", customerId: b.customerId, orderId: b.orderId, granted: true, channel: "bot" },
      w.bot,
    );
    const aSup = await record(
      { kind: "supplier_data_transfer", customerId: a.customerId, orderId: a.orderId, granted: true, channel: "bot" },
      w.bot,
    );
    const verdict = await verifyAcceptConsents(w.db, {
      orderId: a.orderId,
      customerId: a.customerId,
      consentIds: [bPd.id, bSup.id, aSup.id],
      hasNonReturnable: false,
    });
    expect(verdict).toEqual({ ok: false, missing: ["pd_processing"] });
    // The consent of another kind named in place of the right one does not count either.
    const aPd = await record({ kind: "pd_processing", customerId: a.customerId, granted: true, channel: "bot" }, w.bot);
    expect(
      await verifyAcceptConsents(w.db, {
        orderId: a.orderId,
        customerId: a.customerId,
        consentIds: [aPd.id, aPd.id],
        hasNonReturnable: false,
      }),
    ).toEqual({ ok: false, missing: ["supplier_data_transfer"] });
  });

  it("works under the site role, which reads only a few columns of the consents", async () => {
    const { orderId, customerId } = await newOrder();
    const pd = await record({ kind: "pd_processing", customerId, granted: true, channel: "site" }, w.web);
    const sup = await record(
      { kind: "supplier_data_transfer", customerId, orderId, granted: true, channel: "site" },
      w.web,
    );
    expect(
      await verifyAcceptConsents(w.web.db, {
        orderId,
        customerId,
        consentIds: [pd.id, sup.id],
        hasNonReturnable: false,
      }),
    ).toEqual({ ok: true });
  });
});
