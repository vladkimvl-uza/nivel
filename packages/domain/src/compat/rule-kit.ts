// Building blocks shared by the rule files: issue constructor, "no data" probe, rule definitions.
import { type DetailedCategory, type SpecMap, specOf } from "../catalog/specs.ts";
import type { ProductId } from "../catalog/types.ts";
import type { Item } from "./resolve.ts";
import type { CompatIssue, ResolvedBuild, Rule, RuleId, SetupPlan, Severity } from "./types.ts";

/** Message key of the issue raised when a spec value the rule needs is unknown (`null`). Params: `field`, `category`. */
export const MISSING_DATA_KEY = "compat.missing_data";

export type Params = Record<string, string | number>;
export type Fix = NonNullable<CompatIssue["fix"]>;

export function issue(
  ruleId: RuleId,
  severity: Severity,
  productIds: readonly ProductId[],
  messageKey: string,
  params: Params,
  fix?: Fix,
): CompatIssue {
  const out: CompatIssue = { ruleId, severity, productIds: [...new Set(productIds)], messageKey, params };
  if (fix) out.fix = fix;
  return out;
}

type Read<C extends DetailedCategory, K extends keyof SpecMap[C]> = Exclude<SpecMap[C][K], null | undefined>;

/**
 * Reads spec fields for one rule run and records every unknown value as a "no data" issue (warn, `compat.missing_data`).
 * Convention: `null` is "unknown" and always becomes missing data; an absent value of an optional (`?`) field means
 * "not applicable / no constraint" and is returned as `undefined` without complaint (see `optional`).
 */
export class Probe {
  readonly issues: CompatIssue[] = [];
  private readonly seen = new Set<string>();

  private readonly ruleId: RuleId;

  constructor(ruleId: RuleId) {
    this.ruleId = ruleId;
  }

  /** True once any needed value turned out to be unknown. */
  get incomplete(): boolean {
    return this.issues.length > 0;
  }

  private record(item: Item, field: string): void {
    const key = `${item.product.id}\u0000${field}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.issues.push(
      issue(this.ruleId, "warn", [item.product.id], MISSING_DATA_KEY, { field, category: item.product.category }),
    );
  }

  /** Required field: `undefined` (and a recorded issue) when unknown. */
  need<C extends DetailedCategory, K extends keyof SpecMap[C] & string>(
    item: Item,
    category: C,
    field: K,
  ): Read<C, K> | undefined {
    const value = (specOf(item.product, category) as Record<string, unknown> | undefined)?.[field];
    if (value === null || value === undefined) {
      this.record(item, field);
      return undefined;
    }
    return value as Read<C, K>;
  }

  /** Optional field: absent means "no constraint" (`undefined`, nothing recorded); `null` means unknown (recorded). */
  optional<C extends DetailedCategory, K extends keyof SpecMap[C] & string>(
    item: Item,
    category: C,
    field: K,
  ): Read<C, K> | undefined {
    const value = (specOf(item.product, category) as Record<string, unknown> | undefined)?.[field];
    if (value === null) {
      this.record(item, field);
      return undefined;
    }
    return value as Read<C, K> | undefined;
  }

  /** Records an unknown value found by the rule itself (nested data, derived values). */
  missing(item: Item, field: string): void {
    this.record(item, field);
  }

  /** Found issues followed by the "no data" issues. */
  result(found: readonly CompatIssue[]): CompatIssue[] {
    return [...found, ...this.issues];
  }
}

export type RuleContext = Parameters<Rule>[1];
export type SetupRuleContext = RuleContext & { plan: SetupPlan };

export interface PcRuleDef {
  id: RuleId;
  scope: "pc";
  /** False when the build has nothing for the rule to check: the rule is then not in `checkedRules`. */
  applies(b: ResolvedBuild, ctx: RuleContext): boolean;
  run: Rule;
}
export interface SetupRuleDef {
  id: RuleId;
  scope: "setup";
  applies(b: ResolvedBuild, ctx: SetupRuleContext): boolean;
  run(b: ResolvedBuild, ctx: SetupRuleContext): CompatIssue[];
}
export type AnyRuleDef = PcRuleDef | SetupRuleDef;

export const pcRule = (def: Omit<PcRuleDef, "scope">): PcRuleDef => ({ scope: "pc", ...def });
export const setupRule = (def: Omit<SetupRuleDef, "scope">): SetupRuleDef => ({ scope: "setup", ...def });
