// The check that a state-changing request comes from a page of this admin (server actions of Next.js do it by
// themselves; a route handler does not).
import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "./origin.ts";

const h = (entries: Record<string, string>) => new Headers(entries);

describe("isSameOriginRequest", () => {
  it("accepts a request whose Origin is the host it was sent to", () => {
    expect(isSameOriginRequest(h({ origin: "https://admin.nivel.uz", host: "admin.nivel.uz" }))).toBe(true);
    expect(isSameOriginRequest(h({ origin: "http://127.0.0.1:3401", host: "127.0.0.1:3401" }))).toBe(true);
  });

  it("takes the host Caddy forwarded when there is one", () => {
    expect(
      isSameOriginRequest(
        h({ origin: "https://admin.nivel.uz", host: "127.0.0.1:3101", "x-forwarded-host": "admin.nivel.uz" }),
      ),
    ).toBe(true);
  });

  it("refuses another site, a missing Origin and a garbled one", () => {
    expect(isSameOriginRequest(h({ origin: "https://evil.example", host: "admin.nivel.uz" }))).toBe(false);
    expect(isSameOriginRequest(h({ host: "admin.nivel.uz" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "null", host: "admin.nivel.uz" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "not a url", host: "admin.nivel.uz" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "https://admin.nivel.uz" }))).toBe(false);
  });

  it("refuses when the browser itself says the request is cross-site, whatever Origin says", () => {
    expect(
      isSameOriginRequest(
        h({ origin: "https://admin.nivel.uz", host: "admin.nivel.uz", "sec-fetch-site": "cross-site" }),
      ),
    ).toBe(false);
    expect(
      isSameOriginRequest(
        h({ origin: "https://admin.nivel.uz", host: "admin.nivel.uz", "sec-fetch-site": "same-origin" }),
      ),
    ).toBe(true);
  });
});
