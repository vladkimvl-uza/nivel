import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling } from "./loop.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startPolling", () => {
  it("runs a pass at once and then every interval", async () => {
    const pass = vi.fn(async () => ({ claimed: 0 }));
    const loop = startPolling({ pass, intervalMs: 5000, fullBatch: 10, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pass).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(pass).toHaveBeenCalledTimes(3);
    await loop.stop();
  });

  it("goes on at once after a full batch: there is more waiting", async () => {
    const answers = [{ claimed: 10 }, { claimed: 10 }, { claimed: 3 }];
    const pass = vi.fn(async () => answers.shift() ?? { claimed: 0 });
    const loop = startPolling({ pass, intervalMs: 5000, fullBatch: 10, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(10);
    expect(pass).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4980);
    expect(pass).toHaveBeenCalledTimes(3);
    await loop.stop();
  });

  it("never runs two passes at the same time", async () => {
    let running = 0;
    let most = 0;
    const pass = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 12_000));
      running -= 1;
      return { claimed: 0 };
    });
    const loop = startPolling({ pass, intervalMs: 5000, fullBatch: 10, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(most).toBe(1);
    const stopped = loop.stop();
    await vi.advanceTimersByTimeAsync(12_000);
    await stopped;
  });

  it("reports the error of a pass and keeps going", async () => {
    const onError = vi.fn();
    const pass = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue({ claimed: 0 });
    const loop = startPolling({ pass, intervalMs: 1000, fullBatch: 10, onError });
    await vi.advanceTimersByTimeAsync(2500);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(pass.mock.calls.length).toBeGreaterThanOrEqual(2);
    await loop.stop();
  });

  it("wakes up early when asked (a message was just queued)", async () => {
    const pass = vi.fn(async () => ({ claimed: 0 }));
    const loop = startPolling({ pass, intervalMs: 5000, fullBatch: 10, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    loop.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(pass).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it("stops: waits for the pass that runs, and runs no more", async () => {
    let finished = false;
    const pass = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 3000));
      finished = true;
      return { claimed: 0 };
    });
    const loop = startPolling({ pass, intervalMs: 1000, fullBatch: 10, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(10);
    const stopped = loop.stop();
    await vi.advanceTimersByTimeAsync(3000);
    await stopped;
    expect(finished).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pass).toHaveBeenCalledTimes(1);
  });
});
