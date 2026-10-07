import { revalidateTag } from "next/cache";
import { handleRevalidate } from "../../../../src/i18n/site/revalidate.ts";

export const dynamic = "force-dynamic";

// `{ expire: 0 }`: the entry is dropped at once. The soft profile "max" would serve the old price list once more to the first visitor
// after the owner changed the prices.

/**
 * POST /api/internal/revalidate (ARCHITECTURE 5.1, 10.1 A08): the admin panel and the worker drop cache tags of the site. The
 * request is signed (HMAC-SHA256 over "<timestamp>.<body>", header `x-nivel-signature`, fresh within five minutes); Caddy does
 * not let this path out of the internal network (12.2). The rules are in src/i18n/site/revalidate.ts.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRevalidate(request, {
    key: process.env.REVALIDATE_HMAC_KEY,
    now: () => Date.now(),
    revalidate: (tag) => revalidateTag(tag, { expire: 0 }),
  });
}
