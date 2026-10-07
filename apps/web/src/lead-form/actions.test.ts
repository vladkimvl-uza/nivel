import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitLead } from "./actions.ts";
import { configureLeadGateway } from "./runtime.ts";
import { IDLE } from "./types.ts";

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));

// the consent text of the page comes from the database; these tests have none
vi.mock("../../app/[locale]/(marketing)/_data/server.ts", () => ({ getLegalRows: async () => [] }));

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

beforeEach(() => {
  // no database in a unit test, whatever the .env.local of the machine holds
  vi.stubEnv("DATABASE_URL_WEB", "");
  vi.stubEnv("DATA_ENC_KEY", "");
});
afterEach(() => {
  delete shared.__nivelLeadDeps;
  requestHeaders.current = new Headers();
  vi.unstubAllEnvs();
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

  it("answers a second argument that is not a form with the plain error of an empty form, not with a crash", async () => {
    const submit = vi.fn();
    configureLeadGateway({ submit });
    for (const bad of [null, undefined, "phone=1", { phone: "+998901234567" }]) {
      const state = await submitLead(IDLE, bad as unknown as FormData);
      expect(state).toMatchObject({ status: "error", code: "invalid", fields: {}, values: {} });
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it("writes the built-in consent text when the database has no document of it", async () => {
    const seen: { consent: { textVersion: string; documentId?: string } }[] = [];
    configureLeadGateway({
      submit: async (command) => {
        seen.push(command);
        return { ok: true, number: "L-0008" };
      },
    });
    await submitLead(IDLE, form({ phone: "+998 90 555 44 33" }));
    expect(seen[0]?.consent.textVersion).toBe("builtin-2026-10-07");
    expect(seen[0]?.consent.documentId).toBeUndefined();
  });
});
