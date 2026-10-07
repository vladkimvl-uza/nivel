import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp.ts";

describe("buildCsp", () => {
  const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d]));

  it("lets scripts in only with the nonce of the request, and strict-dynamic for the chunks they load", () => {
    const d = directives(buildCsp("abc123", false));
    expect(d["script-src"]).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("allows eval and sockets only in development", () => {
    expect(directives(buildCsp("n", true))["script-src"]).toContain("'unsafe-eval'");
    expect(directives(buildCsp("n", true))["connect-src"]).toContain("ws:");
    expect(directives(buildCsp("n", false))["script-src"]).not.toContain("unsafe-eval");
    expect(directives(buildCsp("n", false))["connect-src"]).toBe("connect-src 'self'");
  });

  it("lets the first screen play its clip from memory and nothing from outside", () => {
    const d = directives(buildCsp("n", false));
    expect(d["media-src"]).toBe("media-src 'self' blob:");
    expect(d["img-src"]).toBe("img-src 'self' data: blob:");
    expect(d["default-src"]).toBe("default-src 'self'");
    expect(d["object-src"]).toBe("object-src 'none'");
    expect(d["frame-ancestors"]).toBe("frame-ancestors 'none'");
    expect(d["form-action"]).toBe("form-action 'self'");
  });

  it("names no host outside the site", () => {
    expect(buildCsp("n", false)).not.toMatch(/https?:\/\//);
  });
});
