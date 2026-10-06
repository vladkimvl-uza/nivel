// Frozen contract (ARCHITECTURE 4.8). Change only via ADR and a "contract" PR.
import type { Bp, IsoDate, Sum } from "../money/types.ts";

export interface DealEntry {
  kind: "receipt" | "fee_in" | "fee_refund" | "other_income";
  amount: Sum;
  date: IsoDate;
}
export interface ThresholdSettings {
  annualLimit: Sum;
  registrationDate?: IsoDate;
  planCap?: Sum;
  alertsBp: readonly Bp[];
  proportion: "without_registration_day" | "with_registration_day"; // default: without (lower bound)
}
export interface ThresholdStatus {
  year: number;
  limit: Sum;
  volume: Sum;
  committed: Sum;
  shareBp: Bp;
  projectedShareBp: Bp;
  crossedAlerts: Bp[];
  overPlanCap: boolean;
  remaining: Sum;
}
export interface WarrantyReserveState {
  balance: Sum;
  closedOrders: number;
  lossesLast12mBp: Bp;
}

export interface ThresholdApi {
  /** Registration year: floor(annualLimit / daysInYear × days). */
  thresholdForYear(year: number, s: ThresholdSettings): Sum;
  thresholdStatus(entries: readonly DealEntry[], committed: Sum, year: number, s: ThresholdSettings): ThresholdStatus;
}
export interface ReserveApi {
  warrantyReserveContribution(componentsSum: Sum, st: WarrantyReserveState): Sum;
  taxRiskReserve(receiptsTotal: Sum, active: boolean): Sum;
}
