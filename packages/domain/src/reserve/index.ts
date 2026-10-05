// Reserve contracts are declared with the threshold types (ARCHITECTURE 4.8).
import { NotImplementedError } from "../errors.ts";
import type { Sum } from "../money/types.ts";
import type { ReserveApi, WarrantyReserveState } from "../threshold/types.ts";

export type { ReserveApi, WarrantyReserveState } from "../threshold/types.ts";

export function warrantyReserveContribution(_componentsSum: Sum, _st: WarrantyReserveState): Sum {
  throw new NotImplementedError("reserve.warrantyReserveContribution");
}
export function taxRiskReserve(_receiptsTotal: Sum, _active: boolean): Sum {
  throw new NotImplementedError("reserve.taxRiskReserve");
}

export const reserveApi = { warrantyReserveContribution, taxRiskReserve } satisfies ReserveApi;
