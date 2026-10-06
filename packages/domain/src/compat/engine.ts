import type { ProductId } from "../catalog/types.ts";
import { MISSING_DATA_KEY } from "./rule-kit.ts";
import type { CompatIssue, CompatResult, ResolvedBuild, RuleId } from "./types.ts";

/** What the engine needs from a rule; both PC and setup rule definitions satisfy it. */
export interface RunnableRule<Ctx> {
  id: RuleId;
  applies(b: ResolvedBuild, ctx: Ctx): boolean;
  run(b: ResolvedBuild, ctx: Ctx): CompatIssue[];
}

/** Runs the rules that have something to check. `checkedRules` keeps the registry order; so do the issues. */
export function runRules<Ctx>(
  rules: readonly RunnableRule<Ctx>[],
  b: ResolvedBuild,
  ctx: Ctx,
): { issues: CompatIssue[]; checkedRules: RuleId[] } {
  const issues: CompatIssue[] = [];
  const checkedRules: RuleId[] = [];
  for (const rule of rules) {
    if (!rule.applies(b, ctx)) continue;
    checkedRules.push(rule.id);
    issues.push(...rule.run(b, ctx));
  }
  return { issues, checkedRules };
}

/** (product, field) pairs of "no data" issues without duplicates across rules, then lines with unknown products. */
export function collectMissingData(
  issues: readonly CompatIssue[],
  unknown: readonly ProductId[],
): CompatResult["missingData"] {
  const out: CompatResult["missingData"] = [];
  const seen = new Set<string>();
  const add = (productId: ProductId, field: string) => {
    const key = `${productId}\u0000${field}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ productId, field });
  };
  for (const i of issues) {
    if (i.messageKey !== MISSING_DATA_KEY) continue;
    const id = i.productIds[0];
    if (id !== undefined) add(id, String(i.params.field));
  }
  for (const id of unknown) add(id, "product");
  return out;
}

/** "нельзя" beats everything; unknown data beats a warning ("never ok without data"); then warn; then ok. */
export function verdictOf(
  issues: readonly CompatIssue[],
  missingData: CompatResult["missingData"],
): CompatResult["verdict"] {
  if (issues.some((i) => i.severity === "block")) return "block";
  if (missingData.length > 0) return "incomplete";
  if (issues.length > 0) return "warn";
  return "ok";
}
