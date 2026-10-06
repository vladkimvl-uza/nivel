// Public API: checkCompatibility, checkSetup, estimatePower, compatApi.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BuildLine } from "../catalog/types.ts";
import {
  checkCompatibility,
  checkSetup,
  compatApi,
  DEFAULT_COMPAT_SETTINGS,
  estimatePower,
  MAX_LINE_QTY,
  MAX_LINES,
  PC_RULES,
} from "./index.ts";
import { build, ctx, makeProduct, type Part, pcBuild, pid, settings, setupParts } from "./testkit.ts";
import type { CompatResult, RuleId, SetupPlan, Task } from "./types.ts";

const run = (parts: Part[], tasks: Task[] = [], over = {}): CompatResult => {
  const b = build(...parts);
  return checkCompatibility(b.lines, b.catalog, ctx(tasks, over));
};
const contractOrder = PC_RULES.map((r) => r.id);

describe("checkCompatibility: result shape", () => {
  it("an empty build is ok and checks nothing", () => {
    expect(run([])).toEqual({
      verdict: "ok",
      issues: [],
      power: { peakW: 0, recommendedPsuW: 0 },
      checkedRules: [],
      missingData: [],
    });
  });

  it("a complete compatible PC is ok, with 25 rules checked in contract order and the power estimate", () => {
    const r = run(pcBuild());
    expect(r.verdict).toBe("ok");
    expect(r.issues).toEqual([]);
    expect(r.missingData).toEqual([]);
    expect(r.checkedRules).toHaveLength(25);
    expect(r.checkedRules).toEqual(contractOrder.filter((id) => r.checkedRules.includes(id)));
    expect(r.checkedRules).not.toContain("AIO_RADIATOR_MOUNT");
    expect(r.checkedRules).not.toContain("WIFI_FOR_TASK");
    expect(r.power).toMatchObject({ peakW: 293, recommendedPsuW: 550, selectedPsuW: 650 });
  });

  it("the task list switches the Wi-Fi rule on", () => {
    expect(run(pcBuild(), ["office"]).checkedRules).toHaveLength(26);
    expect(run(pcBuild(), ["gaming", "programming", "design3d"]).checkedRules).toHaveLength(25);
  });

  it("an AIO build checks the radiator rules instead of the tower cooler rules", () => {
    const r = run(pcBuild({ drop: ["cooler"], add: [makeProduct("aio", "aio")] }));
    expect(r.checkedRules).toHaveLength(24);
    expect(r.checkedRules).toEqual(expect.arrayContaining(["AIO_RADIATOR_MOUNT", "AIO_RADIATOR_THICKNESS"]));
    expect(r.checkedRules).not.toContain("COOLER_TDP");
    expect(r.verdict).toBe("ok");
  });

  it("a partial build checks only the rules that have both parts (a configurator step by step)", () => {
    const r = run([makeProduct("cpu", "cpu"), makeProduct("mb", "mb")]);
    expect(r.checkedRules).toEqual(
      ["CPU_MB_SOCKET", "CPU_MB_CHIPSET", "CPU_MB_BIOS", "CPU_NO_VIDEO", "FAN_HEADERS", "ARGB_HEADERS"].sort(
        (a, b) => contractOrder.indexOf(a as RuleId) - contractOrder.indexOf(b as RuleId),
      ),
    );
    expect(r.verdict).toBe("block"); // no integrated graphics and no video card yet
  });
});

describe("checkCompatibility: verdict", () => {
  it("warn: only warnings", () => {
    expect(run(pcBuild({ gpu: { lengthMm: 325 } })).verdict).toBe("warn");
  });
  it("block: any block wins over warnings and missing data", () => {
    const r = run(pcBuild({ gpu: { lengthMm: 400 }, cooler: { heightMm: 162 }, ram: { mts: null } }));
    expect(r.verdict).toBe("block");
    expect(r.missingData.length).toBeGreaterThan(0);
  });
  it("incomplete: missing data beats a plain warning, and never ends in ok", () => {
    const r = run(pcBuild({ gpu: { lengthMm: 325 }, ram: { mts: null } }));
    expect(r.verdict).toBe("incomplete");
    expect(r.issues.some((i) => i.severity === "warn" && i.messageKey === "compat.gpu_tight_fit")).toBe(true);
  });
  it("a fully unknown spec never produces ok: every rule that needs the data reports it", () => {
    const blank = (id: "cpu" | "mb") =>
      makeProduct(id, id, Object.fromEntries(Object.keys(makeProduct(id, id).spec).map((k) => [k, null])));
    const r = run([blank("cpu"), blank("mb")]);
    expect(r.verdict).toBe("incomplete");
    expect(r.issues.every((i) => i.messageKey === "compat.missing_data")).toBe(true);
    expect(r.missingData).toContainEqual({ productId: "cpu", field: "socket" });
    expect(r.missingData).toContainEqual({ productId: "mb", field: "chipset" });
  });
  it("missingData lists each (product, field) once even when several rules need it", () => {
    const r = run(pcBuild({ cpu: { socket: null } }));
    const sockets = r.missingData.filter((m) => m.productId === "cpu" && m.field === "socket");
    expect(sockets).toHaveLength(1);
    const rules = r.issues
      .filter((i) => i.messageKey === "compat.missing_data" && i.params.field === "socket")
      .map((i) => i.ruleId);
    expect(rules).toEqual(expect.arrayContaining(["CPU_MB_SOCKET", "COOLER_SOCKET"]));
  });
});

describe("checkCompatibility: input handling", () => {
  it("a product missing from the catalog is reported as missing data (field `product`) and the rest is still checked", () => {
    const b = build(...pcBuild({ gpu: { lengthMm: 400 } }));
    const lines: BuildLine[] = [...b.lines, { productId: pid("ghost"), qty: 1 }];
    const r = checkCompatibility(lines, b.catalog, ctx());
    expect(r.missingData).toContainEqual({ productId: "ghost", field: "product" });
    expect(r.verdict).toBe("block");
    const clean = build(...pcBuild());
    const r2 = checkCompatibility([...clean.lines, { productId: pid("ghost"), qty: 1 }], clean.catalog, ctx());
    expect(r2.verdict).toBe("incomplete");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects quantity %s with RangeError", (qty) => {
    const b = build(makeProduct("cpu", "cpu"));
    expect(() => checkCompatibility([{ productId: pid("cpu"), qty }], b.catalog, ctx())).toThrow(RangeError);
    expect(() => estimatePower([{ productId: pid("cpu"), qty }], b.catalog, settings())).toThrow(RangeError);
  });

  it("two lines of the same product behave like one line with the summed quantity", () => {
    const ram = makeProduct("ram", "ram");
    const rest = pcBuild({ drop: ["ram"] });
    const one = build(...rest, ram);
    const split = checkCompatibility([...one.lines, { productId: ram.id, qty: 1 }], one.catalog, ctx());
    const two = build(...rest, [ram, 2]);
    const merged = checkCompatibility(two.lines, two.catalog, ctx());
    expect(split).toEqual(merged);
  });

  it("two lines of an incompatible product give the same single finding as one line", () => {
    const rest = pcBuild({ drop: ["ram"] });
    const ram = makeProduct("ram", "ram", { type: "DDR4" });
    const one = build(...rest, ram);
    const split = checkCompatibility([...one.lines, { productId: ram.id, qty: 1 }], one.catalog, ctx());
    const merged = checkCompatibility(build(...rest, [ram, 2]).lines, one.catalog, ctx());
    expect(split.issues.filter((i) => i.messageKey === "compat.mem_type_board")).toHaveLength(1);
    expect(split).toEqual(merged);
  });

  it("limits the quantity of a line, the summed quantity of a product and the number of lines (no huge loops)", () => {
    const b = build(...pcBuild());
    const nvme = pid("ssd");
    const started = Date.now();
    const bad = (lines: BuildLine[]) => () => checkCompatibility(lines, b.catalog, ctx());
    expect(bad([...b.lines, { productId: nvme, qty: MAX_LINE_QTY + 1 }])).toThrow(RangeError);
    expect(bad([...b.lines, { productId: nvme, qty: 100_000_000 }])).toThrow(RangeError);
    expect(bad([...b.lines, { productId: nvme, qty: MAX_LINE_QTY }, { productId: nvme, qty: 1 }])).toThrow(RangeError);
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => ({ productId: pid(`ghost-${i}`), qty: 1 }));
    expect(bad(many)).toThrow(RangeError);
    expect(() => estimatePower([{ productId: nvme, qty: 1_000_000_000 }], b.catalog, settings())).toThrow(RangeError);
    const sb = build(...setupParts());
    const plan: SetupPlan = {
      room: { widthMm: 1, depthMm: 1 },
      lines: [...sb.lines, { productId: pid("monitor"), qty: 1_000_000_000 }],
    };
    expect(() => checkSetup(plan, sb.catalog, settings())).toThrow(RangeError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("accepts the largest allowed quantity", () => {
    const b = build(...pcBuild());
    const lines = b.lines.map((l) => (l.productId === "ssd" ? { ...l, qty: MAX_LINE_QTY } : l));
    expect(() => checkCompatibility(lines, b.catalog, ctx())).not.toThrow();
  });

  it("a PC holds one processor, board, case and PSU: more than one is a caller bug (RangeError)", () => {
    const b = build(...pcBuild());
    const twin = (id: string, category: "cpu" | "mb" | "case" | "psu") =>
      build(...pcBuild(), makeProduct(category, `${id}-2`));
    for (const [id, category] of [
      ["cpu", "cpu"],
      ["mb", "mb"],
      ["case", "case"],
      ["psu", "psu"],
    ] as const) {
      const t = twin(id, category);
      expect(() => checkCompatibility(t.lines, t.catalog, ctx()), `second ${id}`).toThrow(RangeError);
      // either order: no silent dependence on which one comes first
      expect(() => checkCompatibility([...t.lines].reverse(), t.catalog, ctx()), `second ${id}`).toThrow(RangeError);
    }
    const two = b.lines.map((l) => (l.productId === "mb" ? { ...l, qty: 2 } : l));
    expect(() => checkCompatibility(two, b.catalog, ctx())).toThrow(RangeError);
  });

  it("customer-owned parts are checked like any other part (they only leave the price)", () => {
    const b = build(...pcBuild({ gpu: { lengthMm: 400 } }));
    const own = b.lines.map((l) => (l.productId === "gpu" ? { ...l, customerOwned: true } : l));
    const mine = checkCompatibility(own, b.catalog, ctx());
    const bought = checkCompatibility(b.lines, b.catalog, ctx());
    expect(mine).toEqual(bought);
    expect(mine.verdict).toBe("block");
  });

  it("does not mutate its inputs", () => {
    const b = build(...pcBuild());
    const frozen = JSON.stringify([b.lines, b.products, DEFAULT_COMPAT_SETTINGS]);
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === "object" && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
    };
    deepFreeze(b.lines);
    deepFreeze(b.products);
    const c = { tasks: ["office"] as Task[], settings: settings() };
    deepFreeze(c);
    expect(() => checkCompatibility(b.lines, b.catalog, c)).not.toThrow();
    expect(JSON.stringify([b.lines, b.products, DEFAULT_COMPAT_SETTINGS])).toBe(frozen);
  });

  it("is deterministic and independent of the order of lines (property)", () => {
    const parts = pcBuild({
      gpu: { lengthMm: 325 },
      cooler: { tdpRatedW: 60 },
      qty: { ram: 3 },
      add: [makeProduct("fan", "fan")],
    });
    const base = run(parts, ["office"]);
    fc.assert(
      fc.property(fc.shuffledSubarray(parts, { minLength: parts.length, maxLength: parts.length }), (shuffled) => {
        const r = run(shuffled, ["office"]);
        const key = (x: CompatResult) =>
          JSON.stringify({
            v: x.verdict,
            i: x.issues.map((i) => `${i.ruleId}|${i.messageKey}|${[...i.productIds].sort()}`).sort(),
            c: x.checkedRules,
            m: x.missingData.map((m) => `${m.productId}.${m.field}`).sort(),
            p: x.power,
          });
        expect(key(r)).toBe(key(base));
      }),
      { numRuns: 50 },
    );
  }, 60_000);

  it("settings are arguments: a different margin gives a different verdict", () => {
    const parts = pcBuild({ gpu: { lengthMm: 300 } });
    expect(run(parts).verdict).toBe("ok");
    expect(run(parts, [], { gpuLenWarnMarginMm: 50 }).verdict).toBe("warn");
  });

  it("every issue is well formed", () => {
    const r = run(pcBuild({ gpu: { lengthMm: 400 }, mb: { socket: "AM4" }, ram: { mts: null } }));
    expect(r.issues.length).toBeGreaterThan(2);
    for (const i of r.issues) {
      expect(i.messageKey).toMatch(/^compat\.[a-z0-9_]+$/);
      expect(["block", "warn"]).toContain(i.severity);
      expect(i.productIds.length).toBeGreaterThan(0);
      expect(new Set(i.productIds).size).toBe(i.productIds.length);
      for (const v of Object.values(i.params)) expect(["string", "number"]).toContain(typeof v);
      expect(contractOrder).toContain(i.ruleId);
    }
  });
});

describe("checkSetup", () => {
  const plan = (parts: Part[], over: Partial<SetupPlan> = {}) => {
    const b = build(...parts);
    const p: SetupPlan = { room: { widthMm: 3000, depthMm: 2500, userHeightCm: 175 }, lines: b.lines, ...over };
    return checkSetup(p, b.catalog, settings());
  };

  it("an empty plan is ok and checks nothing; power is zero", () => {
    expect(plan([])).toEqual({
      verdict: "ok",
      issues: [],
      power: { peakW: 0, recommendedPsuW: 0 },
      checkedRules: [],
      missingData: [],
    });
  });

  it("a complete desk setup is ok with the applicable setup rules checked", () => {
    const r = plan(setupParts({ withArm: true }));
    expect(r.verdict).toBe("ok");
    expect(r.checkedRules).toEqual([
      "DESK_DEPTH_EYES",
      "DESK_WIDTH_MONITORS",
      "ARM_VESA",
      "ARM_LOAD",
      "ARM_DIAGONAL",
      "ARM_DESK_THICKNESS",
      "CHAIR_ROLLBACK",
      "CHAIR_USER_HEIGHT",
    ]);
  });

  it("runs setup rules only: PC parts in the plan are ignored", () => {
    const r = plan([...setupParts(), ...pcBuild({ gpu: { lengthMm: 999 } })]);
    expect(r.issues).toEqual([]);
    expect(r.power).toEqual({ peakW: 0, recommendedPsuW: 0 });
  });

  it("an unknown product is missing data", () => {
    const b = build(...setupParts());
    const r = checkSetup(
      { room: { widthMm: 3000, depthMm: 2500 }, lines: [...b.lines, { productId: pid("ghost"), qty: 1 }] },
      b.catalog,
      settings(),
    );
    expect(r.missingData).toContainEqual({ productId: "ghost", field: "product" });
    expect(r.verdict).toBe("incomplete");
  });

  it("rejects a non-positive quantity", () => {
    const b = build(...setupParts());
    expect(() =>
      checkSetup(
        { room: { widthMm: 1, depthMm: 1 }, lines: [{ productId: pid("desk"), qty: 0 }] },
        b.catalog,
        settings(),
      ),
    ).toThrow(RangeError);
  });

  it("monitors beyond the arm places stand on their own stands", () => {
    // one single-screen arm, two monitors: the second one is checked as a stand monitor (depth to the eyes)
    const parts = setupParts({ withArm: true, qty: { monitor: 2 }, desk: { topDmm: 600 } });
    const r = plan(parts);
    expect(r.issues.map((i) => i.messageKey)).toEqual(["compat.eye_distance_short"]);
  });

  it("a two-screen arm carries two monitors", () => {
    const parts = setupParts({ withArm: true, qty: { monitor: 2 }, arm: { screens: 2 }, desk: { topDmm: 600 } });
    expect(plan(parts).issues).toEqual([]);
  });

  it("an arm with unknown screen count carries one monitor and reports the gap", () => {
    const parts = setupParts({ withArm: true, arm: { screens: null } });
    const r = plan(parts);
    expect(r.missingData).toContainEqual({ productId: "arm", field: "screens" });
    expect(r.verdict).toBe("incomplete");
  });
});

describe("compatApi", () => {
  it("exposes the three contract functions", () => {
    expect(compatApi.checkCompatibility).toBe(checkCompatibility);
    expect(compatApi.checkSetup).toBe(checkSetup);
    expect(compatApi.estimatePower).toBe(estimatePower);
  });
});
