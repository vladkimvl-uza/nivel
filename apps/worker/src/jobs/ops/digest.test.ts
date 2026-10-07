import type { ops } from "@nivel/db/repos";
import { describe, expect, it } from "vitest";
import { FakeClock, recordingLogger } from "../../queues/test-support/fakes.ts";
import { type DigestDeps, handleErrorDigest } from "./digest.ts";

function setup(
  errors: { app: string; message: string; count: number; lastAt: Date }[],
  now = new Date("2026-10-12T20:00:00+05:00"),
) {
  const clock = new FakeClock(now);
  const enqueued: ops.OutboxInput[] = [];
  const asked: Date[] = [];
  const { log } = recordingLogger();
  const deps: DigestDeps = {
    now: clock.now,
    log,
    recentErrors: async (since) => {
      asked.push(since);
      return errors;
    },
    enqueue: async (input) => {
      enqueued.push(input);
      return { id: "x", duplicate: false };
    },
  };
  return { deps, enqueued, asked };
}

describe("handleErrorDigest: the summary of ops.app_errors at 20:00", () => {
  it("sends nothing on a quiet day", async () => {
    const t = setup([]);
    expect(await handleErrorDigest(t.deps)).toEqual({ sent: false, items: 0 });
    expect(t.enqueued).toEqual([]);
  });

  it("asks for the errors of the last 24 hours", async () => {
    const t = setup([]);
    await handleErrorDigest(t.deps);
    expect(t.asked).toEqual([new Date("2026-10-11T20:00:00+05:00")]);
  });

  it("sends one message to the owner's group with the queue, the text and the count of each failure, once a day", async () => {
    const t = setup([
      { app: "worker", message: "[ledger.append] db down", count: 3, lastAt: new Date("2026-10-12T19:00:00+05:00") },
      { app: "worker", message: "[web.revalidate] HTTP 502", count: 1, lastAt: new Date("2026-10-12T18:00:00+05:00") },
      { app: "worker", message: "no prefix at all", count: 2, lastAt: new Date("2026-10-12T17:00:00+05:00") },
      { app: "web", message: "TypeError: x is undefined", count: 5, lastAt: new Date("2026-10-12T16:00:00+05:00") },
    ]);
    expect(await handleErrorDigest(t.deps)).toEqual({ sent: true, items: 4 });
    expect(t.enqueued).toEqual([
      {
        kind: "telegram_message",
        dedupeKey: "ops:digest:2026-10-12",
        payload: {
          target: "group",
          templateKey: "ops.digest",
          lang: "ru",
          params: {
            items: [
              { queue: "ledger.append", message: "db down", count: 3 },
              { queue: "web.revalidate", message: "HTTP 502", count: 1 },
              { queue: "-", message: "no prefix at all", count: 2 },
              { queue: "web", message: "TypeError: x is undefined", count: 5 },
            ],
            more: 0,
          },
        },
      },
    ]);
  });

  it("lists ten failures at most and says how many more there are", async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      app: "worker",
      message: `[q${i}] boom`,
      count: 1,
      lastAt: new Date(2026, 9, 12, 12, 0, i),
    }));
    const t = setup(many);
    expect(await handleErrorDigest(t.deps)).toEqual({ sent: true, items: 14 });
    const params = t.enqueued[0]?.payload.params as { items: unknown[]; more: number };
    expect(params.items).toHaveLength(10);
    expect(params.more).toBe(4);
  });
});
