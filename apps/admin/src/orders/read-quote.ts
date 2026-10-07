// What the editor of the estimate and the form of a purchase need to choose from: the positions of the catalog with their
// market price, the shops, and the lines of the current draft.
import type { Db } from "@nivel/db";
import type { DraftLines } from "./quote-editor.ts";

const num = (v: unknown): number => Number(v ?? 0);
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The lines of the current quote of the order as the editor holds them; an order without a quote has none. */
export async function loadDraftLines(db: Db, orderId: string): Promise<DraftLines> {
  const { rows } = await db.$client.query<{
    product_id: string | null;
    title_snapshot: string;
    category_code: string;
    fee_group: string;
    qty: number;
    unit_market_sum: string;
    customer_owned: boolean;
    purchased_by_ip: boolean;
  }>(
    `select l.product_id, l.title_snapshot, l.category_code, l.fee_group, l.qty, l.unit_market_sum::text as unit_market_sum,
            l.customer_owned, l.purchased_by_ip
       from sales.orders o
       join sales.quote_lines l on l.quote_id = o.current_quote_id
      where o.id = $1
      order by l.id`,
    [orderId],
  );
  const out: DraftLines = { catalog: [], manual: [] };
  for (const r of rows) {
    if (r.product_id !== null) {
      out.catalog.push({ productId: r.product_id, qty: r.qty, customerOwned: r.customer_owned });
    } else {
      out.manual.push({
        title: r.title_snapshot,
        categoryCode: r.category_code as never,
        feeGroup: r.fee_group as never,
        qty: r.qty,
        unitSum: num(r.unit_market_sum),
        ...(r.purchased_by_ip ? {} : { purchasedByIp: false }),
        ...(r.customer_owned ? { customerOwned: true } : {}),
      });
    }
  }
  return out;
}

export interface CatalogChoice {
  id: string;
  category: string;
  title: string;
  /** Whole median of the market price, or the lower bound when the median is not there yet. */
  priceSum: number | null;
  confidence: string | null;
  priceDate: string | null;
  /** Left out of the auto-build: the owner picks it by hand, and the price may be a lower bound only. */
  manualOnly: boolean;
}

/**
 * Verified positions with their current market price; a text narrows by brand, model or category. The positions that
 * are "only by hand" (the auto-build and the assistant skip them) are here: the owner is who picks them.
 */
export async function searchCatalog(db: Db, q: string | undefined, limit = 30): Promise<CatalogChoice[]> {
  const like = q?.trim() ? `%${escapeLike(q.trim())}%` : null;
  const { rows } = await db.$client.query<{
    id: string;
    category_code: string;
    brand: string;
    model: string;
    manual_only: boolean;
    median_sum: string | null;
    from_sum: string | null;
    confidence: string | null;
    as_of: string | null;
  }>(
    `select p.id, p.category_code, p.brand, p.model, p.manual_only, m.median_sum::text as median_sum, m.from_sum::text as from_sum,
            m.confidence, m.as_of::text as as_of
       from catalog.products p
       left join pricing.v_market_price_current m on m.product_id = p.id
      where p.status = 'verified'
        and ($1::text is null or p.brand ilike $1 escape '\\' or p.model ilike $1 escape '\\'
             or p.category_code ilike $1 escape '\\')
      order by p.category_code, p.brand, p.model
      limit $2`,
    [like, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    category: r.category_code,
    title: `${r.brand} ${r.model}`,
    priceSum: r.median_sum !== null ? num(r.median_sum) : r.from_sum !== null ? num(r.from_sum) : null,
    confidence: r.confidence,
    priceDate: r.as_of,
    manualOnly: r.manual_only,
  }));
}

export async function listVendors(db: Db): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.$client.query<{ id: string; name: string }>(
    "select id, name from pricing.vendors where status = 'active' order by name limit 200",
  );
  return rows;
}

export async function listCategories(db: Db): Promise<{ code: string; name: string; feeGroup: string }[]> {
  const { rows } = await db.$client.query<{ code: string; name: { ru?: string }; fee_group_default: string }>(
    "select code, name, fee_group_default from catalog.categories order by sort, code",
  );
  return rows.map((r) => ({ code: r.code, name: r.name?.ru || r.code, feeGroup: r.fee_group_default }));
}
