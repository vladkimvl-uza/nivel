// Compatibility and power (ARCHITECTURE 4.4): 28 PC rules and 9 setup rules, one file per rule in ./rules.
//
// Conventions shared by all rules:
// - Messages: a result carries only `messageKey` (`compat.*`, registry in message-keys.ts) and `params`; texts live in
//   packages/i18n. Quantities for the user (percent of headroom, mm, W) are plain numbers.
// - Unknown data: a spec value that is `null` and that the rule needs gives a warn `compat.missing_data` (params `field`,
//   `category`), an entry in `missingData` and verdict `incomplete`; it is never read as "fine". An optional (`?`) field
//   that is absent means "not applicable / no constraint" (no BIOS floor, monitor without VESA, mount without a
//   thickness limit); the exceptions are documented in the rule file.
// - A rule runs only when the build contains the parts it compares (`checkedRules`): a configurator can call the check
//   after every step. Unknown products (not in the catalog snapshot) are missing data with field `product`.
// - `fix.filter` keys are spec field names: a scalar means "equals, or is in the list" (`{ sockets: "AM5" }`); a suffix
//   `Min` / `Max` is a numeric bound (`{ gpuMaxLenMmMin: 340 }` = case with `gpuMaxLenMm >= 340`).
//   One pseudo key: `radiatorSizeMm: 360` (AIO_RADIATOR_MOUNT) = a case with a mount whose `radiators[].sizesMm` holds
//   that size (the sizes live in a nested list, there is no scalar field).
// - Setup plans: `placement` is keyed by product id, in room millimetres (left-back corner of the item, x to the right,
//   y towards the user); the clamp position on the desk is the arm x minus the desk x (a clamp arm needs
//   both placed, a missing desk position is missing data).
import type { BuildLine, CatalogLookup } from "../catalog/types.ts";
import { collectMissingData, runRules, verdictOf } from "./engine.ts";
import { computePower } from "./power.ts";
import { assertSinglePcParts, resolveBuild } from "./resolve.ts";
import { PC_RULES, SETUP_RULES } from "./rules/index.ts";
import type { CompatApi, CompatResult, CompatSettings, PowerEstimate, SetupPlan, Task } from "./types.ts";

export { COMPAT_MESSAGE_KEYS, MESSAGE_KEY_PREFIX, type MessageKeySpec } from "./message-keys.ts";
export { MAX_LINE_QTY, MAX_LINES } from "./resolve.ts";
export { MISSING_DATA_KEY, type PcRuleDef, type SetupRuleDef } from "./rule-kit.ts";
export { DEFAULT_COMPAT_SETTINGS, defaultCompatSettings } from "./settings.ts";
export type * from "./types.ts";
export { PC_RULES, SETUP_RULES };

/**
 * Checks a PC build against the 28 PC rules (ARCHITECTURE 4.4). Pure: same lines, catalog snapshot and settings give the
 * same result. A rule runs only when the build contains the parts it compares; a missing spec value yields a warn with
 * `compat.missing_data`, an entry in `missingData` and verdict `incomplete`, never `ok`.
 * Throws RangeError (a caller bug) for a non-positive or fractional quantity, a quantity above MAX_LINE_QTY, more than
 * MAX_LINES lines, or more than one processor, board, case or PSU. Lines of the same product are merged.
 */
export function checkCompatibility(
  lines: BuildLine[],
  catalog: CatalogLookup,
  ctx: { tasks: Task[]; settings: CompatSettings },
): CompatResult {
  const { build, unknown } = resolveBuild(lines, catalog);
  assertSinglePcParts(build);
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

/**
 * Peak power and recommended PSU (block 28, 3.4); with a PSU in the build also its rating and headroom. Unknown (null)
 * spec values count as 0: the result is then a lower bound; `checkCompatibility` reports the gaps (`missingData`).
 */
export function estimatePower(lines: BuildLine[], catalog: CatalogLookup, s: CompatSettings): PowerEstimate {
  const { build } = resolveBuild(lines, catalog);
  return computePower(build, s).estimate;
}

export const compatApi = { checkCompatibility, checkSetup, estimatePower } satisfies CompatApi;
