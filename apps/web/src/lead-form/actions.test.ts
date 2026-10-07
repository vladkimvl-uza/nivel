import { afterEach, describe, expect, it, vi } from "vitest";
import { submitLead } from "./actions.ts";
import { configureLeadGateway } from "./runtime.ts";
import { IDLE } from "./types.ts";

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));

const shared = globalThis as { __nivelLeadDeps?: unknown };

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    name: "Aziz",
    phone: "+998 90 123 45 67",
    scope: "pc",
    consent: "on",
    locale: "uz",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

afterEach(() => {
  delete shared.__nivelLeadDeps;
  requestHeaders.current = new Headers();
});

describe("submitLead", () => {
  it("hands a good request to the gateway with the address of the visitor in the limit", async () => {
    const seen: unknown[] = [];
    configureLeadGateway({
      submit: async (command) => {
        seen.push(command);
        return { ok: true, number: "L-0007" };
      },
    });
    requestHeaders.current = new Headers({ "x-forwarded-for": "203.0.113.9" });
    const state = await submitLead(IDLE, form());
    expect(state).toEqual({ status: "ok", number: "L-0007" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ channel: "web", scope: "pc", customer: { phoneE164: "+998901234567" } });
  });

  it("answers an empty form with the fields that are wrong and does not call the gateway", async () => {
    const submit = vi.fn();
    configureLeadGateway({ submit });
    const state = await submitLead(IDLE, form({ phone: "", consent: "" }));
    expect(state.status).toBe("error");
    expect(submit).not.toHaveBeenCalled();
  });

  it("tells the visitor the truth while the services are not connected", async () => {
    const state = await submitLead(IDLE, form());
    expect(state).toMatchObject({ status: "error", code: "unavailable" });
  });
});
