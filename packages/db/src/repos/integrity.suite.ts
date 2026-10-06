import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, createOrder, one, pgError, uniq } from "./testkit.ts";

// ARCHITECTURE 3.1, 3.4: immutable snapshots and the CHECKs that keep a second line behind packages/domain.
let c: pg.Client;
let admin: pg.Client;

beforeAll(async () => {
  c = await connectAs("MIGRATOR");
  admin = await connectAs("ADMIN");
});
afterAll(async () => {
  await c.end();
  await admin.end();
});

const IMMUTABLE = /immutable/;

async function configuration(): Promise<string> {
  const n = uniq();
  const row = await one<{ id: string }>(
    c,
    `insert into sales.configurations (public_code, kind, items, created_via)
     values ($1, 'pc', '[]', 'web') returning id`,
    [`AB${String(n).padStart(6, "0")}`],
  );
  return row.id;
}

describe("sales.configurations are immutable", () => {
  it("refuses UPDATE, DELETE and TRUNCATE; a change is a new row with parent_id", async () => {
    const parent = await configuration();
    expect((await pgError(c, "update sales.configurations set items = '[1]' where id = $1", [parent])).message).toMatch(
      IMMUTABLE,
    );
    expect((await pgError(c, "delete from sales.configurations where id = $1", [parent])).message).toMatch(IMMUTABLE);
    expect((await pgError(c, "truncate sales.configurations")).message).toMatch(/immutable|cannot truncate/);
    await c.query(
      "insert into sales.configurations (public_code, kind, items, parent_id, created_via) values ($1, 'pc', '[]', $2, 'web')",
      [`CD${String(uniq()).padStart(6, "0")}`, parent],
    );
  });

  it("is closed to the admin role by rights as well", async () => {
    const id = await configuration();
    expect((await pgError(admin, "update sales.configurations set kind = 'setup' where id = $1", [id])).code).toBe(
      "42501",
    );
  });

  it("needs a unique 8-character code and an array of items", async () => {
    await configuration();
    expect(
      (
        await pgError(
          c,
          "insert into sales.configurations (public_code, kind, created_via) values ('short', 'pc', 'web')",
        )
      ).message,
    ).toMatch(/configurations_code_chk/);
    expect(
      (
        await pgError(
          c,
          "insert into sales.configurations (public_code, kind, items, created_via) values ('ZZ000001', 'pc', '{}', 'web')",
        )
      ).message,
    ).toMatch(/configurations_items_chk/);
    const dup = `DU${String(uniq()).padStart(6, "0")}`;
    await c.query("insert into sales.configurations (public_code, kind, created_via) values ($1, 'pc', 'web')", [dup]);
    expect(
      (
        await pgError(c, "insert into sales.configurations (public_code, kind, created_via) values ($1, 'pc', 'web')", [
          dup,
        ])
      ).code,
    ).toBe("23505");
  });
});

describe("sales.quotes", () => {
  it("keeps a draft editable", async () => {
    const o = await createOrder(c);
    await c.query(
      "update sales.quotes set components_sum = components_sum + 1, purchase_limit = purchase_limit + 1 where id = $1",
      [o.quoteId],
    );
  });

  it("refuses a sent quote without a manual check mark", async () => {
    const o = await createOrder(c);
    const e = await pgError(c, "update sales.quotes set status = 'sent', sent_at = now() where id = $1", [o.quoteId]);
    expect(e.message).toMatch(/quotes_sent_chk/);
  });

  async function send(quoteId: string) {
    const admin = await one<{ id: string }>(
      c,
      "insert into ops.admin_users (email, password_hash, role) values ($1, 'x', 'owner') returning id",
      [`owner${uniq()}@example.test`],
    );
    await c.query(
      "update sales.quotes set status = 'sent', sent_at = now(), manually_checked_by = $2, manually_checked_at = now() where id = $1",
      [quoteId, admin.id],
    );
  }

  it("freezes totals, lines and dates after sent", async () => {
    // The lines of a sent quote are covered by the next test; here the quote itself is frozen.
    const o = await createOrder(c);
    await send(o.quoteId);
    for (const set of [
      "components_sum = 1",
      "fee_total = 1, fee_advance = 0, fee_final = 1",
      "valid_until = now()",
      "version = 9",
      "totals = '{\"x\":1}'",
    ]) {
      expect((await pgError(c, `update sales.quotes set ${set} where id = $1`, [o.quoteId])).message, set).toMatch(
        IMMUTABLE,
      );
    }
    expect((await pgError(c, "delete from sales.quotes where id = $1", [o.quoteId])).message).toMatch(IMMUTABLE);
  });

  it("freezes the lines of a sent quote and lets a draft's lines change", async () => {
    const o = await createOrder(c);
    const line = await one<{ id: string }>(
      c,
      "insert into sales.quote_lines (quote_id, title_snapshot, category_code, fee_group, qty, unit_market_sum) values ($1, 'CPU', 'cpu', 'pc', 1, 2000000) returning id",
      [o.quoteId],
    );
    await c.query("update sales.quote_lines set qty = 2 where id = $1", [line.id]);
    await send(o.quoteId);
    expect((await pgError(c, "update sales.quote_lines set qty = 3 where id = $1", [line.id])).message).toMatch(
      IMMUTABLE,
    );
    expect((await pgError(c, "delete from sales.quote_lines where id = $1", [line.id])).message).toMatch(IMMUTABLE);
    expect(
      (
        await pgError(
          c,
          "insert into sales.quote_lines (quote_id, title_snapshot, category_code, fee_group, qty, unit_market_sum) values ($1, 'RAM', 'ram', 'pc', 1, 1)",
          [o.quoteId],
        )
      ).message,
    ).toMatch(IMMUTABLE);
  });

  it("moves sent -> accepted once, writing acceptance data once", async () => {
    const o = await createOrder(c);
    await send(o.quoteId);
    await c.query(
      "update sales.quotes set status = 'accepted', accepted_at = now(), acceptance = '{\"channel\":\"bot\"}' where id = $1",
      [o.quoteId],
    );
    expect(
      (await pgError(c, 'update sales.quotes set acceptance = \'{"channel":"site"}\' where id = $1', [o.quoteId]))
        .message,
    ).toMatch(IMMUTABLE);
    expect((await pgError(c, "update sales.quotes set status = 'sent' where id = $1", [o.quoteId])).message).toMatch(
      IMMUTABLE,
    );
  });

  it("allows only the status moves of the estimate life: sent -> expired -> superseded", async () => {
    const o = await createOrder(c);
    await send(o.quoteId);
    await c.query("update sales.quotes set status = 'expired' where id = $1", [o.quoteId]);
    expect(
      (await pgError(c, "update sales.quotes set status = 'accepted', accepted_at = now() where id = $1", [o.quoteId]))
        .message,
    ).toMatch(IMMUTABLE);
    await c.query("update sales.quotes set status = 'superseded' where id = $1", [o.quoteId]);
  });

  it("writes a PDF link once", async () => {
    const o = await createOrder(c);
    await send(o.quoteId);
    const f = async () =>
      (
        await one<{ id: string }>(
          c,
          "insert into ops.files (sha256, mime, bytes, storage_key, kind, retention_class) values ($1, 'application/pdf', 10, $2, 'quote_pdf', 'order_warranty_plus_3y') returning id",
          [createHash("sha256").update(String(uniq())).digest("hex"), `k/${uniq()}`],
        )
      ).id;
    await c.query("update sales.quotes set pdf_uz_file_id = $2 where id = $1", [o.quoteId, await f()]);
    expect(
      (await pgError(c, "update sales.quotes set pdf_uz_file_id = $2 where id = $1", [o.quoteId, await f()])).message,
    ).toMatch(IMMUTABLE);
  });

  it("keeps the fee parts adding up to the fee (two lines of defence)", async () => {
    const o = await createOrder(c, { feeTotal: 1_000_000 });
    expect(
      (await pgError(c, "update sales.quotes set fee_advance = 300001 where id = $1", [o.quoteId])).message,
    ).toMatch(/quotes_fee_split_chk/);
    expect(
      (await pgError(c, "update sales.quotes set fee_commission_line = 1 where id = $1", [o.quoteId])).message,
    ).toMatch(/quotes_fee_lines_chk/);
    expect(
      (await pgError(c, "update sales.quotes set reserve_sum = purchase_limit + 1 where id = $1", [o.quoteId])).message,
    ).toMatch(/quotes_limit_chk/);
    expect((await pgError(c, "update sales.quotes set reserve_bp = 10001 where id = $1", [o.quoteId])).message).toMatch(
      /quotes_reserve_bp_chk/,
    );
    expect(
      (await pgError(c, "update sales.quotes set outside_scale_sum = -1 where id = $1", [o.quoteId])).message,
    ).toMatch(/quotes_amounts_chk/);
  });

  it("never lets an order point at another order's quote", async () => {
    const a = await createOrder(c);
    const b = await createOrder(c);
    expect(
      (await pgError(c, "update sales.orders set current_quote_id = $1 where id = $2", [b.quoteId, a.orderId])).code,
    ).toBe("23503");
  });
});

describe("content.legal_documents", () => {
  const text = "Offer text (stub)";
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  async function doc(status: string, body = text, hash = sha(body)) {
    return one<{ id: string }>(
      c,
      `insert into content.legal_documents (kind, version, lang, body_md, status, text_sha256, effective_from)
       values ('offer', $1, 'uz', $2, $3, $4, '2026-11-01') returning id`,
      [`v${uniq()}`, body, status, hash],
    );
  }

  it("keeps a stub editable", async () => {
    const d = await doc("stub");
    await c.query("update content.legal_documents set body_md = 'edited' where id = $1", [d.id]);
  });

  it("checks the hash when a document is published and freezes it afterwards", async () => {
    const d = await doc("lawyer_approved");
    expect(
      (
        await pgError(c, "update content.legal_documents set status = 'published', text_sha256 = $2 where id = $1", [
          d.id,
          sha("other"),
        ])
      ).message,
    ).toMatch(/text_hash_mismatch/);
    await c.query("update content.legal_documents set status = 'published' where id = $1", [d.id]);
    expect(
      (await pgError(c, "update content.legal_documents set body_md = 'x' where id = $1", [d.id])).message,
    ).toMatch(IMMUTABLE);
    expect(
      (await pgError(c, "update content.legal_documents set status = 'stub' where id = $1", [d.id])).message,
    ).toMatch(IMMUTABLE);
    expect((await pgError(c, "delete from content.legal_documents where id = $1", [d.id])).message).toMatch(IMMUTABLE);
  });

  it("refuses to insert a published document with a wrong hash", async () => {
    await expect(doc("published", text, sha("another"))).rejects.toThrow(/text_hash_mismatch/);
  });

  it("deletes a stub and needs the effective date when published", async () => {
    const d = await doc("stub");
    await c.query("delete from content.legal_documents where id = $1", [d.id]);
    const e = await pgError(
      c,
      `insert into content.legal_documents (kind, version, lang, body_md, status, text_sha256)
       values ('privacy', 'p1', 'ru', $1, 'published', $2)`,
      [text, sha(text)],
    );
    expect(e.message).toMatch(/legal_documents_published_chk/);
  });
});

// One row per declared CHECK rule that the tests above do not already touch. A foreign key is checked after the
// row has passed its CHECKs, so a random uuid stands for a parent that is not needed.
describe("CHECK constraints", () => {
  async function category(code: string) {
    await c.query(
      `insert into catalog.categories (code, category_group, name, fee_group_default, freshness_days, returnable_default, sort)
       values ($1, 'pc', '{"uz":"x","ru":"x"}', 'pc', 7, true, 0) on conflict (code) do nothing`,
      [code],
    );
  }
  const CASES: { name: string; sql: string; constraint: string }[] = [
    {
      name: "orders: the sale scheme is switched off",
      sql: "insert into sales.orders (number, customer_id, kind, contract_scheme) values ('NV-2026-8001', '$customer', 'pc', 'sale')",
      constraint: "orders_scheme_(not_sale_)?chk",
    },
    {
      name: "orders: number format",
      sql: "insert into sales.orders (number, customer_id, kind) values ('X-1', '$customer', 'pc')",
      constraint: "orders_number_chk",
    },
    {
      name: "leads: number format",
      sql: "insert into sales.leads (number, channel, scope) values ('L-26-1', 'web', 'pc')",
      constraint: "leads_number_chk",
    },
    {
      name: "leads: rejection needs a reason",
      sql: "insert into sales.leads (number, channel, scope, status) values ('L-2026-8002', 'web', 'pc', 'rejected')",
      constraint: "leads_reject_chk",
    },
    {
      name: "warranty cases: a refusal needs a causal link",
      sql: "insert into sales.warranty_cases (number, order_id, description, status) values ('G-2026-8003', '$order', 'x', 'rejected')",
      constraint: "warranty_cases_rejected_chk",
    },
    {
      name: "warranty cases: unknown fault",
      sql: "insert into sales.warranty_cases (number, order_id, description, client_fault) values ('G-2026-8004', '$order', 'x', 'bad_luck')",
      constraint: "warranty_cases_fault_chk",
    },
    {
      name: "customers: phone in E.164",
      sql: "insert into sales.customers (phone_e164) values ('998 90 123')",
      constraint: "customers_phone_chk",
    },
    {
      name: "other income: positive",
      sql: "insert into sales.other_income (year, period, amount_sum) values (2026, '2026-10', 0)",
      constraint: "other_income_amount_chk",
    },
    {
      name: "commission reports: received - spent = remainder",
      sql: "insert into sales.commission_reports (order_id, version, received_sum, spent_sum, remainder_sum, lines) values ('$order', 1, 100, 60, 41, '[]')",
      constraint: "commission_reports_sums_chk",
    },
    {
      name: "acts: signature time and channel go together",
      sql: "insert into sales.acts (order_id, kind, signed_at) values ('$order', 'handover', now())",
      constraint: "acts_signed_chk",
    },
    {
      name: "market prices: fewer than three vendors give no median",
      sql: "insert into pricing.market_prices (product_id, as_of, median_sum, vendors_n, confidence) values ('$product', '2026-10-05', 1000, 2, 'low')",
      constraint: "market_prices_min_vendors_chk",
    },
    {
      name: "market prices: high confidence needs five fresh vendors",
      sql: "insert into pricing.market_prices (product_id, as_of, median_sum, vendors_n, max_age_days, confidence) values ('$product', '2026-10-05', 1000, 4, 1, 'high')",
      constraint: "market_prices_high_chk",
    },
    {
      name: "price observations: a dollar price keeps its amount and rate",
      sql: "insert into pricing.price_observations (vendor_id, price_sum, orig_currency, availability, source) values ('$vendor', 100, 'USD', 'in_stock', 'manual')",
      constraint: "price_observations_usd_chk",
    },
    {
      name: "price observations: a positive price",
      sql: "insert into pricing.price_observations (vendor_id, price_sum, availability, source) values ('$vendor', 0, 'in_stock', 'manual')",
      constraint: "price_observations_price_chk",
    },
    {
      name: "fx rates: positive rate",
      sql: "insert into pricing.fx_rates (ccy, rate, effective_date, source) values ('USD', 0, '2026-10-05', 'manual')",
      constraint: "fx_rates_rate_chk",
    },
    {
      name: "price imports: rows add up",
      sql: "insert into pricing.price_imports (vendor_id, format, rows_total, rows_matched) values ('$vendor', 'csv', 1, 2)",
      constraint: "price_imports_rows_chk",
    },
    {
      name: "base builds: a cell that is not offered names a task to switch to",
      sql: "insert into catalog.base_builds (task, tier, style, status) values ('streaming', 'T1', 'A', 'not_offered')",
      constraint: "base_builds_redirect_chk",
    },
    {
      name: "base build items: exactly one of price class and product",
      sql: "insert into catalog.base_build_items (base_build_id, slot) select id, 'cpu' from catalog.base_builds limit 1",
      constraint: "base_build_items_one_ref_chk",
    },
    {
      name: "rule sets: a published set has its time",
      sql: "insert into catalog.rule_sets (version, status, payload) values (9001, 'published', '{}')",
      constraint: "rule_sets_published_chk",
    },
    {
      name: "perf facts: no publication without a source",
      sql: "insert into catalog.perf_facts (price_class_id, task, metric, value, published) select id, 'gaming', 'fps', '100', true from catalog.price_classes limit 1",
      constraint: "perf_facts_published_source_chk",
    },
    {
      name: "products: a verified product has the complete keys of the block rules",
      sql: "insert into catalog.products (slug, category_code, brand, model, status, specs) values ('v-incomplete', 'gpu', 'B', 'M', 'verified', '{\"lengthMm\": 300}')",
      constraint: "products_verified_spec_complete_chk",
    },
    {
      name: "products: an unknown value (null) keeps a product out of verified",
      sql: "insert into catalog.products (slug, category_code, brand, model, status, specs) values ('v-null', 'gpu', 'B', 'M', 'verified', '{\"lengthMm\": 300, \"power\": [], \"tgpW\": null}')",
      constraint: "products_verified_spec_complete_chk",
    },
    {
      name: "idea posts: only a granted permission publishes",
      sql: "insert into content.idea_posts (instagram_url, author_handle, status) values ('https://example.test/p/1', 'a', 'published')",
      constraint: "idea_posts_published_chk",
    },
    {
      name: "idea posts: a revoked permission carries the takedown time",
      sql: "insert into content.idea_posts (instagram_url, author_handle, permission_status) values ('https://example.test/p/2', 'a', 'revoked')",
      constraint: "idea_posts_revoked_chk",
    },
    {
      name: "pages: publishing needs the Uzbek text",
      sql: 'insert into content.pages (slug, kind, title, body, status, published_at) values (\'p-ru-only\', \'faq\', \'{"uz":"","ru":"x"}\', \'{"uz":"","ru":"x"}\', \'published\', now())',
      constraint: "pages_published_uz_chk",
    },
    {
      name: "portfolio: a published customer build needs order and consent",
      sql: "insert into content.portfolio_items (kind, status) values ('own_build', 'published')",
      constraint: "portfolio_items_own_build_chk",
    },
    {
      name: "portfolio: a concept carries its label",
      sql: "insert into content.portfolio_items (kind) values ('concept')",
      constraint: "portfolio_items_concept_chk",
    },
    {
      name: "hero scene: five frames or none",
      sql: "insert into content.hero_scene (frames) values ('[1,2]')",
      constraint: "hero_scene_frames_chk",
    },
    {
      name: "files: personal data never sits in a public file",
      sql: "insert into ops.files (sha256, mime, bytes, storage_key, kind, retention_class, is_public, contains_pd) values (repeat('a', 64), 'image/png', 1, 'k/pd', 'photo', 'media', true, true)",
      constraint: "files_public_no_pd_chk",
    },
    {
      name: "files: SHA-256 is 64 hex characters",
      sql: "insert into ops.files (sha256, mime, bytes, storage_key, kind, retention_class) values ('zz', 'image/png', 1, 'k/bad', 'photo', 'media')",
      constraint: "files_sha256_chk",
    },
    {
      name: "admin users: a known role",
      sql: "insert into ops.admin_users (email, password_hash, role) values ('r@example.test', 'x', 'wizard')",
      constraint: "admin_users_role_chk",
    },
    {
      name: "admin users: unique e-mail regardless of case",
      sql: "insert into ops.admin_users (email, password_hash, role) values ('DUP@example.test', 'x', 'owner'), ('dup@example.test', 'x', 'owner')",
      constraint: "admin_users_email_key",
    },
    {
      name: "outbox: a known kind",
      sql: "insert into ops.outbox (kind, payload) values ('sms', '{}')",
      constraint: "outbox_kind_chk",
    },
    {
      name: "AI conversations: a known language",
      sql: "insert into ai.conversations (channel, lang, model) values ('web', 'en', 'm')",
      constraint: "conversations_lang_chk",
    },
    {
      name: "AI conversations: the cost is not negative",
      sql: "insert into ai.conversations (channel, lang, model, cost_micro_usd) values ('web', 'uz', 'm', -1)",
      constraint: "conversations_cost_chk",
    },
    {
      name: "AI messages: numbered from 1",
      sql: "insert into ai.messages (conversation_id, seq, role, content) values (gen_random_uuid(), 0, 'user', '\"x\"')",
      constraint: "messages_seq_chk",
    },
    {
      name: "AI usage: the cost of a day is not negative",
      sql: "insert into ai.usage_daily (day, model, cost_micro_usd) values ('2037-01-01', 'm', -1)",
      constraint: "usage_daily_cost_chk",
    },
    {
      name: "analogs: a position is not its own analog",
      sql: "insert into catalog.analogs (product_id, analog_product_id) values ('$product', '$product')",
      constraint: "analogs_not_self_chk",
    },
    {
      name: "base build items: a positive quantity",
      sql: "insert into catalog.base_build_items (base_build_id, slot, price_class_id, qty) select b.id, 'cpu', pc.id, 0 from catalog.base_builds b, catalog.price_classes pc limit 1",
      constraint: "base_build_items_qty_chk",
    },
    {
      name: "categories: a positive freshness term",
      sql: "insert into catalog.categories (code, category_group, name, fee_group_default, freshness_days, returnable_default) values ('zz', 'pc', '{}', 'pc', 0, true)",
      constraint: "categories_freshness_chk",
    },
    {
      name: "price classes: a ladder and a step go together",
      sql: "insert into catalog.price_classes (category_code, key, name, ladder_code) values ('cpu', 'chk.ladder', '{}', 'gpu')",
      constraint: "price_classes_ladder_step_chk",
    },
    {
      name: "products: specs are an object",
      sql: "insert into catalog.products (slug, category_code, brand, model, specs) values ('chk-specs', 'cpu', 'B', 'M', '[]')",
      constraint: "products_specs_object_chk",
    },
    {
      name: "legal documents: the hash is 64 hex characters",
      sql: "insert into content.legal_documents (kind, version, lang, body_md, text_sha256) values ('privacy', 'sha1', 'ru', 'x', 'nothex')",
      constraint: "legal_documents_sha_chk",
    },
    {
      name: "policy texts: versions start at 1",
      sql: "insert into content.policy_texts (topic, body, version) values ('fee', '{}', 0)",
      constraint: "policy_texts_version_chk",
    },
    {
      name: "admin sessions: the token is stored as a SHA-256 hash",
      sql: "insert into ops.admin_sessions (token_sha256, user_id, expires_at) values ('plain-token', gen_random_uuid(), now())",
      constraint: "admin_sessions_token_chk",
    },
    {
      name: "files: the size is not negative",
      sql: "insert into ops.files (sha256, mime, bytes, storage_key, kind, retention_class) values (repeat('a', 64), 'image/png', -1, 'k/neg', 'photo', 'media')",
      constraint: "files_bytes_chk",
    },
    {
      name: "threshold snapshots: the share is not negative",
      sql: "insert into ops.threshold_snapshots (year, as_of, deals_sum, committed_sum, limit_sum, share_bp) values (2037, '2037-01-01', 1, 1, 1, -1)",
      constraint: "threshold_snapshots_share_chk",
    },
    {
      name: "market prices: a median is positive",
      sql: "insert into pricing.market_prices (product_id, as_of, median_sum, vendors_n, confidence) values ('$product', '2037-01-01', 0, 3, 'low')",
      constraint: "market_prices_median_chk",
    },
    {
      name: "market prices: the minimum is not above the maximum",
      sql: "insert into pricing.market_prices (product_id, as_of, min_sum, max_sum, confidence) values ('$product', '2037-01-02', 10, 5, 'low')",
      constraint: "market_prices_order_chk",
    },
    {
      name: "vendors: the return term is not negative",
      sql: "insert into pricing.vendors (name, kind, price_source, return_days) values ('chk return', 'shop', 'manual', -1)",
      constraint: "vendors_return_days_chk",
    },
    {
      name: "commission reports: versions start at 1",
      sql: "insert into sales.commission_reports (order_id, version, received_sum, spent_sum, remainder_sum, lines) values ('$order', 0, 0, 0, 0, '[]')",
      constraint: "commission_reports_version_chk",
    },
    {
      name: "order events: numbered from 1",
      sql: "insert into sales.order_events (order_id, seq, actor_kind, actor_id, event, from_status, to_status) values ('$order', 0, 'owner', 'x', '{}', 'estimate_draft', 'estimate_sent')",
      constraint: "order_events_seq_chk",
    },
    {
      name: "order transitions: an edge names at least one actor",
      sql: "insert into sales.order_transitions (from_status, event_type, to_status, actors) values ('closed', 'REOPEN', 'accepted', '{}')",
      constraint: "order_transitions_actors_chk",
    },
    {
      name: "orders: documented losses are not negative (they enter the closing check)",
      sql: "insert into sales.orders (number, customer_id, kind, documented_losses_sum) values ('NV-2026-8101', '$customer', 'pc', -1)",
      constraint: "orders_losses_chk",
    },
    {
      name: "quote lines: a positive quantity",
      sql: "insert into sales.quote_lines (quote_id, title_snapshot, category_code, fee_group, qty, unit_market_sum) values (gen_random_uuid(), 'x', 'cpu', 'pc', 0, 1)",
      constraint: "quote_lines_qty_chk",
    },
    {
      name: "quote lines: the market price is not negative",
      sql: "insert into sales.quote_lines (quote_id, title_snapshot, category_code, fee_group, qty, unit_market_sum) values (gen_random_uuid(), 'x', 'cpu', 'pc', 1, -1)",
      constraint: "quote_lines_sum_chk",
    },
    {
      name: "quotes: an accepted quote has its acceptance time",
      sql: "insert into sales.quotes (order_id, version, status, totals, components_sum, reserve_bp, reserve_sum, purchase_limit, fee_total, fee_commission_line, fee_works_line, fee_advance, fee_final, settings_version) values ('$order', 7, 'accepted', '{}', 0, 0, 0, 0, 0, 0, 0, 0, 0, 'v')",
      constraint: "quotes_accepted_chk",
    },
    {
      name: "quotes: versions start at 1",
      sql: "insert into sales.quotes (order_id, version, totals, components_sum, reserve_bp, reserve_sum, purchase_limit, fee_total, fee_commission_line, fee_works_line, fee_advance, fee_final, settings_version) values ('$order', 0, '{}', 0, 0, 0, 0, 0, 0, 0, 0, 0, 'v')",
      constraint: "quotes_version_chk",
    },
    {
      name: "warranty cases: the cost from the reserve is not negative",
      sql: "insert into sales.warranty_cases (number, order_id, description, cost_from_reserve_sum) values ('G-2026-8201', '$order', 'x', -1)",
      constraint: "warranty_cases_cost_chk",
    },
    {
      name: "warranty cases: number format",
      sql: "insert into sales.warranty_cases (number, order_id, description) values ('G-26-1', '$order', 'x')",
      constraint: "warranty_cases_number_chk",
    },
  ];

  it.each(CASES)("$name", async ({ sql, constraint }) => {
    await category("gpu");
    await category("cpu");
    await category("ram");
    const customer = (await createOrder(c)).customerId;
    const order = (await createOrder(c)).orderId;
    const vendor = (
      await one<{ id: string }>(
        c,
        "insert into pricing.vendors (name, kind, price_source) values ($1, 'shop', 'manual') returning id",
        [`chk ${uniq()}`],
      )
    ).id;
    const product = (
      await one<{ id: string }>(
        c,
        "insert into catalog.products (slug, category_code, brand, model) values ($1, 'cpu', 'B', 'M') returning id",
        [`chk-${uniq()}`],
      )
    ).id;
    if (/base_build_items/.test(sql) || /perf_facts/.test(sql)) {
      await c.query(
        "insert into catalog.base_builds (task, tier, style) values ('gaming', 'T1', $1) on conflict do nothing",
        [uniq() % 2 ? "A" : "B"],
      );
      await c.query(
        'insert into catalog.price_classes (category_code, key, name) values (\'cpu\', $1, \'{"uz":"x","ru":"x"}\') on conflict do nothing',
        [`chk.${uniq()}`],
      );
    }
    const text = sql
      .replace("$customer", customer)
      .replace(/\$order/g, order)
      .replace(/\$vendor/g, vendor)
      .replace(/\$product/g, product);
    const e = await pgError(c, text);
    expect(e.message).toMatch(new RegExp(constraint));
  });

  it("accepts the same rows when the rule is respected (a granted idea, a Uzbek page, a complete verified product)", async () => {
    await category("gpu");
    await c.query(
      "insert into content.idea_posts (instagram_url, author_handle, status, permission_status) values ('https://example.test/p/ok', 'a', 'published', 'granted')",
    );
    await c.query(
      'insert into content.pages (slug, kind, title, body, status, published_at) values (\'p-ok\', \'faq\', \'{"uz":"a","ru":"a"}\', \'{"uz":"b","ru":"b"}\', \'published\', now())',
    );
    await c.query(
      `insert into catalog.products (slug, category_code, brand, model, status, specs)
       values ('v-ok', 'gpu', 'B', 'M', 'verified', '{"lengthMm": 300, "power": [{"conn":"8pin","count":1}], "tgpW": 160}')`,
    );
  });
});

// Every CHECK of the application schemas is either exercised by a test of this package (its name appears in a suite or
// in the money-case table) or is an enumeration, which the schema files generate from the same list as the TypeScript
// union of the column. A new rule CHECK without a test fails here.
describe("coverage of the CHECK constraints", () => {
  // Redundant on purpose, with the reason: the first CHECK of the same column fires first in every case.
  const EXCLUDED: Record<string, string> = {
    orders_scheme_not_sale_chk:
      "contract_scheme = 'sale' is already outside the list of orders_scheme_chk; this one keeps the ban if the list grows",
  };
  const HERE = dirname(fileURLToPath(import.meta.url));
  const FIXTURES = join(HERE, "../../../testing/fixtures/wp-06");
  const sources = [
    ...readdirSync(HERE)
      .filter((f) => /\.(suite\.ts|int\.test\.ts)$/.test(f))
      .map((f) => readFileSync(join(HERE, f), "utf8")),
    ...readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readFileSync(join(FIXTURES, f), "utf8")),
  ].join("\n");

  it("leaves no rule CHECK without a test", async () => {
    const { rows } = await c.query<{ name: string; def: string }>(
      `select k.conname as name, pg_get_constraintdef(k.oid) as def
         from pg_constraint k join pg_class t on t.oid = k.conrelid join pg_namespace n on n.oid = t.relnamespace
        where k.contype = 'c' and n.nspname in ('catalog', 'pricing', 'sales', 'content', 'ai', 'bot', 'ops')`,
    );
    expect(rows.length).toBeGreaterThan(150);
    const isEnumeration = (def: string) => /^CHECK \(\(?[a-z_]+ (= ANY \(ARRAY\[|= ')/.test(def);
    const untested = rows.filter((r) => !sources.includes(r.name) && !isEnumeration(r.def) && !(r.name in EXCLUDED));
    expect(untested.map((r) => `${r.name}: ${r.def}`)).toEqual([]);
  });

  it("keeps every exclusion tied to a CHECK that exists", async () => {
    const { rows } = await c.query<{ name: string }>(
      "select conname as name from pg_constraint where contype = 'c' and conname = any($1)",
      [Object.keys(EXCLUDED)],
    );
    expect(rows.map((r) => r.name).sort()).toEqual(Object.keys(EXCLUDED).sort());
  });
});
