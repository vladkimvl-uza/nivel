// The sample order NV-0001 of the one-page site: the estimate and the receipt report that the documents of the page and
// the scenes of the background show. The sums are fixed example data (dates and shops are invented, and the page says
// so), the fee and the reserve follow the scale of the owner. All numbers are whole sums.
import { type FeeScale, pcFee, purchaseReserve } from "./fee-scale.ts";

export interface SampleItem {
  id: "cpu" | "cool" | "mb" | "ram" | "gpu" | "ssd" | "psu" | "case" | "fans";
  /** The price in the estimate of 05.10.2026. */
  estimate: number;
  /** The price on the receipt of 06-07.10.2026. */
  receipt: number;
  /** Memory and SSD count for the higher reserve. */
  memory?: true;
}

/** In the order of the documents: the receipts arrive in this order on the background of the page. */
export const SAMPLE_ITEMS: readonly SampleItem[] = [
  { id: "cpu", estimate: 4_300_000, receipt: 4_250_000 },
  { id: "cool", estimate: 650_000, receipt: 650_000 },
  { id: "mb", estimate: 2_400_000, receipt: 2_400_000 },
  { id: "ram", estimate: 4_950_000, receipt: 4_950_000, memory: true },
  { id: "gpu", estimate: 9_650_000, receipt: 9_590_000 },
  { id: "ssd", estimate: 2_100_000, receipt: 2_070_000, memory: true },
  { id: "psu", estimate: 1_250_000, receipt: 1_250_000 },
  { id: "case", estimate: 1_050_000, receipt: 1_050_000 },
  { id: "fans", estimate: 480_000, receipt: 480_000 },
];

export interface SampleOrder {
  partsEstimate: number;
  partsReceipts: number;
  /** What goes back to the customer: the estimate minus the receipts. */
  refund: number;
  /** The fee by the scale, whole sums. */
  fee: number;
  /** The fee by the rate alone, before the minimum applies. */
  feeByRate: number;
  feeRateBp: number;
  /** Parts by the estimate plus the fee. */
  total: number;
  reserveRateBp: number;
  reserve: number;
  /** What is transferred to the account for the purchase: parts plus reserve. */
  purchaseLimit: number;
}

export function sampleOrder(scale: Readonly<FeeScale>): SampleOrder {
  const partsEstimate = SAMPLE_ITEMS.reduce((a, i) => a + i.estimate, 0);
  const partsReceipts = SAMPLE_ITEMS.reduce((a, i) => a + i.receipt, 0);
  const memory = SAMPLE_ITEMS.filter((i) => i.memory).reduce((a, i) => a + i.estimate, 0);
  const fee = pcFee(partsEstimate, scale);
  const low = partsEstimate < scale.pcThreshold;
  const feeRateBp = low ? scale.pcLowRateBp : scale.pcHighRateBp;
  const feeByRate = Number((BigInt(partsEstimate) * BigInt(feeRateBp)) / 10_000n);
  const { rateBp: reserveRateBp, reserve } = purchaseReserve(partsEstimate, memory, scale);
  return {
    partsEstimate,
    partsReceipts,
    refund: partsEstimate - partsReceipts,
    fee,
    feeByRate,
    feeRateBp,
    total: partsEstimate + fee,
    reserveRateBp,
    reserve,
    purchaseLimit: partsEstimate + reserve,
  };
}
