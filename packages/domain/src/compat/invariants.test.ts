// Property tests and a field audit.
// - Random builds (values scaled, flipped or set to null) must never break the structural invariants of a result.
// - The audit nulls every spec field of a complete build one at a time: a field the rules read must turn the verdict
//   into "incomplete"; the fields that stay "ok" are listed explicitly, so a rule that stops reading a field (or a new
//   field nobody reads) shows up in review.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DETAILED_CATEGORIES } from "../catalog/index.ts";
import type { Product } from "../catalog/types.ts";
import { createGen, type Gen } from "../money/testkit.ts";
import { checkCompatibility, checkSetup, PC_RULES, SETUP_RULES } from "./index.ts";
import { COMPAT_MESSAGE_KEYS } from "./message-keys.ts";
import { build, ctx, makeProduct, type Part, pcBuild, settings, setupParts } from "./testkit.ts";
import type { CompatResult, SetupPlan, Task } from "./types.ts";

// Property tests run on a shared machine next to other work packages: allow time, the logic is not slow.
const SLOW = 60_000;
const pcOrder = PC_RULES.map((r) => r.id as string);
const setupOrder = SETUP_RULES.map((r) => r.id as string);

/** A PC with every optional part: AIO next to the tower cooler, lit fans, a SATA drive, office task. */
function fullPc(): Part[] {
  return pcBuild({
    add: [
      makeProduct("aio", "aio"),
      makeProduct("fan", "fan-argb", { argb: true, count: 1 }, { lighting: "argb" }),
      makeProduct("fan", "fan-rgb", { argb: false, count: 1 }, { lighting: "rgb" }),
      makeProduct("ssd", "hdd", { iface: "sata", formFactor: "2.5" }),
    ],
  });
}
const FULL_TASKS: Task[] = ["office"];

function fullSetup(): { parts: Part[]; plan: Omit<SetupPlan, "lines"> } {
  return {
    parts: setupParts({ withArm: true, qty: { monitor: 2 } }),
    plan: {
      room: { widthMm: 3000, depthMm: 2500, userHeightCm: 175 },
      placement: { arm: { xMm: 700, yMm: 0 } },
    },
  };
}

function nullField(parts: Part[], productId: string, field: string): Part[] {
  return parts.map((part) => {
    const p = Array.isArray(part) ? part[0] : part;
    if (p.id !== productId) return part;
    const spec = { ...(p.spec as Record<string, unknown>), [field]: null };
    const changed = { ...p, spec } as Product;
    return Array.isArray(part) ? ([changed, part[1]] as [Product, number]) : changed;
  });
}

function audit(parts: Part[], category: string, run: (p: Part[]) => CompatResult): string[] {
  const unused: string[] = [];
  for (const part of parts) {
    const p = Array.isArray(part) ? part[0] : part;
    if (p.category !== category) continue;
    for (const field of Object.keys(p.spec as object)) {
      const r = run(nullField(parts, p.id, field));
      if (r.verdict === "ok") unused.push(`${p.id}.${field}`);
      else expect(r.missingData, `${p.id}.${field}`).toContainEqual({ productId: p.id, field });
    }
  }
  return unused.sort();
}

describe("field audit: PC (a field a rule reads must not be silently unknown)", () => {
  const run = (parts: Part[]) => {
    const b = build(...parts);
    return checkCompatibility(b.lines, b.catalog, ctx(FULL_TASKS));
  };
  const parts = fullPc();

  it("the complete build is ok with all 28 rules checked", () => {
    const r = run(parts);
    expect(r.verdict).toBe("ok");
    expect(r.checkedRules).toEqual(pcOrder);
  });

  // Fields no PC rule reads (display, price class, other contexts) or reads only conditionally.
  const UNUSED: Record<string, string[]> = {
    cpu: ["cpu.boxCooler", "cpu.boostGhz", "cpu.cores", "cpu.hasIgpu", "cpu.tdpW", "cpu.threads"], // hasIgpu: only without a card
    mb: [
      "mb.bluetooth", // WIFI_FOR_TASK: one known "true" settles it
      "mb.biosFlashback", // CPU_MB_BIOS: read only when the shipped BIOS is older than the floor
      "mb.pcieX16Slots",
      "mb.wifi", // see bluetooth
    ],
    ram: ["ram.cl", "ram.lighting", "ram.profile"],
    ssd: ["hdd.capacityGb", "hdd.formFactor", "hdd.pcieGen", "hdd.tbw", "ssd.capacityGb", "ssd.pcieGen", "ssd.tbw"], // formFactor: NVMe only
    gpu: ["gpu.adapterInBox", "gpu.chip", "gpu.heightMm", "gpu.hwEncoders", "gpu.vramGb"], // adapterInBox: only for 12V-2x6
    psu: ["psu.atx3", "psu.modular", "psu.native12v2x6", "psu.rating"], // native12v2x6: only when the card needs it
    case: ["case.dimsMm"],
    cooler_air: [],
    aio: ["aio.pumpW", "aio.tubeLenMm"], // the pump is taken from the settings
    fan: ["fan-argb.conn", "fan-argb.sizeMm", "fan-rgb.conn", "fan-rgb.sizeMm"],
  };

  it.each(Object.entries(UNUSED))("%s: exactly the listed fields are not read", (category, expected) => {
    expect(audit(parts, category, run)).toEqual([...expected].sort());
  });

  it("covers every typed PC category", () => {
    const pcCategories = DETAILED_CATEGORIES.filter((c) => !["monitor", "arm", "desk", "chair"].includes(c));
    expect(Object.keys(UNUSED).sort()).toEqual([...pcCategories].sort());
  });
});

describe("field audit: setup", () => {
  const { parts, plan } = fullSetup();
  const run = (p: Part[]) => {
    const b = build(...p);
    return checkSetup({ ...plan, lines: b.lines }, b.catalog, settings());
  };

  it("the complete setup is ok with all 9 rules checked", () => {
    const r = run(parts);
    expect(r.verdict).toBe("ok");
    expect(r.checkedRules).toEqual(setupOrder);
  });

  const UNUSED: Record<string, string[]> = {
    desk: ["desk.cableCutout", "desk.heightMaxMm", "desk.heightMinMm", "desk.loadKg", "desk.motors"],
    monitor: [
      "monitor.aspect",
      "monitor.curved",
      "monitor.depthWithStandMm",
      "monitor.hz",
      "monitor.panelHmm",
      "monitor.resolution",
    ],
    arm: ["arm.poleHeightMm", "arm.reachMaxMm", "arm.reachMinMm"],
    chair: ["chair.baseDiamMm", "chair.seatHeightMaxMm", "chair.seatHeightMinMm", "chair.userMaxKg"],
  };

  it.each(Object.entries(UNUSED))("%s: exactly the listed fields are not read", (category, expected) => {
    expect(audit(parts, category, run)).toEqual([...expected].sort());
  });
});

// --- random builds ---------------------------------------------------------------------------------------------

/** Scales numbers and flips flags everywhere; unknown (null) values only at the top level, as `Nullable<T>` allows. */
function mutate(value: unknown, g: Gen, nullChance: number, top = true): unknown {
  if (Array.isArray(value)) return value.map((v) => mutate(v, g, nullChance, false));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        top && g.int(0, 99) < nullChance ? null : mutate(v, g, nullChance, false),
      ]),
    );
  }
  if (typeof value === "number") {
    const scaled = Math.round(value * (g.int(20, 300) / 100));
    return Math.max(1, scaled);
  }
  if (typeof value === "boolean") return g.bool() ? value : !value;
  return value;
}

function randomParts(seed: number, base: Part[], nullChance: number): Part[] {
  const g = createGen(seed);
  return base.map((part) => {
    const p = Array.isArray(part) ? part[0] : part;
    const changed = { ...p, spec: mutate(p.spec, g, nullChance) } as Product;
    const qty = g.int(1, 3);
    return [changed, qty] as [Product, number];
  });
}

function structural(r: CompatResult, order: string[], lineIds: Set<string>): void {
  expect(r.checkedRules).toEqual(order.filter((id) => r.checkedRules.includes(id as never)));
  for (const i of r.issues) {
    expect(r.checkedRules, i.messageKey).toContain(i.ruleId);
    const reg = COMPAT_MESSAGE_KEYS[i.messageKey];
    expect(reg, `unregistered ${i.messageKey}`).toBeDefined();
    expect(Object.keys(i.params).sort(), i.messageKey).toEqual([...(reg?.params ?? [])].sort());
    for (const id of i.productIds) expect(lineIds.has(id), `${i.messageKey}: ${id}`).toBe(true);
    for (const v of Object.values(i.params)) {
      if (typeof v === "number") expect(Number.isFinite(v), i.messageKey).toBe(true);
    }
  }
  const hasBlock = r.issues.some((i) => i.severity === "block");
  const missingIssues = r.issues.filter((i) => i.messageKey === "compat.missing_data");
  if (hasBlock) expect(r.verdict).toBe("block");
  else if (r.missingData.length > 0) expect(r.verdict).toBe("incomplete");
  else if (r.issues.length > 0) expect(r.verdict).toBe("warn");
  else expect(r.verdict).toBe("ok");
  for (const m of r.missingData) {
    if (m.field === "product") continue;
    expect(missingIssues.some((i) => i.productIds[0] === m.productId && i.params.field === m.field)).toBe(true);
  }
  for (const i of missingIssues) {
    expect(r.missingData).toContainEqual({ productId: i.productIds[0], field: i.params.field });
    expect(i.severity).toBe("warn");
  }
}

describe("random builds keep the structural invariants", () => {
  const pcBase = fullPc();
  it(
    "PC: scaled values, flipped flags and unknown (null) values",
    () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 2 ** 30 }), fc.constantFrom(0, 5, 25), (seed, nullChance) => {
          const parts = randomParts(seed, pcBase, nullChance);
          const b = build(...parts);
          const r = checkCompatibility(b.lines, b.catalog, ctx(["streaming", "office"]));
          structural(r, pcOrder, new Set(b.lines.map((l) => l.productId)));
          // the estimate is a finite non-negative number and the recommendation never below the peak x 1.3
          expect(Number.isFinite(r.power.peakW)).toBe(true);
          expect(r.power.peakW).toBeGreaterThanOrEqual(0);
          expect(r.power.recommendedPsuW).toBeGreaterThanOrEqual(Math.ceil(r.power.peakW * 1.3 - 1e-9));
        }),
        { numRuns: 150 },
      );
    },
    SLOW,
  );

  const { parts: setupBase, plan } = fullSetup();
  it(
    "setup: scaled values, flipped flags and unknown (null) values",
    () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 2 ** 30 }), fc.constantFrom(0, 5, 25), (seed, nullChance) => {
          const parts = randomParts(seed, setupBase, nullChance);
          const b = build(...parts);
          const r = checkSetup({ ...plan, lines: b.lines }, b.catalog, settings());
          structural(r, setupOrder, new Set(b.lines.map((l) => l.productId)));
          expect(r.power).toEqual({ peakW: 0, recommendedPsuW: 0 });
        }),
        { numRuns: 150 },
      );
    },
    SLOW,
  );
});

describe("monotonic properties", () => {
  const gpuRule = (gpuMm: number, caseMm: number) => {
    const b = build(
      ...pcBuild({
        gpu: { lengthMm: gpuMm },
        case: { gpuMaxLenMm: caseMm, gpuMaxLenWithFrontRadMm: Math.min(caseMm, 300) },
      }),
    );
    const r = checkCompatibility(b.lines, b.catalog, ctx());
    return r.issues.find((i) => i.ruleId === "GPU_CASE_LENGTH")?.severity;
  };
  const rank = (s: "block" | "warn" | undefined) => (s === "block" ? 2 : s === "warn" ? 1 : 0);

  it(
    "a longer case never makes the GPU length verdict worse",
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 150, max: 450 }),
          fc.integer({ min: 150, max: 450 }),
          fc.integer({ min: 0, max: 100 }),
          (gpu, caseMm, extra) => {
            expect(rank(gpuRule(gpu, caseMm + extra))).toBeLessThanOrEqual(rank(gpuRule(gpu, caseMm)));
          },
        ),
        { numRuns: 60 },
      );
    },
    SLOW,
  );

  it(
    "a more powerful PSU never makes the PSU verdict worse",
    () => {
      const psuRank = (watts: number) => {
        const b = build(...pcBuild({ psu: { watts }, gpu: { tgpW: 300, vendorRecommendedPsuW: 750 } }));
        const r = checkCompatibility(b.lines, b.catalog, ctx());
        return rank(r.issues.find((i) => i.ruleId === "PSU_WATTAGE")?.severity);
      };
      fc.assert(
        fc.property(fc.integer({ min: 200, max: 1500 }), fc.integer({ min: 0, max: 400 }), (watts, extra) => {
          expect(psuRank(watts + extra)).toBeLessThanOrEqual(psuRank(watts));
        }),
        { numRuns: 60 },
      );
    },
    SLOW,
  );
});
