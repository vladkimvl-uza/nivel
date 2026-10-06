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
-- Public numbers: L-2026-0001, NV-2026-0001, G-2026-0001. Gap-free inside the caller's transaction.
CREATE FUNCTION ops.next_number(p_kind text, p_year integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v integer;
BEGIN
  IF p_kind NOT IN ('L', 'NV', 'G') THEN
    RAISE EXCEPTION 'unknown_number_kind: %', p_kind USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO ops.number_counters AS c (kind, year, last_value) VALUES (p_kind, p_year, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = c.last_value + 1
  RETURNING c.last_value INTO v;
  RETURN p_kind || '-' || p_year::text || '-' || lpad(v::text, 4, '0');
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
