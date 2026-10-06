import type { CatalogLookup, CategoryCode, Product, ProductId } from "./types.ts";

/** In-memory catalog over a snapshot of products (the server and the configurator build it from the same snapshot). */
export function createCatalogLookup(products: readonly Product[]): CatalogLookup {
  const byId = new Map<ProductId, Product>();
  const byCat = new Map<CategoryCode, Product[]>();
  for (const p of products) {
    if (byId.has(p.id)) throw new RangeError(`Duplicate product id in catalog: ${p.id}`);
    byId.set(p.id, p);
    const list = byCat.get(p.category);
    if (list) list.push(p);
    else byCat.set(p.category, [p]);
  }
  return {
    get: (id) => byId.get(id),
    byCategory: (c) => byCat.get(c) ?? [],
  };
}
