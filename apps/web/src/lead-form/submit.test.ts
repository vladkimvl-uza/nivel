import { describe, expect, it, vi } from "vitest";
import { createKeyHasher } from "./client-ip.ts";
import { createRateLimiter } from "./rate-limit.ts";
import {
  createSubmitDeps,
  type GatewayResult,
  type LeadGateway,
  processLeadForm,
  unavailableGateway,
} from "./submit.ts";
import type { LeadCommand } from "./types.ts";

const good = {
  name: "Aziz",
  phone: "+998901234567",
  scope: "pc",
  consent: "on",
  locale: "uz",
  website: "",
};

function setup(result: GatewayResult | (() => Promise<GatewayResult>) = { ok: true, number: "L-2026-0001" }) {
  let t = 1_000_000;
  const calls: LeadCommand[] = [];
  const gateway: LeadGateway = {
    async submit(command) {
      calls.push(command);
      return typeof result === "function" ? result() : result;
    },
  };
  const log = vi.fn();
  const deps = createSubmitDeps({
    gateway,
    hash: createKeyHasher("test-secret"),
    now: () => t,
    log,
  });
  return { deps, calls, log, advance: (ms: number) => (t += ms) };
}

describe("processLeadForm", () => {
  it("hands a good request to the gateway and tells the visitor its number", async () => {
    const { deps, calls } = setup();
    const state = await processLeadForm(good, { ip: "203.0.113.7" }, deps);
    expect(state).toEqual({ status: "ok", number: "L-2026-0001" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      channel: "web",
      scope: "pc",
      customer: { displayName: "Aziz", phoneE164: "+998901234567" },
      consent: { kind: "pd_processing", granted: true },
    });
  });

  it("answers an invalid form with the fields and what was typed, and does not call the gateway", async () => {
    const { deps, calls } = setup();
    const state = await processLeadForm({ ...good, phone: "1", consent: "" }, { ip: null }, deps);
    expect(state).toMatchObject({
      status: "error",
      code: "invalid",
      fields: { phone: "phone_invalid", consent: "consent_required" },
      values: { name: "Aziz", phone: "1" },
    });
    expect(calls).toHaveLength(0);
  });

  it("swallows the request of a bot and looks like a success", async () => {
    const { deps, calls } = setup();
    const state = await processLeadForm({ ...good, website: "http://spam.example" }, { ip: "203.0.113.7" }, deps);
    expect(state).toEqual({ status: "ok", number: null });
    expect(calls).toHaveLength(0);
  });

  it("allows three requests a day from one phone and refuses the fourth", async () => {
    const { deps, calls, advance } = setup();
    const send = async (n: number) => {
      advance(60_000); // a minute apart: these are different requests, not a double click
      return processLeadForm({ ...good, comment: `n${n}` }, { ip: null }, deps);
    };
    for (let i = 0; i < 3; i++) expect(await send(i)).toMatchObject({ status: "ok" });
    expect(await send(3)).toMatchObject({ status: "error", code: "rate_limited" });
    expect(calls).toHaveLength(3);
    advance(24 * 60 * 60 * 1000);
    expect(await send(4)).toMatchObject({ status: "ok" });
  });

  it("allows three requests a day from one address, whatever the phones are", async () => {
    const { deps, calls } = setup();
    const from = (phone: string) => processLeadForm({ ...good, phone }, { ip: "198.51.100.9" }, deps);
    expect(await from("+998901111111")).toMatchObject({ status: "ok" });
    expect(await from("+998902222222")).toMatchObject({ status: "ok" });
    expect(await from("+998903333333")).toMatchObject({ status: "ok" });
    expect(await from("+998904444444")).toMatchObject({ status: "error", code: "rate_limited" });
    expect(calls).toHaveLength(3);
  });

  it("limits a Telegram nickname the same way", async () => {
    const { deps, advance } = setup();
    const send = async () => {
      advance(60_000);
      return processLeadForm({ ...good, phone: "", telegram: "@nivel_user" }, { ip: null }, deps);
    };
    for (let i = 0; i < 3; i++) expect(await send()).toMatchObject({ status: "ok" });
    expect(await send()).toMatchObject({ status: "error", code: "rate_limited" });
  });

  it("does not create a second request when the same contact presses the button twice", async () => {
    const { deps, calls, advance } = setup();
    const first = await processLeadForm(good, { ip: null }, deps);
    advance(2_000);
    const second = await processLeadForm(good, { ip: null }, deps);
    expect(first).toEqual({ status: "ok", number: "L-2026-0001" });
    expect(second).toEqual({ status: "ok", number: "L-2026-0001" });
    expect(calls).toHaveLength(1);
  });

  it("forgets the double click after a while", async () => {
    const { deps, calls, advance } = setup();
    await processLeadForm(good, { ip: null }, deps);
    advance(31_000);
    await processLeadForm(good, { ip: null }, deps);
    expect(calls).toHaveLength(2);
  });

  it("gives the place in the limit back when the services are not available", async () => {
    const { deps, advance } = setup({ ok: false, reason: "unavailable" });
    for (let i = 0; i < 5; i++) {
      advance(60_000);
      expect(await processLeadForm(good, { ip: "203.0.113.7" }, deps)).toMatchObject({
        status: "error",
        code: "unavailable",
      });
    }
  });

  it("shows the field the services refused, and gives the place back", async () => {
    const { deps, advance } = setup({ ok: false, reason: "invalid", fields: { phone: "rejected" } });
    for (let i = 0; i < 4; i++) {
      advance(60_000);
      expect(await processLeadForm(good, { ip: null }, deps)).toMatchObject({
        status: "error",
        code: "invalid",
        fields: { phone: "rejected" },
        values: { phone: "+998901234567" },
      });
    }
  });

  it("answers a failure of the gateway with a plain error and logs no personal data", async () => {
    const { deps, log } = setup(() => Promise.reject(new Error("connection to 10.0.0.5 for +998901234567 refused")));
    const state = await processLeadForm(good, { ip: "203.0.113.7" }, deps);
    expect(state).toMatchObject({ status: "error", code: "failed" });
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("998901234567");
    expect(logged).not.toContain("203.0.113.7");
  });

  it("works without an address (no proxy header): only the contact is limited", async () => {
    const { deps } = setup();
    expect(await processLeadForm(good, { ip: null }, deps)).toMatchObject({ status: "ok" });
  });
});

describe("unavailableGateway", () => {
  it("says that the services are not connected", async () => {
    const result = await unavailableGateway.submit({
      channel: "web",
      scope: "pc",
      lang: "uz",
      customer: {},
      consent: { kind: "pd_processing", granted: true, textVersion: "x" },
    });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("createSubmitDeps", () => {
  it("builds default limits when only the gateway is given", async () => {
    const deps = createSubmitDeps({ gateway: unavailableGateway });
    expect(await processLeadForm(good, { ip: null }, deps)).toMatchObject({ code: "unavailable" });
  });

  it("takes a limiter of the caller", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    const deps = createSubmitDeps({ gateway: { submit: async () => ({ ok: true, number: "L-1" }) }, limiter });
    expect(await processLeadForm({ ...good, phone: "+998905555555" }, { ip: null }, deps)).toMatchObject({
      status: "ok",
    });
  });
});
