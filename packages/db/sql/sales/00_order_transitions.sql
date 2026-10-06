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
  -- Fields this actor may write together with this event (see below).
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
  -- could name any actor, so the id it names must be the Telegram id of an active account of that role. The id is
  -- text and telegram_user_id is a bigint: the column is cast to text and the two texts are compared. The id is never
  -- cast to a number, so '+123', ' 123', '0123' and '123.0' are not the account 123, and a text that is no number is
  -- a plain refusal, not a cast error.
  IF session_user = 'nivel_bot' AND p_actor_kind IN ('owner', 'assistant') AND NOT EXISTS (
       SELECT 1 FROM ops.admin_users a
        WHERE a.telegram_user_id::text = p_actor_id AND a.role = p_actor_kind AND a.active) THEN
    RAISE EXCEPTION 'actor_not_allowed: % is not the Telegram id of an active % account', p_actor_id, p_actor_kind
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Fields an actor may write together with an event: a whitelist of the pair (actor, event), not of the actor
  -- alone. The owner writes any of them; the customer only what its event owns (the acceptance time and the offer
  -- versions with ACCEPT, the handover time and the warranty with HANDOVER); the system the deadlines it sets; the
  -- assistant none. The money fields (flags that open purchases, the deadlines of refunds, the documented losses of
  -- the closing check) belong to the owner only.
  v_actor_keys := CASE
    WHEN p_actor_kind = 'owner' THEN v_allowed
    WHEN p_actor_kind = 'customer' AND v_type = 'ACCEPT'
      THEN ARRAY['accepted_at', 'offer_version_uz_id', 'offer_version_ru_id']
    WHEN p_actor_kind = 'customer' AND v_type = 'HANDOVER'
      THEN ARRAY['handed_over_at', 'warranty_until']
    WHEN p_actor_kind = 'system' THEN ARRAY['report_due_at', 'objection_until', 'refund_due_at']
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
