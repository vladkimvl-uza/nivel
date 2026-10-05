import type { BuildLine, CatalogLookup } from "../catalog/types.ts";
import { NotImplementedError } from "../errors.ts";
import type { CompatApi, CompatResult, CompatSettings, PowerEstimate, SetupPlan, Task } from "./types.ts";

export type * from "./types.ts";

export function checkCompatibility(
  _lines: BuildLine[],
  _catalog: CatalogLookup,
  _ctx: { tasks: Task[]; settings: CompatSettings },
): CompatResult {
  throw new NotImplementedError("compat.checkCompatibility");
}
export function checkSetup(_plan: SetupPlan, _catalog: CatalogLookup, _s: CompatSettings): CompatResult {
  throw new NotImplementedError("compat.checkSetup");
}
export function estimatePower(_lines: BuildLine[], _catalog: CatalogLookup, _s: CompatSettings): PowerEstimate {
  throw new NotImplementedError("compat.estimatePower");
}

export const compatApi = { checkCompatibility, checkSetup, estimatePower } satisfies CompatApi;
