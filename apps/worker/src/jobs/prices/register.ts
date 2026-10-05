import type { JobContext } from "../types.ts";

/** Domain "prices" (ARCHITECTURE 9): prices.import.file, prices.import.apply, prices.import.sheet, prices.recompute, prices.stale, prices.scrape. Owner — WP-15. */
export async function register(_ctx: JobContext): Promise<void> {}
