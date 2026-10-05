import { createServer, type Server } from "node:http";

export type HealthCheck = () => Promise<{ ok: boolean; body: Record<string, unknown> }>;

/** Minimal HTTP server with GET /healthz only (worker and bot). */
export function startHealthServer(port: number, check: HealthCheck): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/healthz" || req.url?.startsWith("/healthz?"))) {
      const { ok, body } = await check();
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not_found"}');
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, process.env.HOST ?? "127.0.0.1", () => resolve(server));
  });
}
