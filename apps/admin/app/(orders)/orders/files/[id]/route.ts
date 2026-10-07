import { serveFile } from "../../../../../src/orders/files.ts";

export const dynamic = "force-dynamic";

/** A registered file of an order (a photo of a receipt, an act, a PDF), for the people who may see the orders. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return serveFile(id);
}
