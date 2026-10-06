-- WP-06: generic guards, counters and settings triggers (ARCHITECTURE 3.1).
-- Statements are separated by the drizzle breakpoint marker; files are joined in module order by assemble.mjs.

-- True inside a SECURITY DEFINER function of the migrator: the caller cannot fake it by setting the flag alone,
-- because current_user is the function owner only while that function runs.
CREATE FUNCTION ops.in_owner_context(p_flag text, p_owner_of regproc) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting(p_flag, true), '') = 'on'
     AND current_user = (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = p_owner_of)
$$;
--> statement-breakpoint
-- Append-only journals: no UPDATE, DELETE or TRUNCATE; a correction is a reversing row.
CREATE FUNCTION ops.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only: %.% forbids %', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation', HINT = 'Journals are append-only; write a reversing row instead.';
END
$$;
--> statement-breakpoint
-- Immutable rows (saved configurations): any change or removal is rejected.
CREATE FUNCTION ops.forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable: %.% forbids %', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation', HINT = 'Create a new row (a new version) instead of changing this one.';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON ops.audit_log
  FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON ops.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
-- The public processes (site, bot, worker) cannot choose the time of a journal row: the latest consent of a kind
-- decides, so a row dated in the future would outlive every withdrawal. The migrator and the admin keep their own
-- time (seed, imports, corrections by reversing rows).
CREATE FUNCTION ops.stamp_time() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF session_user IN ('nivel_web', 'nivel_bot', 'nivel_worker') THEN
    NEW.at := clock_timestamp();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_stamp BEFORE INSERT ON ops.audit_log
  FOR EACH ROW EXECUTE FUNCTION ops.stamp_time();
--> statement-breakpoint
-- Consents: server time for the public roles; an order-level consent belongs to the customer of the order; the
-- site does not record the consents that move money (limit overrun, no receipt, replacement, third-party payer):
-- the bot and the admin do, after the customer's answer.
CREATE FUNCTION ops.guard_consent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_customer uuid;
BEGIN
  IF session_user IN ('nivel_web', 'nivel_bot', 'nivel_worker') THEN
    NEW.at := clock_timestamp();
  END IF;
  IF session_user = 'nivel_web'
     AND NEW.kind IN ('limit_overrun', 'no_receipt_purchase', 'replacement', 'third_party_payer') THEN
    RAISE EXCEPTION 'actor_not_allowed: the site cannot record the consent %', NEW.kind
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.order_id IS NOT NULL THEN
    SELECT o.customer_id INTO v_customer FROM sales.orders o WHERE o.id = NEW.order_id;
    IF v_customer IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'consent_mismatch: the consent % names another customer than the order %', NEW.kind, NEW.order_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER consents_guard BEFORE INSERT ON ops.consents
  FOR EACH ROW EXECUTE FUNCTION ops.guard_consent();
--> statement-breakpoint
CREATE TRIGGER consents_append_only BEFORE UPDATE OR DELETE ON ops.consents
  FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER consents_no_truncate BEFORE TRUNCATE ON ops.consents
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
-- Latest consent of a kind for an order: withdrawal is a newer row with granted = false.
CREATE FUNCTION ops.consent_granted(p_order_id uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT c.granted FROM ops.consents c
      WHERE c.order_id = p_order_id AND c.kind = p_kind
      ORDER BY c.at DESC, c.id DESC LIMIT 1), false)
$$;
--> statement-breakpoint
-- Public numbers: L-2026-0001, NV-2026-0001, G-2026-0001. Gap-free inside the caller's transaction. The site and the
-- bot only open leads: a number of another kind, or of a year far from the current one, would burn a number or add
-- counter rows. The worker has no use for numbers (the function is not granted to it).
CREATE FUNCTION ops.next_number(p_kind text, p_year integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v integer;
  v_year integer := extract(year FROM now() AT TIME ZONE 'Asia/Tashkent')::integer;
BEGIN
  IF p_kind NOT IN ('L', 'NV', 'G') THEN
    RAISE EXCEPTION 'unknown_number_kind: %', p_kind USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF session_user IN ('nivel_web', 'nivel_bot') AND (p_kind <> 'L' OR p_year NOT BETWEEN v_year - 1 AND v_year + 1) THEN
    RAISE EXCEPTION 'number_not_allowed: % may only take lead numbers of the current year, not % %', session_user, p_kind, p_year
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO ops.number_counters AS c (kind, year, last_value) VALUES (p_kind, p_year, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = c.last_value + 1
  RETURNING c.last_value INTO v;
  -- Four digits at least; lpad alone would cut a longer number (the table CHECKs allow four digits or more).
  RETURN p_kind || '-' || p_year::text || '-' || CASE WHEN v < 10000 THEN lpad(v::text, 4, '0') ELSE v::text END;
END
$$;
--> statement-breakpoint
-- ops.settings: every change bumps the version and the change time.
CREATE FUNCTION ops.settings_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER settings_touch BEFORE UPDATE ON ops.settings
  FOR EACH ROW EXECUTE FUNCTION ops.settings_touch();
--> statement-breakpoint
CREATE FUNCTION ops.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- The relay's "next batch" query scans pending rows only.
CREATE INDEX outbox_pending_idx ON ops.outbox (send_after, priority DESC) WHERE status = 'pending';
--> statement-breakpoint
-- WP-06: catalog functions, CHECKs and indexes that Drizzle cannot express (ARCHITECTURE 3.3).

-- Keys the "block" compatibility rules (ARCHITECTURE 4.4) read per category. A product may be `verified`
-- only when all of them are present and not JSON null; an unknown value stays null in a draft.
CREATE FUNCTION catalog.required_spec_keys(p_category text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_category
    WHEN 'cpu' THEN ARRAY['socket', 'chipsets', 'memTypes', 'maxPowerW', 'hasIgpu']
    WHEN 'mb' THEN ARRAY['socket', 'chipset', 'formFactor', 'ramType', 'ramSlots', 'ramMaxGb', 'm2', 'sataPorts']
    WHEN 'ram' THEN ARRAY['type', 'kitGb', 'modules', 'mts']
    WHEN 'ssd' THEN ARRAY['iface', 'formFactor', 'capacityGb']
    WHEN 'gpu' THEN ARRAY['lengthMm', 'power', 'tgpW']
    WHEN 'psu' THEN ARRAY['watts', 'formFactor', 'pcie8pin', 'native12v2x6']
    WHEN 'case' THEN ARRAY['boards', 'gpuMaxLenMm', 'coolerMaxHeightMm', 'psuFF', 'radiators']
    WHEN 'cooler_air' THEN ARRAY['sockets', 'heightMm']
    WHEN 'aio' THEN ARRAY['sockets', 'radMm']
    WHEN 'monitor' THEN ARRAY['diagIn', 'panelWmm']
    WHEN 'arm' THEN ARRAY['vesa', 'loadMaxKg', 'topThicknessMinMm', 'topThicknessMaxMm']
    WHEN 'desk' THEN ARRAY['topWmm', 'topDmm', 'topThicknessMm']
    ELSE ARRAY[]::text[]
  END
$$;
--> statement-breakpoint
CREATE FUNCTION catalog.spec_complete(p_category text, p_specs jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(catalog.required_spec_keys(p_category)) AS k
     WHERE p_specs -> k IS NULL OR jsonb_typeof(p_specs -> k) = 'null')
$$;
--> statement-breakpoint
ALTER TABLE catalog.products ADD CONSTRAINT products_verified_spec_complete_chk
  CHECK (status <> 'verified' OR catalog.spec_complete(category_code, specs));
--> statement-breakpoint
CREATE INDEX products_specs_gin_idx ON catalog.products USING gin (specs jsonb_path_ops);
--> statement-breakpoint
-- Search by "brand model mpn" for the admin catalog and price matching (pg_trgm, WP-00).
CREATE INDEX products_search_trgm_idx ON catalog.products
  USING gin ((brand || ' ' || model || ' ' || coalesce(mpn, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE TRIGGER products_touch BEFORE UPDATE ON catalog.products
  FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();
--> statement-breakpoint
-- WP-06: price journal guard, trigram memory of price lines, current market prices (ARCHITECTURE 3.1, 3.3).

-- price_observations is append-only except for the `excluded` flag with its reason.
CREATE FUNCTION pricing.guard_observation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append_only: pricing.price_observations forbids DELETE'
      USING ERRCODE = 'check_violation', HINT = 'Exclude the observation with a reason instead.';
  END IF;
  IF (to_jsonb(NEW) - 'excluded' - 'exclude_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'excluded' - 'exclude_reason') THEN
    RAISE EXCEPTION 'append_only: pricing.price_observations allows changing only excluded and exclude_reason'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER price_observations_guard BEFORE UPDATE OR DELETE ON pricing.price_observations
  FOR EACH ROW EXECUTE FUNCTION pricing.guard_observation();
--> statement-breakpoint
CREATE TRIGGER price_observations_no_truncate BEFORE TRUNCATE ON pricing.price_observations
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
CREATE INDEX sku_mappings_title_trgm_idx ON pricing.sku_mappings USING gin (raw_title_normalized gin_trgm_ops);
--> statement-breakpoint
-- The latest market price per product: one query for the configurator snapshot (ARCHITECTURE 3.5).
CREATE VIEW pricing.v_market_price_current AS
SELECT DISTINCT ON (mp.product_id)
       mp.id, mp.product_id, mp.as_of, mp.median_sum, mp.from_sum, mp.min_sum, mp.max_sum,
       mp.offers_n, mp.vendors_n, mp.max_age_days, mp.confidence, mp.flags, mp.input_ids,
       mp.computed_at, mp.is_demo
  FROM pricing.market_prices mp
 ORDER BY mp.product_id, mp.as_of DESC;
--> statement-breakpoint
-- WP-06: the order status graph, sales.apply_transition() and the guard that makes it the only way to change a
-- status (ARCHITECTURE 3.4, 4.9, 4.13). The graph repeats table 4.9 of the architecture as data, with the actors
-- allowed for each event; the other guards of the finite-state machine (when, which flags) stay in packages/domain.

CREATE TABLE sales.order_transitions (
  from_status text NOT NULL,
  event_type text NOT NULL,
  to_status text NOT NULL,
  -- Who may send the event (table 4.9, column "who"); packages/domain holds the same list and a test compares them.
  actors text[] NOT NULL,
  PRIMARY KEY (from_status, event_type)
);
--> statement-breakpoint
INSERT INTO sales.order_transitions (from_status, event_type, to_status, actors) VALUES
  ('estimate_draft', 'SEND_ESTIMATE', 'estimate_sent', ARRAY['owner']),
  ('estimate_sent', 'EXPIRE', 'estimate_expired', ARRAY['system']),
  ('estimate_sent', 'REVISE', 'estimate_draft', ARRAY['owner']),
  ('estimate_expired', 'REVISE', 'estimate_draft', ARRAY['owner']),
  ('estimate_sent', 'ACCEPT', 'accepted', ARRAY['customer']),
  ('estimate_sent', 'PODBOR_DELIVERED', 'podbor_delivered', ARRAY['owner']),
  ('accepted', 'FEE_PREPAID', 'accepted', ARRAY['owner']),
  ('accepted', 'FUNDS_RECEIVED', 'accepted', ARRAY['owner']),
  ('accepted', 'MEETING_DONE', 'accepted', ARRAY['owner']),
  ('accepted', 'START_PURCHASE', 'purchasing', ARRAY['owner']),
  ('purchasing', 'PURCHASE_RECORDED', 'purchasing', ARRAY['owner', 'assistant']),
  ('purchasing', 'PURCHASE_DONE', 'report_due', ARRAY['owner']),
  ('report_due', 'SEND_REPORT', 'report_sent', ARRAY['owner']),
  ('report_sent', 'OBJECTION', 'report_sent', ARRAY['customer']),
  ('report_sent', 'REPORT_ACCEPTED', 'report_sent', ARRAY['customer']),
  ('report_sent', 'REPORT_DEEMED_ACCEPTED', 'report_sent', ARRAY['system']),
  ('report_sent', 'REMAINDER_SETTLED', 'settled', ARRAY['owner']),
  ('settled', 'MATERIALS_ACCEPTED', 'assembling', ARRAY['owner']),
  ('assembling', 'ASSEMBLED', 'testing', ARRAY['owner', 'assistant']),
  ('testing', 'TESTS_PASSED', 'ready', ARRAY['owner', 'assistant']),
  ('ready', 'DISPATCH', 'delivering', ARRAY['owner']),
  ('delivering', 'HANDOVER', 'handed_over', ARRAY['owner', 'customer']),
  ('handed_over', 'CLOSE', 'closed', ARRAY['system']),
  ('cancelling', 'CANCEL_SETTLED', 'cancelled', ARRAY['owner']),
  -- CANCEL: any status before handed_over.
  ('estimate_draft', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('estimate_sent', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('estimate_expired', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('accepted', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('purchasing', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('report_due', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('report_sent', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('settled', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('assembling', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('testing', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('ready', 'CANCEL', 'cancelling', ARRAY['owner']),
  ('delivering', 'CANCEL', 'cancelling', ARRAY['owner']);
--> statement-breakpoint
ALTER TABLE sales.order_transitions
  ADD CONSTRAINT order_transitions_from_chk CHECK (from_status IN (
    'estimate_draft', 'estimate_sent', 'estimate_expired', 'accepted', 'purchasing', 'report_due', 'report_sent',
    'settled', 'assembling', 'testing', 'ready', 'delivering', 'handed_over', 'closed', 'podbor_delivered',
    'cancelling', 'cancelled')),
  ADD CONSTRAINT order_transitions_to_chk CHECK (to_status IN (
    'estimate_draft', 'estimate_sent', 'estimate_expired', 'accepted', 'purchasing', 'report_due', 'report_sent',
    'settled', 'assembling', 'testing', 'ready', 'delivering', 'handed_over', 'closed', 'podbor_delivered',
    'cancelling', 'cancelled')),
  ADD CONSTRAINT order_transitions_actors_chk CHECK (
    cardinality(actors) > 0 AND actors <@ ARRAY['system', 'customer', 'owner', 'assistant']);
--> statement-breakpoint
-- The only writer of orders.status. Runs as the migrator; callers need EXECUTE only.
-- One call = one transaction step: status, sales.order_events and ops.audit_log. The service adds ops.outbox rows
-- in the same transaction (ARCHITECTURE 4.13).
-- What the function checks itself, in this order (the second line of defence after packages/domain):
--   1. the input: an event with a type, an actor kind from the list, an actor id (a NULL would pass every test below);
--   2. who may call: the site only as the customer, the worker only as the system, the bot never as the system;
--   3. who may send the event (sales.order_transitions.actors, table 4.9);
--   4. the bot acting as the owner or the assistant: the actor id must be the Telegram id of an active account of
--      that role in ops.admin_users (the bot's word alone is not enough: the credentials of nivel_bot may leak);
--   5. which order fields the actor may write with this event: a whitelist of the pair (actor, event);
--   6. the order exists, the expected status holds, the edge is in the graph;
--   7. a customer writes a field once: a value the order already has stays;
--   8. the flags that open money steps follow the confirmed payments.
CREATE FUNCTION sales.apply_transition(
  p_order_id uuid,
  p_event jsonb,
  p_actor_kind text,
  p_actor_id text,
  p_expected_from text DEFAULT NULL,
  p_guard_snapshot jsonb DEFAULT NULL,
  p_changes jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (out_seq integer, out_from text, out_to text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_from text;
  v_to text;
  v_type text := p_event ->> 'type';
  v_seq integer;
  v_key text;
  v_row jsonb;
  v_allowed text[] := ARRAY[
    'fee_prepaid', 'funds_received', 'funds_received_at', 'purchase_not_before', 'first_order_meeting_done',
    'current_quote_id', 'offer_version_uz_id', 'offer_version_ru_id', 'accepted_at', 'report_due_at',
    'objection_until', 'refund_due_at', 'handed_over_at', 'warranty_until', 'podbor_credit_until',
    'cancel', 'documented_losses_sum'];
  -- Fields this actor may write together with this event (see below); empty for the system and the assistant.
  v_actor_keys text[];
  v_event_actors text[];
  v_net numeric;
  v_limit numeric;
BEGIN
  -- Missing input first. Every test below is `<>` or `NOT IN`: against a NULL it is unknown, not true, so a missing
  -- actor would pass them all and fail only at the NOT NULL columns of the journal.
  IF p_event IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'invalid_event: the event has no type' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_actor_kind IS NULL OR p_actor_kind NOT IN ('system', 'customer', 'owner', 'assistant') THEN
    RAISE EXCEPTION 'invalid_actor: %', coalesce(p_actor_kind, 'no actor kind') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id ~ '^\s*$' THEN
    RAISE EXCEPTION 'invalid_actor: the % has no id', p_actor_kind USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Who may call at all: the public site acts for customers, the worker for the system, the bot never for the system.
  IF (session_user = 'nivel_web' AND p_actor_kind <> 'customer')
     OR (session_user = 'nivel_worker' AND p_actor_kind <> 'system')
     OR (session_user = 'nivel_bot' AND p_actor_kind = 'system') THEN
    RAISE EXCEPTION 'actor_not_allowed: % as % cannot apply %', session_user, p_actor_kind, v_type
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Who may send this event (table 4.9). An unknown event falls through to invalid_transition below.
  SELECT t.actors INTO v_event_actors FROM sales.order_transitions t WHERE t.event_type = v_type LIMIT 1;
  IF FOUND AND NOT (p_actor_kind = ANY (v_event_actors)) THEN
    RAISE EXCEPTION 'actor_not_allowed: % cannot send % (allowed: %)', p_actor_kind, v_type, v_event_actors
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The bot lives in the group of the owner and acts for the owner and the assistant. Whoever holds its credentials
  -- could name any actor, so the id it names must be the Telegram id of an active account of that role. A Telegram id
  -- belongs to at most one account (the unique index admin_users_telegram_user_id_key), so there is one row to judge.
  -- The id is text and telegram_user_id is a bigint: the column is cast to text and the two texts are compared. The
  -- id is never cast to a number, so '+123', ' 123', '0123' and '123.0' are not the account 123, and a text that is
  -- no number is a plain refusal, not a cast error.
  IF session_user = 'nivel_bot' AND p_actor_kind IN ('owner', 'assistant') AND NOT EXISTS (
       SELECT 1 FROM ops.admin_users a
        WHERE a.telegram_user_id::text = p_actor_id AND a.role = p_actor_kind AND a.active) THEN
    RAISE EXCEPTION 'actor_not_allowed: % is not the Telegram id of an active % account', p_actor_id, p_actor_kind
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Fields an actor may write together with an event: a whitelist of the pair (actor, event), not of the actor
  -- alone. The owner writes any of them; the customer only what its event owns (the acceptance time and the offer
  -- versions with ACCEPT, the handover time and the warranty with HANDOVER); the system and the assistant none: the
  -- events of the system (EXPIRE, REPORT_DEEMED_ACCEPTED, CLOSE) write no order field in table 4.9, the deadlines are
  -- set by the owner's events. The money fields (flags that open purchases, the deadlines of refunds, the documented
  -- losses of the closing check) belong to the owner only.
  v_actor_keys := CASE
    WHEN p_actor_kind = 'owner' THEN v_allowed
    WHEN p_actor_kind = 'customer' AND v_type = 'ACCEPT'
      THEN ARRAY['accepted_at', 'offer_version_uz_id', 'offer_version_ru_id']
    WHEN p_actor_kind = 'customer' AND v_type = 'HANDOVER'
      THEN ARRAY['handed_over_at', 'warranty_until']
    ELSE ARRAY[]::text[]
  END;
  FOR v_key IN SELECT jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'unknown_change: % is not a changeable order field', v_key USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF NOT (v_key = ANY (v_actor_keys)) THEN
      RAISE EXCEPTION 'change_not_allowed: % may not write the order field %', p_actor_kind, v_key
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  SELECT o.status, to_jsonb(o) INTO v_from, v_row FROM sales.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found: %', p_order_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_expected_from IS NOT NULL AND p_expected_from <> v_from THEN
    RAISE EXCEPTION 'stale_status: expected %, actual %', p_expected_from, v_from USING ERRCODE = 'serialization_failure';
  END IF;
  SELECT t.to_status INTO v_to FROM sales.order_transitions t WHERE t.from_status = v_from AND t.event_type = v_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_transition: % is not allowed from %', v_type, v_from USING ERRCODE = 'check_violation';
  END IF;

  -- A customer writes a field once: a value the order already has is the record of what happened first (who
  -- accepted, when it was handed over) and stays, even if the new value is the same. The row is locked, so the value
  -- cannot change between this test and the UPDATE below. A JSON null is a column without a value.
  IF p_actor_kind = 'customer' THEN
    FOR v_key IN SELECT jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) LOOP
      IF jsonb_typeof(v_row -> v_key) IS DISTINCT FROM 'null' THEN
        RAISE EXCEPTION 'change_not_allowed: the order field % already has a value, the customer may not write it again', v_key
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END LOOP;
  END IF;

  -- The flags that open the next money step follow the confirmed payments (the same sums the closing check uses).
  IF (p_changes ->> 'fee_prepaid')::boolean IS TRUE THEN
    SELECT coalesce(sum(p.amount_sum), 0) INTO v_net FROM sales.payments p
      WHERE p.order_id = p_order_id AND p.status = 'confirmed' AND p.kind = 'fee_advance';
    IF v_net <= 0 THEN
      RAISE EXCEPTION 'payments_incomplete: no confirmed fee advance for the order' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF (p_changes ->> 'funds_received')::boolean IS TRUE THEN
    SELECT coalesce(sum(p.amount_sum), 0) INTO v_net FROM sales.payments p
      WHERE p.order_id = p_order_id AND p.status = 'confirmed' AND p.kind IN ('purchase_funds', 'purchase_topup');
    SELECT q.purchase_limit INTO v_limit FROM sales.quotes q
      JOIN sales.orders o ON o.current_quote_id = q.id WHERE o.id = p_order_id;
    IF v_net <= 0 OR v_net < coalesce(v_limit, 0) THEN
      RAISE EXCEPTION 'payments_incomplete: confirmed purchase funds % are below the purchase limit %', v_net, coalesce(v_limit, 0)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  PERFORM set_config('nivel.apply_transition', 'on', true);
  UPDATE sales.orders o SET
    status = v_to,
    fee_prepaid = coalesce((p_changes ->> 'fee_prepaid')::boolean, o.fee_prepaid),
    funds_received = coalesce((p_changes ->> 'funds_received')::boolean, o.funds_received),
    funds_received_at = coalesce((p_changes ->> 'funds_received_at')::timestamptz, o.funds_received_at),
    purchase_not_before = coalesce((p_changes ->> 'purchase_not_before')::timestamptz, o.purchase_not_before),
    first_order_meeting_done = coalesce((p_changes ->> 'first_order_meeting_done')::boolean, o.first_order_meeting_done),
    current_quote_id = coalesce((p_changes ->> 'current_quote_id')::uuid, o.current_quote_id),
    offer_version_uz_id = coalesce((p_changes ->> 'offer_version_uz_id')::uuid, o.offer_version_uz_id),
    offer_version_ru_id = coalesce((p_changes ->> 'offer_version_ru_id')::uuid, o.offer_version_ru_id),
    accepted_at = coalesce((p_changes ->> 'accepted_at')::timestamptz, o.accepted_at),
    report_due_at = coalesce((p_changes ->> 'report_due_at')::timestamptz, o.report_due_at),
    objection_until = coalesce((p_changes ->> 'objection_until')::timestamptz, o.objection_until),
    refund_due_at = coalesce((p_changes ->> 'refund_due_at')::timestamptz, o.refund_due_at),
    handed_over_at = coalesce((p_changes ->> 'handed_over_at')::timestamptz, o.handed_over_at),
    warranty_until = coalesce((p_changes ->> 'warranty_until')::timestamptz, o.warranty_until),
    podbor_credit_until = coalesce((p_changes ->> 'podbor_credit_until')::timestamptz, o.podbor_credit_until),
    cancel = coalesce(p_changes -> 'cancel', o.cancel),
    documented_losses_sum = coalesce((p_changes ->> 'documented_losses_sum')::bigint, o.documented_losses_sum)
  WHERE o.id = p_order_id;
  PERFORM set_config('nivel.apply_transition', 'off', true);

  SELECT coalesce(max(e.seq), 0) + 1 INTO v_seq FROM sales.order_events e WHERE e.order_id = p_order_id;
  INSERT INTO sales.order_events (order_id, seq, actor_kind, actor_id, event, from_status, to_status, guard_snapshot)
  VALUES (p_order_id, v_seq, p_actor_kind, p_actor_id, p_event, v_from, v_to, p_guard_snapshot);
  INSERT INTO ops.audit_log (actor, action, entity, entity_id, before, after)
  VALUES (p_actor_kind || ':' || p_actor_id, 'order.' || v_type, 'sales.orders', p_order_id::text,
          jsonb_build_object('status', v_from),
          jsonb_build_object('status', v_to, 'event', p_event, 'changes', coalesce(p_changes, '{}'::jsonb),
                             'db_role', session_user));

  out_seq := v_seq;
  out_from := v_from;
  out_to := v_to;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
-- Orders: new orders start as drafts; a status changes only inside sales.apply_transition(); closing or cancelling
-- needs the money to reconcile (ARCHITECTURE 3.4, red line 13).
CREATE FUNCTION sales.guard_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_funds numeric;
  v_refunds numeric;
  v_spent numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'estimate_draft' THEN
      RAISE EXCEPTION 'invalid_initial_status: an order starts as estimate_draft, not %', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ops.in_owner_context('nivel.apply_transition', 'sales.apply_transition'::regproc) THEN
      RAISE EXCEPTION 'direct_status_change: orders.status is changed only by sales.apply_transition()'
        USING ERRCODE = 'insufficient_privilege', HINT = 'Use services.orders.dispatch.';
    END IF;
    IF NEW.status IN ('closed', 'cancelled') THEN
      SELECT coalesce(sum(p.amount_sum) FILTER (WHERE p.kind IN ('purchase_funds', 'purchase_topup')), 0),
             coalesce(sum(p.amount_sum) FILTER (WHERE p.kind IN ('remainder_refund', 'funds_refund')), 0)
        INTO v_funds, v_refunds
        FROM sales.payments p WHERE p.order_id = NEW.id AND p.status = 'confirmed';
      SELECT coalesce(sum(pu.amount_sum), 0) INTO v_spent FROM sales.purchases pu WHERE pu.order_id = NEW.id;
      IF v_funds <> v_spent + v_refunds + NEW.documented_losses_sum THEN
        RAISE EXCEPTION 'not_reconciled: funds %, purchases %, refunds %, documented losses %',
          v_funds, v_spent, v_refunds, NEW.documented_losses_sum
          USING ERRCODE = 'check_violation',
                HINT = 'Received purchase money must equal purchases + refunds + documented losses.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER orders_guard BEFORE INSERT OR UPDATE ON sales.orders
  FOR EACH ROW EXECUTE FUNCTION sales.guard_order();
--> statement-breakpoint
-- WP-06: money triggers, journals and immutability for the sales schema (ARCHITECTURE 3.1, 3.4).

-- ---- append-only journals -------------------------------------------------------------------------------------
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON sales.order_events
  FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER order_events_no_truncate BEFORE TRUNCATE ON sales.order_events
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER reserve_ledger_append_only BEFORE UPDATE OR DELETE ON sales.reserve_ledger
  FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER reserve_ledger_no_truncate BEFORE TRUNCATE ON sales.reserve_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
-- ---- payments: only `expected -> confirmed | void`, with the confirmation fields -------------------------------
CREATE FUNCTION sales.guard_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_confirmable text[] := ARRAY[
    'status', 'fiscal_receipt_no', 'bank_doc_no', 'payer_is_customer', 'third_party_statement_file_id',
    'occurred_at', 'confirmed_by', 'confirmed_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append_only: sales.payments forbids DELETE'
      USING ERRCODE = 'check_violation', HINT = 'Void an expected payment or write a reversing row.';
  END IF;
  IF OLD.status <> 'expected' OR NEW.status NOT IN ('confirmed', 'void') THEN
    RAISE EXCEPTION 'append_only: a % payment cannot become %; only expected -> confirmed | void', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', HINT = 'Write a reversing row (reversal_of) to correct a confirmed payment.';
  END IF;
  IF (to_jsonb(NEW) - v_confirmable) IS DISTINCT FROM (to_jsonb(OLD) - v_confirmable) THEN
    RAISE EXCEPTION 'append_only: sales.payments allows changing only the confirmation fields'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON sales.payments
  FOR EACH ROW EXECUTE FUNCTION sales.guard_payment();
--> statement-breakpoint
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON sales.payments
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
-- A reversing row corrects one confirmed payment of the same order, kind, direction and method, and all the
-- reversals of a payment together never exceed it: a repeated request cannot write the correction twice.
-- (A reversal with the wrong sign is left to payments_amount_chk.)
CREATE FUNCTION sales.guard_payment_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_orig sales.payments%ROWTYPE;
  v_reversed numeric;
BEGIN
  IF NEW.reversal_of IS NULL OR NEW.amount_sum >= 0 THEN
    RETURN NEW;
  END IF;
  -- The lock serialises two requests that reverse the same payment.
  SELECT * INTO v_orig FROM sales.payments p WHERE p.id = NEW.reversal_of FOR UPDATE;
  IF NOT FOUND OR v_orig.order_id <> NEW.order_id OR v_orig.status <> 'confirmed' OR v_orig.reversal_of IS NOT NULL
     OR v_orig.kind <> NEW.kind OR v_orig.direction <> NEW.direction OR v_orig.method <> NEW.method THEN
    RAISE EXCEPTION 'invalid_reversal: payment % is not a confirmed payment of order % with the same kind, direction and method',
      NEW.reversal_of, NEW.order_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(-sum(p.amount_sum), 0) INTO v_reversed
    FROM sales.payments p WHERE p.reversal_of = v_orig.id AND p.status <> 'void';
  IF v_reversed - NEW.amount_sum > v_orig.amount_sum THEN
    RAISE EXCEPTION 'invalid_reversal: reversals % would exceed the payment %', v_reversed - NEW.amount_sum, v_orig.amount_sum
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payments_reversal BEFORE INSERT ON sales.payments
  FOR EACH ROW EXECUTE FUNCTION sales.guard_payment_reversal();
--> statement-breakpoint
-- ---- purchases: limit, funds, receipts (ARCHITECTURE 3.4) ---------------------------------------------------
CREATE FUNCTION sales.guard_purchase() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_limit bigint;
  v_total numeric;
  v_funds numeric;
  v_orig sales.purchases%ROWTYPE;
  v_returned numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_id <> OLD.order_id THEN
    RAISE EXCEPTION 'immutable: a purchase never moves to another order' USING ERRCODE = 'check_violation';
  END IF;
  -- Serialise purchases of one order: the sums below must not race.
  PERFORM 1 FROM sales.orders o WHERE o.id = NEW.order_id FOR UPDATE;

  -- A return to the shop reduces one purchase of the same order and shop, and all returns of it together stay within
  -- it: a repeated request cannot give the limit and the funds back twice. (The wrong sign is purchases_amount_chk's.)
  IF TG_OP = 'INSERT' AND NEW.refund_of IS NOT NULL AND NEW.amount_sum < 0 THEN
    SELECT * INTO v_orig FROM sales.purchases p WHERE p.id = NEW.refund_of;
    IF NOT FOUND OR v_orig.order_id <> NEW.order_id OR v_orig.refund_of IS NOT NULL
       OR v_orig.vendor_id IS DISTINCT FROM NEW.vendor_id THEN
      RAISE EXCEPTION 'invalid_refund: purchase % is not a purchase of order % in the same shop', NEW.refund_of, NEW.order_id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(-sum(p.amount_sum), 0) INTO v_returned FROM sales.purchases p WHERE p.refund_of = v_orig.id;
    IF v_returned - NEW.amount_sum > v_orig.amount_sum THEN
      RAISE EXCEPTION 'invalid_refund: returns % would exceed the purchase %', v_returned - NEW.amount_sum, v_orig.amount_sum
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT q.purchase_limit INTO v_limit
    FROM sales.orders o JOIN sales.quotes q ON q.id = o.current_quote_id
   WHERE o.id = NEW.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_current_quote: order % has no current quote, there is no purchase limit', NEW.order_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(p.amount_sum), 0) + NEW.amount_sum INTO v_total
    FROM sales.purchases p WHERE p.order_id = NEW.order_id AND p.id IS DISTINCT FROM NEW.id;
  -- Above the limit only with the customer's written consent (limit_overrun).
  IF v_total > v_limit AND NOT ops.consent_granted(NEW.order_id, 'limit_overrun') THEN
    RAISE EXCEPTION 'limit_exceeded: purchases % exceed the limit % without a limit_overrun consent', v_total, v_limit
      USING ERRCODE = 'check_violation';
  END IF;
  -- Never with our own money: purchases stay within the confirmed purchase funds.
  SELECT coalesce(sum(p.amount_sum), 0) INTO v_funds
    FROM sales.payments p
   WHERE p.order_id = NEW.order_id AND p.status = 'confirmed' AND p.kind IN ('purchase_funds', 'purchase_topup');
  IF v_total > v_funds THEN
    RAISE EXCEPTION 'funds_exceeded: purchases % exceed the received purchase funds %', v_total, v_funds
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.receipt_kind = 'none_with_consent' AND NOT ops.consent_granted(NEW.order_id, 'no_receipt_purchase') THEN
    RAISE EXCEPTION 'consent_missing: a purchase without a receipt needs the no_receipt_purchase consent'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER purchases_guard BEFORE INSERT OR UPDATE ON sales.purchases
  FOR EACH ROW EXECUTE FUNCTION sales.guard_purchase();
--> statement-breakpoint
-- ---- quotes: immutable after `sent` -------------------------------------------------------------------------
CREATE FUNCTION sales.guard_quote() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_movable text[] := ARRAY['status', 'accepted_at', 'acceptance', 'pdf_uz_file_id', 'pdf_ru_file_id'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'immutable: a % quote cannot be deleted', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - v_movable) IS DISTINCT FROM (to_jsonb(OLD) - v_movable) THEN
    RAISE EXCEPTION 'immutable: a % quote keeps its totals, lines and dates', OLD.status
      USING ERRCODE = 'check_violation', HINT = 'Create a new version of the quote.';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'sent' AND NEW.status IN ('accepted', 'expired', 'superseded'))
       OR (OLD.status = 'expired' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'immutable: quote status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)
     OR (OLD.acceptance IS NOT NULL AND NEW.acceptance IS DISTINCT FROM OLD.acceptance)
     OR (OLD.pdf_uz_file_id IS NOT NULL AND NEW.pdf_uz_file_id IS DISTINCT FROM OLD.pdf_uz_file_id)
     OR (OLD.pdf_ru_file_id IS NOT NULL AND NEW.pdf_ru_file_id IS DISTINCT FROM OLD.pdf_ru_file_id) THEN
    RAISE EXCEPTION 'immutable: acceptance and PDF links are written once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER quotes_guard BEFORE UPDATE OR DELETE ON sales.quotes
  FOR EACH ROW EXECUTE FUNCTION sales.guard_quote();
--> statement-breakpoint
CREATE FUNCTION sales.guard_quote_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT q.status INTO v_status FROM sales.quotes q WHERE q.id = OLD.quote_id;
    IF v_status IS NOT NULL AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'immutable: lines of a % quote cannot change', v_status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT q.status INTO v_status FROM sales.quotes q WHERE q.id = NEW.quote_id;
    IF v_status IS NOT NULL AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'immutable: lines of a % quote cannot change', v_status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER quote_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sales.quote_lines
  FOR EACH ROW EXECUTE FUNCTION sales.guard_quote_line();
--> statement-breakpoint
-- ---- saved configurations are immutable -----------------------------------------------------------------------
CREATE TRIGGER configurations_immutable BEFORE UPDATE OR DELETE ON sales.configurations
  FOR EACH ROW EXECUTE FUNCTION ops.forbid_change();
--> statement-breakpoint
CREATE TRIGGER configurations_no_truncate BEFORE TRUNCATE ON sales.configurations
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_change();
--> statement-breakpoint
-- ---- warranty case numbers and plain bookkeeping --------------------------------------------------------------
-- Pending ESF documents are found by (esf_status, esf_due); the partial index keeps the reminder job cheap.
CREATE INDEX purchases_esf_pending_idx ON sales.purchases (esf_due) WHERE esf_status = 'pending';
--> statement-breakpoint
-- WP-06: customer-facing views and the annual deal volume (ARCHITECTURE 3.2, 4.8).
-- The site role reads payments and purchases only through these views: no bank documents, no staff names,
-- shop names only where the shop agreed to be named.

CREATE VIEW sales.v_customer_order_status AS
SELECT o.id AS order_id, o.number, o.customer_id, o.kind, o.status, o.fee_prepaid, o.funds_received,
       o.accepted_at, o.report_due_at, o.objection_until, o.refund_due_at, o.handed_over_at, o.warranty_until,
       o.created_at
  FROM sales.orders o;
--> statement-breakpoint
CREATE VIEW sales.v_customer_order_quotes AS
SELECT q.id AS quote_id, q.order_id, o.customer_id, q.version, q.status,
       q.components_sum, q.reserve_bp, q.reserve_sum, q.purchase_limit, q.outside_scale_sum,
       q.fee_total, q.fee_commission_line, q.fee_works_line, q.fee_advance, q.fee_final,
       q.valid_until, q.sent_at, q.accepted_at, q.watermark_draft, q.totals,
       (SELECT jsonb_agg(jsonb_build_object(
                 'id', l.id, 'productId', l.product_id, 'title', l.title_snapshot, 'category', l.category_code,
                 'feeGroup', l.fee_group, 'qty', l.qty, 'unitMarketSum', l.unit_market_sum,
                 'priceDate', l.price_date, 'confidence', l.confidence, 'returnable', l.returnable,
                 'customerOwned', l.customer_owned) ORDER BY l.id)
          FROM sales.quote_lines l WHERE l.quote_id = q.id) AS lines
  FROM sales.quotes q JOIN sales.orders o ON o.id = q.order_id
 WHERE q.status <> 'draft';
--> statement-breakpoint
CREATE VIEW sales.v_customer_order_payments AS
SELECT p.id AS payment_id, p.order_id, o.customer_id, p.kind, p.direction, p.method, p.amount_sum, p.status,
       p.fiscal_receipt_no, p.occurred_at, p.confirmed_at
  FROM sales.payments p JOIN sales.orders o ON o.id = p.order_id;
--> statement-breakpoint
CREATE VIEW sales.v_customer_order_purchases AS
SELECT pu.id AS purchase_id, pu.order_id, o.customer_id, pu.product_id,
       (SELECT pr.brand || ' ' || pr.model FROM catalog.products pr WHERE pr.id = pu.product_id) AS product_title,
       pu.qty, pu.amount_sum, pu.discount_sum, pu.receipt_kind, pu.receipt_no, pu.esf_no, pu.esf_status, pu.serials,
       pu.vendor_warranty_months, pu.vendor_warranty_until, pu.bought_at,
       CASE WHEN v.public_name_allowed THEN v.name END AS vendor_name
  FROM sales.purchases pu
  JOIN sales.orders o ON o.id = pu.order_id
  JOIN pricing.vendors v ON v.id = pu.vendor_id;
--> statement-breakpoint
-- Deals of the year for the registration threshold (NK art. 462 part 9): purchase receipts + received fee
-- - refunded fee + income of the other activity of the sole proprietor. Returned reserves are not deals.
-- The year is taken in the business calendar, Asia/Tashkent.
CREATE VIEW sales.v_deal_volume_by_year AS
WITH receipts AS (
  SELECT extract(year FROM pu.bought_at AT TIME ZONE 'Asia/Tashkent')::integer AS year, sum(pu.amount_sum) AS s
    FROM sales.purchases pu GROUP BY 1),
fee_in AS (
  SELECT extract(year FROM p.confirmed_at AT TIME ZONE 'Asia/Tashkent')::integer AS year, sum(p.amount_sum) AS s
    FROM sales.payments p
   WHERE p.status = 'confirmed' AND p.kind IN ('fee_advance', 'fee_final', 'fee_extra', 'podbor_fee') GROUP BY 1),
fee_refund AS (
  SELECT extract(year FROM p.confirmed_at AT TIME ZONE 'Asia/Tashkent')::integer AS year, sum(p.amount_sum) AS s
    FROM sales.payments p WHERE p.status = 'confirmed' AND p.kind = 'fee_refund' GROUP BY 1),
other AS (
  SELECT oi.year, sum(oi.amount_sum) AS s FROM sales.other_income oi GROUP BY 1),
years AS (
  SELECT year FROM receipts UNION SELECT year FROM fee_in UNION SELECT year FROM fee_refund UNION SELECT year FROM other)
SELECT y.year,
       coalesce(r.s, 0)::bigint AS receipts_sum,
       coalesce(f.s, 0)::bigint AS fee_in_sum,
       coalesce(fr.s, 0)::bigint AS fee_refund_sum,
       coalesce(o.s, 0)::bigint AS other_income_sum,
       (coalesce(r.s, 0) + coalesce(f.s, 0) - coalesce(fr.s, 0) + coalesce(o.s, 0))::bigint AS deals_sum
  FROM years y
  LEFT JOIN receipts r ON r.year = y.year
  LEFT JOIN fee_in f ON f.year = y.year
  LEFT JOIN fee_refund fr ON fr.year = y.year
  LEFT JOIN other o ON o.year = y.year;
--> statement-breakpoint
-- WP-06: published legal documents are immutable and carry the hash of their text (ARCHITECTURE 3.1, 3.4).

CREATE FUNCTION content.guard_legal_document() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'published' THEN
    RAISE EXCEPTION 'immutable: a published % version % (%) cannot be changed or removed', OLD.kind, OLD.version, OLD.lang
      USING ERRCODE = 'check_violation', HINT = 'Publish a new version; consents refer to the hash of the old text.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status = 'published'
     AND NEW.text_sha256 <> encode(sha256(convert_to(NEW.body_md, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'text_hash_mismatch: text_sha256 of % version % does not match its text', NEW.kind, NEW.version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER legal_documents_guard BEFORE INSERT OR UPDATE OR DELETE ON content.legal_documents
  FOR EACH ROW EXECUTE FUNCTION content.guard_legal_document();
--> statement-breakpoint
CREATE TRIGGER pages_touch BEFORE UPDATE ON content.pages
  FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();
--> statement-breakpoint
-- WP-06: the AI message journal is append-only; only the retention function may delete expired conversations
-- (90 days, ARCHITECTURE 3.3, 10.2).

CREATE FUNCTION ai.guard_message() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND ops.in_owner_context('nivel.ai_purge', 'ai.purge_expired'::regproc) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'append_only: ai.messages forbids %', TG_OP
    USING ERRCODE = 'check_violation', HINT = 'Messages leave the database only through ai.purge_expired().';
END
$$;
--> statement-breakpoint
CREATE TRIGGER messages_guard BEFORE UPDATE OR DELETE ON ai.messages
  FOR EACH ROW EXECUTE FUNCTION ai.guard_message();
--> statement-breakpoint
CREATE TRIGGER messages_no_truncate BEFORE TRUNCATE ON ai.messages
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();
--> statement-breakpoint
-- Removes conversations whose purge_after has passed, with their messages; returns the number of conversations.
-- The caller may pass an earlier moment (tests, a dry run), never a later one than the clock of the database.
CREATE FUNCTION ai.purge_expired(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_n integer;
  v_now timestamptz := least(coalesce(p_now, now()), now());
BEGIN
  PERFORM set_config('nivel.ai_purge', 'on', true);
  DELETE FROM ai.messages m USING ai.conversations c WHERE m.conversation_id = c.id AND c.purge_after <= v_now;
  WITH gone AS (DELETE FROM ai.conversations WHERE purge_after <= v_now RETURNING 1)
  SELECT count(*)::integer INTO v_n FROM gone;
  PERFORM set_config('nivel.ai_purge', 'off', true);
  RETURN v_n;
END
$$;

--> statement-breakpoint
-- The spend counters only grow for the public roles: the site adds to them as the dialogue goes and cannot reset
-- them (the budget alarms and the day limit rest on them). Corrections are the admin's.
CREATE FUNCTION ai.guard_conversation_counters() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF session_user IN ('nivel_web', 'nivel_bot', 'nivel_worker')
     AND (NEW.cost_micro_usd < OLD.cost_micro_usd OR NEW.filter_hits < OLD.filter_hits) THEN
    RAISE EXCEPTION 'counters_only_grow: the counters of a conversation cannot go down' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER conversations_counters BEFORE UPDATE ON ai.conversations
  FOR EACH ROW EXECUTE FUNCTION ai.guard_conversation_counters();
--> statement-breakpoint
CREATE FUNCTION ai.guard_usage_counters() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF session_user IN ('nivel_web', 'nivel_bot', 'nivel_worker')
     AND (NEW.cost_micro_usd < OLD.cost_micro_usd OR NEW.conversations < OLD.conversations) THEN
    RAISE EXCEPTION 'counters_only_grow: the counters of a day cannot go down' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER usage_daily_counters BEFORE UPDATE ON ai.usage_daily
  FOR EACH ROW EXECUTE FUNCTION ai.guard_usage_counters();
--> statement-breakpoint
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
