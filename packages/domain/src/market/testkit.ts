// Test helpers for the market module: observation builders on a fixed clock. Not shipped, excluded from coverage.
import type { ProductId } from "../catalog/types.ts";
import { sum } from "../money/index.ts";
import type { PriceObservation } from "./types.ts";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
/** Fixed "now" of all market tests. */
export const NOW = new Date("2026-10-06T10:00:00.000Z");
export const PRODUCT = "prod-rtx-5070" as ProductId;

/** Observation made `ageHours` before NOW; fresh, new, in stock, shop — override anything via `over`. */
export function obs(
  id: string,
  vendorId: string,
  priceSum: number,
  over: Partial<PriceObservation> & { ageHours?: number } = {},
): PriceObservation {
  const { ageHours = 24, ...rest } = over;
  return {
    id,
    productId: PRODUCT,
    vendorId,
    vendorKind: "shop",
    observedAt: new Date(NOW.getTime() - ageHours * HOUR_MS),
    priceSum: sum(priceSum),
    availability: "in_stock",
    condition: "new",
    isFromPrice: false,
    ...rest,
  };
}

/** One fresh offer per vendor "v1", "v2", … with the given prices. */
export function offers(prices: readonly number[], over: Partial<PriceObservation> & { ageHours?: number } = {}) {
  return prices.map((p, i) => obs(`o${String(i + 1)}`, `v${String(i + 1)}`, p, over));
}
