-- WP-00 (db rights): the functions and guards the bot, the site and the worker need from the database (requests of
-- WP-07, see docs/arch/DATA-MAP.md sections 2, 6 and 9). The tables and CHECKs of this change are made by the
-- generated migration before this one (src/schema). The base migration wp06_sql is not touched: a function that changes
-- is replaced here (CREATE OR REPLACE keeps its grants), the rest is new.
--
--   sales.apply_transition   ACCEPT moves the current quote to `accepted` in the same transaction
--   sales.expect_payment     expected payments of the bot and the worker, after ACCEPT and CANCEL
--   sales.sign_act           the signature of an act by the button of the bot, for the customer of the order only
--   sales.warranty_fund_state  four aggregates of the warranty fund for the contribution at HANDOVER, for every role
--   sales.purge_expired_leads  the 12-month erasure of requests that did not become an order
--   ops.purge_expired_files  the retention classes of files; returns the storage keys to delete from the disk
--   sales.guard_lead         a request is bound to a customer once, by the admin panel only; its day is never rewritten;
--                            the site and the bot write a request with the day of the database
--   sales.guard_customer     the bot gives a Telegram id to a customer that has none and never changes it afterwards
--   ops.guard_file           the class (never shorter), the id, the day, the kind, the key and the hash of a file are not rewritten
--   search_path              every function of the application schemas pins it (the guards no longer use the operators of the
--                            caller); the application roles lose TEMP on the database
--   sales.guard_quote, sales.guard_payment  let the file purge empty a link to a file that has expired, nothing else

-- ---- the functions do not take the search_path of the caller ------------------------------------------------------
-- A guard is a plain function: the operators it uses (=, <, IS DISTINCT FROM) were looked up in the search_path of
-- whoever ran the statement. The worker may create a schema (pg-boss needs CREATE on the database) and an operator in it,
-- put the schema first in its path and make "x IS DISTINCT FROM y" say "not distinct" for the guard. The same for a
-- temporary table named pg_proc, which ops.in_owner_context read instead of the catalog. So the path is pinned: first the
-- catalog, the temporary schema last. The functions that are written below pin it themselves; the loop at the end of the
-- file pins the rest (the base migration is not touched), and the test of packages/db fails for a function without it.
CREATE OR REPLACE FUNCTION ops.in_owner_context(p_flag text, p_owner_of regproc) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(pg_catalog.current_setting(p_flag, true), '') = 'on'
     AND current_user = (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = p_owner_of)
$$;
--> statement-breakpoint
-- ---- the file purge may empty the link of a document to an expired file -----------------------------------------
-- The quotes are immutable after `sent` and the payments are a journal, yet a PDF or a statement that has outlived its
-- retention class must leave the database. Only ops.purge_expired_files() (the flag is set inside it and the caller is
-- the owner of that function, see ops.in_owner_context) may do it, and only by setting a link to NULL.
CREATE OR REPLACE FUNCTION sales.guard_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_movable text[] := ARRAY['status', 'accepted_at', 'acceptance', 'pdf_uz_file_id', 'pdf_ru_file_id'];
BEGIN
  IF TG_OP = 'UPDATE'
     AND ops.in_owner_context('nivel.files_purge', 'ops.purge_expired_files'::regproc)
     AND (to_jsonb(NEW) - ARRAY['pdf_uz_file_id', 'pdf_ru_file_id']) = (to_jsonb(OLD) - ARRAY['pdf_uz_file_id', 'pdf_ru_file_id'])
     AND (NEW.pdf_uz_file_id IS NULL OR NEW.pdf_uz_file_id = OLD.pdf_uz_file_id)
     AND (NEW.pdf_ru_file_id IS NULL OR NEW.pdf_ru_file_id = OLD.pdf_ru_file_id) THEN
    RETURN NEW;
  END IF;
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
CREATE OR REPLACE FUNCTION sales.guard_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_confirmable text[] := ARRAY[
    'status', 'fiscal_receipt_no', 'bank_doc_no', 'payer_is_customer', 'third_party_statement_file_id',
    'occurred_at', 'confirmed_by', 'confirmed_at'];
BEGIN
  IF TG_OP = 'UPDATE'
     AND ops.in_owner_context('nivel.files_purge', 'ops.purge_expired_files'::regproc)
     AND (to_jsonb(NEW) - 'third_party_statement_file_id') = (to_jsonb(OLD) - 'third_party_statement_file_id')
     AND NEW.third_party_statement_file_id IS NULL THEN
    RETURN NEW;
  END IF;
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
-- ---- ACCEPT also accepts the quote ----------------------------------------------------------------------------------
-- The site and the bot may not UPDATE sales.quotes, so the quote stayed `sent` when the customer accepted through them.
-- Now the function that moves the order moves its current quote in the same transaction: with the time the order got,
-- and the acceptance of the event (channel, consents), the offer versions fixed on the order, the actor and the role of
-- the database. A quote that is not `sent` (a draft the owner never marked, an expired one) is left as it is: the status
-- machine of packages/domain decides what may be accepted, the function only records it. An event that names a quote
-- (`quoteId`) must name the current one.
CREATE OR REPLACE FUNCTION sales.apply_transition(
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
  v_quote_id uuid;
  v_accepted_at timestamptz;
  v_offer_uz uuid;
  v_offer_ru uuid;
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
  -- The customer accepts the quote of the order as it stands now: an event that names another quote is a stale click.
  IF v_type = 'ACCEPT' AND p_event ? 'quoteId' AND (p_event ->> 'quoteId') IS DISTINCT FROM (v_row ->> 'current_quote_id') THEN
    RAISE EXCEPTION 'invalid_transition: ACCEPT names the quote % but the current quote of the order is %',
      p_event ->> 'quoteId', coalesce(v_row ->> 'current_quote_id', 'none') USING ERRCODE = 'check_violation';
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

  IF v_type = 'ACCEPT' THEN
    SELECT o.current_quote_id, o.accepted_at, o.offer_version_uz_id, o.offer_version_ru_id
      INTO v_quote_id, v_accepted_at, v_offer_uz, v_offer_ru FROM sales.orders o WHERE o.id = p_order_id;
    UPDATE sales.quotes q SET
      status = 'accepted',
      accepted_at = coalesce(v_accepted_at, now()),
      acceptance = jsonb_build_object(
        'channel', p_event -> 'channel',
        'consentIds', p_event -> 'consentIds',
        'offerVersionUzId', v_offer_uz,
        'offerVersionRuId', v_offer_ru,
        'actorId', p_actor_id,
        'dbRole', session_user::text)
    WHERE q.id = v_quote_id AND q.status = 'sent';
  END IF;

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
-- ---- expected payments of the bot and the worker -------------------------------------------------------------------
-- After ACCEPT (the advance, the money for the purchases) and CANCEL (the refunds, the extra fee) somebody must expect
-- the payments. Only the admin role writes sales.payments; the bot acts for the owner in the group and the worker
-- handles the jobs the site queued, so both need a narrow door. The door checks the pair of the kind, the way and the
-- direction as the domain does (packages/domain validatePayment), a positive sum, the order and a repeat. It does NOT
-- know the amount of the quote: the caller computes it with the domain from the data of the database. The site has no
-- right to call it at all: its payload is a hint for the worker, never a payment. A payment is only an expectation: it
-- becomes money when the owner confirms it with the receipt or the bank document.
CREATE FUNCTION sales.expect_payment(
  p_order_id uuid,
  p_kind text,
  p_amount_sum bigint,
  p_method text DEFAULT NULL,
  p_payer_is_customer boolean DEFAULT true
) RETURNS TABLE (out_payment_id uuid, out_duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_direction text;
  v_methods text[];
  v_method text;
  v_once boolean;
  v_id uuid;
BEGIN
  IF p_kind IS NULL THEN
    RAISE EXCEPTION 'invalid_payment: no payment kind' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The pairs of the domain: the fee through the QR (or the card of the merchant) with a receipt, the money for the
  -- purchases only by transfer to the account of the sole proprietor, every refund as an outgoing transfer.
  IF p_kind IN ('fee_advance', 'fee_final', 'fee_extra', 'podbor_fee') THEN
    v_direction := 'in';
    v_methods := ARRAY['xolis_qr', 'merchant_card'];
  ELSIF p_kind IN ('purchase_funds', 'purchase_topup') THEN
    v_direction := 'in';
    v_methods := ARRAY['bank_transfer_ip'];
  ELSIF p_kind IN ('remainder_refund', 'fee_refund', 'funds_refund') THEN
    v_direction := 'out';
    v_methods := ARRAY['bank_transfer_out'];
  ELSE
    RAISE EXCEPTION 'invalid_payment: % is not a payment kind', p_kind USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_method := coalesce(p_method, v_methods[1]);
  IF NOT (v_method = ANY (v_methods)) THEN
    RAISE EXCEPTION 'invalid_payment: % is not paid by "%" (allowed: %)', p_kind, v_method, v_methods
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The sums of the system are whole numbers a JavaScript number reads without loss (ARCHITECTURE 3.1).
  IF p_amount_sum IS NULL OR p_amount_sum <= 0 OR p_amount_sum > 9007199254740991 THEN
    RAISE EXCEPTION 'invalid_payment: the sum of % must be a positive whole number of sums up to 9007199254740991, got %', p_kind, coalesce(p_amount_sum::text, 'none')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_payer_is_customer IS NULL THEN
    RAISE EXCEPTION 'invalid_payment: payer_is_customer is true or false' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The lock serialises two requests about one order: the second one finds the expectation of the first.
  PERFORM 1 FROM sales.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found: %', coalesce(p_order_id::text, 'no order') USING ERRCODE = 'no_data_found';
  END IF;
  -- The payments the quote fixes are expected once: an expectation that is open, or a payment that was made and not
  -- taken back, stands. The other kinds (a second top-up, a second refund of one sum) repeat when the earlier one is
  -- done, so only an open expectation counts for them.
  v_once := p_kind IN ('fee_advance', 'fee_final', 'purchase_funds', 'podbor_fee');
  SELECT p.id INTO v_id FROM sales.payments p
   WHERE p.order_id = p_order_id AND p.kind = p_kind AND p.amount_sum = p_amount_sum AND p.reversal_of IS NULL
     AND (p.status = 'expected'
          OR (v_once AND p.status = 'confirmed'
              AND p.amount_sum + coalesce((SELECT sum(r.amount_sum) FROM sales.payments r
                                            WHERE r.reversal_of = p.id AND r.status = 'confirmed'), 0) > 0))
   ORDER BY p.created_at, p.id LIMIT 1;
  IF FOUND THEN
    out_payment_id := v_id;
    out_duplicate := true;
    RETURN NEXT;
    RETURN;
  END IF;
  -- The sum of such a payment is one sum of the quote: an open expectation of another sum is a conflict (the quote changed
  -- or the caller is wrong) that the owner voids first, not a second row for the customer to see beside the first.
  IF v_once AND EXISTS (SELECT 1 FROM sales.payments p
                         WHERE p.order_id = p_order_id AND p.kind = p_kind AND p.status = 'expected'
                           AND p.reversal_of IS NULL AND p.amount_sum <> p_amount_sum) THEN
    RAISE EXCEPTION 'invalid_payment: % is already expected for another sum of the order', p_kind
      USING ERRCODE = 'invalid_parameter_value', HINT = 'Void the open expectation first.';
  END IF;
  INSERT INTO sales.payments (order_id, kind, direction, method, amount_sum, status, payer_is_customer)
  VALUES (p_order_id, p_kind, v_direction, v_method, p_amount_sum, 'expected', p_payer_is_customer)
  RETURNING id INTO v_id;
  INSERT INTO ops.audit_log (actor, action, entity, entity_id, after)
  VALUES ('db:' || session_user, 'payment.expect', 'sales.payments', v_id::text,
          jsonb_build_object('orderId', p_order_id, 'kind', p_kind, 'amountSum', p_amount_sum,
                             'db_role', session_user::text));
  out_payment_id := v_id;
  out_duplicate := false;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
-- ---- the signature of an act by the button of the bot ---------------------------------------------------------------
-- The bot cannot write acts; the press of the button of the customer is the one signature that arrives through it. The
-- press proves itself with the Telegram id of the person and the id of the message with the button, and it counts only
-- when that Telegram id is the one of the customer of the order of the act. The check catches the mistakes of the code
-- of the bot (a press of another person, of another order) and leaves a trace (the role of the database in the audit
-- row); it is NOT a defence against whoever holds the credentials of the bot: the bot reads the Telegram id of every
-- customer and names it itself. Two things limit that: the bot cannot change a Telegram id once a customer has one
-- (sales.guard_customer), and the act is signed once. The act is signed once; the time is the clock of the database.
-- Only the two facts of the press are kept, never the other words of the caller.
CREATE FUNCTION sales.sign_act(p_act_id uuid, p_via text, p_evidence jsonb) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_order uuid;
  v_signed timestamptz;
  v_customer uuid;
  v_telegram bigint;
  v_at timestamptz := clock_timestamp();
BEGIN
  IF p_via IS DISTINCT FROM 'tg_button' THEN
    RAISE EXCEPTION 'invalid_evidence: the bot signs only by the button (tg_button), not by %', coalesce(p_via, 'nothing')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object'
     OR jsonb_typeof(p_evidence -> 'messageId') IS DISTINCT FROM 'number'
     OR (p_evidence ->> 'messageId') !~ '^[1-9][0-9]{0,17}$'
     OR jsonb_typeof(p_evidence -> 'telegramUserId') IS DISTINCT FROM 'number'
     OR (p_evidence ->> 'telegramUserId') !~ '^[1-9][0-9]{0,17}$' THEN
    RAISE EXCEPTION 'invalid_evidence: the press needs the id of the message (messageId) and the Telegram id of the person (telegramUserId), whole positive numbers'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT a.order_id, a.signed_at INTO v_order, v_signed FROM sales.acts a WHERE a.id = p_act_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'act_not_found: %', coalesce(p_act_id::text, 'no act') USING ERRCODE = 'no_data_found';
  END IF;
  IF v_signed IS NOT NULL THEN
    RAISE EXCEPTION 'act_already_signed: the act was signed at %', v_signed USING ERRCODE = 'check_violation';
  END IF;
  SELECT o.customer_id, c.telegram_user_id INTO v_customer, v_telegram
    FROM sales.orders o JOIN sales.customers c ON c.id = o.customer_id WHERE o.id = v_order;
  IF v_telegram IS NULL OR v_telegram::text <> (p_evidence ->> 'telegramUserId') THEN
    RAISE EXCEPTION 'evidence_mismatch: the press is not the press of the customer of the order of the act'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE sales.acts a SET
    signed_at = v_at,
    signed_via = 'tg_button',
    evidence = jsonb_build_object('messageId', p_evidence -> 'messageId', 'telegramUserId', p_evidence -> 'telegramUserId')
  WHERE a.id = p_act_id;
  INSERT INTO ops.audit_log (actor, action, entity, entity_id, after)
  VALUES ('customer:' || v_customer::text, 'act.sign', 'sales.acts', p_act_id::text,
          jsonb_build_object('orderId', v_order, 'via', 'tg_button', 'db_role', session_user::text));
  RETURN v_at;
END
$$;
--> statement-breakpoint
-- ---- the state of the warranty fund, for every role ----------------------------------------------------------------
-- The contribution at HANDOVER depends on the fund (2 % until it has 10 million and 30 closed orders, then 1 %). The
-- site and the bot cannot read the ledger, the orders or the cases, and a contribution computed from a fund they could
-- not see always used the rate of a young fund. The function answers the four aggregates the domain needs, never a
-- row of a register: the balance of the warranty fund, the orders closed, the losses paid from the fund and the
-- purchases of the last 12 months (their ratio is the losses in basis points, counted by packages/domain). A moment
-- later than the clock of the database is not taken. The site and the bot read the present only: the contribution is
-- computed at HANDOVER, now, and a moment they could choose would let them find the single entries of the registers by
-- asking the same question for two close moments. The admin panel and the worker, which read the registers anyway, may
-- ask about the past (tests, the closing check).
CREATE FUNCTION sales.warranty_fund_state(p_now timestamptz DEFAULT now())
RETURNS TABLE (out_balance bigint, out_closed_orders integer, out_losses_12m bigint, out_purchased_12m bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := CASE WHEN session_user IN ('nivel_web', 'nivel_bot') THEN now()
                            ELSE least(coalesce(p_now, now()), now()) END;
  v_since timestamptz;
BEGIN
  v_since := v_now - interval '12 months';
  out_balance := coalesce((SELECT sum(l.amount_sum) FROM sales.reserve_ledger l WHERE l.fund = 'warranty' AND l.at <= v_now), 0)::bigint;
  out_closed_orders := (SELECT count(DISTINCT e.order_id) FROM sales.order_events e WHERE e.to_status = 'closed' AND e.at <= v_now)::integer;
  out_losses_12m := coalesce((SELECT sum(w.cost_from_reserve_sum) FROM sales.warranty_cases w
                               WHERE w.opened_at > v_since AND w.opened_at <= v_now), 0)::bigint;
  out_purchased_12m := coalesce((SELECT sum(pu.amount_sum) FROM sales.purchases pu
                                  WHERE pu.bought_at > v_since AND pu.bought_at <= v_now), 0)::bigint;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
-- ---- a request is bound to a customer once, by the admin panel ---------------------------------------------------------
-- The site cannot link a request to a customer it cannot read (it keeps the contact in the request). The owner merges
-- them by hand in the admin panel: customer_id goes from NULL to a customer, once. The bot may update a request (its
-- status, the first answer) but never its customer; the worker cannot update requests at all. The day of a request
-- (created_at) is the start of its 12 months (sales.purge_expired_leads) and is never rewritten by a role of the
-- application: the bot can update its requests, and a day it could move would make any request due, or never due.
-- The same holds at INSERT, where the site and the bot would write the day themselves: they get the day of the database
-- (a request dated in the past would make its customer due for the erasure at once), and open the request as `new`.
-- The site may name only a customer it made in the same transaction (it reads the ids of all customers and could attach
-- a request to anyone: to erase him with an old day, or to keep him alive with a fresh one). The bot finds the customer
-- by his Telegram id or phone and names him: that is its work, the same trust as sales.sign_act.
CREATE FUNCTION sales.guard_lead() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF session_user IN ('nivel_web', 'nivel_bot') THEN
      NEW.created_at := now();
      IF NEW.status IS DISTINCT FROM 'new' THEN
        RAISE EXCEPTION 'actor_not_allowed: % opens a request as new, not as %', session_user, NEW.status
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF session_user = 'nivel_web' AND NEW.customer_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM sales.customers c WHERE c.id = NEW.customer_id AND c.created_at = now()) THEN
        RAISE EXCEPTION 'actor_not_allowed: % may name only a customer it made in the same transaction', session_user
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at AND session_user <> 'nivel_migrator' THEN
    RAISE EXCEPTION 'immutable: the day of request % is written once', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    IF OLD.customer_id IS NOT NULL THEN
      RAISE EXCEPTION 'immutable: the customer of request % is bound once and never changes', OLD.number
        USING ERRCODE = 'check_violation';
    END IF;
    IF session_user NOT IN ('nivel_admin', 'nivel_migrator') THEN
      RAISE EXCEPTION 'actor_not_allowed: % cannot bind a request to a customer', session_user
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER leads_guard BEFORE INSERT OR UPDATE ON sales.leads
  FOR EACH ROW EXECUTE FUNCTION sales.guard_lead();
--> statement-breakpoint
-- ---- the Telegram id of a customer is given once ---------------------------------------------------------------------
-- sales.sign_act() trusts the press of a button when its Telegram id is the one of the customer, and the bot may update
-- customers (the name, the language, the first contact). So the bot gives a Telegram id to a customer that has none and
-- never changes or clears it: whoever holds the credentials of the bot cannot make a customer "be" another person to
-- sign an act in his name. The erasure of a customer clears the id as the worker or the admin panel (not as the bot).
CREATE FUNCTION sales.guard_customer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF session_user = 'nivel_bot' AND OLD.telegram_user_id IS NOT NULL
     AND NEW.telegram_user_id IS DISTINCT FROM OLD.telegram_user_id THEN
    RAISE EXCEPTION 'immutable: the Telegram id of customer % is given once and the bot does not change it', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER customers_guard BEFORE UPDATE ON sales.customers
  FOR EACH ROW EXECUTE FUNCTION sales.guard_customer();
--> statement-breakpoint
-- ---- what decides the retention of a file is not rewritten ----------------------------------------------------------
-- ops.purge_expired_files() judges a file by its class and its day and then removes links of journals that nobody else
-- may touch. The worker and the admin panel write ops.files (they register the files), so the inputs of the decision
-- must not be theirs to change: the class may be lengthened (a lead file that becomes a document of an order, a file
-- that is published) and never shortened; the id, the day, the kind, the key and the hash are written once. The migrator
-- (fixtures, repairs by hand) is not bound.
CREATE FUNCTION ops.guard_file() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_rank jsonb := '{"ai_90d": 1, "lead_12m": 2, "order_warranty_plus_3y": 3, "tax_5y": 3, "media": 4}';
BEGIN
  IF session_user = 'nivel_migrator' THEN
    RETURN NEW;
  END IF;
  -- The id too: the files that a JSON of an order names (the evidence of a paper act, the photos of a passport) are
  -- linked by it alone, with no foreign key, so a file with a new id would be judged by its class and not by the order.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key OR NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    RAISE EXCEPTION 'immutable: the id, the day, the kind, the storage key and the hash of a file are written once'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (v_rank ->> NEW.retention_class)::integer < (v_rank ->> OLD.retention_class)::integer THEN
    RAISE EXCEPTION 'immutable: the retention class of a file may be lengthened, never shortened (% -> %)',
      OLD.retention_class, NEW.retention_class USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER files_guard BEFORE UPDATE ON ops.files
  FOR EACH ROW EXECUTE FUNCTION ops.guard_file();
--> statement-breakpoint
-- ---- the 12-month erasure of requests ---------------------------------------------------------------------------------
-- A request that did not become an order is kept 12 months (DATA-MAP 9). After that the personal data of the request
-- and of its customer are erased; the request itself stays as a number, a scope and a budget band for the statistics.
--  - a request older than 12 months with no order: its comment and its contact (phone, name, Telegram name) are cleared;
--  - the customer of such a request is made anonymous (erased_at; name, phone, Telegram id and name, address cleared;
--    the passport secret and the subscriptions of that Telegram id removed) when he has no order, no request younger than
--    12 months, no configuration younger than 12 months and no consent younger than 12 months (whoever is active in the
--    bot or on the site has given one: an old request merged by hand into a customer who came last week must not erase
--    that customer).
-- The journals are not touched: consents and audit rows keep the id of the customer, which says nothing without the row.
-- Returns the number of requests it cleaned (their own data or their customer's). The moment is never later than the
-- clock of the database; an earlier one is a dry run of the past (tests).
CREATE FUNCTION sales.purge_expired_leads(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := least(coalesce(p_now, now()), now());
  v_cut timestamptz := least(coalesce(p_now, now()), now()) - interval '12 months';
  v_customers uuid[];
  v_telegram bigint[];
  v_leads integer;
  v_erased integer := 0;
  v_pass integer;
BEGIN
  -- Two passes. The first one picks the candidates; they are locked (an order, a request or a consent being written for a
  -- customer holds a share of his row, so the lock waits for it); the second judges the same customers again, with what
  -- has been committed meanwhile. A customer who got an order between the two is not erased.
  FOR v_pass IN 1..2 LOOP
    SELECT coalesce(array_agg(c.id ORDER BY c.id), ARRAY[]::uuid[]),
           coalesce(array_agg(c.telegram_user_id) FILTER (WHERE c.telegram_user_id IS NOT NULL), ARRAY[]::bigint[])
      INTO v_customers, v_telegram
      FROM sales.customers c
     WHERE (v_pass = 1 OR c.id = ANY (v_customers))
       AND c.erased_at IS NULL
       AND EXISTS (SELECT 1 FROM sales.leads l
                    WHERE l.customer_id = c.id AND l.created_at <= v_cut
                      AND NOT EXISTS (SELECT 1 FROM sales.orders o WHERE o.lead_id = l.id))
       AND NOT EXISTS (SELECT 1 FROM sales.orders o WHERE o.customer_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM sales.leads l
                        WHERE l.customer_id = c.id
                          AND (l.created_at > v_cut OR EXISTS (SELECT 1 FROM sales.orders o WHERE o.lead_id = l.id)))
       AND NOT EXISTS (SELECT 1 FROM sales.configurations cf WHERE cf.customer_id = c.id AND cf.created_at > v_cut)
       AND NOT EXISTS (SELECT 1 FROM ops.consents k WHERE k.customer_id = c.id AND k.at > v_cut);
    IF v_pass = 1 THEN
      PERFORM 1 FROM sales.customers c WHERE c.id = ANY (v_customers) ORDER BY c.id FOR UPDATE;
    END IF;
  END LOOP;

  WITH due AS (
    SELECT l.id, l.customer_id FROM sales.leads l
     WHERE l.created_at <= v_cut AND NOT EXISTS (SELECT 1 FROM sales.orders o WHERE o.lead_id = l.id)
  ), cleared AS (
    UPDATE sales.leads l
       SET comment = NULL, contact_phone = NULL, contact_name = NULL, contact_username = NULL
      FROM due
     WHERE l.id = due.id
       AND (l.comment IS NOT NULL OR l.contact_phone IS NOT NULL OR l.contact_name IS NOT NULL
            OR l.contact_username IS NOT NULL)
    RETURNING l.id
  )
  SELECT count(*)::integer INTO v_leads FROM due
   WHERE due.id IN (SELECT cleared.id FROM cleared) OR due.customer_id = ANY (v_customers);

  IF cardinality(v_customers) > 0 THEN
    UPDATE sales.customers c
       SET display_name = NULL, phone_e164 = NULL, telegram_user_id = NULL, telegram_username = NULL, address = NULL,
           erased_at = now()
     WHERE c.id = ANY (v_customers);
    GET DIAGNOSTICS v_erased = ROW_COUNT;
    DELETE FROM sales.customer_secrets s WHERE s.customer_id = ANY (v_customers);
    DELETE FROM bot.subscriptions b WHERE b.telegram_user_id = ANY (v_telegram);
  END IF;

  IF v_leads > 0 OR v_erased > 0 THEN
    INSERT INTO ops.audit_log (actor, action, entity, after)
    VALUES ('db:' || session_user, 'retention.purge_leads', 'sales.leads',
            jsonb_build_object('leads', v_leads, 'customers', v_erased, 'asOf', v_now, 'db_role', session_user::text));
  END IF;
  RETURN v_leads;
END
$$;
--> statement-breakpoint
-- ---- the retention classes of files -----------------------------------------------------------------------------------
-- ops.files.retention_class decides how long the row and the bytes stay (DATA-MAP 9):
--  - lead_12m: 12 months from the day of the file; ai_90d: 90 days; media: for good;
--  - order_warranty_plus_3y and tax_5y: 5 years from the day of the file;
--  - whatever the class says, a file that a document of an order names (by a column, or by an id inside the JSON of the
--    order: the passport photos, the evidence of a paper act, a claim to a shop) lives until the end of the longest
--    warranty of that order (ours and the shops') plus 3 years, and never less than 5 years from its day. An order that
--    has no warranty yet (it is going on) waits; one that ended without a warranty (cancelled, a Podbor) does not. A
--    wrong class, written by whoever, never shortens the life of a receipt.
-- The rows go and the function returns their storage keys, so that the worker removes the bytes from the disk. The links
-- of the documents to a file that goes are emptied first (the quotes, the payments, the reports, the acts, the passports,
-- the DSR results; the rows of purchase_files are removed): the documents stay, only the file is gone. A file that the
-- catalog, the content (a picture, a frame of the hero scene, a photo of the portfolio) or the price lists still use is
-- skipped, so the purge never fails on a link it does not know. The caller removes the bytes inside the same transaction,
-- before the commit (repos/ops.ts purgeExpiredFilesAndRemoveBytes): if the disk fails, the rows come back and the keys
-- are not lost. The moment is never later than the clock of the database.
CREATE FUNCTION ops.purge_expired_files(p_now timestamptz DEFAULT now()) RETURNS TABLE (storage_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now timestamptz := least(coalesce(p_now, now()), now());
  v_ids uuid[];
BEGIN
  WITH links AS MATERIALIZED (
    -- The documents of an order name their files by a column ...
    SELECT q.order_id, x.file_id FROM sales.quotes q,
           LATERAL (VALUES (q.pdf_uz_file_id), (q.pdf_ru_file_id)) AS x (file_id) WHERE x.file_id IS NOT NULL
    UNION ALL
    SELECT p.order_id, p.third_party_statement_file_id FROM sales.payments p
     WHERE p.third_party_statement_file_id IS NOT NULL
    UNION ALL
    SELECT pu.order_id, pf.file_id FROM sales.purchase_files pf JOIN sales.purchases pu ON pu.id = pf.purchase_id
    UNION ALL
    SELECT r.order_id, x.file_id FROM sales.commission_reports r,
           LATERAL (VALUES (r.pdf_uz_file_id), (r.pdf_ru_file_id)) AS x (file_id) WHERE x.file_id IS NOT NULL
    UNION ALL
    SELECT a.order_id, x.file_id FROM sales.acts a,
           LATERAL (VALUES (a.pdf_uz_file_id), (a.pdf_ru_file_id)) AS x (file_id) WHERE x.file_id IS NOT NULL
    UNION ALL
    SELECT b.order_id, x.file_id FROM sales.build_passports b,
           LATERAL (VALUES (b.pdf_uz_file_id), (b.pdf_ru_file_id)) AS x (file_id) WHERE x.file_id IS NOT NULL
    -- ... and by an id inside the free JSON of the order (the photos of the passport and of the seals, the evidence of a
    -- paper act, the pictures of a purchase, a claim to a shop). Every text of the shape of an id counts, in any case:
    -- a text that only looks like one keeps a file longer, never shorter.
    UNION ALL
    SELECT j.order_id, lower(m[1])::uuid FROM (
      SELECT pu.order_id, concat_ws(' ', pu.authenticity::text) AS doc FROM sales.purchases pu
      UNION ALL SELECT r.order_id, concat_ws(' ', r.lines::text, r.objection::text) FROM sales.commission_reports r
      UNION ALL SELECT a.order_id, concat_ws(' ', a.lines::text, a.evidence::text) FROM sales.acts a
      UNION ALL SELECT b.order_id, concat_ws(' ', b.serials::text, b.tests::text, b.photos::text, b.seal_photos::text)
                  FROM sales.build_passports b
      UNION ALL SELECT w.order_id, concat_ws(' ', w.vendor_claim::text) FROM sales.warranty_cases w
    ) j, LATERAL regexp_matches(j.doc, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'g') AS m
  ), ends AS MATERIALIZED (
    SELECT o.id, o.status,
           greatest(o.warranty_until,
                    (SELECT max(pu.vendor_warranty_until) FROM sales.purchases pu WHERE pu.order_id = o.id)::timestamptz)
             AS warranty_end
      FROM sales.orders o
  )
  SELECT coalesce(array_agg(f.id), ARRAY[]::uuid[]) INTO v_ids
    FROM ops.files f
   WHERE f.retention_class IN ('lead_12m', 'ai_90d', 'order_warranty_plus_3y', 'tax_5y')
     AND CASE
           -- A file that a document of an order names lives as long as the order says, whatever its class: not less than
           -- 5 years from its day, and until the end of the warranty plus 3 years. A wrong class never shortens it.
           WHEN EXISTS (SELECT 1 FROM links l WHERE l.file_id = f.id) THEN
             f.created_at <= v_now - interval '5 years'
             AND NOT EXISTS (
               SELECT 1 FROM links l JOIN ends e ON e.id = l.order_id
                WHERE l.file_id = f.id
                  AND ((e.warranty_end IS NULL AND e.status NOT IN ('cancelled', 'closed', 'podbor_delivered'))
                       OR e.warranty_end + interval '3 years' > v_now))
           -- A file no order names goes by its own class.
           ELSE f.created_at <= v_now - CASE f.retention_class
                                          WHEN 'lead_12m' THEN interval '12 months'
                                          WHEN 'ai_90d' THEN interval '90 days'
                                          ELSE interval '5 years' END
         END
     AND NOT EXISTS (SELECT 1 FROM catalog.products x WHERE x.image_file_id = f.id)
     AND NOT EXISTS (SELECT 1 FROM content.idea_posts x WHERE x.permission_file_id = f.id)
     AND NOT EXISTS (SELECT 1 FROM content.hero_scene x
                      WHERE f.id IN (x.poster_file_id, x.video_720_file_id, x.video_1080_file_id, x.video_vertical_file_id)
                         OR position(f.id::text IN lower(x.frames::text)) > 0)
     AND NOT EXISTS (SELECT 1 FROM content.portfolio_items x WHERE position(f.id::text IN lower(x.photos::text)) > 0)
     AND NOT EXISTS (SELECT 1 FROM pricing.vendors x WHERE x.agreement_file_id = f.id)
     AND NOT EXISTS (SELECT 1 FROM pricing.price_imports x WHERE x.file_id = f.id);

  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  PERFORM set_config('nivel.files_purge', 'on', true);
  UPDATE sales.quotes q SET
    pdf_uz_file_id = CASE WHEN q.pdf_uz_file_id = ANY (v_ids) THEN NULL ELSE q.pdf_uz_file_id END,
    pdf_ru_file_id = CASE WHEN q.pdf_ru_file_id = ANY (v_ids) THEN NULL ELSE q.pdf_ru_file_id END
  WHERE q.pdf_uz_file_id = ANY (v_ids) OR q.pdf_ru_file_id = ANY (v_ids);
  UPDATE sales.payments p SET third_party_statement_file_id = NULL WHERE p.third_party_statement_file_id = ANY (v_ids);
  PERFORM set_config('nivel.files_purge', 'off', true);
  UPDATE sales.commission_reports r SET
    pdf_uz_file_id = CASE WHEN r.pdf_uz_file_id = ANY (v_ids) THEN NULL ELSE r.pdf_uz_file_id END,
    pdf_ru_file_id = CASE WHEN r.pdf_ru_file_id = ANY (v_ids) THEN NULL ELSE r.pdf_ru_file_id END
  WHERE r.pdf_uz_file_id = ANY (v_ids) OR r.pdf_ru_file_id = ANY (v_ids);
  UPDATE sales.acts a SET
    pdf_uz_file_id = CASE WHEN a.pdf_uz_file_id = ANY (v_ids) THEN NULL ELSE a.pdf_uz_file_id END,
    pdf_ru_file_id = CASE WHEN a.pdf_ru_file_id = ANY (v_ids) THEN NULL ELSE a.pdf_ru_file_id END
  WHERE a.pdf_uz_file_id = ANY (v_ids) OR a.pdf_ru_file_id = ANY (v_ids);
  UPDATE sales.build_passports b SET
    pdf_uz_file_id = CASE WHEN b.pdf_uz_file_id = ANY (v_ids) THEN NULL ELSE b.pdf_uz_file_id END,
    pdf_ru_file_id = CASE WHEN b.pdf_ru_file_id = ANY (v_ids) THEN NULL ELSE b.pdf_ru_file_id END
  WHERE b.pdf_uz_file_id = ANY (v_ids) OR b.pdf_ru_file_id = ANY (v_ids);
  UPDATE ops.dsr_requests d SET result_file_id = NULL WHERE d.result_file_id = ANY (v_ids);
  DELETE FROM sales.purchase_files pf WHERE pf.file_id = ANY (v_ids);

  INSERT INTO ops.audit_log (actor, action, entity, after)
  VALUES ('db:' || session_user, 'retention.purge_files', 'ops.files',
          jsonb_build_object('files', cardinality(v_ids), 'asOf', v_now, 'db_role', session_user::text));

  RETURN QUERY
    WITH gone AS (DELETE FROM ops.files f WHERE f.id = ANY (v_ids) RETURNING f.storage_key)
    SELECT g.storage_key FROM gone g;
END
$$;
--> statement-breakpoint
-- ---- the rest of the functions pin the search_path, and nobody makes a temporary table ---------------------------------
-- The functions of the base migration (the triggers of the journals, the guards of the orders, the CHECK helpers of the
-- catalog) were made without it. ALTER keeps their bodies and their rights. Functions of an extension are not ours.
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('ops', 'catalog', 'pricing', 'sales', 'content', 'ai', 'bot') AND p.prokind = 'f'
       AND NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false)
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, pg_temp', f);
  END LOOP;
END
$$;
--> statement-breakpoint
-- The temporary schema is searched before the catalog for tables: a role that could make one named like a catalog table
-- would stand in for it in every query that does not name the schema. The application has no temporary table.
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$$;
--> statement-breakpoint
-- ---- rights ---------------------------------------------------------------------------------------------------------
-- The bot and the worker expect payments; the site queues a job and cannot call it. The admin panel writes the table.
GRANT EXECUTE ON FUNCTION sales.expect_payment(uuid, text, bigint, text, boolean) TO nivel_worker, nivel_bot;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION sales.sign_act(uuid, text, jsonb) TO nivel_bot;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION sales.warranty_fund_state(timestamptz) TO nivel_web, nivel_admin, nivel_bot, nivel_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION sales.purge_expired_leads(timestamptz), ops.purge_expired_files(timestamptz)
  TO nivel_admin, nivel_worker;
