import type { ops } from "@nivel/db/repos";
import { describe, expect, it } from "vitest";
import { FakeClock, recordingLogger } from "../../queues/test-support/fakes.ts";
import { type EsfDeps, type EsfDue, handleEsfReminders } from "./esf.ts";

function setup(due: EsfDue[], now = new Date("2026-10-22T10:00:00+05:00")) {
  const clock = new FakeClock(now);
  const enqueued: ops.OutboxInput[] = [];
  const asked: string[] = [];
  const seen = new Set<string>();
  const { log } = recordingLogger();
  const deps: EsfDeps = {
    now: clock.now,
    log,
    esfDue: async (today) => {
      asked.push(today);
      return due;
    },
    enqueue: async (input) => {
      const duplicate = input.dedupeKey !== undefined && seen.has(input.dedupeKey);
      if (input.dedupeKey !== undefined) seen.add(input.dedupeKey);
      if (!duplicate) enqueued.push(input);
      return { id: "x", duplicate };
    },
  };
  return { deps, enqueued, asked };
}

const esf = (over: Partial<EsfDue> = {}): EsfDue => ({
  purchaseId: "p-1",
  orderId: "o-1",
  orderNumber: "NV-2026-0001",
  dueDate: "2026-10-22",
  ...over,
});

describe("handleEsfReminders: the ESF of a purchase is due 10 days after it", () => {
  it("asks for the purchases whose ESF is due by the date of Tashkent", async () => {
    const t = setup([], new Date("2026-10-21T20:00:00Z")); // already the 22nd in Tashkent
    await handleEsfReminders(t.deps);
    expect(t.asked).toEqual(["2026-10-22"]);
  });

  it("tells the owner in the topic of the order, once for each purchase", async () => {
    const t = setup([esf(), esf({ purchaseId: "p-2", dueDate: "2026-10-20" })]);
    expect(await handleEsfReminders(t.deps)).toEqual({ reminded: 2 });
    expect(t.enqueued).toEqual([
      {
        kind: "telegram_message",
        dedupeKey: "purchase:p-1:esf_due",
        priority: 3,
        payload: {
          target: "owner_topic",
          templateKey: "reminder.esf_due",
          orderId: "o-1",
          orderNumber: "NV-2026-0001",
          params: { dueDate: "2026-10-22" },
        },
      },
      {
        kind: "telegram_message",
        dedupeKey: "purchase:p-2:esf_due",
        priority: 3,
        payload: {
          target: "owner_topic",
          templateKey: "reminder.esf_due",
          orderId: "o-1",
          orderNumber: "NV-2026-0001",
          params: { dueDate: "2026-10-20" },
        },
      },
    ]);
    expect(await handleEsfReminders(t.deps)).toEqual({ reminded: 0 });
  });

  it("is quiet when no ESF is due", async () => {
    expect(await handleEsfReminders(setup([]).deps)).toEqual({ reminded: 0 });
  });
});
