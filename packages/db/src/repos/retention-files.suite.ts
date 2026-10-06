import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectAs,
  createOrder,
  createVendor,
  insertAct,
  insertFile,
  insertPurchase,
  one,
  pgError,
  receiveFunds,
  sendQuote,
} from "./testkit.ts";

// WP-00 (d): the files of ops.files are kept by the class of retention (DATA-MAP 9). ops.purge_expired_files() deletes the
// rows that are due and returns the storage keys, so that the worker removes the bytes from the disk. The documents of an
// order live until the end of the longest warranty plus 3 years and never less than 5 years.
let migrator: pg.Client;
let web: pg.Client;
let admin: pg.Client;
let bot: pg.Client;
let worker: pg.Client;

const DENIED = "42501";
const PURGE = "select * from ops.purge_expired_files($1::timestamptz)";

beforeAll(async () => {
  [migrator, web, admin, bot, worker] = await Promise.all([
    connectAs("MIGRATOR"),
    connectAs("WEB"),
    connectAs("ADMIN"),
    connectAs("BOT"),
    connectAs("WORKER"),
  ]);
});
afterAll(async () => {
  for (const c of [migrator, web, admin, bot, worker]) await c.end();
});

const purge = async (c: pg.Client, now: string | null = null) =>
  (await c.query<{ storage_key: string }>(PURGE, [now])).rows.map((r) => r.storage_key).sort();
const exists = async (id: string) =>
  Number((await one<{ n: string }>(migrator, "select count(*)::text as n from ops.files where id = $1", [id])).n) === 1;
const file = (retention: Parameters<typeof insertFile>[1]["retention"], age: string, kind?: string) =>
  insertFile(migrator, { retention, age, ...(kind ? { kind } : {}) });

describe.each(["worker", "admin"] as const)("ops.purge_expired_files as the %s role", (role) => {
  const client = () => (role === "worker" ? worker : admin);

  it("runs in the session of the real role", async () => {
    expect(await one(client(), "select current_user, session_user")).toEqual({
      current_user: `nivel_${role}`,
      session_user: `nivel_${role}`,
    });
  });

  it("deletes a lead file after 12 months and an AI file after 90 days, returns their keys and keeps the younger", async () => {
    const lead = await file("lead_12m", "13 months");
    const leadYoung = await file("lead_12m", "11 months");
    const ai = await file("ai_90d", "91 days");
    const aiYoung = await file("ai_90d", "89 days");
    const keys = await purge(client());
    expect(keys).toEqual([lead.storageKey, ai.storageKey].sort());
    expect(await exists(lead.id)).toBe(false);
    expect(await exists(ai.id)).toBe(false);
    expect(await exists(leadYoung.id)).toBe(true);
    expect(await exists(aiYoung.id)).toBe(true);
  });

  it("never deletes media, however old", async () => {
    const m = await file("media", "40 years");
    expect(await purge(client())).not.toContain(m.storageKey);
    expect(await exists(m.id)).toBe(true);
  });

  it.each(["tax_5y", "order_warranty_plus_3y"] as const)(
    "keeps a %s file without an order for 5 years from its day",
    async (cls) => {
      const old = await file(cls, "6 years");
      const young = await file(cls, "4 years 11 months");
      const keys = await purge(client());
      expect(keys).toContain(old.storageKey);
      expect(keys).not.toContain(young.storageKey);
      expect(await exists(old.id)).toBe(false);
      expect(await exists(young.id)).toBe(true);
    },
  );

  it("is repeatable: the second run finds nothing", async () => {
    await file("lead_12m", "2 years");
    expect((await purge(client())).length).toBeGreaterThan(0);
    expect(await purge(client())).toEqual([]);
  });

  it("counts the day: a file of exactly 12 months is due, one a second younger is not", async () => {
    const due = await file("lead_12m", "1 month");
    const notYet = await file("lead_12m", "1 month");
    const at = (await one<{ at: Date }>(migrator, "select now() - interval '6 months' as at")).at.toISOString();
    await migrator.query("update ops.files set created_at = $2::timestamptz - interval '12 months' where id = $1", [
      due.id,
      at,
    ]);
    await migrator.query(
      "update ops.files set created_at = $2::timestamptz - interval '12 months' + interval '1 second' where id = $1",
      [notYet.id, at],
    );
    expect(await purge(client(), at)).toEqual([due.storageKey]);
    expect(await exists(notYet.id)).toBe(true);
  });

  it("never reads a moment later than the clock of the database", async () => {
    const young = await file("lead_12m", "2 months");
    expect(await purge(client(), "2999-01-01T00:00:00Z")).not.toContain(young.storageKey);
    expect(await exists(young.id)).toBe(true);
  });

  it("writes one audit row with the count and no storage keys", async () => {
    const f = await file("lead_12m", "2 years");
    await purge(client());
    const audit = await migrator.query(
      "select actor, after from ops.audit_log where action = 'retention.purge_files' order by at desc limit 1",
    );
    expect(audit.rows[0]).toMatchObject({ actor: `db:nivel_${role}`, after: { files: expect.any(Number) } });
    expect(JSON.stringify(audit.rows[0])).not.toContain(f.storageKey);
  });
});

/** An order with a warranty that ends `warrantyEnds` (SQL interval before now, or null: no warranty yet). */
async function orderWithWarranty(warrantyEnds: string | null) {
  const o = await createOrder(migrator);
  if (warrantyEnds !== null) {
    // The status machine is not under test here: the column is set as the migrator does it in a fixture.
    await migrator.query("update sales.orders set warranty_until = now() - $2::interval where id = $1", [
      o.orderId,
      warrantyEnds,
    ]);
  }
  return o;
}

describe("the documents of an order: the warranty plus 3 years, and not less than 5 years", () => {
  it.each(["tax_5y", "order_warranty_plus_3y"] as const)(
    "keeps a %s PDF of a quote while the term after the warranty runs",
    async (cls) => {
      // The file is 6 years old, but the warranty ended 2 years ago: it lives until 1 year from now.
      const o = await orderWithWarranty("2 years");
      const f = await file(cls, "6 years");
      await migrator.query("update sales.quotes set pdf_uz_file_id = $2 where id = $1", [o.quoteId, f.id]);
      expect(await purge(worker)).not.toContain(f.storageKey);
      expect(await exists(f.id)).toBe(true);
    },
  );

  it("deletes it when the warranty plus 3 years is over, and takes the link out of the quote that stays", async () => {
    const o = await orderWithWarranty("4 years");
    const f = await file("tax_5y", "6 years");
    const g = await file("tax_5y", "6 years");
    await migrator.query("update sales.quotes set pdf_uz_file_id = $2, pdf_ru_file_id = $3 where id = $1", [
      o.quoteId,
      f.id,
      g.id,
    ]);
    expect(await purge(worker)).toEqual([f.storageKey, g.storageKey].sort());
    const q = await one<{ pdf_uz_file_id: string | null; pdf_ru_file_id: string | null; purchase_limit: string }>(
      migrator,
      "select pdf_uz_file_id, pdf_ru_file_id, purchase_limit::text from sales.quotes where id = $1",
      [o.quoteId],
    );
    expect(q).toEqual({ pdf_uz_file_id: null, pdf_ru_file_id: null, purchase_limit: "10000000" });
  });

  it("is never earlier than 5 years from the day of the file, even when the warranty ended long ago", async () => {
    const o = await orderWithWarranty("10 years");
    const f = await file("tax_5y", "3 years");
    await migrator.query("update sales.quotes set pdf_uz_file_id = $2 where id = $1", [o.quoteId, f.id]);
    expect(await purge(worker)).not.toContain(f.storageKey);
  });

  it("waits for the longest of the warranties: the one of a shop may end after ours", async () => {
    const o = await orderWithWarranty("4 years");
    await receiveFunds(migrator, o.orderId, 1_000_000);
    const p = await insertPurchase(migrator, {
      orderId: o.orderId,
      vendorId: await createVendor(migrator),
      amount: 500_000,
    });
    // The shop gave 5 years: it ended 1 year ago, so the files live 2 more years.
    await migrator.query(
      "update sales.purchases set vendor_warranty_until = (now() - interval '1 year')::date where id = $1",
      [p],
    );
    const f = await file("tax_5y", "6 years");
    await migrator.query("insert into sales.purchase_files (purchase_id, file_id, kind) values ($1, $2, 'receipt')", [
      p,
      f.id,
    ]);
    expect(await purge(worker)).not.toContain(f.storageKey);
    await migrator.query(
      "update sales.purchases set vendor_warranty_until = (now() - interval '4 years')::date where id = $1",
      [p],
    );
    expect(await purge(worker)).toContain(f.storageKey);
    const left = await one<{ n: string }>(
      migrator,
      "select count(*)::text as n from sales.purchase_files where purchase_id = $1",
      [p],
    );
    expect(left.n).toBe("0");
  });

  it("keeps the files of an order that is still going on: the warranty has not begun", async () => {
    const o = await orderWithWarranty(null);
    const f = await file("tax_5y", "7 years");
    await migrator.query("update sales.quotes set pdf_ru_file_id = $2 where id = $1", [o.quoteId, f.id]);
    expect(await purge(worker)).not.toContain(f.storageKey);
  });

  it("does not wait for an order that ended without a warranty (a cancelled one)", async () => {
    const o = await createOrder(migrator);
    await migrator.query(
      "select * from sales.apply_transition($1, '{\"type\":\"CANCEL\"}', 'owner', 'x', null, null, '{}')",
      [o.orderId],
    );
    await migrator.query(
      "select * from sales.apply_transition($1, '{\"type\":\"CANCEL_SETTLED\"}', 'owner', 'x', null, null, '{}')",
      [o.orderId],
    );
    const f = await file("order_warranty_plus_3y", "6 years");
    await migrator.query("update sales.quotes set pdf_uz_file_id = $2 where id = $1", [o.quoteId, f.id]);
    expect(await purge(worker)).toContain(f.storageKey);
  });

  it("takes the file out of every document that names it, the journal of payments included", async () => {
    const o = await orderWithWarranty("5 years");
    const f = await file("tax_5y", "7 years");
    const payment = await one<{ id: string }>(
      migrator,
      `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, payer_is_customer,
          third_party_statement_file_id, confirmed_at, confirmed_by)
       values ($1, 'purchase_funds', 'in', 'bank_transfer_ip', 100000, 'confirmed', false, $2, now(), 'test') returning id`,
      [o.orderId, f.id],
    );
    const actId = await insertAct(migrator, o.orderId, "handover");
    await migrator.query("update sales.acts set pdf_uz_file_id = $2, pdf_ru_file_id = $2 where id = $1", [actId, f.id]);
    await migrator.query(
      "insert into sales.commission_reports (order_id, version, received_sum, spent_sum, remainder_sum, lines, pdf_uz_file_id) values ($1, 1, 10, 4, 6, '[]', $2)",
      [o.orderId, f.id],
    );
    await migrator.query("insert into sales.build_passports (order_id, pdf_ru_file_id) values ($1, $2)", [
      o.orderId,
      f.id,
    ]);
    const customerId = (
      await one<{ customer_id: string }>(migrator, "select customer_id from sales.orders where id = $1", [o.orderId])
    ).customer_id;
    const dsr = await one<{ id: string }>(
      migrator,
      "insert into ops.dsr_requests (customer_id, kind, result_file_id) values ($1, 'copy', $2) returning id",
      [customerId, f.id],
    );
    expect(await purge(admin)).toContain(f.storageKey);
    const rows = await one<Record<string, string | null>>(
      migrator,
      `select (select third_party_statement_file_id from sales.payments where id = $1)::text as payment,
              (select pdf_uz_file_id from sales.acts where id = $2)::text as act_uz,
              (select pdf_ru_file_id from sales.acts where id = $2)::text as act_ru,
              (select pdf_uz_file_id from sales.commission_reports where order_id = $3)::text as report,
              (select pdf_ru_file_id from sales.build_passports where order_id = $3)::text as passport,
              (select result_file_id from ops.dsr_requests where id = $4)::text as dsr`,
      [payment.id, actId, o.orderId, dsr.id],
    );
    expect(rows).toEqual({ payment: null, act_uz: null, act_ru: null, report: null, passport: null, dsr: null });
    // Nothing else of the confirmed payment changed: the journal keeps its amount, kind and status.
    const p = await one<{ amount: string; status: string; kind: string; payer: boolean }>(
      migrator,
      "select amount_sum::text as amount, status, kind, payer_is_customer as payer from sales.payments where id = $1",
      [payment.id],
    );
    expect(p).toEqual({ amount: "100000", status: "confirmed", kind: "purchase_funds", payer: false });
  });

  it("the paper act that names a file only in its evidence loses nothing but the file", async () => {
    const o = await orderWithWarranty("5 years");
    const f = await file("tax_5y", "7 years", "act_photo");
    const actId = await insertAct(migrator, o.orderId, "customer_parts");
    await migrator.query(
      "update sales.acts set signed_at = now(), signed_via = 'paper_photo', evidence = $2::jsonb where id = $1",
      [actId, JSON.stringify({ fileId: f.id })],
    );
    expect(await purge(worker)).toContain(f.storageKey);
    const act = await one<{ signed_via: string; evidence: { fileId: string } }>(
      migrator,
      "select signed_via, evidence from sales.acts where id = $1",
      [actId],
    );
    expect(act).toEqual({ signed_via: "paper_photo", evidence: { fileId: f.id } });
  });

  it("skips a file that the catalog, the content or the price lists still use: the purge never fails on a link it does not know", async () => {
    const f = await file("lead_12m", "3 years", "image");
    const vendor = await createVendor(migrator);
    await migrator.query("update pricing.vendors set agreement_file_id = $2 where id = $1", [vendor, f.id]);
    expect(await purge(worker)).not.toContain(f.storageKey);
    expect(await exists(f.id)).toBe(true);
    await migrator.query("update pricing.vendors set agreement_file_id = null where id = $1", [vendor]);
    expect(await purge(worker)).toContain(f.storageKey);
  });

  it("knows every table that points at ops.files: a new link must be named in the function before it ships", async () => {
    const { rows } = await migrator.query<{ ref: string }>(
      `select conrelid::regclass::text || '.' || a.attname as ref
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.contype = 'f' and c.confrelid = 'ops.files'::regclass
        order by 1`,
    );
    expect(rows.map((r) => r.ref)).toEqual(
      [
        "catalog.products.image_file_id",
        "content.hero_scene.poster_file_id",
        "content.hero_scene.video_720_file_id",
        "content.hero_scene.video_1080_file_id",
        "content.hero_scene.video_vertical_file_id",
        "content.idea_posts.permission_file_id",
        "ops.dsr_requests.result_file_id",
        "pricing.price_imports.file_id",
        "pricing.vendors.agreement_file_id",
        "sales.acts.pdf_ru_file_id",
        "sales.acts.pdf_uz_file_id",
        "sales.build_passports.pdf_ru_file_id",
        "sales.build_passports.pdf_uz_file_id",
        "sales.commission_reports.pdf_ru_file_id",
        "sales.commission_reports.pdf_uz_file_id",
        "sales.payments.third_party_statement_file_id",
        "sales.purchase_files.file_id",
        "sales.quotes.pdf_ru_file_id",
        "sales.quotes.pdf_uz_file_id",
      ].sort(),
    );
  });
});

describe("who may call ops.purge_expired_files", () => {
  it("only the admin panel and the worker", async () => {
    for (const [role, ok] of [
      ["nivel_admin", true],
      ["nivel_worker", true],
      ["nivel_web", false],
      ["nivel_bot", false],
      ["public", false],
    ] as const) {
      const r = await one<{ ok: boolean }>(
        migrator,
        "select has_function_privilege($1, 'ops.purge_expired_files(timestamptz)'::regprocedure, 'EXECUTE') as ok",
        [role],
      );
      expect(r.ok, role).toBe(ok);
    }
  });

  it("the site and the bot are refused and nothing is deleted", async () => {
    const f = await file("lead_12m", "2 years");
    for (const c of [web, bot]) expect((await pgError(c, PURGE, [null])).code).toBe(DENIED);
    expect(await exists(f.id)).toBe(true);
  });

  it("the worker still cannot delete a row of ops.files itself, nor change the links of the documents", async () => {
    expect((await pgError(worker, "delete from ops.files")).code).toBe(DENIED);
    expect((await pgError(worker, "update sales.quotes set pdf_uz_file_id = null")).code).toBe(DENIED);
  });

  it("the guards of the quote and of the payment journal stay shut for everybody else, even for a caller that sets the flag itself", async () => {
    const o = await createOrder(migrator);
    const f = await file("tax_5y", "1 day");
    await migrator.query("update sales.quotes set pdf_uz_file_id = $2 where id = $1", [o.quoteId, f.id]);
    await sendQuote(migrator, o.quoteId);
    const payment = await one<{ id: string }>(
      migrator,
      `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, payer_is_customer,
          third_party_statement_file_id, confirmed_at, confirmed_by)
       values ($1, 'purchase_funds', 'in', 'bank_transfer_ip', 1000, 'confirmed', false, $2, now(), 'test') returning id`,
      [o.orderId, f.id],
    );
    await admin.query("select set_config('nivel.files_purge', 'on', false)");
    try {
      const q = await pgError(admin, "update sales.quotes set pdf_uz_file_id = null where id = $1", [o.quoteId]);
      expect(q.message).toMatch(/^immutable:/);
      const p = await pgError(admin, "update sales.payments set third_party_statement_file_id = null where id = $1", [
        payment.id,
      ]);
      expect(p.message).toMatch(/^append_only:/);
    } finally {
      await admin.query("select set_config('nivel.files_purge', 'off', false)");
    }
  });
});
