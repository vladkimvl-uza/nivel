import type { FeeSettings } from "../fee/types.ts";
import { type Bp, bp, type Sum, sum } from "../money/index.ts";
import type { WorkCalendar } from "../order/types.ts";
import type { CancelApi, CancelInput, CancelPoint, CancelSettlement } from "./types.ts";

export type * from "./types.ts";

const WORKING_DAYS_TO_PAY = 5;

/** floor(fee × bpScaled / 10 000²): `bpScaled` carries a rate in 1/10 000 of a basis point so one rounding covers a sum of shares. */
function floorShare(fee: Sum, bpScaled: bigint): Sum {
  return sum(Number((BigInt(fee) * bpScaled) / 100_000_000n));
}
const scaled = (rate: Bp): bigint => BigInt(rate) * 10_000n;

/** Fee earned by the stage price list (CONCEPT 2.5): shares of finished stages, rounded down to a whole sum. */
function earnedFee(i: CancelInput, s: FeeSettings): Sum {
  const { selection, purchase, assembly } = s.stageSharesBp;
  switch (i.point) {
    case "before_accept":
      return sum(0);
    case "after_accept_before_purchase":
      return floorShare(i.fee, scaled(selection));
    case "after_purchase_before_assembly":
      return floorShare(i.fee, scaled(bp(selection + purchase)));
    case "during_assembly": {
      if (i.assemblyDoneBp === undefined) {
        throw new RangeError("assemblyDoneBp is required during assembly (owner input)");
      }
      const done = BigInt(bp(i.assemblyDoneBp));
      return floorShare(i.fee, scaled(bp(selection + purchase)) + BigInt(assembly) * done);
    }
    case "after_tests_before_handover":
      return floorShare(i.fee, scaled(s.afterTestsRetainBp));
    default:
      throw new RangeError(`Unknown cancellation point: ${String(i.point)}`);
  }
}

const PARTS_GO_TO: Record<CancelPoint, CancelSettlement["partsGoTo"]> = {
  before_accept: "none",
  after_accept_before_purchase: "none",
  after_purchase_before_assembly: "shop_or_client",
  during_assembly: "client",
  after_tests_before_handover: "client",
};

/**
 * Settlement on the client's cancellation. The unpaid part of the earned fee goes to a separate invoice (QR with receipt)
 * and is never taken from the purchase funds; the funds remainder is returned in five working days.
 */
export function settleCancellation(i: CancelInput, s: FeeSettings, now: Date, cal: WorkCalendar): CancelSettlement {
  const fee = sum(i.fee);
  const feePaid = sum(i.feePaid);
  const fundsToRefund = sum(sum(i.fundsReceived) - sum(i.receiptsTotal) + sum(i.shopRefunds) - sum(i.documentedLosses));
  if (fundsToRefund < 0) {
    throw new RangeError("Documented losses exceed the remaining funds: the client's money would be exceeded");
  }
  const feeEarned = earnedFee({ ...i, fee }, s);
  return {
    feeEarned,
    feeToRefund: sum(Math.max(feePaid - feeEarned, 0)),
    feeToInvoice: sum(Math.max(feeEarned - feePaid, 0)),
    fundsToRefund,
    partsGoTo: PARTS_GO_TO[i.point],
    dueBy: cal.addWorkingDays(now, WORKING_DAYS_TO_PAY),
  };
}

export const cancelApi = { settleCancellation } satisfies CancelApi;
