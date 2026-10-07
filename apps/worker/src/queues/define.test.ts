import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RETRY, PermanentJobError, registerQueue, TASHKENT_TZ } from "./define.ts";
import type { FailureInfo, FailureSink } from "./failures.ts";
import type { WorkerContext } from "./runtime.ts";

type Handler = (jobs: Record<string, unknown>[]) => Promise<void>;

function fakeContext() {
  const calls = {
    createQueue: [] as [string, Record<string, unknown> | undefined][],
    updateQueue: [] as [string, Record<string, unknown> | undefined][],
    schedule: [] as [string, string, unknown, Record<string, unknown> | undefined][],
    work: [] as [string, Record<string, unknown>][],
  };
  const handlers = new Map<string, Handler>();
  const recorded: FailureInfo[] = [];
  const failures: FailureSink = {
    async recordFinal(info) {
      recorded.push(info);
      return { count: 1, fingerprint: "f" };
    },
  };
  const warn = vi.fn();
  const error = vi.fn();
  const log = { warn, error, info: vi.fn(), child: () => log } as unknown as Logger;
  const boss = {
    async createQueue(name: string, options?: Record<string, unknown>) {
      calls.createQueue.push([name, options]);
    },
    async updateQueue(name: string, options?: Record<string, unknown>) {
      calls.updateQueue.push([name, options]);
    },
    async schedule(name: string, cron: string, data: unknown, options?: Record<string, unknown>) {
      calls.schedule.push([name, cron, data, options]);
    },
    async work(name: string, options: Record<string, unknown>, handler: Handler) {
      calls.work.push([name, options]);
      handlers.set(name, handler);
      return "worker-id";
    },
  };
  const ctx = { boss, log, runtime: { log, failures }, onStop: vi.fn() } as unknown as WorkerContext;
  const run = (name: string, job: Record<string, unknown>) => (handlers.get(name) as Handler)([job]);
  return { ctx, calls, recorded, run, error };
}

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  data: { orderId: "o-1" },
  retryCount: 0,
  retryLimit: DEFAULT_RETRY.limit,
  ...over,
});

describe("registerQueue", () => {
  it("makes the queue with five attempts and a growing pause, and puts a worker on it", async () => {
    const { ctx, calls } = fakeContext();
    await registerQueue(ctx, { name: "payment.expect", handler: async () => {} });
    expect(calls.createQueue).toEqual([
      [
        "payment.expect",
        expect.objectContaining({ retryLimit: 4, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 }),
      ],
    ]);
    expect(calls.work[0]?.[0]).toBe("payment.expect");
    expect(calls.work[0]?.[1]).toMatchObject({ includeMetadata: true });
  });

  it("applies the options again to a queue that exists already, so that a change in a new release reaches it", async () => {
    const { ctx, calls } = fakeContext();
    await registerQueue(ctx, { name: "payment.expect", retry: { limit: 6, maxDelaySec: 600 }, handler: async () => {} });
    expect(calls.updateQueue).toEqual([
      ["payment.expect", expect.objectContaining({ retryLimit: 6, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 })],
    ]);
    await registerQueue(ctx, { name: "flat", retry: { backoff: false }, handler: async () => {} });
    expect(calls.updateQueue[1]?.[1]).toMatchObject({ retryBackoff: false, retryDelayMax: null });
  });

  it("schedules a cron queue in the calendar of Tashkent and a queue without a cron is not scheduled", async () => {
    const { ctx, calls } = fakeContext();
    await registerQueue(ctx, { name: "retention.purge", cron: "30 3 * * *", handler: async () => {} });
    await registerQueue(ctx, { name: "ledger.append", handler: async () => {} });
    expect(calls.schedule).toHaveLength(1);
    expect(calls.schedule[0]?.[0]).toBe("retention.purge");
    expect(calls.schedule[0]?.[1]).toBe("30 3 * * *");
    expect(calls.schedule[0]?.[3]).toMatchObject({ tz: TASHKENT_TZ });
    expect(TASHKENT_TZ).toBe("Asia/Tashkent");
  });

  it("takes the retry options of a queue that needs its own (the site cache is retried for half an hour)", async () => {
    const { ctx, calls } = fakeContext();
    await registerQueue(ctx, {
      name: "web.revalidate",
      retry: { limit: 6, delaySec: 30, backoff: true, maxDelaySec: 600 },
      handler: async () => {},
    });
    expect(calls.createQueue[0]?.[1]).toMatchObject({ retryLimit: 6, retryDelay: 30, retryDelayMax: 600 });
  });

  it("does not cap a pause that does not grow: pg-boss refuses a cap without the backoff", async () => {
    const { ctx, calls } = fakeContext();
    await registerQueue(ctx, { name: "flat", retry: { backoff: false, delaySec: 1 }, handler: async () => {} });
    expect(calls.createQueue[0]?.[1]).toMatchObject({ retryBackoff: false, retryDelay: 1 });
    expect(calls.createQueue[0]?.[1]).not.toHaveProperty("retryDelayMax");
  });

  it("gives the handler the data of the job and which attempt it is", async () => {
    const { ctx, run } = fakeContext();
    const seen: unknown[] = [];
    await registerQueue(ctx, {
      name: "q",
      handler: async (data, meta) => {
        seen.push([data, meta]);
      },
    });
    await run("q", job({ retryCount: 2 }));
    expect(seen).toEqual([[{ orderId: "o-1" }, { id: "job-1", attempt: 3, attempts: 5, final: false }]]);
  });

  it("lets a failed attempt go back to pg-boss without a record while attempts are left", async () => {
    const { ctx, run, recorded } = fakeContext();
    await registerQueue(ctx, {
      name: "q",
      handler: async () => {
        throw new Error("db down");
      },
    });
    await expect(run("q", job({ retryCount: 3 }))).rejects.toThrow("db down");
    expect(recorded).toEqual([]);
  });

  it("writes the failure down after the fifth failure and still lets pg-boss mark the job failed", async () => {
    const { ctx, run, recorded } = fakeContext();
    await registerQueue(ctx, {
      name: "q",
      handler: async () => {
        throw new Error("db down");
      },
    });
    await expect(run("q", job({ retryCount: 4 }))).rejects.toThrow("db down");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ queue: "q", jobId: "job-1", attempts: 5 });
    expect(recorded[0]?.error).toEqual(new Error("db down"));
  });

  it("does not hide the error of the job when the record of it fails", async () => {
    const { ctx, run, error } = fakeContext();
    (ctx.runtime as { failures: FailureSink }).failures = {
      async recordFinal() {
        throw new Error("app_errors is not writable");
      },
    };
    await registerQueue(ctx, {
      name: "q",
      handler: async () => {
        throw new Error("original");
      },
    });
    await expect(run("q", job({ retryCount: 4 }))).rejects.toThrow("original");
    expect(error).toHaveBeenCalled();
  });

  it("records a permanent error at once and ends the job: retrying a wrong sum five times would only repeat the refusal", async () => {
    const { ctx, run, recorded } = fakeContext();
    await registerQueue(ctx, {
      name: "q",
      handler: async () => {
        throw new PermanentJobError("amount_mismatch: the job names another sum");
      },
    });
    await expect(run("q", job({ retryCount: 0 }))).resolves.toBeUndefined();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ queue: "q", attempts: 1 });
  });
});
