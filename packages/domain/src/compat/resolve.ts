import type { BuildLine, CatalogLookup, CategoryCode, Product, ProductId } from "../catalog/types.ts";
import type { ResolvedBuild } from "./types.ts";

export type Item = { product: Product; qty: number };

export interface Resolution {
  build: ResolvedBuild;
  /** Lines whose product is not in the catalog snapshot. */
  unknown: ProductId[];
}

/** Groups lines by category. Quantity must be a positive integer: anything else is a caller bug, not "missing data". */
export function resolveBuild(lines: readonly BuildLine[], catalog: CatalogLookup): Resolution {
  const byCategory: Partial<Record<CategoryCode, Item[]>> = {};
  const unknown: ProductId[] = [];
  for (const line of lines) {
    if (!Number.isSafeInteger(line.qty) || line.qty < 1) {
      throw new RangeError(`Quantity must be a positive integer, got ${String(line.qty)} for ${line.productId}`);
    }
    const product = catalog.get(line.productId);
    if (!product) {
      if (!unknown.includes(line.productId)) unknown.push(line.productId);
      continue;
    }
    const list = byCategory[product.category];
    if (list) list.push({ product, qty: line.qty });
    else byCategory[product.category] = [{ product, qty: line.qty }];
  }
  return { build: { byCategory }, unknown };
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
