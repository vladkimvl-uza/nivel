// The cancellation of an order by the customer (ARCHITECTURE 4.7). The amounts of the settlement are the server's: they
// are calculated here from the quote, the confirmed payments and the purchases, whatever the event carries. The domain
// throws RangeError for sums that cannot be (receipts above the money received, losses above the remainder); for the
// person who entered them it is a mistake in the input, so it is a ValidationError that says what is wrong.
import { type Executor, sales } from "@nivel/db/repos";
import { type CancelPoint, type CancelSettlement, settleCancellation } from "@nivel/domain/cancel";
import type { FeeSettings } from "@nivel/domain/fee";
import { bp, sum } from "@nivel/domain/money";
import type { OrderStatus, WorkCalendar } from "@nivel/domain/order";
import { ValidationError } from "./errors.ts";
import type { OrderRow } from "./snapshot.ts";

/** The point of cancellation that belongs to each status (ARCHITECTURE 4.7, 4.9); no point after the handover. */
export const POINT_BY_STATUS: Readonly<Partial<Record<OrderStatus, CancelPoint>>> = {
  estimate_draft: "before_accept",
  estimate_sent: "before_accept",
  estimate_expired: "before_accept",
  accepted: "after_accept_before_purchase",
  purchasing: "after_purchase_before_assembly",
  report_due: "after_purchase_before_assembly",
  report_sent: "after_purchase_before_assembly",
  settled: "after_purchase_before_assembly",
  assembling: "during_assembly",
  testing: "during_assembly",
  ready: "after_tests_before_handover",
  delivering: "after_tests_before_handover",
};

export interface SettlementInput {
  order: OrderRow;
  /** The fee of the current quote; zero when the order has none. */
  feeTotal: number;
  point: CancelPoint;
  /** The part of the assembly done, in basis points: the input of the owner, journaled. */
  assemblyDoneBp?: number;
  documentedLosses?: number;
  fundsReceived: number;
  now: Date;
  settings: FeeSettings;
  calendar: WorkCalendar;
}

/** Fee payments that count as paid: the net of confirmed advance, final and extra payments. */
export async function paidFee(ex: Executor, orderId: string): Promise<number> {
  const rows = await ex.query.payments.findMany({
    columns: { amountSum: true },
    where: (t, { and, eq, inArray }) =>
      and(
        eq(t.orderId, orderId),
        eq(t.status, "confirmed"),
        inArray(t.kind, ["fee_advance", "fee_final", "fee_extra"]),
      ),
  });
  return rows.reduce((n, r) => n + r.amountSum, 0);
}

/** Gross purchases and what the shops took back (the negative rows). */
export async function purchaseTotals(
  ex: Executor,
  orderId: string,
): Promise<{ receipts: number; shopRefunds: number }> {
  const rows = await sales.listPurchases(ex, orderId);
  return {
    receipts: rows.filter((r) => r.amountSum > 0).reduce((n, r) => n + r.amountSum, 0),
    shopRefunds: rows.filter((r) => r.amountSum < 0).reduce((n, r) => n - r.amountSum, 0),
  };
}

export function settle(
  i: SettlementInput,
  paid: number,
  totals: { receipts: number; shopRefunds: number },
): CancelSettlement {
  if (i.point === "during_assembly" && i.assemblyDoneBp === undefined) {
    throw ValidationError.of(
      "assemblyDoneBp",
      "assembly_done_required",
      "a cancellation during the assembly needs the share of the assembly that is done (basis points)",
    );
  }
  try {
    return settleCancellation(
      {
        point: i.point,
        fee: sum(i.feeTotal),
        feePaid: sum(paid),
        fundsReceived: sum(i.fundsReceived),
        receiptsTotal: sum(totals.receipts),
        shopRefunds: sum(totals.shopRefunds),
        documentedLosses: sum(i.documentedLosses ?? i.order.documentedLossesSum),
        ...(i.assemblyDoneBp === undefined ? {} : { assemblyDoneBp: bp(i.assemblyDoneBp) }),
      },
      i.settings,
      i.now,
      i.calendar,
    );
  } catch (e) {
    // A RangeError of the domain is a sum that cannot be: the person has to see which one.
    if (e instanceof RangeError) throw ValidationError.of("settlement", "cancel_input_invalid", e.message);
    throw e;
  }
}
