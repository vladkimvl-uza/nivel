import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, createOrder, insertPayment, insertPurchase, one, uniq } from "./testkit.ts";

// ARCHITECTURE 3.1, 3.3, 3.5, 4.8: views, public numbers, settings versions, consents.
let c: pg.Client;
let admin: pg.Client;
let web: pg.Client;

beforeAll(async () => {
  c = await connectAs("MIGRATOR");
  admin = await connectAs("ADMIN");
  web = await connectAs("WEB");
});
afterAll(async () => {
  for (const x of [c, admin, web]) await x.end();
});

async function product(): Promise<string> {
  await c.query(
    `insert into catalog.categories (code, category_group, name, fee_group_default, freshness_days, returnable_default, sort)
     values ('cpu', 'pc', '{"uz":"Protsessor","ru":"Процессор"}', 'pc', 7, true, 1) on conflict (code) do nothing`,
  );
  const p = await one<{ id: string }>(
    c,
    "insert into catalog.products (slug, category_code, brand, model) values ($1, 'cpu', 'AMD', 'Ryzen 5 7500F') returning id",
    [`view-${uniq()}`],
  );
  return p.id;
}

describe("pricing.v_market_price_current", () => {
  it("returns the latest market price of every product", async () => {
    const a = await product();
    const b = await product();
    const insert = (id: string, asOf: string, median: number | null, vendors: number, conf: string) =>
      c.query(
        `insert into pricing.market_prices (product_id, as_of, median_sum, from_sum, offers_n, vendors_n, confidence)
         values ($1, $2, $3, $3, $4, $4, $5)`,
        [id, asOf, median, vendors, conf],
      );
    await insert(a, "2026-10-01", 2_000_000, 3, "medium");
    await insert(a, "2026-10-05", 2_100_000, 3, "medium");
    await insert(a, "2026-10-03", 1_900_000, 3, "medium");
    await insert(b, "2026-10-02", null, 1, "low");
    const { rows } = await web.query<{ product_id: string; as_of: string; median_sum: string | null }>(
      "select product_id, as_of::text, median_sum from pricing.v_market_price_current where product_id = any($1) order by as_of",
      [[a, b]],
    );
    expect(rows).toEqual([
      { product_id: b, as_of: "2026-10-02", median_sum: null },
      { product_id: a, as_of: "2026-10-05", median_sum: "2100000" },
    ]);
  });
});

describe("customer views", () => {
  it("hide drafts and show a sent quote with its lines", async () => {
    const o = await createOrder(c);
    await c.query(
      "insert into sales.quote_lines (quote_id, title_snapshot, category_code, fee_group, qty, unit_market_sum) values ($1, 'AMD Ryzen 5 7500F', 'cpu', 'pc', 1, 1413000)",
      [o.quoteId],
    );
    const before = await web.query("select * from sales.v_customer_order_quotes where order_id = $1", [o.orderId]);
    expect(before.rowCount).toBe(0);
    const owner = await one<{ id: string }>(
      c,
      "insert into ops.admin_users (email, password_hash, role) values ($1, 'x', 'owner') returning id",
      [`view${uniq()}@example.test`],
    );
    await c.query(
      "update sales.quotes set status = 'sent', sent_at = now(), manually_checked_by = $2, manually_checked_at = now() where id = $1",
      [o.quoteId, owner.id],
    );
    const { rows } = await web.query<{ status: string; fee_total: string; lines: { title: string; qty: number }[] }>(
      "select status, fee_total, lines from sales.v_customer_order_quotes where order_id = $1",
      [o.orderId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("sent");
    expect(rows[0]?.lines).toHaveLength(1);
    expect(rows[0]?.lines[0]).toMatchObject({ title: "AMD Ryzen 5 7500F", qty: 1 });
  });

  it("name a shop only when the shop agreed to be named", async () => {
    const o = await createOrder(c);
    await insertPayment(c, { orderId: o.orderId, kind: "purchase_funds", amount: 5_000_000, status: "confirmed" });
    const named = await one<{ id: string }>(
      c,
      "insert into pricing.vendors (name, kind, price_source, public_name_allowed) values ($1, 'shop', 'manual', true) returning id",
      [`Named ${uniq()}`],
    );
    const hidden = await one<{ id: string }>(
      c,
      "insert into pricing.vendors (name, kind, price_source, public_name_allowed) values ($1, 'shop', 'manual', false) returning id",
      [`Hidden ${uniq()}`],
    );
    await insertPurchase(c, { orderId: o.orderId, vendorId: named.id, amount: 1_000_000 });
    await insertPurchase(c, { orderId: o.orderId, vendorId: hidden.id, amount: 2_000_000 });
    const { rows } = await web.query<{ amount_sum: string; vendor_name: string | null }>(
      "select amount_sum, vendor_name from sales.v_customer_order_purchases where order_id = $1 order by amount_sum",
      [o.orderId],
    );
    expect(rows[0]?.vendor_name).toMatch(/^Named/);
    expect(rows[1]?.vendor_name).toBeNull();
  });
});

describe("sales.v_deal_volume_by_year", () => {
  it("adds receipts and received fee, subtracts refunded fee, adds other income, by Tashkent year", async () => {
    const volume = async () => {
      const { rows } = await c.query<Record<string, string>>(
        "select year::text, receipts_sum::text, fee_in_sum::text, fee_refund_sum::text, other_income_sum::text, deals_sum::text from sales.v_deal_volume_by_year where year in (2026, 2027)",
      );
      const pick = (year: string) => {
        const r = rows.find((x) => x.year === year);
        return {
          receipts: Number(r?.receipts_sum ?? 0),
          feeIn: Number(r?.fee_in_sum ?? 0),
          feeRefund: Number(r?.fee_refund_sum ?? 0),
          other: Number(r?.other_income_sum ?? 0),
          deals: Number(r?.deals_sum ?? 0),
        };
      };
      return { y2026: pick("2026"), y2027: pick("2027") };
    };
    const before = await volume();
    const o = await createOrder(c, { purchaseLimit: 90_000_000 });
    const vendor = await one<{ id: string }>(
      c,
      "insert into pricing.vendors (name, kind, price_source) values ($1, 'shop', 'manual') returning id",
      [`Deals ${uniq()}`],
    );
    await insertPayment(c, { orderId: o.orderId, kind: "purchase_funds", amount: 90_000_000, status: "confirmed" });
    // 2026-12-31 20:00 UTC is already 2027-01-01 01:00 in Tashkent: it belongs to 2027.
    await c.query(
      `insert into sales.purchases (order_id, vendor_id, qty, amount_sum, paid_via, receipt_kind, receipt_no, bought_by, bought_at)
       values ($1, $2, 1, 10000000, 'bank_transfer', 'fiscal', 'A1', 't', '2026-12-31T20:00:00Z'),
              ($1, $2, 1, 7000000, 'bank_transfer', 'fiscal', 'A2', 't', '2026-12-31T18:59:00Z')`,
      [o.orderId, vendor.id],
    );
    const confirm = (kind: string, amount: number, at: string) =>
      c.query(
        `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, fiscal_receipt_no, confirmed_by, confirmed_at)
         values ($1, $2, $3, $4, $5, 'confirmed', 'R', 'owner', $6)`,
        [
          o.orderId,
          kind,
          kind === "fee_refund" ? "out" : "in",
          kind === "fee_refund" ? "bank_transfer_out" : "xolis_qr",
          amount,
          at,
        ],
      );
    await confirm("fee_advance", 900_000, "2027-01-15T10:00:00Z");
    await confirm("fee_final", 2_100_000, "2027-02-01T10:00:00Z");
    await confirm("fee_refund", 300_000, "2027-02-10T10:00:00Z");
    await c.query("insert into sales.other_income (year, period, amount_sum) values (2027, '2027-Q1', 5000000)");
    const after = await volume();
    // 7 000 000 bought before midnight of 31.12 Tashkent time stay in 2026; 10 000 000 bought after it count for 2027.
    expect(after.y2026.receipts - before.y2026.receipts).toBe(7_000_000);
    expect(after.y2026.deals - before.y2026.deals).toBe(7_000_000);
    expect(after.y2027.receipts - before.y2027.receipts).toBe(10_000_000);
    expect(after.y2027.feeIn - before.y2027.feeIn).toBe(3_000_000);
    expect(after.y2027.feeRefund - before.y2027.feeRefund).toBe(300_000);
    expect(after.y2027.other - before.y2027.other).toBe(5_000_000);
    // deals = receipts + fee received - fee refunded + other income
    expect(after.y2027.deals - before.y2027.deals).toBe(10_000_000 + 3_000_000 - 300_000 + 5_000_000);
  });
});

describe("ops.next_number", () => {
  it("counts per kind and year without gaps", async () => {
    const a = await one<{ n: string }>(admin, "select ops.next_number('L', 2031) as n");
    const b = await one<{ n: string }>(admin, "select ops.next_number('L', 2031) as n");
    const o = await one<{ n: string }>(admin, "select ops.next_number('NV', 2031) as n");
    const next = await one<{ n: string }>(admin, "select ops.next_number('L', 2032) as n");
    expect([a.n, b.n, o.n, next.n]).toEqual(["L-2031-0001", "L-2031-0002", "NV-2031-0001", "L-2032-0001"]);
  });

  it("does not skip a number when the transaction rolls back", async () => {
    await admin.query("begin");
    const first = await one<{ n: string }>(admin, "select ops.next_number('G', 2033) as n");
    await admin.query("rollback");
    const again = await one<{ n: string }>(admin, "select ops.next_number('G', 2033) as n");
    expect(first.n).toBe("G-2033-0001");
    expect(again.n).toBe("G-2033-0001");
  });

  it("hands out unique numbers to concurrent callers and is open to the site role", async () => {
    const callers = await Promise.all([connectAs("WEB"), connectAs("BOT"), connectAs("WORKER")]);
    try {
      const perCaller = await Promise.all(
        callers.map(async (cl) => {
          const out: string[] = [];
          for (let i = 0; i < 4; i++) {
            const r = await cl.query<{ n: string }>("select ops.next_number('L', 2034) as n");
            out.push(r.rows[0]?.n ?? "");
          }
          return out;
        }),
      );
      const numbers = perCaller.flat();
      expect(new Set(numbers).size).toBe(12);
    } finally {
      for (const cl of callers) await cl.end();
    }
  });

  it("refuses an unknown kind and the format of a printed number fits the table checks", async () => {
    await expect(admin.query("select ops.next_number('X', 2026)")).rejects.toThrow(/unknown_number_kind/);
    const n = await one<{ n: string }>(admin, "select ops.next_number('NV', 2035) as n");
    expect(n.n).toMatch(/^NV-[0-9]{4}-[0-9]{4,}$/);
  });
});

describe("ops.settings and consents", () => {
  it("bumps the version and time on every change", async () => {
    await c.query("insert into ops.settings (key, value) values ('test.flag', 'false')");
    const before = await one<{ version: number; updated_at: Date }>(
      c,
      "select version, updated_at from ops.settings where key = 'test.flag'",
    );
    await c.query("update ops.settings set value = 'true' where key = 'test.flag'");
    await c.query("update ops.settings set value = 'false' where key = 'test.flag'");
    const after = await one<{ version: number; updated_at: Date }>(
      c,
      "select version, updated_at from ops.settings where key = 'test.flag'",
    );
    expect(before.version).toBe(1);
    expect(after.version).toBe(3);
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
  });

  it("answers consent_granted by the latest row", async () => {
    const o = await createOrder(c);
    const ask = () => one<{ g: boolean }>(c, "select ops.consent_granted($1, 'replacement') as g", [o.orderId]);
    expect((await ask()).g).toBe(false);
    await c.query(
      "insert into ops.consents (customer_id, order_id, kind, granted, at) values ($1, $2, 'replacement', true, '2026-10-01T10:00:00Z')",
      [o.customerId, o.orderId],
    );
    expect((await ask()).g).toBe(true);
    await c.query(
      "insert into ops.consents (customer_id, order_id, kind, granted, at) values ($1, $2, 'replacement', false, '2026-10-02T10:00:00Z')",
      [o.customerId, o.orderId],
    );
    expect((await ask()).g).toBe(false);
  });

  it("keeps a product's updated_at moving", async () => {
    const id = await product();
    const a = await one<{ t: Date }>(c, "select updated_at as t from catalog.products where id = $1", [id]);
    await new Promise((r) => setTimeout(r, 15));
    await c.query("update catalog.products set model = 'changed' where id = $1", [id]);
    const b = await one<{ t: Date }>(c, "select updated_at as t from catalog.products where id = $1", [id]);
    expect(b.t.getTime()).toBeGreaterThan(a.t.getTime());
  });
});
