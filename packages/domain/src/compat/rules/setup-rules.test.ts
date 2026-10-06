// Table-driven suite for the 9 setup rules: "block" / "warn" / "no data" / "not applicable".
import { describe, expect, it } from "vitest";
import { checkSetup } from "../index.ts";
import { roomOf, SETUP_SCENARIOS, type SetupInput, type SetupScenario } from "../setup-scenarios.suite.ts";
import { build, settings } from "../testkit.ts";
import type { RuleId, SetupPlan } from "../types.ts";

const run = (input: SetupInput, s = settings()) => {
  const b = build(...input.parts);
  const plan: SetupPlan = { room: roomOf(input.room), lines: b.lines };
  if (input.placement) plan.placement = input.placement;
  return checkSetup(plan, b.catalog, s);
};
const sorted = (xs: readonly string[]) => [...xs].sort();

describe.each(Object.entries(SETUP_SCENARIOS) as [RuleId, SetupScenario][])("%s", (ruleId, sc) => {
  it("is silent on a clean setup and reported as checked", () => {
    const r = run(sc.ok);
    expect(r.issues).toEqual([]);
    expect(r.checkedRules).toContain(ruleId);
    expect(r.verdict).toBe("ok");
    expect(r.missingData).toEqual([]);
  });

  it.each(sc.issues.map((e) => [e.name, e] as const))("flags: %s", (_name, e) => {
    const r = run(e);
    const found = r.issues.filter((i) => i.messageKey === e.key);
    expect(found, `issues: ${JSON.stringify(r.issues)}`).toHaveLength(1);
    const issue = found[0];
    expect(issue?.ruleId).toBe(ruleId);
    expect(issue?.severity).toBe(e.severity);
    if (e.params) expect(issue?.params).toEqual(e.params);
    if (e.products) expect(sorted(issue?.productIds ?? [])).toEqual(sorted(e.products));
    expect(r.issues.every((i) => i.ruleId === ruleId)).toBe(true);
    expect(r.verdict).toBe(e.severity === "block" ? "block" : "warn");
  });

  it.each(sc.missing.map((m) => [m.name, m] as const))("no data (%s) is incomplete, never ok", (_name, m) => {
    const r = run(m);
    expect(r.missingData).toContainEqual({ productId: m.product, field: m.field });
    const issue = r.issues.find((i) => i.ruleId === ruleId && i.messageKey === "compat.missing_data");
    expect(issue, `issues: ${JSON.stringify(r.issues)}`).toBeDefined();
    expect(issue?.severity).toBe("warn");
    expect(issue?.productIds).toEqual([m.product]);
    expect(issue?.params).toMatchObject({ field: m.field });
    expect(r.verdict).toBe("incomplete");
  });

  it("does not run when there is nothing to check", () => {
    const r = run(sc.notApplicable);
    expect(r.checkedRules).not.toContain(ruleId);
    expect(r.issues.filter((i) => i.ruleId === ruleId)).toEqual([]);
  });
});
