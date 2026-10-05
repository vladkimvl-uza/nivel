import type { BuildLine, CategoryCode } from "../catalog/types.ts";
import { NotImplementedError } from "../errors.ts";
import type {
  AutobuildApi,
  AutobuildData,
  AutobuildInput,
  AutobuildResult,
  ReplacementData,
  ReplacementOption,
} from "./types.ts";

export type * from "./types.ts";

export function autobuild(_input: AutobuildInput, _data: AutobuildData): AutobuildResult {
  throw new NotImplementedError("autobuild.autobuild");
}
export function replacementOptions(
  _lines: BuildLine[],
  _slot: CategoryCode,
  _data: ReplacementData,
  _limit: number,
): ReplacementOption[] {
  throw new NotImplementedError("autobuild.replacementOptions");
}

export const autobuildApi = { autobuild, replacementOptions } satisfies AutobuildApi;
