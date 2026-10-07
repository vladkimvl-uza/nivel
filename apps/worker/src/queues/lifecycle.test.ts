import { describe, expect, it } from "vitest";
import type { JobContext } from "../jobs/types.ts";
import { Lifecycle, workerContext } from "./runtime.ts";

describe("Lifecycle", () => {
  it("starts the hooks in the order they were added and stops them in the reverse order", async () => {
    const log: string[] = [];
    const l = new Lifecycle();
    l.onStart(() => void log.push("start a"));
    l.onStart(async () => void log.push("start b"));
    l.onStop(() => void log.push("stop a"));
    l.onStop(async () => void log.push("stop b"));
    await l.start();
    await l.stop();
    expect(log).toEqual(["start a", "start b", "stop b", "stop a"]);
  });

  it("stops every hook even if one fails, then throws the first error", async () => {
    const log: string[] = [];
    const l = new Lifecycle();
    l.onStop(() => void log.push("a"));
    l.onStop(() => {
      throw new Error("b failed");
    });
    l.onStop(() => void log.push("c"));
    await expect(l.stop()).rejects.toThrow("b failed");
    expect(log).toEqual(["c", "a"]);
  });
});

describe("workerContext", () => {
  it("accepts a context with the runtime and the hooks and refuses one without", () => {
    const l = new Lifecycle();
    const good = { boss: {}, log: {}, runtime: {}, onStart: l.onStart, onStop: l.onStop } as unknown as JobContext;
    expect(workerContext(good)).toBe(good);
    expect(() => workerContext({ boss: {}, log: {} } as unknown as JobContext)).toThrow(/runtime of the worker/);
  });
});
