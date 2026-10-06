// One table-driven suite for every PC rule: "block" / "warn" / "no data" / "not applicable" (BUILD_PLAN WP-03 acceptance).
import { describe, expect, it } from "vitest";
import { checkCompatibility } from "../index.ts";
import { PC_SCENARIOS, type RuleScenario } from "../scenarios.suite.ts";
import { build, ctx, type Part } from "../testkit.ts";
import type { RuleId, Task } from "../types.ts";
import { PC_RULES, SETUP_RULES } from "./index.ts";

const ALL_RULE_IDS: RuleId[] = [
  "CPU_MB_SOCKET",
  "CPU_MB_CHIPSET",
  "CPU_MB_BIOS",
  "CPU_NO_VIDEO",
  "MEM_TYPE",
  "MEM_SLOTS",
  "MEM_CAPACITY",
  "MEM_SPEED",
  "MEM_COOLER_CLEARANCE",
  "MB_CASE_FORMFACTOR",
  "GPU_CASE_LENGTH",
  "GPU_SLOT_WIDTH",
  "COOLER_SOCKET",
  "COOLER_CASE_HEIGHT",
  "COOLER_TDP",
  "AIO_RADIATOR_MOUNT",
  "AIO_RADIATOR_THICKNESS",
  "PSU_WATTAGE",
  "PSU_GPU_CONNECTORS",
  "PSU_CASE_FORMFACTOR",
  "PSU_CASE_LENGTH",
  "M2_SLOTS",
  "M2_LENGTH",
  "M2_SATA_SHARING",
  "SATA_PORTS",
  "ARGB_HEADERS",
  "FAN_HEADERS",
  "WIFI_FOR_TASK",
  "DESK_DEPTH_EYES",
  "DESK_WIDTH_MONITORS",
  "ARM_VESA",
  "ARM_LOAD",
  "ARM_DIAGONAL",
  "ARM_DESK_THICKNESS",
  "ARM_CLAMP_ZONE",
  "CHAIR_ROLLBACK",
  "CHAIR_USER_HEIGHT",
];

const run = (parts: Part[], tasks: Task[] = [], settings = {}) => {
  const b = build(...parts);
  return checkCompatibility(b.lines, b.catalog, ctx(tasks, settings));
};
const sorted = (xs: readonly string[]) => [...xs].sort();

describe("rule registry (ARCHITECTURE 4.4)", () => {
  it("has 28 PC rules and 9 setup rules, 37 distinct ids that cover the frozen RuleId union", () => {
    expect(PC_RULES).toHaveLength(28);
    expect(SETUP_RULES).toHaveLength(9);
    const registered = [...PC_RULES, ...SETUP_RULES].map((r) => r.id);
    expect(new Set(registered).size).toBe(37);
    expect(sorted(registered)).toEqual(sorted(ALL_RULE_IDS));
  });

  it("lists rules in the order of the contract", () => {
    expect([...PC_RULES, ...SETUP_RULES].map((r) => r.id)).toEqual(ALL_RULE_IDS);
  });

  it("has a scenario for every PC rule and nothing else", () => {
    expect(sorted(Object.keys(PC_SCENARIOS))).toEqual(sorted(PC_RULES.map((r) => r.id)));
  });

  it("scopes PC rules to pc and setup rules to setup", () => {
    expect(PC_RULES.every((r) => r.scope === "pc")).toBe(true);
    expect(SETUP_RULES.every((r) => r.scope === "setup")).toBe(true);
  });
});

describe("one file per rule (compat/rules/<id>.ts)", () => {
  const files = import.meta.glob("./*.ts", { eager: true, query: "?raw", import: "default" });
  it.each(ALL_RULE_IDS)("%s has its own file that declares it", (id) => {
    const name = `./${id.toLowerCase().replaceAll("_", "-")}.ts`;
    const text = files[name];
    expect(text, `missing file ${name}`).toBeTypeOf("string");
    expect(text).toContain(`"${id}"`);
  });
});

describe.each(Object.entries(PC_SCENARIOS) as [keyof typeof PC_SCENARIOS, RuleScenario][])("%s", (ruleId, sc) => {
  it("is silent on a clean build and is reported as checked", () => {
    const r = run(sc.ok.parts, sc.ok.tasks);
    expect(r.issues).toEqual([]);
    expect(r.checkedRules).toContain(ruleId);
    expect(r.verdict).toBe("ok");
    expect(r.missingData).toEqual([]);
  });

  it.each(sc.issues.map((e) => [e.name, e] as const))("flags: %s", (_name, e) => {
    const r = run(e.parts, e.tasks, e.settings);
    const found = r.issues.filter((i) => i.messageKey === e.key);
    expect(found, `issues: ${JSON.stringify(r.issues)}`).toHaveLength(1);
    const issue = found[0];
    expect(issue?.ruleId).toBe(ruleId);
    expect(issue?.severity).toBe(e.severity);
    if (e.params) expect(issue?.params).toMatchObject(e.params);
    if (e.products) expect(sorted(issue?.productIds ?? [])).toEqual(sorted(e.products));
    if (e.fix) expect(issue?.fix).toEqual(e.fix);
    // Rules are independent: the scenario breaks exactly one rule.
    expect(r.issues.every((i) => i.ruleId === ruleId)).toBe(true);
    expect(r.verdict).toBe(e.severity === "block" ? "block" : "warn");
    expect(r.checkedRules).toContain(ruleId);
  });

  it.each(sc.missing.map((m) => [m.name, m] as const))("no data (%s) is incomplete, never ok", (_name, m) => {
    const r = run(m.parts, m.tasks);
    expect(r.missingData).toContainEqual({ productId: m.product, field: m.field });
    const issue = r.issues.find((i) => i.ruleId === ruleId && i.messageKey === "compat.missing_data");
    expect(issue, `issues: ${JSON.stringify(r.issues)}`).toBeDefined();
    expect(issue?.severity).toBe("warn");
    expect(issue?.productIds).toEqual([m.product]);
    expect(issue?.params).toMatchObject({ field: m.field });
    expect(r.verdict).toBe("incomplete");
    expect(r.checkedRules).toContain(ruleId);
  });

  it("does not run when there is nothing to check", () => {
    const r = run(sc.notApplicable.parts, sc.notApplicable.tasks);
    expect(r.checkedRules).not.toContain(ruleId);
    expect(r.issues.filter((i) => i.ruleId === ruleId)).toEqual([]);
  });
});
