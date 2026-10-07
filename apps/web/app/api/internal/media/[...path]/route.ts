import { existsSync } from "node:fs";
import { resolveMediaRoot, serveMedia } from "../../../../../src/i18n/site/media.ts";

export const dynamic = "force-dynamic";

let root: string | null | undefined;

/** The folder of the media is looked for once. */
function mediaRoot(): string | null {
  root ??= resolveMediaRoot(process.env, process.cwd(), existsSync);
  return root;
}

type Context = { params: Promise<{ path: string[] }> };

/**
 * /media/* in development, in the e2e run and in the check of the production build (proxy.ts rewrites it here). In production
 * Caddy serves the volume `media` itself, with Range and `immutable`; this route is the same thing for a machine without Caddy.
 */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  return serveMedia(request, mediaRoot(), path);
}

export const HEAD = GET;
