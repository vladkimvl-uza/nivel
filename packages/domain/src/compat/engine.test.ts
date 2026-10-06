import { describe, expect, it } from "vitest";
import type { ProductId } from "../catalog/types.ts";
import { collectMissingData, runRules, verdictOf } from "./engine.ts";
import { issue, MISSING_DATA_KEY } from "./rule-kit.ts";
import type { CompatIssue, ResolvedBuild, RuleId } from "./types.ts";

const P = (s: string) => s as ProductId;
const block = issue("CPU_MB_SOCKET", "block", [P("a")], "compat.socket_mismatch", {});
const warn = issue("MEM_SPEED", "warn", [P("a")], "compat.mem_speed_reduced", {});
const missing = (id: string, field: string, rule: RuleId = "MEM_TYPE") =>
  issue(rule, "warn", [P(id)], MISSING_DATA_KEY, { field, category: "ram" });

describe("verdictOf: block > incomplete > warn > ok", () => {
  it("is ok without issues", () => {
    expect(verdictOf([], [])).toBe("ok");
  });
  it("is warn with only warnings", () => {
    expect(verdictOf([warn], [])).toBe("warn");
  });
  it("is block when any issue blocks, even with missing data", () => {
    expect(verdictOf([warn, block, missing("a", "x")], [{ productId: P("a"), field: "x" }])).toBe("block");
  });
  it("is incomplete when data is missing and nothing blocks, even with warnings", () => {
    expect(verdictOf([warn, missing("a", "x")], [{ productId: P("a"), field: "x" }])).toBe("incomplete");
  });
  it("is incomplete for an unknown product alone", () => {
    expect(verdictOf([], [{ productId: P("ghost"), field: "product" }])).toBe("incomplete");
  });
});

describe("collectMissingData", () => {
  it("takes (product, field) from missing-data issues only and drops duplicates across rules", () => {
    const issues: CompatIssue[] = [
      warn,
      missing("a", "socket", "CPU_MB_SOCKET"),
      missing("a", "socket", "COOLER_SOCKET"),
      missing("b", "socket", "COOLER_SOCKET"),
    ];
    expect(collectMissingData(issues, [])).toEqual([
      { productId: "a", field: "socket" },
      { productId: "b", field: "socket" },
    ]);
  });

  it("appends unknown products as field `product`", () => {
    expect(collectMissingData([], [P("ghost")])).toEqual([{ productId: "ghost", field: "product" }]);
  });
});

describe("runRules", () => {
  const b: ResolvedBuild = { byCategory: {} };
  const rule = (id: RuleId, applies: boolean, out: CompatIssue[]) => ({
    id,
    applies: () => applies,
    run: () => out,
  });

  it("runs only applicable rules and lists exactly those as checked, in registry order", () => {
    const r = runRules(
      [rule("CPU_MB_SOCKET", true, []), rule("MEM_TYPE", false, [block]), rule("MEM_SLOTS", true, [warn])],
      b,
      null,
    );
    expect(r.checkedRules).toEqual(["CPU_MB_SOCKET", "MEM_SLOTS"]);
    expect(r.issues).toEqual([warn]);
  });

  it("keeps issue order: by rule, then as the rule returned them", () => {
    const r = runRules([rule("CPU_MB_SOCKET", true, [block, warn]), rule("MEM_TYPE", true, [block])], b, null);
    expect(r.issues).toEqual([block, warn, block]);
  });

  it("passes the build and context to the rules", () => {
    const seen: unknown[] = [];
    runRules(
      [
        {
          id: "CPU_NO_VIDEO" as RuleId,
          applies: (bb: ResolvedBuild, c: { n: number }) => {
            seen.push(bb, c);
            return true;
          },
          run: () => [],
        },
      ],
      b,
      { n: 1 },
    );
    expect(seen).toEqual([b, { n: 1 }]);
  });
});
