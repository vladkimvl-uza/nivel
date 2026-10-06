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
