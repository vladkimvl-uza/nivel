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
