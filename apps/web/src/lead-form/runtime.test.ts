import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureLeadGateway, gatewayFromEnv, leadDeps } from "./runtime.ts";
import type { LeadGateway } from "./submit.ts";

const shared = globalThis as { __nivelLeadDeps?: unknown };

// The tests of the unit project never reach a database, whatever the .env.local of the machine holds.
beforeEach(() => {
  vi.stubEnv("DATABASE_URL_WEB", "");
  vi.stubEnv("DATA_ENC_KEY", "");
});
afterEach(() => {
  delete shared.__nivelLeadDeps;
  vi.unstubAllEnvs();
});

describe("lead runtime", () => {
  it("starts with a gateway that says the services are not connected", async () => {
    const r = await leadDeps().gateway.submit({} as never);
    expect(r).toEqual({ ok: false, reason: "unavailable" });
  });

  it("stays unavailable with a database but without the key of the consent hash, and the other way round", async () => {
    for (const env of [{ DATABASE_URL_WEB: "postgres://x" }, { DATA_ENC_KEY: "k" }]) {
      expect(await gatewayFromEnv(env).submit({} as never)).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("keeps one set of dependencies for the whole process", () => {
    expect(leadDeps()).toBe(leadDeps());
  });

  it("replaces the gateway and keeps it for the next calls", async () => {
    const gateway: LeadGateway = { submit: async () => ({ ok: true, number: "L-1" }) };
    const deps = configureLeadGateway(gateway);
    expect(leadDeps()).toBe(deps);
    expect(await leadDeps().gateway.submit({} as never)).toEqual({ ok: true, number: "L-1" });
  });
});
