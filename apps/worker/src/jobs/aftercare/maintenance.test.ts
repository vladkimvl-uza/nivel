import type { ops } from "@nivel/db/repos";
import { describe, expect, it } from "vitest";
import { FakeClock, recordingLogger } from "../../queues/test-support/fakes.ts";
import { type Candidate, handleMaintenance, MAINTENANCE_MONTHS, type MaintenanceDeps } from "./maintenance.ts";

const at = (iso: string) => new Date(`${iso}+05:00`);

function setup(candidates: Candidate[], now: Date) {
  const clock = new FakeClock(now);
  const enqueued: ops.OutboxInput[] = [];
  const seen = new Set<string>();
  const { log } = recordingLogger();
  const deps: MaintenanceDeps = {
    now: clock.now,
    log,
    candidates: async () => candidates,
    enqueue: async (input) => {
      const duplicate = input.dedupeKey !== undefined && seen.has(input.dedupeKey);
      if (input.dedupeKey !== undefined) seen.add(input.dedupeKey);
      if (!duplicate) enqueued.push(input);
      return { id: "x", duplicate };
    },
  };
  return { deps, enqueued };
}

const order = (handed: string, id = "o-1"): Candidate => ({
  orderId: id,
  orderNumber: `NV-${id}`,
  handedOverAt: at(handed),
});

describe("handleMaintenance: preventive maintenance 6 and 12 months after the handover (ARCHITECTURE 9, aftercare)", () => {
  it("has the terms of 6 and 12 months", () => {
    expect(MAINTENANCE_MONTHS).toEqual([6, 12]);
  });

  it("tells the owner when six months have passed since the handover, once", async () => {
    const t = setup([order("2026-04-10T15:00:00")], at("2026-10-10T16:00:00"));
    expect(await handleMaintenance(t.deps)).toEqual({ reminded: 1 });
    expect(t.enqueued).toEqual([
      {
        kind: "telegram_message",
        dedupeKey: "order:o-1:maintenance:6",
        priority: 1,
        payload: {
          target: "owner_topic",
          templateKey: "reminder.maintenance",
          orderId: "o-1",
          orderNumber: "NV-o-1",
          params: { months: 6 },
        },
      },
    ]);
    expect(await handleMaintenance(t.deps)).toEqual({ reminded: 0 });
  });

  it("waits until the six months are full, by the calendar months of Tashkent", async () => {
    const t = setup([order("2026-04-10T15:00:00")], at("2026-10-10T14:59:00"));
    expect(await handleMaintenance(t.deps)).toEqual({ reminded: 0 });
    const day = setup([order("2026-04-10T15:00:00")], at("2026-10-10T15:00:00"));
    expect(await handleMaintenance(day.deps)).toEqual({ reminded: 1 });
  });

  it("tells again at twelve months", async () => {
    const t = setup([order("2025-10-10T15:00:00")], at("2026-10-10T16:00:00"));
    expect((await handleMaintenance(t.deps)).reminded).toBe(1);
    expect(t.enqueued[0]?.payload.params).toEqual({ months: 12 });
  });

  it("does not wake up an old order for a term that passed long ago (a month and a half is the limit): the worker was just started", async () => {
    const t = setup([order("2025-01-10T15:00:00")], at("2026-10-10T16:00:00"));
    expect(await handleMaintenance(t.deps)).toEqual({ reminded: 0 });
  });

  it("goes on after a day without the worker: a term that passed a few days ago is told now", async () => {
    const t = setup([order("2026-04-05T15:00:00")], at("2026-10-12T10:00:00"));
    expect(await handleMaintenance(t.deps)).toEqual({ reminded: 1 });
  });

  it("is quiet without orders", async () => {
    expect(await handleMaintenance(setup([], at("2026-10-10T10:00:00")).deps)).toEqual({ reminded: 0 });
  });
});
