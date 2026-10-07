import { handleOrderUpload } from "../../../../src/orders/upload.ts";

export const dynamic = "force-dynamic";

/** Photos of the kinds the orders need (a signed paper act, a statement of a payer): see src/orders/upload.ts. */
export async function POST(request: Request): Promise<Response> {
  return handleOrderUpload(request);
}
