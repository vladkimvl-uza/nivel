import type { ops } from "@nivel/db/repos";
import { describe, expect, it } from "vitest";
import { PermanentJobError } from "../../../queues/define.ts";
import { FakeClock, fetchWithHangingBody, recordingLogger } from "../../../queues/test-support/fakes.ts";
import { signCrm } from "./events.ts";
import {
  type CrmConfig,
  type CrmDeps,
  type CrmRef,
  collectCrmEvents,
  createRateLimiter,
  handleCrmSync,
  isCrmUrl,
} from "./sync.ts";

const SECRET = "dGVzdC1rZXktbm90LWEtcmVhbC1zZWNyZXQ="; // gitleaks:allow test value, not a secret
const CONFIG: CrmConfig = { url: "https://script.google.com/macros/s/TEST/exec", secret: SECRET };
const JOB = "0198a000-0000-7000-8000-000000000001";

const leadFacts = {
  number: "L-2026-0001",
  createdAt: new Date("2026-10-12T09:00:00+05:00"),
  channel: "bot",
  utm: null,
  lang: "uz" as const,
  district: "Chilonzor",
  scope: "pc",
  wantedBy: null,
  configurationCode: null,
  customer: { ref: "c-1", displayName: "Dilshod", telegramUsername: "dilshod" },
};

function setup(
  over: {
    answer?: { status: number; body: unknown } | Error;
    config?: CrmConfig | null;
    facts?: Partial<CrmDeps["facts"]>;
  } = {},
) {
  const clock = new FakeClock();
  const { log, lines } = recordingLogger();
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const a = over.answer ?? { status: 200, body: { ok: true, id: JOB, result: "applied", error: null } };
    if (a instanceof Error) throw a;
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body), { status: a.status });
  }) as typeof fetch;
  const deps: CrmDeps = {
    now: clock.now,
    log,
    config: over.config === undefined ? CONFIG : over.config,
    env: "production",
    fetch: impl,
    limiter: createRateLimiter({ now: clock.ms, sleep: clock.sleep, gapMs: 1000 }),
    facts: {
      lead: async () => leadFacts,
      order: async () => null,
      payment: async () => null,
      purchase: async () => null,
      warranty: async () => null,
      ...over.facts,
    },
  };
  return { deps, clock, calls, lines };
}

describe("handleCrmSync: a server that stops in the middle of the answer", () => {
  it("gives up after the timeout, whole request included the body, and asks for a retry (not a refusal)", async () => {
    const hang = fetchWithHangingBody();
    const t = setup();
    t.deps.fetch = hang.impl;
    t.deps.timeoutMs = 30;
    const error = await handleCrmSync(t.deps, { type: "lead.created", ref: "l-1" }, JOB).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentJobError);
    expect((error as Error).message).toContain("timeout");
  }, 3000);
});

describe("isCrmUrl: only the web app of an Apps Script of Google", () => {
  it("takes https://script.google.com/macros/s/<id>/exec", () => {
    expect(isCrmUrl("https://script.google.com/macros/s/AKfycbx123-_/exec")).toBe(true);
  });
  it("refuses anything else: http, another host, another path, a login in the address, rubbish", () => {
    for (const url of [
      "http://script.google.com/macros/s/x/exec",
      "https://evil.example/macros/s/x/exec",
      "https://script.google.com.evil.example/macros/s/x/exec",
      "https://script.google.com/other",
      "https://user:pw@script.google.com/macros/s/x/exec",
      "https://script.google.com:8443/macros/s/x/exec",
      "",
      "not a url",
    ]) {
      expect(isCrmUrl(url), url).toBe(false);
    }
  });
});

describe("handleCrmSync: one signed event to the CRM", () => {
  it("posts the envelope with the id of the job, the environment of the worker, a stamp and the signature of ts.body", async () => {
    const t = setup();
    await handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "lead-1" }, JOB);
    expect(t.calls).toHaveLength(1);
    const { url, init } = t.calls[0] as { url: string; init: RequestInit };
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(CONFIG.url);
    const ts = Number(u.searchParams.get("ts"));
    expect(u.searchParams.get("v")).toBe("1");
    expect(ts).toBe(Math.floor(t.clock.ms() / 1000));
    const body = String(init.body);
    expect(u.searchParams.get("sig")).toBe(signCrm(SECRET, ts, body));
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    const env = JSON.parse(body);
    expect(env).toMatchObject({ v: 1, id: JOB, type: "lead.created", env: "production", source: "nivel-platform" });
    expect(env.data).toMatchObject({ number: "L-2026-0001", channel: "bot", scope: "pc" });
    // sent_at is the second of the stamp
    expect(Math.abs(Date.parse(env.sent_at) / 1000 - ts)).toBeLessThan(1);
  });

  it("builds each of the five events from its own facts", async () => {
    const t = setup({
      facts: {
        order: async () => ({
          number: "NV-2026-0001",
          leadNumber: null,
          customerRef: null,
          kind: "pc",
          seq: 3,
          from: "accepted",
          to: "purchasing",
          event: "START_PURCHASE",
          actor: "owner",
          at: new Date("2026-10-12T10:00:00+05:00"),
          flags: { feePrepaid: true, fundsReceived: true, firstOrderMeetingDone: false },
          quote: null,
          dates: {
            purchaseNotBefore: null,
            reportDueAt: null,
            objectionUntil: null,
            refundDueAt: null,
            warrantyUntil: null,
            podborCreditUntil: null,
          },
          report: null,
          cancel: null,
          ledger: [],
        }),
        payment: async () => ({
          paymentId: "p-1",
          orderNumber: "NV-2026-0001",
          kind: "fee_advance",
          direction: "in" as const,
          method: "xolis_qr",
          amountSum: 900_000,
          status: "confirmed" as const,
          fiscalReceiptNo: "FR-1",
          bankDocNo: null,
          occurredAt: new Date("2026-10-12T10:00:00+05:00"),
          confirmedAt: new Date("2026-10-12T10:00:00+05:00"),
          payerIsCustomer: true,
          reversalOf: null,
        }),
        purchase: async () => ({
          purchaseId: "pu-1",
          orderNumber: "NV-2026-0001",
          title: "Ryzen 5 7600",
          categoryCode: "cpu",
          vendorName: "Mycom",
          qty: 1,
          amountSum: 2_800_000,
          paidVia: "bank_transfer",
          receiptKind: "fiscal",
          receiptNo: "CH-1",
          esfNo: null,
          esfDue: null,
          discountSum: 0,
          bonusNote: null,
          serials: [],
          vendorWarrantyMonths: null,
          vendorWarrantyUntil: null,
          boughtAt: new Date("2026-10-12T10:00:00+05:00"),
          totals: { receiptsTotal: 2_800_000, fundsReceived: 11_000_000, purchaseLimit: 11_000_000 },
        }),
        warranty: async () => ({
          number: "G-2026-0001",
          orderNumber: "NV-2026-0001",
          purchaseId: null,
          openedAt: new Date("2026-10-12T10:00:00+05:00"),
          channel: "bot",
          summary: "x",
          status: "opened",
          dueReply: null,
          dueDiagnosis: null,
          dueLoaner: null,
          dueFix: null,
        }),
      },
    });
    const sent = async (type: string, extra: Record<string, unknown> = {}) => {
      await handleCrmSync(t.deps, { job: "crm.sync", type, ref: "r-1", ...extra }, JOB);
      return JSON.parse(String((t.calls.at(-1) as { init: RequestInit }).init.body)) as {
        type: string;
        data: Record<string, unknown>;
      };
    };
    expect((await sent("lead.created")).data.number).toBe("L-2026-0001");
    expect((await sent("order.status_changed", { seq: 3 })).data).toMatchObject({
      number: "NV-2026-0001",
      seq: 3,
      to: "purchasing",
    });
    expect((await sent("payment.confirmed")).data).toMatchObject({ payment_id: "p-1", amount_sum: 900_000 });
    expect((await sent("purchase.recorded")).data).toMatchObject({ purchase_id: "pu-1", category_code: "cpu" });
    expect((await sent("warranty.case_opened")).data).toMatchObject({ number: "G-2026-0001" });
  });

  it("signs again at every attempt with the time of that attempt, and keeps the id of the job", async () => {
    const t = setup();
    await handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "lead-1" }, JOB);
    t.clock.advance(10 * 60_000);
    await handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "lead-1" }, JOB);
    const ts = t.calls.map((c) => Number(new URL(c.url).searchParams.get("ts")));
    expect(ts[1]).toBeGreaterThan(ts[0] as number);
    expect(t.calls.map((c) => JSON.parse(String(c.init.body)).id)).toEqual([JOB, JOB]);
  });

  it("never writes the key or the signature into the log", async () => {
    const t = setup({ answer: { status: 200, body: { ok: false, id: JOB, result: null, error: "internal" } } });
    await handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "lead-1" }, JOB).catch(() => undefined);
    const text = JSON.stringify(t.lines);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("sig=");
  });

  it("does nothing, and asks nothing, when the CRM is not set up", async () => {
    const t = setup({ config: null });
    await expect(handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "lead-1" }, JOB)).resolves.toEqual(
      {
        sent: false,
        reason: "no_config",
      },
    );
    expect(t.calls).toEqual([]);
  });

  it("drops an event whose thing is gone or not for the CRM (a return, a partial reversal)", async () => {
    const t = setup({ facts: { lead: async () => null } });
    expect(await handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "lead-1" }, JOB)).toEqual({
      sent: false,
      reason: "no_facts",
    });
    expect(t.calls).toEqual([]);
  });

  it("refuses a job that names no type that the CRM has, no thing, or an order event without its number in the journal", async () => {
    const t = setup();
    for (const data of [
      {},
      { type: "lead.created" },
      { type: "teleport", ref: "x" },
      { type: "order.status_changed", ref: "o-1" },
      { type: "order.status_changed", ref: "o-1", seq: -1 },
      { type: "lead.created", ref: 5 },
    ]) {
      await expect(handleCrmSync(t.deps, { job: "crm.sync", ...data }, JOB)).rejects.toBeInstanceOf(PermanentJobError);
    }
    expect(t.calls).toEqual([]);
  });

  it("refuses to send an address that is not an Apps Script of Google", async () => {
    const t = setup({ config: { url: "https://evil.example/exec", secret: SECRET } });
    await expect(
      handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "l" }, JOB),
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(t.calls).toEqual([]);
  });
});

describe("handleCrmSync: the answers of the CRM", () => {
  const run = (answer: { status: number; body: unknown } | Error) => {
    const t = setup({ answer });
    return handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "l" }, JOB);
  };
  const crm = (error: string | null, result: string | null = null) => ({
    status: 200,
    body: { ok: error === null, id: JOB, result, error },
  });

  it("is done when the CRM says ok (applied, duplicate, ignored or stale_seq: all are delivered)", async () => {
    for (const result of ["applied", "duplicate", "ignored", "stale_seq"]) {
      await expect(run(crm(null, result))).resolves.toMatchObject({ sent: true, result });
    }
  });

  it.each(["bad_signature", "bad_payload", "wrong_env", "unknown_type"])(
    "refuses for good on %s: the event is wrong, repeating it will not help (it goes to ops.app_errors)",
    async (error) => {
      const failure = await run(crm(error)).catch((e) => e);
      expect(failure).toBeInstanceOf(PermanentJobError);
      expect(failure.message).toContain(error);
    },
  );

  it.each(["locked", "internal", "stale"])("is retried on %s, with the same id", async (error) => {
    const failure = await run(crm(error)).catch((e) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PermanentJobError);
    expect(failure.message).toContain(error);
  });

  it("is retried when the answer is not the answer of the CRM: a 5xx, a page of HTML, no answer, a timeout", async () => {
    for (const a of [
      { status: 502, body: "bad gateway" },
      { status: 200, body: "<html>login</html>" },
      { status: 200, body: { unexpected: true } },
      new Error("fetch failed"),
    ]) {
      const failure = await run(a).catch((e) => e);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(PermanentJobError);
    }
  });

  it("gives up on a call that hangs", async () => {
    const clock = new FakeClock();
    const { log } = recordingLogger();
    const deps: CrmDeps = {
      now: clock.now,
      log,
      config: CONFIG,
      env: "production",
      fetch: ((_u: string, init?: RequestInit) =>
        new Promise((_r, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as unknown as typeof fetch,
      limiter: createRateLimiter({ now: clock.ms, sleep: clock.sleep, gapMs: 0 }),
      facts: {
        lead: async () => leadFacts,
        order: async () => null,
        payment: async () => null,
        purchase: async () => null,
        warranty: async () => null,
      },
      timeoutMs: 20,
    };
    await expect(handleCrmSync(deps, { job: "crm.sync", type: "lead.created", ref: "l" }, JOB)).rejects.toThrow(
      /timeout/,
    );
  });
});

describe("createRateLimiter: no more than one event a second", () => {
  it("lets the first go at once and holds the second for the rest of the second", async () => {
    const clock = new FakeClock();
    const limiter = createRateLimiter({ now: clock.ms, sleep: clock.sleep, gapMs: 1000 });
    const start = clock.ms();
    await limiter.wait();
    expect(clock.ms()).toBe(start);
    clock.advance(300);
    await limiter.wait();
    expect(clock.ms()).toBe(start + 1000);
    await limiter.wait();
    expect(clock.ms()).toBe(start + 2000);
  });

  it("does not hold an event that comes after a quiet second", async () => {
    const clock = new FakeClock();
    const limiter = createRateLimiter({ now: clock.ms, sleep: clock.sleep, gapMs: 1000 });
    await limiter.wait();
    clock.advance(5000);
    const at = clock.ms();
    await limiter.wait();
    expect(clock.ms()).toBe(at);
  });

  it("is used by the handler: two events in a second go a second apart", async () => {
    const t = setup();
    await handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "l" }, JOB);
    const first = Number(new URL((t.calls[0] as { url: string }).url).searchParams.get("ts"));
    await handleCrmSync(t.deps, { job: "crm.sync", type: "lead.created", ref: "l" }, JOB);
    const second = Number(new URL((t.calls[1] as { url: string }).url).searchParams.get("ts"));
    expect(second - first).toBeGreaterThanOrEqual(1);
  });
});

describe("collectCrmEvents: what is new for the CRM", () => {
  const refs: CrmRef[] = [
    { type: "lead.created", ref: "lead-1", dedupeKey: "crm:lead:lead-1" },
    { type: "order.status_changed", ref: "order-1", seq: 4, dedupeKey: "crm:order:order-1:4" },
  ];

  function collector(config: CrmConfig | null, found: CrmRef[] = refs) {
    const clock = new FakeClock();
    const enqueued: ops.OutboxInput[] = [];
    const seen = new Set<string>();
    const { log } = recordingLogger();
    let asked = 0;
    return {
      enqueued,
      asked: () => asked,
      deps: {
        now: clock.now,
        log,
        config,
        candidates: async () => {
          asked += 1;
          return found;
        },
        enqueue: async (input: ops.OutboxInput) => {
          const duplicate = input.dedupeKey !== undefined && seen.has(input.dedupeKey);
          if (input.dedupeKey !== undefined) seen.add(input.dedupeKey);
          if (!duplicate) enqueued.push(input);
          return { id: "x", duplicate };
        },
      },
    };
  }

  it("queues one job for each new thing, under a key that holds the thing and, for an order, the number of the event", async () => {
    const c = collector(CONFIG);
    expect(await collectCrmEvents(c.deps)).toEqual({ queued: 2 });
    expect(c.enqueued).toEqual([
      {
        kind: "job",
        dedupeKey: "crm:lead:lead-1",
        priority: -5,
        payload: { job: "crm.sync", type: "lead.created", ref: "lead-1" },
      },
      {
        kind: "job",
        dedupeKey: "crm:order:order-1:4",
        priority: -5,
        payload: { job: "crm.sync", type: "order.status_changed", ref: "order-1", seq: 4 },
      },
    ]);
  });

  it("does not queue a thing twice", async () => {
    const c = collector(CONFIG);
    await collectCrmEvents(c.deps);
    expect(await collectCrmEvents(c.deps)).toEqual({ queued: 0 });
    expect(c.enqueued).toHaveLength(2);
  });

  it("does not even look when the CRM is not set up", async () => {
    const c = collector(null);
    expect(await collectCrmEvents(c.deps)).toEqual({ queued: 0 });
    expect(c.asked()).toBe(0);
  });
});
