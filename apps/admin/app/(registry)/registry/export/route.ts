import { exportRegistryCsv } from "../../../../src/orders/export.ts";

export const dynamic = "force-dynamic";

/** The registry of the year as a CSV for the accountant. */
export async function GET(request: Request): Promise<Response> {
  return exportRegistryCsv(request);
}
