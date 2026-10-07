import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, webhookPath } from "./server.ts";

const SECRET = "s3cret-webhook-token-for-tests-0123456789"; // gitleaks:allow made-up value, never a real secret
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

async function serve(webhook?: { path: string; secret: string; onUpdate: (u: unknown) => Promise<void> }, ok = true) {
  const { server, port } = await startServer({
    port: 0,
    host: "127.0.0.1",
    health: async () => ({ ok, body: { app: "bot", status: ok ? "ok" : "degraded" } }),
    ...(webhook ? { webhook } : {}),
  });
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${port ?? (server.address() as AddressInfo).port}`;
}

describe("/healthz", () => {
  it("answers 200 with the body of the check, not cached", async () => {
    const base = await serve();
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ app: "bot", status: "ok" });
    expect((await fetch(`${base}/healthz?probe=1`)).status).toBe(200);
  });

  it("answers 503 when the check fails", async () => {
    const base = await serve(undefined, false);
    expect((await fetch(`${base}/healthz`)).status).toBe(503);
  });

  it("knows nothing else: any other path is 404, with no webhook configured too", async () => {
    const base = await serve();
    for (const path of ["/", "/admin", "/tg/abc"]) expect((await fetch(`${base}${path}`)).status).toBe(404);
    expect((await fetch(`${base}/tg/abc`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${base}/healthz`, { method: "POST" })).status).toBe(404);
  });
});

describe("webhookPath", () => {
  it("is a random-looking path made from the secret, and never the secret itself", () => {
    const path = webhookPath(SECRET);
    expect(path).toMatch(/^\/tg\/[0-9a-f]{32}$/);
    expect(path).not.toContain(SECRET);
    expect(webhookPath(SECRET)).toBe(path);
    expect(webhookPath(`${SECRET}x`)).not.toBe(path);
  });
});

describe("the webhook (ARCHITECTURE 7.1: a secret path, the header of the secret, an answer at once)", () => {
  const path = webhookPath(SECRET);
  const post = (base: string, body: string, headers: Record<string, string> = {}, to = path) =>
    fetch(`${base}${to}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

  it("hands an update with the right header to the bot and answers 200 at once", async () => {
    const onUpdate = vi.fn(async () => {});
    const base = await serve({ path, secret: SECRET, onUpdate });
    const res = await post(base, JSON.stringify({ update_id: 1, message: { text: "hi" } }), {
      "x-telegram-bot-api-secret-token": SECRET,
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ update_id: 1, message: { text: "hi" } }));
  });

  it("refuses a request without the header or with another one: 403, nothing is handed over", async () => {
    const onUpdate = vi.fn(async () => {});
    const base = await serve({ path, secret: SECRET, onUpdate });
    expect((await post(base, "{}")).status).toBe(403);
    expect((await post(base, "{}", { "x-telegram-bot-api-secret-token": "nope" })).status).toBe(403);
    expect((await post(base, "{}", { "x-telegram-bot-api-secret-token": `${SECRET}x` })).status).toBe(403);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("another path is 404 and a GET on the path is 404 as well", async () => {
    const base = await serve({ path, secret: SECRET, onUpdate: async () => {} });
    expect((await post(base, "{}", { "x-telegram-bot-api-secret-token": SECRET }, "/tg/wrong")).status).toBe(404);
    expect((await fetch(`${base}${path}`)).status).toBe(404);
  });

  it("refuses a body that is not an update (400) or is too large (413)", async () => {
    const onUpdate = vi.fn(async () => {});
    const base = await serve({ path, secret: SECRET, onUpdate });
    const headers = { "x-telegram-bot-api-secret-token": SECRET };
    expect((await post(base, "not json", headers)).status).toBe(400);
    expect((await post(base, "[]", headers)).status).toBe(400);
    expect((await post(base, JSON.stringify({ no_update_id: true }), headers)).status).toBe(400);
    expect((await post(base, JSON.stringify({ update_id: 1, pad: "x".repeat(1_100_000) }), headers)).status).toBe(413);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("a failure of the bot does not become the answer of Telegram: it is 200 and the error is the bot's to log", async () => {
    const onUpdate = vi.fn(async () => {
      throw new Error("boom");
    });
    const base = await serve({ path, secret: SECRET, onUpdate });
    const res = await post(base, JSON.stringify({ update_id: 2 }), { "x-telegram-bot-api-secret-token": SECRET });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
    // The server is still up.
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});
