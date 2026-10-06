// The guards the automaton of the domain leaves to the services (ARCHITECTURE 4.9): it checks that an event names a
// payment, an act or a report; here the database says whether they exist, belong to this order and are what the table
// requires. Run after the domain has accepted the event, so the order of the answers stays the one of the domain.
import type { Executor } from "@nivel/db/repos";
import type { GuardError, OrderEvent } from "@nivel/domain/order";
import { verifyAcceptConsents } from "../consents/consents.ts";
import { FUNDS_KINDS } from "../payments/pairs.ts";
import { ValidationError } from "./errors.ts";
import type { OrderRow, SnapshotInputs } from "./snapshot.ts";
import { isUuid } from "./validate.ts";

/** The test protocol before the PC is ready lasts at least 6 hours (ARCHITECTURE 4.9, TESTS_PASSED: 6-8 hours, no errors). */
export const MIN_TEST_MINUTES = 360;

export interface GuardEnv {
  tx: Executor;
  order: OrderRow;
  inputs: SnapshotInputs;
  now: Date;
}

interface PaymentFacts {
  id: string;
  orderId: string;
  kind: string;
  method: string;
  direction: string;
  status: string;
  receipt: string | null;
  payerIsCustomer: boolean;
  statementFileId: string | null;
  /** The payment net of its reversals. */
  net: number;
  reversal: boolean;
}

async function paymentFacts(tx: Executor, id: unknown): Promise<PaymentFacts | undefined> {
  if (!isUuid(id)) return undefined;
  const rows = await tx.query.payments.findMany({
    where: (t, { eq, or }) => or(eq(t.id, id), eq(t.reversalOf, id)),
  });
  const row = rows.find((r) => r.id === id);
  if (!row) return undefined;
  const reversals = rows.filter((r) => r.reversalOf === id && r.status === "confirmed");
  return {
    id: row.id,
    orderId: row.orderId,
    kind: row.kind,
    method: row.method,
    direction: row.direction,
    status: row.status,
    receipt: row.fiscalReceiptNo,
    payerIsCustomer: row.payerIsCustomer,
    statementFileId: row.thirdPartyStatementFileId,
    net: row.amountSum + reversals.reduce((n, r) => n + r.amountSum, 0),
    reversal: row.reversalOf !== null,
  };
}

const hasReceipt = (p: PaymentFacts): boolean => (p.receipt ?? "").trim() !== "";

/** A confirmed fee payment through the QR of Xolis with a fiscal receipt (the money of the fee, never the money of purchases). */
const confirmedQrFee = (p: PaymentFacts | undefined, order: OrderRow, kind: string): p is PaymentFacts =>
  p !== undefined &&
  p.orderId === order.id &&
  p.kind === kind &&
  p.status === "confirmed" &&
  p.method === "xolis_qr" &&
  p.direction === "in" &&
  !p.reversal &&
  hasReceipt(p);

export async function serviceGuard(env: GuardEnv, event: OrderEvent): Promise<GuardError | undefined> {
  const { tx, order, inputs } = env;
  const quote = inputs.quote;
  switch (event.type) {
    case "ACCEPT": {
      // The domain counts the ids; the kinds (data processing, transfer to the shops, non-returnable goods) are checked here.
      const verdict = await verifyAcceptConsents(tx, {
        orderId: order.id,
        customerId: order.customerId,
        consentIds: Array.isArray(event.consentIds) ? event.consentIds : [],
        hasNonReturnable: quote?.hasNonReturnable ?? false,
      });
      return verdict.ok ? undefined : "consent_missing";
    }
    case "FEE_PREPAID": {
      const p = await paymentFacts(tx, event.paymentId);
      if (!confirmedQrFee(p, order, "fee_advance")) return "payments_incomplete";
      // The advance of the estimate, whole: a part of it does not open the purchase; the payer is the customer or
      // a third party with a written statement (ARCHITECTURE 4.9).
      if (quote === undefined || p.net !== quote.advance) return "payments_incomplete";
      if (!p.payerIsCustomer && p.statementFileId === null) return "payments_incomplete";
      return undefined;
    }
    case "FUNDS_RECEIVED": {
      if (quote === undefined || !Array.isArray(event.paymentIds)) return "payments_incomplete";
      if (!(event.receivedAt instanceof Date) || event.receivedAt.getTime() > env.now.getTime())
        return "payments_incomplete";
      let total = 0;
      for (const id of new Set(event.paymentIds)) {
        const p = await paymentFacts(tx, id);
        const ok =
          p !== undefined &&
          p.orderId === order.id &&
          FUNDS_KINDS.includes(p.kind as never) &&
          p.status === "confirmed" &&
          p.method === "bank_transfer_ip" &&
          p.direction === "in" &&
          !p.reversal;
        if (!ok) return "payments_incomplete";
        total += p.net;
      }
      return total >= quote.purchaseLimit ? undefined : "payments_incomplete";
    }
    case "PURCHASE_RECORDED": {
      if (!isUuid(event.purchaseId)) return "invalid_transition";
      const purchase = await tx.query.purchases.findFirst({ where: (t, { eq }) => eq(t.id, event.purchaseId) });
      if (!purchase || purchase.orderId !== order.id || purchase.refundOf !== null) return "invalid_transition";
      if (purchase.receiptKind === "none_with_consent") return undefined; // the consent is checked by the trigger of the database
      const files = await tx.query.purchaseFiles.findMany({
        columns: { kind: true },
        where: (t, { eq }) => eq(t.purchaseId, purchase.id),
      });
      // A receipt or an ESF is not enough without its photo (ARCHITECTURE 4.9).
      return files.some((f) => f.kind === "receipt") ? undefined : "consent_missing";
    }
    case "SEND_REPORT": {
      if (!isUuid(event.reportId)) throw ValidationError.of("reportId", "report_unknown", "the report does not exist");
      const report = await tx.query.commissionReports.findFirst({ where: (t, { eq }) => eq(t.id, event.reportId) });
      if (!report || report.orderId !== order.id) {
        throw ValidationError.of("reportId", "report_unknown", "the report does not belong to this order");
      }
      const latest = await tx.query.commissionReports.findFirst({
        columns: { id: true },
        where: (t, { eq }) => eq(t.orderId, order.id),
        orderBy: (t, { desc }) => desc(t.version),
      });
      const m = inputs.money;
      if (latest?.id !== report.id || report.spentSum !== m.receiptsTotal || report.receivedSum !== m.fundsReceived) {
        throw ValidationError.of(
          "reportId",
          "report_outdated",
          "the report no longer matches the purchases and the money received: generate it again",
        );
      }
      return undefined;
    }
    case "REMAINDER_SETTLED": {
      if (event.refundPaymentId === undefined) return undefined;
      const p = await paymentFacts(tx, event.refundPaymentId);
      const ok =
        p !== undefined &&
        p.orderId === order.id &&
        p.kind === "remainder_refund" &&
        p.status === "confirmed" &&
        p.direction === "out" &&
        !p.reversal;
      return ok ? undefined : "payments_incomplete";
    }
    case "MATERIALS_ACCEPTED": {
      if (!isUuid(event.actId)) return "act_missing";
      const act = await tx.query.acts.findFirst({ where: (t, { eq }) => eq(t.id, event.actId) });
      // The customer's own materials are accepted by an act that the customer has signed (GK art. 661).
      return act && act.orderId === order.id && act.kind === "material_acceptance" && act.signedAt !== null
        ? undefined
        : "act_missing";
    }
    case "TESTS_PASSED": {
      if (event.passportId !== order.id) return "passport_missing";
      const passport = await tx.query.buildPassports.findFirst({ where: (t, { eq }) => eq(t.orderId, order.id) });
      if (!passport) return "passport_missing";
      const tests = (passport.tests ?? {}) as { minutes?: unknown; errors?: unknown };
      const errors = Array.isArray(tests.errors) ? tests.errors.length : tests.errors;
      const long = typeof tests.minutes === "number" && tests.minutes >= MIN_TEST_MINUTES;
      return long && errors === 0 ? undefined : "passport_missing";
    }
    case "HANDOVER": {
      if (!isUuid(event.actId)) return "act_missing";
      const act = await tx.query.acts.findFirst({ where: (t, { eq }) => eq(t.id, event.actId) });
      if (!act || act.orderId !== order.id || act.kind !== "handover") return "act_missing";
      // The final part of the fee is paid by the QR of Xolis with a receipt, whole (ARCHITECTURE 4.9).
      const p = await paymentFacts(tx, event.finalPaymentId);
      if (!confirmedQrFee(p, order, "fee_final") || quote === undefined || p.net < quote.final)
        return "final_payment_missing";
      return undefined;
    }
    case "PODBOR_DELIVERED": {
      const p = await paymentFacts(tx, event.paymentId);
      return confirmedQrFee(p, order, "podbor_fee") ? undefined : "payments_incomplete";
    }
    case "CANCEL_SETTLED": {
      // Every payment of the cancellation is confirmed or voided with a reason before the order is cancelled.
      const open = await tx.query.payments.findFirst({
        columns: { id: true },
        where: (t, { and, eq }) => and(eq(t.orderId, order.id), eq(t.status, "expected")),
      });
      return open ? "payments_incomplete" : undefined;
    }
    default:
      return undefined;
  }
}
