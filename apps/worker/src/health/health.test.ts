import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startHealthServer } from "../health.ts";

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const urlOf = (s: Server, path: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${path}`;

describe("startHealthServer: GET /healthz of the worker", () => {
  it("answers 200 with the body of the check when it is ok, and does not let a proxy cache it", async () => {
    server = await startHealthServer(0, async () => ({ ok: true, body: { app: "worker", status: "ok" } }));
    const res = await fetch(urlOf(server, "/healthz"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ app: "worker", status: "ok" });
  });

  it("answers 503 when the check says the worker is degraded, and takes a query string", async () => {
    server = await startHealthServer(0, async () => ({ ok: false, body: { status: "degraded" } }));
    const res = await fetch(urlOf(server, "/healthz?probe=1"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded" });
  });

  it("answers 404 for any other path and any other method: the worker has no other door", async () => {
    server = await startHealthServer(0, async () => ({ ok: true, body: {} }));
    expect((await fetch(urlOf(server, "/"))).status).toBe(404);
    expect((await fetch(urlOf(server, "/admin"))).status).toBe(404);
    expect((await fetch(urlOf(server, "/healthz"), { method: "POST" })).status).toBe(404);
  });
});
