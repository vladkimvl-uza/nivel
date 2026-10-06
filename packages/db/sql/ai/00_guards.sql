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
