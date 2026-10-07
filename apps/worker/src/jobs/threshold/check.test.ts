import type { ops } from "@nivel/db/repos";
import { bp, sum } from "@nivel/domain/money";
import type { ThresholdStatus } from "@nivel/domain/threshold";
import { describe, expect, it } from "vitest";
import { recordingLogger } from "../../queues/test-support/fakes.ts";
import { handleThresholdCheck, type ThresholdDeps } from "./check.ts";

function status(over: Partial<ThresholdStatus> = {}): ThresholdStatus {
  return {
    year: 2026,
    limit: sum(1_000_000_000),
    volume: sum(0),
    committed: sum(0),
    shareBp: bp(0),
    projectedShareBp: bp(0),
    crossedAlerts: [],
    overPlanCap: false,
    remaining: sum(1_000_000_000),
    ...over,
  };
}

function setup(over: { status?: ThresholdStatus; planCap?: number | null; now?: Date } = {}) {
  const snapshots: ops.ThresholdSnapshotInput[] = [];
  const enqueued: ops.OutboxInput[] = [];
  const asked: (number | undefined)[] = [];
  const { log } = recordingLogger();
  const deps: ThresholdDeps = {
    now: () => over.now ?? new Date("2026-10-12T10:00:00+05:00"),
    log,
    status: async (year) => {
      asked.push(year);
      return over.status ?? status();
    },
    planCap: async () => (over.planCap === undefined ? 200_000_000 : over.planCap),
    saveSnapshot: async (s) => {
      snapshots.push(s);
    },
    enqueue: async (input) => {
      enqueued.push(input);
      return { id: "x", duplicate: false };
    },
  };
  return { deps, snapshots, enqueued, asked };
}

describe("handleThresholdCheck: the status of the threshold, the snapshot of the day and the alerts", () => {
  it("writes the snapshot of the day: volume, what is committed, the limit, the plan and the share", async () => {
    const t = setup({
      status: status({
        volume: sum(623_400_000),
        committed: sum(50_000_000),
        shareBp: bp(6234),
        projectedShareBp: bp(6734),
        crossedAlerts: [bp(6000)],
      }),
    });
    await handleThresholdCheck(t.deps);
    expect(t.snapshots).toEqual([
      {
        year: 2026,
        asOf: "2026-10-12",
        dealsSum: 623_400_000,
        committedSum: 50_000_000,
        limitSum: 1_000_000_000,
        planCapSum: 200_000_000,
        shareBp: 6234,
      },
    ]);
  });

  it("leaves the plan out of the snapshot when the owner has set none", async () => {
    const t = setup({ planCap: null });
    await handleThresholdCheck(t.deps);
    expect(t.snapshots[0]).not.toHaveProperty("planCapSum");
  });

  it("takes the day and the year from the calendar of Tashkent", async () => {
    const t = setup({ now: new Date("2026-12-31T20:00:00Z") }); // already 1 January 2027 there
    await handleThresholdCheck(t.deps);
    expect(t.asked).toEqual([2027]);
    expect(t.snapshots[0]).toMatchObject({ year: 2027, asOf: "2027-01-01" });
  });

  it("is quiet below the first level", async () => {
    const t = setup({ status: status({ volume: sum(500_000_000), shareBp: bp(5000) }) });
    expect(await handleThresholdCheck(t.deps)).toEqual({ alerts: [] });
    expect(t.enqueued).toEqual([]);
  });

  it("tells the owner of every level the share has crossed, once for each level and year", async () => {
    const t = setup({
      status: status({
        volume: sum(735_000_000),
        shareBp: bp(7350),
        projectedShareBp: bp(7350),
        crossedAlerts: [bp(6000), bp(7000)],
      }),
    });
    expect(await handleThresholdCheck(t.deps)).toEqual({ alerts: [6000, 7000] });
    expect(t.enqueued).toEqual([
      {
        kind: "telegram_message",
        dedupeKey: "threshold:2026:6000",
        priority: 5,
        payload: {
          target: "group",
          templateKey: "threshold.alert",
          lang: "ru",
          params: { year: 2026, levelBp: 6000, shareBp: 7350, volume: 735_000_000, limit: 1_000_000_000 },
        },
      },
      {
        kind: "telegram_message",
        dedupeKey: "threshold:2026:7000",
        priority: 5,
        payload: {
          target: "group",
          templateKey: "threshold.alert",
          lang: "ru",
          params: { year: 2026, levelBp: 7000, shareBp: 7350, volume: 735_000_000, limit: 1_000_000_000 },
        },
      },
    ]);
  });

  it("tells all five levels at 100 %", async () => {
    const t = setup({
      status: status({
        volume: sum(1_000_000_000),
        shareBp: bp(10_000),
        crossedAlerts: [bp(6000), bp(7000), bp(8000), bp(9000), bp(10_000)],
      }),
    });
    const result = await handleThresholdCheck(t.deps);
    expect(result.alerts).toEqual([6000, 7000, 8000, 9000, 10_000]);
    expect(t.enqueued.map((e) => e.dedupeKey)).toEqual([
      "threshold:2026:6000",
      "threshold:2026:7000",
      "threshold:2026:8000",
      "threshold:2026:9000",
      "threshold:2026:10000",
    ]);
  });

  it("tells that the forecast is over the plan, once a year", async () => {
    const t = setup({
      status: status({
        volume: sum(100_000_000),
        committed: sum(150_000_000),
        projectedShareBp: bp(2500),
        overPlanCap: true,
      }),
    });
    expect(await handleThresholdCheck(t.deps)).toEqual({ alerts: ["plan"] });
    expect(t.enqueued).toEqual([
      {
        kind: "telegram_message",
        dedupeKey: "threshold:2026:plan",
        priority: 5,
        payload: {
          target: "group",
          templateKey: "threshold.plan",
          lang: "ru",
          params: { year: 2026, planCap: 200_000_000, projectedShareBp: 2500 },
        },
      },
    ]);
  });

  it("does not tell about the plan without a plan", async () => {
    const t = setup({ planCap: null, status: status({ overPlanCap: true }) });
    expect(await handleThresholdCheck(t.deps)).toEqual({ alerts: [] });
  });

  it("recounts on the same snapshot when it is run again after a payment: the snapshot is the same day's", async () => {
    const t = setup({ status: status({ volume: sum(10), shareBp: bp(0) }) });
    await handleThresholdCheck(t.deps);
    await handleThresholdCheck(t.deps);
    expect(t.snapshots.map((s) => s.asOf)).toEqual(["2026-10-12", "2026-10-12"]);
  });
});
