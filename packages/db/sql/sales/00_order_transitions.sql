-- WP-06: the order status graph, sales.apply_transition() and the guard that makes it the only way to change a
-- status (ARCHITECTURE 3.4, 4.9, 4.13). The graph repeats table 4.9 of the architecture as data; the guards of the
-- finite-state machine itself (who, when, which flags) stay in packages/domain.

CREATE TABLE sales.order_transitions (
  from_status text NOT NULL,
  event_type text NOT NULL,
  to_status text NOT NULL,
  PRIMARY KEY (from_status, event_type)
);
--> statement-breakpoint
INSERT INTO sales.order_transitions (from_status, event_type, to_status) VALUES
  ('estimate_draft', 'SEND_ESTIMATE', 'estimate_sent'),
  ('estimate_sent', 'EXPIRE', 'estimate_expired'),
  ('estimate_sent', 'REVISE', 'estimate_draft'),
  ('estimate_expired', 'REVISE', 'estimate_draft'),
  ('estimate_sent', 'ACCEPT', 'accepted'),
  ('estimate_sent', 'PODBOR_DELIVERED', 'podbor_delivered'),
  ('accepted', 'FEE_PREPAID', 'accepted'),
  ('accepted', 'FUNDS_RECEIVED', 'accepted'),
  ('accepted', 'MEETING_DONE', 'accepted'),
  ('accepted', 'START_PURCHASE', 'purchasing'),
  ('purchasing', 'PURCHASE_RECORDED', 'purchasing'),
  ('purchasing', 'PURCHASE_DONE', 'report_due'),
  ('report_due', 'SEND_REPORT', 'report_sent'),
  ('report_sent', 'OBJECTION', 'report_sent'),
  ('report_sent', 'REPORT_ACCEPTED', 'report_sent'),
  ('report_sent', 'REPORT_DEEMED_ACCEPTED', 'report_sent'),
  ('report_sent', 'REMAINDER_SETTLED', 'settled'),
  ('settled', 'MATERIALS_ACCEPTED', 'assembling'),
  ('assembling', 'ASSEMBLED', 'testing'),
  ('testing', 'TESTS_PASSED', 'ready'),
  ('ready', 'DISPATCH', 'delivering'),
  ('delivering', 'HANDOVER', 'handed_over'),
  ('handed_over', 'CLOSE', 'closed'),
  ('cancelling', 'CANCEL_SETTLED', 'cancelled'),
  -- CANCEL: any status before handed_over.
  ('estimate_draft', 'CANCEL', 'cancelling'),
  ('estimate_sent', 'CANCEL', 'cancelling'),
  ('estimate_expired', 'CANCEL', 'cancelling'),
  ('accepted', 'CANCEL', 'cancelling'),
  ('purchasing', 'CANCEL', 'cancelling'),
  ('report_due', 'CANCEL', 'cancelling'),
  ('report_sent', 'CANCEL', 'cancelling'),
  ('settled', 'CANCEL', 'cancelling'),
  ('assembling', 'CANCEL', 'cancelling'),
  ('testing', 'CANCEL', 'cancelling'),
  ('ready', 'CANCEL', 'cancelling'),
  ('delivering', 'CANCEL', 'cancelling');
--> statement-breakpoint
ALTER TABLE sales.order_transitions
  ADD CONSTRAINT order_transitions_from_chk CHECK (from_status IN (
    'estimate_draft', 'estimate_sent', 'estimate_expired', 'accepted', 'purchasing', 'report_due', 'report_sent',
    'settled', 'assembling', 'testing', 'ready', 'delivering', 'handed_over', 'closed', 'podbor_delivered',
    'cancelling', 'cancelled')),
  ADD CONSTRAINT order_transitions_to_chk CHECK (to_status IN (
    'estimate_draft', 'estimate_sent', 'estimate_expired', 'accepted', 'purchasing', 'report_due', 'report_sent',
    'settled', 'assembling', 'testing', 'ready', 'delivering', 'handed_over', 'closed', 'podbor_delivered',
    'cancelling', 'cancelled'));
--> statement-breakpoint
-- The only writer of orders.status. Runs as the migrator; callers need EXECUTE only.
-- One call = one transaction step: status, sales.order_events and ops.audit_log. The service adds ops.outbox rows
-- in the same transaction (ARCHITECTURE 4.13).
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
  v_allowed text[] := ARRAY[
    'fee_prepaid', 'funds_received', 'funds_received_at', 'purchase_not_before', 'first_order_meeting_done',
    'current_quote_id', 'offer_version_uz_id', 'offer_version_ru_id', 'accepted_at', 'report_due_at',
    'objection_until', 'refund_due_at', 'handed_over_at', 'warranty_until', 'podbor_credit_until',
    'cancel', 'documented_losses_sum'];
  -- Money events the assistant never fires (ARCHITECTURE 4.9); second line next to packages/domain.
  v_owner_only text[] := ARRAY[
    'FEE_PREPAID', 'FUNDS_RECEIVED', 'START_PURCHASE', 'REMAINDER_SETTLED', 'HANDOVER', 'CANCEL', 'CANCEL_SETTLED',
    'SEND_ESTIMATE'];
BEGIN
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'invalid_event: the event has no type' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_actor_kind NOT IN ('system', 'customer', 'owner', 'assistant') THEN
    RAISE EXCEPTION 'invalid_actor: %', p_actor_kind USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Who may call at all: the public site acts for customers, the worker for the system.
  IF (session_user = 'nivel_web' AND p_actor_kind <> 'customer')
     OR (session_user = 'nivel_worker' AND p_actor_kind <> 'system')
     OR (p_actor_kind = 'assistant' AND v_type = ANY (v_owner_only)) THEN
    RAISE EXCEPTION 'actor_not_allowed: % as % cannot apply %', session_user, p_actor_kind, v_type
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'unknown_change: % is not a changeable order field', v_key USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  SELECT o.status INTO v_from FROM sales.orders o WHERE o.id = p_order_id FOR UPDATE;
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
          jsonb_build_object('status', v_to, 'event', p_event, 'changes', coalesce(p_changes, '{}'::jsonb)));

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
