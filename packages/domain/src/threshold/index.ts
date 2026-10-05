import { NotImplementedError } from "../errors.ts";
import type { Sum } from "../money/types.ts";
import type { DealEntry, ThresholdApi, ThresholdSettings, ThresholdStatus } from "./types.ts";

export type * from "./types.ts";

export function thresholdForYear(_year: number, _s: ThresholdSettings): Sum {
  throw new NotImplementedError("threshold.thresholdForYear");
}
export function thresholdStatus(
  _entries: readonly DealEntry[],
  _committed: Sum,
  _year: number,
  _s: ThresholdSettings,
): ThresholdStatus {
  throw new NotImplementedError("threshold.thresholdStatus");
}

export const thresholdApi = { thresholdForYear, thresholdStatus } satisfies ThresholdApi;
