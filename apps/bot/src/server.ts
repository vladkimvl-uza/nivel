// The HTTP face of the bot: GET /healthz always, and in the webhook mode POST /tg/<path> (ARCHITECTURE 7.1: a path nobody
// can guess, the header X-Telegram-Bot-Api-Secret-Token compared in constant time, the answer at once and the work after it).
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** An update of Telegram is a few kilobytes; a megabyte is a mistake or an attack. */
const MAX_BODY_BYTES = 1_000_000;

export interface Webhook {
  /** `/tg/<random>`; see `webhookPath`. */
  path: string;
  /** The secret that Telegram sends in the header; it is set with setWebhook. */
  secret: string;
  /** Handles one update; its failure is the bot's to log, the answer to Telegram is already 200. */
  onUpdate(update: unknown): Promise<void>;
}

export type HealthCheck = () => Promise<{ ok: boolean; body: Record<string, unknown> }>;

export interface ServerOptions {
  port: number;
  host?: string;
  health: HealthCheck;
  webhook?: Webhook;
  /** Called with the failure of an update handled after the answer. */
  onError?: (err: unknown) => void;
}

/** The path of the webhook: made from the secret, so that it needs no second variable, and never equal to it. */
export function webhookPath(secret: string): string {
  return `/tg/${createHash("sha256").update(`${secret}:path`).digest("hex").slice(0, 32)}`;
}

function sameSecret(given: string | undefined, secret: string): boolean {
  if (given === undefined) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

function reply(res: ServerResponse, status: number, body: string, type = "application/json"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function startServer(o: ServerOptions): Promise<{ server: Server; port: number }> {
  const inflight = new Set<Promise<void>>();
  const server = createServer(async (req, res) => {
    try {
      const url = req.url ?? "";
      if (req.method === "GET" && (url === "/healthz" || url.startsWith("/healthz?"))) {
        const { ok, body } = await o.health();
        return reply(res, ok ? 200 : 503, JSON.stringify(body));
      }
      if (o.webhook !== undefined && req.method === "POST" && url === o.webhook.path) {
        if (!sameSecret(req.headers["x-telegram-bot-api-secret-token"] as string | undefined, o.webhook.secret)) {
          return reply(res, 403, '{"error":"forbidden"}');
        }
        const raw = await readBody(req);
        if (raw === null) return reply(res, 413, '{"error":"too_large"}');
        let update: unknown;
        try {
          update = JSON.parse(raw);
        } catch {
          return reply(res, 400, '{"error":"bad_json"}');
        }
        if (
          update === null ||
          typeof update !== "object" ||
          Array.isArray(update) ||
          !Number.isSafeInteger((update as { update_id?: unknown }).update_id)
        ) {
          return reply(res, 400, '{"error":"not_an_update"}');
        }
        reply(res, 200, '{"ok":true}');
        const work = o.webhook.onUpdate(update).catch((err) => o.onError?.(err));
        inflight.add(work);
        void work.finally(() => inflight.delete(work));
        return;
      }
      return reply(res, 404, '{"error":"not_found"}');
    } catch (err) {
      o.onError?.(err);
      if (!res.headersSent) reply(res, 500, '{"error":"internal"}');
    }
  });
  // On close the updates that were answered but are still being handled finish first.
  const close = server.close.bind(server);
  server.close = ((cb?: (err?: Error) => void) => {
    void Promise.allSettled([...inflight]).then(() => close(cb));
    return server;
  }) as typeof server.close;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, o.host ?? process.env.HOST ?? "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address !== null ? address.port : o.port });
    });
  });
}
