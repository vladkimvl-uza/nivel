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
-- ---- purchases: limit, funds, receipts (ARCHITECTURE 3.4) ---------------------------------------------------
CREATE FUNCTION sales.guard_purchase() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_limit bigint;
  v_total numeric;
  v_funds numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_id <> OLD.order_id THEN
    RAISE EXCEPTION 'immutable: a purchase never moves to another order' USING ERRCODE = 'check_violation';
  END IF;
  -- Serialise purchases of one order: the sums below must not race.
  PERFORM 1 FROM sales.orders o WHERE o.id = NEW.order_id FOR UPDATE;

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
