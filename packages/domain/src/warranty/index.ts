import { NotImplementedError } from "../errors.ts";
import type { WorkCalendar } from "../order/types.ts";
import type {
  WarrantyApi,
  WarrantyDeadlines,
  WarrantyEvent,
  WarrantyStatus,
  WarrantyTransitionResult,
} from "./types.ts";

export type * from "./types.ts";

export function warrantyTransition(_status: WarrantyStatus, _e: WarrantyEvent): WarrantyTransitionResult {
  throw new NotImplementedError("warranty.warrantyTransition");
}
export function warrantyDeadlines(_openedAt: Date, _cal: WorkCalendar): WarrantyDeadlines {
  throw new NotImplementedError("warranty.warrantyDeadlines");
}

export const warrantyApi = { warrantyTransition, warrantyDeadlines } satisfies WarrantyApi;
