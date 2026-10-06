import type { BuildLine, CatalogLookup } from "../catalog/types.ts";
import { collectMissingData, runRules, verdictOf } from "./engine.ts";
import { computePower } from "./power.ts";
import { resolveBuild } from "./resolve.ts";
import { PC_RULES, SETUP_RULES } from "./rules/index.ts";
import type { CompatApi, CompatResult, CompatSettings, PowerEstimate, SetupPlan, Task } from "./types.ts";

export { DEFAULT_COMPAT_SETTINGS } from "./settings.ts";
export type * from "./types.ts";
export { PC_RULES, SETUP_RULES };

/**
 * Checks a PC build against the 28 PC rules (ARCHITECTURE 4.4). Pure: same lines, catalog snapshot and settings give the
 * same result. A rule runs only when the build contains the parts it compares; a missing spec value yields a warn with
 * `compat.missing_data`, an entry in `missingData` and verdict `incomplete`, never `ok`.
 * Throws RangeError for a non-positive or fractional quantity (a caller bug).
 */
export function checkCompatibility(
  lines: BuildLine[],
  catalog: CatalogLookup,
  ctx: { tasks: Task[]; settings: CompatSettings },
): CompatResult {
  const { build, unknown } = resolveBuild(lines, catalog);
  const { issues, checkedRules } = runRules(PC_RULES, build, ctx);
  const missingData = collectMissingData(issues, unknown);
  return {
    verdict: verdictOf(issues, missingData),
    issues,
    power: computePower(build, ctx.settings).estimate,
    checkedRules,
    missingData,
  };
}

/** Checks a desk setup against the 9 setup rules. `power` is zero: a setup plan carries no PC parts. */
export function checkSetup(plan: SetupPlan, catalog: CatalogLookup, s: CompatSettings): CompatResult {
  const { build, unknown } = resolveBuild(plan.lines, catalog);
  const { issues, checkedRules } = runRules(SETUP_RULES, build, { tasks: [], settings: s, plan });
  const missingData = collectMissingData(issues, unknown);
  return {
    verdict: verdictOf(issues, missingData),
    issues,
    power: { peakW: 0, recommendedPsuW: 0 },
    checkedRules,
    missingData,
  };
}

/** Peak power and recommended PSU (block 28, 3.4); with a PSU in the build also its rating and headroom. */
export function estimatePower(lines: BuildLine[], catalog: CatalogLookup, s: CompatSettings): PowerEstimate {
  const { build } = resolveBuild(lines, catalog);
  return computePower(build, s).estimate;
}

export const compatApi = { checkCompatibility, checkSetup, estimatePower } satisfies CompatApi;
