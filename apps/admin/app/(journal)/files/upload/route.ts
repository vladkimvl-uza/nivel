import { handleUploadRequest } from "../../../../src/kit/upload/handler.ts";

export const dynamic = "force-dynamic";

/** The photo from the phone; the logic and the reasons it is not a server action are in the handler. */
export async function POST(request: Request): Promise<Response> {
  return handleUploadRequest(request);
}
