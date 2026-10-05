import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { isLocalUrl } from "./network-guard.ts";
import { network } from "./setup-unit.ts";

describe("NETWORK_GUARD", () => {
  it("is on in tests", () => {
    expect(process.env.NETWORK_GUARD).toBe("1");
  });

  it("fails an unmocked external request and records it", async () => {
    // .invalid never resolves, so even a broken guard sends nothing; the record proves the guard stopped it.
    await expect(fetch("https://nivel-guard-probe.invalid/json/")).rejects.toThrow(TypeError);
    expect(network.takeViolations()).toEqual(["GET https://nivel-guard-probe.invalid/json/"]);
  });

  it("serves a mocked request", async () => {
    network.use(http.get("https://api.telegram.org/botTEST/getMe", () => HttpResponse.json({ ok: true })));
    const res = await fetch("https://api.telegram.org/botTEST/getMe");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("treats only loopback as local", () => {
    expect(isLocalUrl("http://127.0.0.1:3100/healthz")).toBe(true);
    expect(isLocalUrl("http://localhost:3103/healthz")).toBe(true);
    expect(isLocalUrl("https://nivel.uz/")).toBe(false);
  });
});
