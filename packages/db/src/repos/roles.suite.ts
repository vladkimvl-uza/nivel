import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectAs,
  createOrder,
  createVendor,
  insertPayment,
  insertPurchase,
  one,
  pgError,
  receiveFunds,
  uniq,
} from "./testkit.ts";

// ARCHITECTURE 3.2: rights per role. The key acceptance point: nivel_web does not read sales.payments directly.
let migrator: pg.Client;
let web: pg.Client;
let admin: pg.Client;
let bot: pg.Client;
let worker: pg.Client;
let order: { orderId: string; customerId: string };

const DENIED = "42501";

beforeAll(async () => {
  [migrator, web, admin, bot, worker] = await Promise.all([
    connectAs("MIGRATOR"),
    connectAs("WEB"),
    connectAs("ADMIN"),
    connectAs("BOT"),
    connectAs("WORKER"),
  ]);
  order = await createOrder(migrator);
  await receiveFunds(migrator, order.orderId, 2_000_000);
  await insertPurchase(migrator, { orderId: order.orderId, vendorId: await createVendor(migrator), amount: 500_000 });
  await migrator.query(
    "update sales.customers set phone_e164 = '+998901234567', address = 'Tashkent, secret street 1' where id = $1",
    [order.customerId],
  );
});
afterAll(async () => {
  for (const c of [migrator, web, admin, bot, worker]) await c.end();
});

describe("nivel_web", () => {
  it("does not read sales.payments or sales.purchases directly", async () => {
    expect((await pgError(web, "select * from sales.payments")).code).toBe(DENIED);
    expect((await pgError(web, "select amount_sum from sales.purchases")).code).toBe(DENIED);
    expect((await pgError(web, "select * from sales.orders")).code).toBe(DENIED);
    expect((await pgError(web, "select * from sales.quotes")).code).toBe(DENIED);
  });

  it("reads its customer's money through the views, without staff and bank fields", async () => {
    const payments = await web.query("select * from sales.v_customer_order_payments where customer_id = $1", [
      order.customerId,
    ]);
    expect(payments.rowCount).toBe(1);
    expect(Object.keys(payments.rows[0])).not.toEqual(expect.arrayContaining(["bank_doc_no"]));
    expect(Object.keys(payments.rows[0])).not.toEqual(expect.arrayContaining(["confirmed_by"]));
    const purchases = await web.query("select * from sales.v_customer_order_purchases where customer_id = $1", [
      order.customerId,
    ]);
    expect(purchases.rowCount).toBe(1);
    const status = await web.query("select status from sales.v_customer_order_status where customer_id = $1", [
      order.customerId,
    ]);
    expect(status.rows).toEqual([{ status: "estimate_draft" }]);
  });

  it("reads catalog, prices, content and settings", async () => {
    for (const t of ["catalog.products", "pricing.market_prices", "content.pages", "ops.settings", "catalog.rule_sets"])
      await web.query(`select 1 from ${t} limit 1`);
  });

  it("does not write catalog, prices, content or settings", async () => {
    expect((await pgError(web, "insert into ops.settings (key, value) values ('x', '1')")).code).toBe(DENIED);
    expect((await pgError(web, "update ops.settings set value = '2'")).code).toBe(DENIED);
    expect(
      (
        await pgError(
          web,
          "insert into catalog.categories (code, category_group, name, fee_group_default, freshness_days, returnable_default) values ('x', 'pc', '{}', 'pc', 1, true)",
        )
      ).code,
    ).toBe(DENIED);
    expect((await pgError(web, "delete from pricing.market_prices")).code).toBe(DENIED);
  });

  it("creates customers, leads, configurations, consents and outbox rows, and reads only safe columns back", async () => {
    const n = uniq();
    const customer = await one<{ id: string }>(
      web,
      "insert into sales.customers (display_name, telegram_user_id, lang) values ('Web guest', $1, 'uz') returning id",
      [8_000_000_000 + n],
    );
    const lead = await one<{ number: string }>(
      web,
      "insert into sales.leads (number, customer_id, channel, scope) values ($1, $2, 'web', 'pc') returning number",
      [`L-2026-${7000 + n}`, customer.id],
    );
    expect(lead.number).toMatch(/^L-2026-/);
    await web.query("insert into sales.configurations (public_code, kind, created_via) values ($1, 'pc', 'web')", [
      `WB${String(n).padStart(6, "0")}`,
    ]);
    await web.query("insert into ops.consents (customer_id, kind, granted) values ($1, 'pd_processing', true)", [
      customer.id,
    ]);
    await web.query("insert into ops.outbox (kind, payload, dedupe_key) values ('telegram_message', '{}', $1)", [
      `web-${n}`,
    ]);
    await web.query("insert into ops.audit_log (actor, action, entity) values ('web', 'lead.create', 'sales.leads')");
    expect((await pgError(web, "select phone_e164 from sales.customers")).code).toBe(DENIED);
    expect((await pgError(web, "select address from sales.customers")).code).toBe(DENIED);
    expect((await pgError(web, "select comment from sales.leads")).code).toBe(DENIED);
    expect((await pgError(web, "update sales.leads set status = 'spam'")).code).toBe(DENIED);
    expect((await pgError(web, "update sales.customers set lang = 'ru'")).code).toBe(DENIED);
    expect((await pgError(web, "select * from ops.audit_log")).code).toBe(DENIED);
  });

  it("writes the AI journal and nothing else of the AI schema", async () => {
    const c = await one<{ id: string }>(
      web,
      "insert into ai.conversations (channel, lang, model) values ('web', 'uz', 'm') returning id",
    );
    await web.query("insert into ai.messages (conversation_id, seq, role, content) values ($1, 1, 'user', '\"hi\"')", [
      c.id,
    ]);
    await web.query("update ai.conversations set filter_hits = 1, outcome = 'lead' where id = $1", [c.id]);
    await web.query(
      "insert into ai.usage_daily (day, model, cost_micro_usd) values ('2026-10-06', 'm', 10) on conflict (day, model) do update set cost_micro_usd = ai.usage_daily.cost_micro_usd + 10",
    );
    expect((await pgError(web, "update ai.messages set shown_text = 'x'")).code).toBe(DENIED);
    expect((await pgError(web, "delete from ai.conversations")).code).toBe(DENIED);
  });

  it("cannot reach secrets, admin accounts, files or the bot schema", async () => {
    expect((await pgError(web, "select * from sales.customer_secrets")).code).toBe(DENIED);
    expect((await pgError(web, "select * from ops.admin_users")).code).toBe(DENIED);
    expect((await pgError(web, "select * from ops.files")).code).toBe(DENIED);
    expect((await pgError(web, "select * from bot.sessions")).code).toBe(DENIED);
  });

  it("has no DDL", async () => {
    expect((await pgError(web, "create table sales.hack (id int)")).code).toBe(DENIED);
    expect((await pgError(web, "drop table sales.orders")).code).toBe("42501");
  });
});

describe("nivel_bot", () => {
  it("handles leads, customers and sessions, reads orders", async () => {
    await bot.query("select * from sales.orders limit 1");
    await bot.query("select * from sales.payments limit 1");
    await bot.query("insert into bot.sessions (key, value) values ($1, '{}') on conflict (key) do nothing", [
      `k${uniq()}`,
    ]);
    await bot.query("insert into bot.processed_updates (update_id) values ($1)", [uniq() + 5_000_000]);
    await bot.query("update sales.customers set lang = 'ru' where id = $1", [order.customerId]);
    await bot.query("select address from sales.customers where id = $1", [order.customerId]);
  });

  it("does not write money, orders or journals directly", async () => {
    expect(
      (
        await pgError(
          bot,
          "insert into sales.payments (order_id, kind, direction, method, amount_sum) values ($1, 'fee_advance', 'in', 'xolis_qr', 1)",
          [order.orderId],
        )
      ).code,
    ).toBe(DENIED);
    expect((await pgError(bot, "update sales.orders set tg_topic_id = 1")).code).toBe(DENIED);
    expect(
      (
        await pgError(
          bot,
          "insert into sales.purchases (order_id, vendor_id, qty, amount_sum, paid_via, receipt_kind, bought_by) values ($1, $1, 1, 1, 'bank_transfer', 'esf', 'x')",
          [order.orderId],
        )
      ).code,
    ).toBe(DENIED);
    expect((await pgError(bot, "select * from sales.customer_secrets")).code).toBe(DENIED);
    expect((await pgError(bot, "select * from ai.messages")).code).toBe(DENIED);
  });

  it("records consents and queues messages", async () => {
    await bot.query("insert into ops.consents (customer_id, kind, granted) values ($1, 'marketing', true)", [
      order.customerId,
    ]);
    await bot.query("insert into ops.outbox (kind, payload) values ('telegram_message', '{}')");
    expect((await pgError(bot, "delete from ops.consents")).code).toBe(DENIED);
  });
});

describe("nivel_worker", () => {
  it("maintains prices and the queue", async () => {
    const vendor = await one<{ id: string }>(
      worker,
      "insert into pricing.vendors (name, kind, price_source) values ($1, 'shop', 'csv') returning id",
      [`W ${uniq()}`],
    );
    await worker.query(
      "insert into pricing.price_observations (vendor_id, price_sum, availability, source) values ($1, 10, 'in_stock', 'partner_csv')",
      [vendor.id],
    );
    await worker.query(
      "insert into pricing.fx_rates (ccy, rate, effective_date, source) values ('USD', 12000.5, '2026-10-06', 'cbu_json') on conflict do nothing",
    );
    await worker.query("update ops.outbox set status = 'sent' where false");
    await worker.query("insert into ops.app_errors (app, fingerprint, message) values ('worker', $1, 'boom')", [
      `fp${uniq()}`,
    ]);
    await worker.query(
      "insert into ops.threshold_snapshots (year, as_of, deals_sum, committed_sum, limit_sum, share_bp) values (2026, '2026-10-06', 1, 1, 1000000000, 0) on conflict do nothing",
    );
    expect((await pgError(worker, "delete from pricing.price_observations")).code).toBe(DENIED);
  });

  it("reads sales, without addresses and secrets, and does not write orders or payments", async () => {
    await worker.query("select * from sales.orders limit 1");
    await worker.query("select phone_e164 from sales.customers limit 1");
    expect((await pgError(worker, "select address from sales.customers")).code).toBe(DENIED);
    expect((await pgError(worker, "select * from sales.customer_secrets")).code).toBe(DENIED);
    expect((await pgError(worker, "update sales.orders set tg_topic_id = 1")).code).toBe(DENIED);
    expect(
      (
        await pgError(
          worker,
          "insert into sales.payments (order_id, kind, direction, method, amount_sum) values ($1, 'fee_advance', 'in', 'xolis_qr', 1)",
          [order.orderId],
        )
      ).code,
    ).toBe(DENIED);
  });

  it("writes the reserve ledger and purges expired AI conversations", async () => {
    await worker.query(
      "insert into sales.reserve_ledger (fund, amount_sum, reason) values ('warranty', 150000, 'contribution')",
    );
    await worker.query("select ai.purge_expired()");
  });
});

describe("nivel_admin", () => {
  it("has everything in the application schemas, but no DDL", async () => {
    await admin.query("select * from sales.customer_secrets limit 1");
    await admin.query("select address from sales.customers limit 1");
    await admin.query("update ops.settings set value = value where false");
    expect((await pgError(admin, "create table sales.hack (id int)")).code).toBe(DENIED);
    expect((await pgError(admin, "drop table sales.orders")).code).toBe("42501");
    expect((await pgError(admin, "alter table sales.orders add column x int")).code).toBe("42501");
  });

  it("may confirm a payment but not delete one", async () => {
    const id = await insertPayment(migrator, { orderId: order.orderId, kind: "fee_advance", amount: 100_000 });
    await admin.query(
      "update sales.payments set status = 'confirmed', fiscal_receipt_no = 'R-77', confirmed_by = 'owner', confirmed_at = now() where id = $1",
      [id],
    );
    expect((await pgError(admin, "delete from sales.payments where id = $1", [id])).code).toBe(DENIED);
  });
});

describe("functions", () => {
  it("are not executable by PUBLIC: an unknown role would not call them (grants name the four roles)", async () => {
    const { rows } = await migrator.query<{ fn: string; grantees: string[] }>(
      `select p.oid::regprocedure::text as fn,
              coalesce((select array_agg(distinct pg_get_userbyid(a.grantee)) from aclexplode(p.proacl) a
                         where a.privilege_type = 'EXECUTE' and a.grantee <> 0), '{}') as grantees,
              exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('sales', 'ops', 'ai', 'catalog') and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const r of rows as unknown as { fn: string; public_exec: boolean }[]) expect(r.public_exec, r.fn).toBe(false);
  });
});

describe("the public roles cannot see partner data", () => {
  const PARTNER_TABLES = [
    "pricing.vendors",
    "pricing.offers",
    "pricing.sku_mappings",
    "pricing.price_imports",
    "pricing.price_observations",
  ];
  it.each(PARTNER_TABLES)("keeps %s from the site and the bot", async (table) => {
    expect((await pgError(web, `select * from ${table}`)).code).toBe(DENIED);
    expect((await pgError(bot, `select * from ${table}`)).code).toBe(DENIED);
  });

  it("still gives them the public price data and the worker the partner data", async () => {
    for (const c of [web, bot]) {
      await c.query("select 1 from pricing.fx_rates limit 1");
      await c.query("select 1 from pricing.market_prices limit 1");
      await c.query("select 1 from pricing.v_market_price_current limit 1");
    }
    for (const t of PARTNER_TABLES) await worker.query(`select 1 from ${t} limit 1`);
  });
});

describe("the AI counters of the site", () => {
  it("cannot extend the retention of a conversation or reset the spend counters", async () => {
    const c = await one<{ id: string }>(
      web,
      "insert into ai.conversations (channel, lang, model, cost_micro_usd) values ('web', 'uz', 'm', 500) returning id",
    );
    expect((await pgError(web, "update ai.conversations set purge_after = 'infinity' where id = $1", [c.id])).code).toBe(
      DENIED,
    );
    expect((await pgError(web, "update ai.conversations set cost_micro_usd = 0 where id = $1", [c.id])).message).toMatch(
      /counters_only_grow/,
    );
    await web.query("update ai.conversations set cost_micro_usd = cost_micro_usd + 5, filter_hits = 2 where id = $1", [
      c.id,
    ]);
    const day = `2036-01-${String(10 + (uniq() % 15))}`;
    await web.query("insert into ai.usage_daily (day, model, cost_micro_usd, conversations) values ($1, 'm', 10, 1)", [
      day,
    ]);
    expect(
      (await pgError(web, "update ai.usage_daily set cost_micro_usd = 0 where day = $1 and model = 'm'", [day])).message,
    ).toMatch(/counters_only_grow/);
    expect(
      (await pgError(web, "update ai.usage_daily set conversations = 0 where day = $1 and model = 'm'", [day])).message,
    ).toMatch(/counters_only_grow/);
    await web.query("update ai.usage_daily set cost_micro_usd = cost_micro_usd + 1 where day = $1 and model = 'm'", [
      day,
    ]);
  });
});

describe("the bot schema and the worker", () => {
  it("lets the worker read subscriptions and clean the bot tables", async () => {
    await worker.query("select 1 from bot.subscriptions limit 1");
    await bot.query("insert into bot.processed_updates (update_id) values ($1)", [uniq() + 6_000_000]);
    await worker.query("delete from bot.processed_updates where at < now() - interval '7 days'");
    await worker.query("delete from bot.sessions where updated_at < now() - interval '90 days'");
    expect((await pgError(worker, "insert into bot.sessions (key, value) values ('w', '{}')")).code).toBe(DENIED);
  });
});

describe("journal rows written by the public roles", () => {
  it.each(["web", "bot", "worker"] as const)("get the server time, not the time the %s gives", async (who) => {
    const c = { web, bot, worker }[who];
    const entity = `time-${who}-${uniq()}`;
    await c.query("insert into ops.audit_log (actor, action, entity, at) values ($1, 'x', $2, '2999-01-01')", [
      who,
      entity,
    ]);
    const row = await one<{ in_future: boolean }>(
      migrator,
      "select at > now() + interval '1 minute' as in_future from ops.audit_log where entity = $1",
      [entity],
    );
    expect(row.in_future).toBe(false);
  });

  it.each(["web", "bot"] as const)("makes a consent of %s a row of now: it cannot outlive a withdrawal", async (who) => {
    const c = { web, bot }[who];
    const o = await createOrder(migrator);
    await c.query(
      "insert into ops.consents (customer_id, order_id, kind, granted, at) values ($1, $2, 'non_returnable', true, '2999-01-01')",
      [o.customerId, o.orderId],
    );
    await c.query("insert into ops.consents (customer_id, order_id, kind, granted) values ($1, $2, 'non_returnable', false)", [
      o.customerId,
      o.orderId,
    ]);
    const latest = await one<{ granted: boolean }>(migrator, "select ops.consent_granted($1, 'non_returnable') as granted", [
      o.orderId,
    ]);
    expect(latest.granted).toBe(false);
  });

  it("keeps the time the migrator and the admin give (seed, imports, tests)", async () => {
    const o = await createOrder(migrator);
    await migrator.query(
      "insert into ops.consents (customer_id, order_id, kind, granted, at) values ($1, $2, 'non_returnable', true, '2026-01-01')",
      [o.customerId, o.orderId],
    );
    const row = await one<{ at: Date }>(migrator, "select at from ops.consents where order_id = $1", [o.orderId]);
    expect(row.at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it.each(["web", "bot"] as const)("refuses a consent of %s for an order of another customer", async (who) => {
    const c = { web, bot }[who];
    const other = await createOrder(migrator);
    const e = await pgError(
      c,
      "insert into ops.consents (customer_id, order_id, kind, granted) values ($1, $2, 'non_returnable', true)",
      [order.customerId, other.orderId],
    );
    expect(e.message).toMatch(/consent_mismatch/);
    const noCustomer = await pgError(
      c,
      "insert into ops.consents (subject_ref_hash, order_id, kind, granted) values ('h', $1, 'non_returnable', true)",
      [other.orderId],
    );
    expect(noCustomer.message).toMatch(/consent_mismatch/);
  });

  it.each(["limit_overrun", "no_receipt_purchase", "replacement", "third_party_payer"])(
    "does not let the site record the money consent %s (the bot and the admin do)",
    async (kind) => {
      const o = await createOrder(migrator);
      const e = await pgError(
        web,
        "insert into ops.consents (customer_id, order_id, kind, granted) values ($1, $2, $3, true)",
        [o.customerId, o.orderId, kind],
      );
      expect(e.message).toMatch(/actor_not_allowed/);
      await bot.query("insert into ops.consents (customer_id, order_id, kind, granted) values ($1, $2, $3, true)", [
        o.customerId,
        o.orderId,
        kind,
      ]);
    },
  );
});
