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
  uniq,
} from "./testkit.ts";

// The review of WP-00: ops.purge_expired_files() decides by fields of ops.files (the class, the day) that the worker and
// the admin panel can write, and then empties the links of journals that nobody else may touch. So (1) the inputs of the
// decision cannot be changed by those who may call it, (2) a file that a document of an order names is never judged by
// its class alone, (3) the links the function must know include the ones inside JSON, and (4) the same holds for the
// day of a request (sales.leads.created_at), which sales.purge_expired_leads() reads.
let migrator: pg.Client;
let web: pg.Client;
let admin: pg.Client;
let bot: pg.Client;
let worker: pg.Client;

const CHECK = "23514";
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

const purge = async (c: pg.Client) =>
  (await c.query<{ storage_key: string }>(PURGE, [null])).rows.map((r) => r.storage_key).sort();
const exists = async (id: string) =>
  Number((await one<{ n: string }>(migrator, "select count(*)::text as n from ops.files where id = $1", [id])).n) === 1;
const file = (retention: Parameters<typeof insertFile>[1]["retention"], age: string, kind?: string) =>
  insertFile(migrator, { retention, age, ...(kind ? { kind } : {}) });
const klass = async (id: string) =>
  (await one<{ retention_class: string }>(migrator, "select retention_class from ops.files where id = $1", [id]))
    .retention_class;

/** A purchase of the order (the purchase funds are received first: the database refuses a purchase without them). */
async function purchaseOf(orderId: string): Promise<string> {
  await receiveFunds(migrator, orderId, 1_000_000);
  return insertPurchase(migrator, { orderId, vendorId: await createVendor(migrator), amount: 1000 });
}

/** An order whose warranty ended `ago` (SQL interval) before now. */
async function orderWithWarranty(ago: string | null) {
  const o = await createOrder(migrator);
  if (ago !== null) {
    await migrator.query("update sales.orders set warranty_until = now() - $2::interval where id = $1", [
      o.orderId,
      ago,
    ]);
  }
  return o;
}

describe.each(["worker", "admin"] as const)("the inputs of the retention of a file, as the %s role", (role) => {
  const client = () => (role === "worker" ? worker : admin);

  it("runs in the session of the real role", async () => {
    expect(await one(client(), "select current_user, session_user")).toEqual({
      current_user: `nivel_${role}`,
      session_user: `nivel_${role}`,
    });
  });

  it("cannot shorten the class of a file: the reclassification that made a receipt due is refused", async () => {
    for (const [from, to] of [
      ["tax_5y", "ai_90d"],
      ["order_warranty_plus_3y", "lead_12m"],
      ["lead_12m", "ai_90d"],
      ["media", "lead_12m"],
      ["tax_5y", "lead_12m"],
    ] as const) {
      const f = await file(from, "1 day");
      const e = await pgError(client(), "update ops.files set retention_class = $2 where id = $1", [f.id, to]);
      expect(e.code, `${from} -> ${to}`).toBe(CHECK);
      expect(e.message).toMatch(/^immutable:/);
      expect(await klass(f.id)).toBe(from);
    }
  });

  it("may lengthen it: a lead file that becomes a document of an order", async () => {
    const f = await file("lead_12m", "1 day");
    await client().query("update ops.files set retention_class = 'tax_5y' where id = $1", [f.id]);
    expect(await klass(f.id)).toBe("tax_5y");
    await client().query("update ops.files set retention_class = 'media' where id = $1", [f.id]);
    expect(await klass(f.id)).toBe("media");
    const g = await file("ai_90d", "1 day");
    await client().query("update ops.files set retention_class = 'lead_12m' where id = $1", [g.id]);
    expect(await klass(g.id)).toBe("lead_12m");
  });

  it("cannot move the day of a file, nor its kind, its key or its hash", async () => {
    const f = await file("tax_5y", "1 day");
    for (const [set, value] of [
      ["created_at = now() - interval '9 years'", []],
      ["kind = 'image'", []],
      ["storage_key = 'elsewhere/key'", []],
      ["sha256 = repeat('b', 64)", []],
    ] as const) {
      const e = await pgError(client(), `update ops.files set ${set} where id = $1`, [f.id, ...value]);
      expect(e.code, set).toBe(CHECK);
      expect(e.message).toMatch(/^immutable:/);
    }
  });

  it("still changes the other fields (the flags, the creator)", async () => {
    const f = await file("tax_5y", "1 day");
    await client().query("update ops.files set contains_pd = true, created_by = 'owner' where id = $1", [f.id]);
    const r = await one<{ contains_pd: boolean; created_by: string }>(
      migrator,
      "select contains_pd, created_by from ops.files where id = $1",
      [f.id],
    );
    expect(r).toEqual({ contains_pd: true, created_by: "owner" });
  });

  it("the exploit of the review: shorten the class, age the day, call the purge - nothing is lost", async () => {
    const o = await orderWithWarranty(null);
    const receipt = await file("tax_5y", "1 day");
    const p = await purchaseOf(o.orderId);
    await migrator.query("insert into sales.purchase_files (purchase_id, file_id, kind) values ($1, $2, 'receipt')", [
      p,
      receipt.id,
    ]);
    await pgError(
      client(),
      "update ops.files set retention_class = 'ai_90d', created_at = now() - interval '91 days' where id = $1",
      [receipt.id],
    );
    await purge(client());
    expect(await exists(receipt.id)).toBe(true);
    const left = await one<{ n: string }>(
      migrator,
      "select count(*)::text as n from sales.purchase_files where file_id = $1",
      [receipt.id],
    );
    expect(left.n).toBe("1");
  });
});

describe("the migrator still reclassifies a file (a fixture, a repair)", () => {
  it("changes the class and the day", async () => {
    const f = await file("tax_5y", "1 day");
    await migrator.query(
      "update ops.files set retention_class = 'ai_90d', created_at = now() - interval '9 years' where id = $1",
      [f.id],
    );
    expect(await klass(f.id)).toBe("ai_90d");
  });
});

describe("a file that a document of an order names is judged by the order, whatever its class says", () => {
  // Even when somebody with the right of the migrator gives the file a wrong class, the receipt, the PDF of the quote and
  // the photo of the act live until the warranty plus 3 years and never less than 5 years.
  it.each(["ai_90d", "lead_12m"] as const)("keeps a %s file of a purchase while the order lives", async (cls) => {
    const o = await orderWithWarranty(null);
    const f = await file(cls, "3 years");
    const p = await purchaseOf(o.orderId);
    await migrator.query("insert into sales.purchase_files (purchase_id, file_id, kind) values ($1, $2, 'receipt')", [
      p,
      f.id,
    ]);
    expect(await purge(worker)).not.toContain(f.storageKey);
    expect(await exists(f.id)).toBe(true);
  });

  it.each(["ai_90d", "lead_12m"] as const)("keeps a %s PDF of a quote for 5 years from its day", async (cls) => {
    const o = await orderWithWarranty("10 years");
    const young = await file(cls, "4 years");
    const old = await file(cls, "6 years");
    await migrator.query("update sales.quotes set pdf_uz_file_id = $2, pdf_ru_file_id = $3 where id = $1", [
      o.quoteId,
      young.id,
      old.id,
    ]);
    const keys = await purge(worker);
    expect(keys).not.toContain(young.storageKey);
    expect(keys).toContain(old.storageKey);
  });

  it("keeps a file of a confirmed payment statement for the term of the order", async () => {
    const o = await orderWithWarranty("1 year");
    const f = await file("ai_90d", "6 years");
    await migrator.query(
      `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, payer_is_customer,
          third_party_statement_file_id, confirmed_at, confirmed_by)
       values ($1, 'purchase_funds', 'in', 'bank_transfer_ip', 1000, 'confirmed', false, $2, now(), 'test')`,
      [o.orderId, f.id],
    );
    expect(await purge(worker)).not.toContain(f.storageKey);
  });

  it("a file that no document names still goes by its own class", async () => {
    const f = await file("ai_90d", "100 days");
    expect(await purge(worker)).toContain(f.storageKey);
  });
});

describe("the links inside JSON are links too", () => {
  /** The file of the class `order_warranty_plus_3y`, 6 years old, in an order whose warranty ended 1 year ago. */
  async function kept() {
    const o = await orderWithWarranty("1 year");
    const f = await file("order_warranty_plus_3y", "6 years", "act_photo");
    return { o, f };
  }

  it("the photos of the build passport, written in any case", async () => {
    const { o, f } = await kept();
    await migrator.query("insert into sales.build_passports (order_id, photos, seal_photos) values ($1, $2, $3)", [
      o.orderId,
      JSON.stringify([f.id.toUpperCase()]),
      JSON.stringify([]),
    ]);
    expect(await purge(worker)).not.toContain(f.storageKey);
    expect(await exists(f.id)).toBe(true);
    // The warranty plus 3 years is over: the file goes and the passport stays with its text.
    await migrator.query("update sales.orders set warranty_until = now() - interval '4 years' where id = $1", [
      o.orderId,
    ]);
    expect(await purge(worker)).toContain(f.storageKey);
    const left = await one<{ n: string }>(
      migrator,
      "select count(*)::text as n from sales.build_passports where order_id = $1",
      [o.orderId],
    );
    expect(left.n).toBe("1");
  });

  it("the seal photos of the passport", async () => {
    const { o, f } = await kept();
    await migrator.query("insert into sales.build_passports (order_id, seal_photos) values ($1, $2)", [
      o.orderId,
      JSON.stringify(["not-a-file", f.id]),
    ]);
    expect(await purge(worker)).not.toContain(f.storageKey);
  });

  it("the file id of a paper act in capitals", async () => {
    const { o, f } = await kept();
    const actId = await insertAct(migrator, o.orderId, "customer_parts");
    await migrator.query(
      "update sales.acts set signed_at = now(), signed_via = 'paper_photo', evidence = $2::jsonb where id = $1",
      [actId, JSON.stringify({ fileId: f.id.toUpperCase() })],
    );
    expect(await purge(worker)).not.toContain(f.storageKey);
  });

  it("the authenticity photos of a purchase", async () => {
    const { o, f } = await kept();
    const p = await purchaseOf(o.orderId);
    await migrator.query("update sales.purchases set authenticity = $2::jsonb where id = $1", [
      p,
      JSON.stringify({ gpuz: { shots: [{ file: f.id }] } }),
    ]);
    expect(await purge(worker)).not.toContain(f.storageKey);
  });

  it("the lines and the objection of a commission report, and the claim of a warranty case", async () => {
    const { o, f } = await kept();
    const g = await file("order_warranty_plus_3y", "6 years", "act_photo");
    const h = await file("order_warranty_plus_3y", "6 years", "act_photo");
    await migrator.query(
      "insert into sales.commission_reports (order_id, version, received_sum, spent_sum, remainder_sum, lines, objection) values ($1, 1, 10, 4, 6, $2, $3)",
      [o.orderId, JSON.stringify([{ receipt: f.id }]), JSON.stringify({ photo: g.id })],
    );
    await migrator.query(
      "insert into sales.warranty_cases (number, order_id, description, vendor_claim) values ($1, $2, 'x', $3)",
      [`G-2995-${String(uniq()).padStart(4, "0")}`, o.orderId, JSON.stringify({ scans: [h.id] })],
    );
    const keys = await purge(worker);
    for (const x of [f, g, h]) expect(keys).not.toContain(x.storageKey);
  });

  it("a published portfolio photo and a frame of the hero scene are not purged by a short class", async () => {
    const f = await file("lead_12m", "3 years", "image");
    const g = await file("lead_12m", "3 years", "image");
    await migrator.query(
      "insert into content.portfolio_items (kind, label, photos) values ('concept', 'concept', $1)",
      [JSON.stringify([f.id.toUpperCase()])],
    );
    const frames = Array.from({ length: 5 }, (_, i) => ({
      fileId: i === 2 ? g.id : f.id,
      caption: { uz: "x", ru: "x" },
    }));
    await migrator.query("insert into content.hero_scene (frames) values ($1)", [JSON.stringify(frames)]);
    const keys = await purge(worker);
    expect(keys).not.toContain(f.storageKey);
    expect(keys).not.toContain(g.storageKey);
  });

  it("knows every JSON column of the schemas: a new one is read for file ids before it ships", async () => {
    const { rows } = await migrator.query<{ ref: string }>(
      `select c.table_schema || '.' || c.table_name || '.' || c.column_name as ref
         from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.data_type = 'jsonb' and t.table_type = 'BASE TABLE'
          and c.table_schema in ('ops', 'sales', 'catalog', 'content', 'pricing', 'ai', 'bot')
        order by 1`,
    );
    // Read by ops.purge_expired_files: the documents of an order and the published pictures.
    const read = [
      "sales.purchases.authenticity",
      "sales.commission_reports.lines",
      "sales.commission_reports.objection",
      "sales.acts.lines",
      "sales.acts.evidence",
      "sales.build_passports.serials",
      "sales.build_passports.tests",
      "sales.build_passports.photos",
      "sales.build_passports.seal_photos",
      "sales.warranty_cases.vendor_claim",
      "content.portfolio_items.photos",
      "content.hero_scene.frames",
    ];
    // Looked at and known not to hold the id of a file of an order: the text of a dialogue, the numbers of a calculation,
    // a snapshot, a journal, a setting. The texts of the site (pages, policies, the catalog) name pictures that are
    // published, and a published file has the class `media`, which no purge touches.
    const without = [
      "ai.messages.content",
      "ai.messages.display_substitution",
      "ai.messages.usage",
      "ai.messages.tool_calls",
      "ai.messages.guard_events",
      "ai.usage_daily.tokens",
      "bot.sessions.value",
      "catalog.base_builds.explain",
      "catalog.categories.name",
      "catalog.price_classes.name",
      "catalog.price_classes.perf_class",
      "catalog.products.description",
      "catalog.products.specs",
      "catalog.products.dims_mm",
      "catalog.rule_sets.payload",
      "catalog.rule_sets.golden_run",
      "content.idea_posts.breakdown",
      "content.idea_posts.oembed_cache",
      "content.pages.body",
      "content.pages.title",
      "content.policy_texts.body",
      "content.portfolio_items.caption",
      "ops.settings.value",
      "ops.outbox.payload",
      "ops.consents.evidence",
      "ops.audit_log.before",
      "ops.audit_log.after",
      "pricing.price_imports.errors",
      "sales.configurations.items",
      "sales.configurations.room",
      "sales.configurations.prefs",
      "sales.configurations.price_snapshot",
      "sales.configurations.quote",
      "sales.configurations.compat",
      "sales.leads.utm",
      "sales.orders.cancel",
      "sales.order_events.event",
      "sales.order_events.guard_snapshot",
      "sales.quotes.totals",
      "sales.quotes.acceptance",
    ];
    const known = new Set([...read, ...without]);
    expect(rows.map((r) => r.ref).filter((r) => !known.has(r))).toEqual([]);
    // And nothing in the lists is stale.
    const present = new Set(rows.map((r) => r.ref));
    expect([...known].filter((r) => !present.has(r))).toEqual([]);
  });
});

describe("the day of a request and the Telegram id of a customer cannot be rewritten by the bot", () => {
  it("the bot cannot move sales.leads.created_at (the 12 months of the erasure)", async () => {
    const n = uniq();
    const lead = await one<{ id: string }>(
      migrator,
      "insert into sales.leads (number, channel, scope) values ($1, 'bot', 'pc') returning id",
      [`L-2994-${String(n).padStart(4, "0")}`],
    );
    const e = await pgError(bot, "update sales.leads set created_at = now() - interval '13 months' where id = $1", [
      lead.id,
    ]);
    expect(e.code).toBe(CHECK);
    expect(e.message).toMatch(/^immutable:/);
    // The status of the request is still the bot's to change.
    await bot.query("update sales.leads set status = 'in_review' where id = $1", [lead.id]);
  });

  it("the admin panel cannot move it either; the migrator can", async () => {
    const lead = await one<{ id: string }>(
      migrator,
      "insert into sales.leads (number, channel, scope) values ($1, 'bot', 'pc') returning id",
      [`L-2994-${String(uniq()).padStart(4, "0")}`],
    );
    const e = await pgError(admin, "update sales.leads set created_at = now() - interval '13 months' where id = $1", [
      lead.id,
    ]);
    expect(e.code).toBe(CHECK);
    await migrator.query("update sales.leads set created_at = now() - interval '13 months' where id = $1", [lead.id]);
  });

  it("the bot cannot change the Telegram id a customer already has (the id that signs an act)", async () => {
    const o = await createOrder(migrator);
    const e = await pgError(bot, "update sales.customers set telegram_user_id = 7999999999 where id = $1", [
      o.customerId,
    ]);
    expect(e.code).toBe(CHECK);
    expect(e.message).toMatch(/^immutable:/);
    const e2 = await pgError(bot, "update sales.customers set telegram_user_id = null where id = $1", [o.customerId]);
    expect(e2.code).toBe(CHECK);
  });

  it("the bot still gives a Telegram id to a customer that has none, and changes the other fields", async () => {
    const c = await one<{ id: string }>(
      migrator,
      "insert into sales.customers (display_name) values ('No telegram yet') returning id",
    );
    await bot.query("update sales.customers set telegram_user_id = $2, telegram_username = 'x' where id = $1", [
      c.id,
      7_100_000_000 + uniq(),
    ]);
    await bot.query("update sales.customers set display_name = 'Renamed', telegram_username = 'y' where id = $1", [
      c.id,
    ]);
    const r = await one<{ display_name: string }>(migrator, "select display_name from sales.customers where id = $1", [
      c.id,
    ]);
    expect(r.display_name).toBe("Renamed");
  });

  it("the retention that erases a customer is not the bot and still clears the id", async () => {
    // sales.purge_expired_leads() runs for the worker and the admin panel: the guard names the bot only.
    const e = await pgError(web, "update sales.customers set telegram_user_id = null", []);
    expect(e.code).toBe("42501");
  });
});
