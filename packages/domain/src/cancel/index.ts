import { NotImplementedError } from "../errors.ts";
import type { FeeSettings } from "../fee/types.ts";
import type { WorkCalendar } from "../order/types.ts";
import type { CancelApi, CancelInput, CancelSettlement } from "./types.ts";

export type * from "./types.ts";

export function settleCancellation(_i: CancelInput, _s: FeeSettings, _now: Date, _cal: WorkCalendar): CancelSettlement {
  throw new NotImplementedError("cancel.settleCancellation");
}

export const cancelApi = { settleCancellation } satisfies CancelApi;
