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
