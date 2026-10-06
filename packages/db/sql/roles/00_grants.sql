-- WP-06: table, column, view and function rights per role (ARCHITECTURE 3.2). WP-00 set schema usage and the
-- default privileges (admin everything, web/bot/worker read catalog, prices and content); this file adds what
-- differs. No role receives rights on pgboss here.

-- ---- helper functions that CHECKs and triggers call as the invoker -----------------------------------------
GRANT EXECUTE ON FUNCTION
  ops.in_owner_context(text, regproc),
  ops.consent_granted(uuid, text),
  catalog.required_spec_keys(text),
  catalog.spec_complete(text, jsonb)
TO nivel_web, nivel_admin, nivel_bot, nivel_worker;
--> statement-breakpoint
-- Lead numbers: the site and the bot; orders and warranty cases: the admin. The worker takes no numbers.
GRANT EXECUTE ON FUNCTION ops.next_number(text, integer) TO nivel_web, nivel_admin, nivel_bot;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION sales.apply_transition(uuid, jsonb, text, text, text, jsonb, jsonb)
  TO nivel_web, nivel_admin, nivel_bot, nivel_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai.purge_expired(timestamptz) TO nivel_admin, nivel_worker;
--> statement-breakpoint
-- ---- nivel_admin: everything, except what journals and fixed rules forbid -------------------------------------
REVOKE UPDATE, DELETE, TRUNCATE ON
  ops.audit_log, ops.consents, sales.order_events, sales.reserve_ledger, ai.messages, sales.configurations
FROM nivel_admin;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON pricing.price_observations, sales.payments FROM nivel_admin, nivel_worker;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON sales.order_transitions FROM nivel_admin;
--> statement-breakpoint
-- ---- nivel_web: public site -------------------------------------------------------------------------------------
-- Payments and purchases: only through the sales.v_customer_order_* views (no table rights in sales.payments).
GRANT SELECT ON ops.settings TO nivel_web;
--> statement-breakpoint
GRANT SELECT, INSERT ON sales.configurations TO nivel_web;
--> statement-breakpoint
GRANT INSERT ON sales.leads, sales.customers TO nivel_web;
--> statement-breakpoint
-- The site never reads phone numbers, addresses or other leads' data.
GRANT SELECT (id, number, status, created_at) ON sales.leads TO nivel_web;
--> statement-breakpoint
GRANT SELECT (id, display_name, lang, district, telegram_user_id, age_18_confirmed, created_at)
  ON sales.customers TO nivel_web;
--> statement-breakpoint
GRANT INSERT ON ops.consents, ops.outbox, ops.audit_log TO nivel_web;
--> statement-breakpoint
GRANT SELECT (id, customer_id, order_id, kind, granted, at) ON ops.consents TO nivel_web;
--> statement-breakpoint
GRANT SELECT (id, dedupe_key, status) ON ops.outbox TO nivel_web;
--> statement-breakpoint
-- ai.* already has SELECT, INSERT (WP-00); the counters of the conversation and of the day are updated as the
-- dialogue goes. purge_after (the 90-day retention) and the identity columns are not the site's to change; the
-- counters only grow (trigger ai.guard_*_counters).
GRANT UPDATE (cost_micro_usd, filter_hits, outcome, lead_id, configuration_id) ON ai.conversations TO nivel_web;
--> statement-breakpoint
GRANT INSERT, UPDATE ON ai.usage_daily TO nivel_web;
--> statement-breakpoint
-- Partner data (price list links, contacts, prices per vendor) is for the worker and the admin. The public
-- processes read prices through pricing.fx_rates, pricing.market_prices and the views, which run with the rights of
-- their owner. WP-00 gave SELECT on every pricing table by default; this takes it back where it does not belong.
REVOKE SELECT ON
  pricing.vendors, pricing.offers, pricing.sku_mappings, pricing.price_imports, pricing.price_observations
FROM nivel_web, nivel_bot;
--> statement-breakpoint
GRANT SELECT ON
  sales.v_customer_order_status, sales.v_customer_order_quotes,
  sales.v_customer_order_payments, sales.v_customer_order_purchases
TO nivel_web, nivel_bot;
--> statement-breakpoint
-- ---- nivel_bot: clients, leads, consents, reading orders, order scenarios ---------------------------------------
GRANT SELECT, INSERT, UPDATE ON sales.leads, sales.customers TO nivel_bot;
--> statement-breakpoint
GRANT SELECT, INSERT ON sales.configurations TO nivel_bot;
--> statement-breakpoint
GRANT SELECT ON
  sales.orders, sales.order_events, sales.quotes, sales.quote_lines, sales.payments, sales.purchases,
  sales.purchase_files, sales.commission_reports, sales.acts, sales.build_passports, sales.warranty_cases
TO nivel_bot;
--> statement-breakpoint
GRANT SELECT, INSERT ON ops.consents, ops.outbox TO nivel_bot;
--> statement-breakpoint
GRANT SELECT ON ops.settings, ops.files TO nivel_bot;
--> statement-breakpoint
GRANT INSERT ON ops.audit_log TO nivel_bot;
--> statement-breakpoint
-- ---- nivel_worker: prices, queue, files, reminders, retention ---------------------------------------------------
-- pricing.* read-write comes from the defaults; sales is read-only except the reserve ledger.
GRANT SELECT ON
  sales.configurations, sales.leads, sales.orders, sales.order_events, sales.quotes, sales.quote_lines,
  sales.payments, sales.purchases, sales.purchase_files, sales.commission_reports, sales.acts,
  sales.build_passports, sales.warranty_cases, sales.loaner_items, sales.reserve_ledger, sales.other_income,
  sales.order_transitions, sales.v_deal_volume_by_year
TO nivel_worker;
--> statement-breakpoint
GRANT SELECT (id, display_name, phone_e164, telegram_user_id, telegram_username, lang, district,
              age_18_confirmed, created_at, erased_at)
  ON sales.customers TO nivel_worker;
--> statement-breakpoint
GRANT INSERT ON sales.reserve_ledger TO nivel_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ops.outbox, ops.files, ops.app_errors, ops.threshold_snapshots TO nivel_worker;
--> statement-breakpoint
GRANT SELECT ON ops.settings, ops.consents TO nivel_worker;
--> statement-breakpoint
GRANT SELECT, UPDATE ON ops.dsr_requests TO nivel_worker;
--> statement-breakpoint
GRANT INSERT ON ops.audit_log TO nivel_worker;
--> statement-breakpoint
GRANT SELECT ON ai.conversations, ai.messages TO nivel_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ai.usage_daily TO nivel_worker;
--> statement-breakpoint
GRANT SELECT ON bot.subscriptions TO nivel_worker;
--> statement-breakpoint
-- Retention of the bot tables (ARCHITECTURE 9): the worker removes old updates and idle sessions. It reads only the
-- columns the WHERE clause needs; a session's content stays out of reach.
GRANT USAGE ON SCHEMA bot TO nivel_worker;
--> statement-breakpoint
GRANT SELECT (update_id, at) ON bot.processed_updates TO nivel_worker;
--> statement-breakpoint
GRANT DELETE ON bot.processed_updates TO nivel_worker;
--> statement-breakpoint
GRANT SELECT (key, updated_at) ON bot.sessions TO nivel_worker;
--> statement-breakpoint
GRANT DELETE ON bot.sessions TO nivel_worker;
