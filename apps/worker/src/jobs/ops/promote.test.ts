import type { ops } from "@nivel/db/repos";
import { DEFAULT_FEE_SETTINGS } from "@nivel/domain/fee";
import { describe, expect, it, vi } from "vitest";
import { FakeClock, recordingLogger } from "../../queues/test-support/fakes.ts";
import { isFeeScaleShape, NOTHING_SCHEDULED, type PromoteDeps, promoteDueFeeScale } from "./promote.ts";

const scale = (over: Record<string, unknown> = {}) => ({
  ...structuredClone(DEFAULT_FEE_SETTINGS),
  version: "2026-11-01",
  effectiveFrom: "2026-11-01",
  pcLowRateBp: 1400,
  ...over,
});

function setup(o: { next?: unknown; canWrite?: boolean; now?: Date } = {}) {
  const clock = new FakeClock(o.now ?? new Date("2026-11-01T00:05:00+05:00"));
  const promoted: unknown[] = [];
  const enqueued: ops.OutboxInput[] = [];
  const { log, lines } = recordingLogger();
  const deps: PromoteDeps = {
    now: clock.now,
    log,
    readNext: async () => (o.next === undefined ? null : o.next),
    canWrite: async () => o.canWrite ?? true,
    promote: vi.fn(async (next) => {
      promoted.push(next);
    }),
    enqueue: async (input) => {
      enqueued.push(input);
      return { id: "x", duplicate: false };
    },
  };
  return { deps, promoted, enqueued, lines };
}

describe("promoteDueFeeScale: the scheduled scale of the fee comes into force on its day", () => {
  it("puts the scale into force on the day it takes effect and clears the slot", async () => {
    const t = setup({ next: scale() });
    expect(await promoteDueFeeScale(t.deps)).toEqual({ outcome: "promoted", effectiveFrom: "2026-11-01" });
    expect(t.promoted).toEqual([scale()]);
  });

  it("tells the site to drop the cached price list: the tags settings and fee, once for that scale", async () => {
    const t = setup({ next: scale() });
    await promoteDueFeeScale(t.deps);
    expect(t.enqueued).toEqual([
      {
        kind: "job",
        dedupeKey: "web.revalidate:fee-promoted:2026-11-01",
        payload: { job: "web.revalidate", tags: ["settings", "fee"] },
      },
    ]);
  });

  it("does nothing before the day, by the calendar of Tashkent (the evening before in UTC is already the day there)", async () => {
    const early = setup({ next: scale(), now: new Date("2026-10-31T23:59:00+05:00") });
    expect(await promoteDueFeeScale(early.deps)).toEqual({ outcome: "not_due", effectiveFrom: "2026-11-01" });
    expect(early.promoted).toEqual([]);
    const utcEvening = setup({ next: scale(), now: new Date("2026-10-31T19:00:00Z") }); // 00:00 on 1 November in Tashkent
    expect((await promoteDueFeeScale(utcEvening.deps)).outcome).toBe("promoted");
  });

  it("puts a scale into force that was due days ago (the worker was down on the day)", async () => {
    const t = setup({ next: scale(), now: new Date("2026-11-04T00:05:00+05:00") });
    expect((await promoteDueFeeScale(t.deps)).outcome).toBe("promoted");
  });

  it("does nothing when nothing is scheduled: the slot is empty or holds the mark of a cleared one", async () => {
    for (const next of [undefined, NOTHING_SCHEDULED, { cleared: true }, null]) {
      const t = setup({ next });
      expect(await promoteDueFeeScale(t.deps)).toEqual({ outcome: "none" });
      expect(t.promoted).toEqual([]);
    }
  });

  it("does not put a damaged scale into force, and tells the owner", async () => {
    for (const next of [
      scale({ pcLowRateBp: "15 %" }),
      scale({ effectiveFrom: "soon" }),
      { ...scale(), extra: 1 },
      "text",
      5,
      scale({ stageSharesBp: null }),
    ]) {
      const t = setup({ next });
      expect(await promoteDueFeeScale(t.deps)).toEqual({ outcome: "invalid" });
      expect(t.promoted).toEqual([]);
      expect(t.enqueued).toHaveLength(1);
      expect(t.enqueued[0]?.payload).toMatchObject({ templateKey: "ops.alert", params: { check: "fee_scale" } });
    }
  });

  it("leaves the scale in its slot when the role has no right to write the settings, and says why", async () => {
    const t = setup({ next: scale(), canWrite: false });
    expect(await promoteDueFeeScale(t.deps)).toEqual({ outcome: "no_right", effectiveFrom: "2026-11-01" });
    expect(t.promoted).toEqual([]);
    expect(t.lines.some((l) => l.level === "warn" && String(l.message).includes("ops.settings"))).toBe(true);
  });

  it("does not look at the right when there is nothing to put into force", async () => {
    const canWrite = vi.fn(async () => false);
    const t = setup({ next: undefined });
    t.deps.canWrite = canWrite;
    await promoteDueFeeScale(t.deps);
    expect(canWrite).not.toHaveBeenCalled();
  });
});

describe("isFeeScaleShape: the shape of FeeSettings of the domain", () => {
  it("accepts the defaults of the domain and a changed copy", () => {
    expect(isFeeScaleShape(structuredClone(DEFAULT_FEE_SETTINGS))).toBe(true);
    expect(isFeeScaleShape(scale())).toBe(true);
  });

  it("refuses a missing key, an extra key, a fraction where a whole number is, a wrong kind of value", () => {
    const { pcHighRateBp: _gone, ...missing } = scale();
    expect(isFeeScaleShape(missing)).toBe(false);
    expect(isFeeScaleShape({ ...scale(), extra: 1 })).toBe(false);
    expect(isFeeScaleShape(scale({ pcLowRateBp: 1400.5 }))).toBe(false);
    expect(isFeeScaleShape(scale({ pcThreshold: "20000000" }))).toBe(false);
    expect(isFeeScaleShape(scale({ commissionLineStages: "selection" }))).toBe(false);
    expect(isFeeScaleShape(scale({ commissionLineStages: [1] }))).toBe(false);
    expect(isFeeScaleShape(scale({ version: "" }))).toBe(false);
    expect(isFeeScaleShape(scale({ effectiveFrom: "2026-13-40" }))).toBe(false);
    expect(isFeeScaleShape(scale({ shelfLifeHours: { components: 24 } }))).toBe(false);
    expect(isFeeScaleShape(null)).toBe(false);
    expect(isFeeScaleShape([])).toBe(false);
  });
});
