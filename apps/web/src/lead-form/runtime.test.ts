import { afterEach, describe, expect, it } from "vitest";
import { configureLeadGateway, leadDeps } from "./runtime.ts";
import type { LeadGateway } from "./submit.ts";

const shared = globalThis as { __nivelLeadDeps?: unknown };

afterEach(() => {
  delete shared.__nivelLeadDeps;
});

describe("lead runtime", () => {
  it("starts with a gateway that says the services are not connected", async () => {
    const r = await leadDeps().gateway.submit({} as never);
    expect(r).toEqual({ ok: false, reason: "unavailable" });
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
