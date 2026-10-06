import type { BuildLine, CatalogLookup, CategoryCode, Product, ProductId } from "../catalog/types.ts";
import type { ResolvedBuild } from "./types.ts";

export type Item = { product: Product; qty: number };

export interface Resolution {
  build: ResolvedBuild;
  /** Lines whose product is not in the catalog snapshot. */
  unknown: ProductId[];
}

/** Largest quantity of one product in a build (lines of the same product are summed first). */
export const MAX_LINE_QTY = 99;
/** Largest number of lines in a build or a setup plan. */
export const MAX_LINES = 200;

/**
 * Groups lines by category. Lines of the same product are merged (quantities summed). Anything outside the limits is a
 * caller bug, not "missing data": a non-integer or non-positive quantity, a quantity above MAX_LINE_QTY, more than
 * MAX_LINES lines. The limits keep the work proportional to a small constant: some rules expand a quantity into places
 * (M.2 slots, monitor stands), and the server recomputes builds that clients send.
 */
export function resolveBuild(lines: readonly BuildLine[], catalog: CatalogLookup): Resolution {
  if (lines.length > MAX_LINES) {
    throw new RangeError(`A build holds at most ${MAX_LINES} lines, got ${lines.length}`);
  }
  const qtyById = new Map<ProductId, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.qty) || line.qty < 1) {
      throw new RangeError(`Quantity must be a positive integer, got ${String(line.qty)} for ${line.productId}`);
    }
    const qty = (qtyById.get(line.productId) ?? 0) + line.qty;
    if (qty > MAX_LINE_QTY) {
      throw new RangeError(`Quantity of ${line.productId} must not exceed ${MAX_LINE_QTY}, got ${qty}`);
    }
    qtyById.set(line.productId, qty);
  }
  const byCategory: Partial<Record<CategoryCode, Item[]>> = {};
  const unknown: ProductId[] = [];
  for (const [productId, qty] of qtyById) {
    const product = catalog.get(productId);
    if (!product) {
      unknown.push(productId);
      continue;
    }
    const list = byCategory[product.category];
    if (list) list.push({ product, qty });
    else byCategory[product.category] = [{ product, qty }];
  }
  return { build: { byCategory }, unknown };
}

/** Categories of which a PC holds exactly one part (the rules compare against the first one only). */
const SINGLE_PC_CATEGORIES: readonly CategoryCode[] = ["cpu", "mb", "case", "psu"];

/** A PC has one processor, board, case and PSU; a second part or a quantity above 1 is a caller bug (RangeError). */
export function assertSinglePcParts(b: ResolvedBuild): void {
  for (const category of SINGLE_PC_CATEGORIES) {
    const items = itemsOf(b, category);
    if (items.length > 1 || (items[0] && items[0].qty > 1)) {
      throw new RangeError(`A PC build holds one "${category}" part, got ${totalQty(items)}`);
    }
  }
}

export function itemsOf(b: ResolvedBuild, category: CategoryCode): readonly Item[] {
  return b.byCategory[category] ?? [];
}
export function firstOf(b: ResolvedBuild, category: CategoryCode): Item | undefined {
  return b.byCategory[category]?.[0];
}
export function hasAll(b: ResolvedBuild, ...categories: CategoryCode[]): boolean {
  return categories.every((c) => itemsOf(b, c).length > 0);
}
export function hasAny(b: ResolvedBuild, ...categories: CategoryCode[]): boolean {
  return categories.some((c) => itemsOf(b, c).length > 0);
}
export function totalQty(items: readonly Item[]): number {
  return items.reduce((n, i) => n + i.qty, 0);
}
