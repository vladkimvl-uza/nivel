// reports.generate | send | accept | object | resolveObjection (BUILD_PLAN WP-07, ARCHITECTURE 4.9): the report of the
// commission is built from the purchases, sent within 24-48 hours of the end of the purchases, and the customer has three
// working days to object. What the customer says (accept, object) is an event of the order automaton; the journal of
// the order is the record of it, and the owner's answer to an objection is written on the report.
import { commissionReports } from "@nivel/db";
import { ops, sales } from "@nivel/db/repos";
import type { ActorRef } from "../orders/actor.ts";
import { auditActor, checkActor } from "../orders/actor.ts";
import { type DispatchResult, dispatch, dispatchInTx, inDispatchTransaction } from "../orders/dispatch.ts";
import { dsl } from "../orders/dsl.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import { lockBy } from "../orders/lock.ts";
import { type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { reportStateFrom } from "../orders/snapshot.ts";
import { asDate, assertText, assertUuid } from "../orders/validate.ts";

function requireOwner(actorRef: ActorRef): ActorRef {
  const actor = checkActor(actorRef);
  if (actor.kind !== "owner")
    throw new ForbiddenError(`the report is the business of the owner, not of the ${actor.kind}`);
  return actor;
}

export interface GeneratedReport {
  reportId: string;
  version: number;
  receivedSum: number;
  spentSum: number;
  discountsSum: number;
  remainderSum: number;
}

/** A report is made while the purchases run and once they are closed; after it went out the automaton does not take another. */
const GENERATE_STATUSES = new Set(["purchasing", "report_due"]);

export async function generate(input: { orderId: string }, actorRef: ActorRef, rt?: Runtime): Promise<GeneratedReport> {
  const r = runtimeOf(rt);
  requireOwner(actorRef);
  requireCapability(r, "reports.write");
  const orderId = assertUuid(input.orderId, "orderId");
  return r.db.transaction(async (tx) => {
    await lockBy(tx, `order:${orderId}`);
    const order = await sales.getOrder(tx, orderId);
    if (!order) throw new NotFoundError("order");
    if (!GENERATE_STATUSES.has(order.status)) {
      throw ValidationError.of(
        "orderId",
        "order_status",
        `a report is made in the status purchasing or report_due, not ${order.status}`,
      );
    }
    const money = await sales.orderMoney(tx, orderId);
    const purchases = await sales.listPurchases(tx, orderId);
    const discountsSum = purchases.filter((p) => p.refundOf === null).reduce((n, p) => n + p.discountSum, 0);
    const previous = await tx.query.commissionReports.findFirst({
      columns: { version: true },
      where: (t, { eq }) => eq(t.orderId, orderId),
      orderBy: (t, { desc }) => desc(t.version),
    });
    const version = (previous?.version ?? 0) + 1;
    const remainderSum = money.fundsReceived - money.receiptsTotal;
    const [row] = await tx
      .insert(commissionReports)
      .values({
        orderId,
        version,
        receivedSum: money.fundsReceived,
        spentSum: money.receiptsTotal,
        discountsSum,
        remainderSum,
        // A snapshot of the purchases at this moment: later changes do not rewrite what the customer was shown.
        lines: purchases.map((p) => ({
          purchaseId: p.id,
          productId: p.productId,
          quoteLineId: p.quoteLineId,
          qty: p.qty,
          amountSum: p.amountSum,
          discountSum: p.discountSum,
          receiptKind: p.receiptKind,
          receiptNo: p.receiptNo,
          esfNo: p.esfNo,
          refundOf: p.refundOf,
          boughtAt: p.boughtAt.toISOString(),
        })),
        dueAt: order.reportDueAt,
      })
      .returning({ id: commissionReports.id });
    if (!row) throw new Error("the report was not written");
    return {
      reportId: row.id,
      version,
      receivedSum: money.fundsReceived,
      spentSum: money.receiptsTotal,
      discountsSum,
      remainderSum,
    };
  });
}

/** SEND_REPORT with the stamps on the report: the time of sending and the end of the window of objections. */
export async function send(
  input: { orderId: string; reportId: string },
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<DispatchResult> {
  const r = runtimeOf(rt);
  const actor = requireOwner(actorRef);
  requireCapability(r, "reports.write");
  const orderId = assertUuid(input.orderId, "orderId");
  const reportId = assertUuid(input.reportId, "reportId");
  return inDispatchTransaction(r, (tx) =>
    dispatchInTx(r, tx, orderId, { type: "SEND_REPORT", reportId }, actor, {
      after: async (ex, info) => {
        const { eq } = dsl(ex);
        const order = await sales.getOrder(ex, orderId);
        await ex
          .update(commissionReports)
          .set({ sentAt: info.now, dueAt: order?.reportDueAt ?? null, objectionUntil: order?.objectionUntil ?? null })
          .where(eq(commissionReports.id, reportId));
      },
    }),
  );
}

/** The customer confirms the report ("Tasdiqlayman"): an event of the customer, the journal keeps it. */
export function accept(input: { orderId: string }, actor: ActorRef, rt?: Runtime): Promise<DispatchResult> {
  return dispatch(input.orderId, { type: "REPORT_ACCEPTED" }, actor, rt);
}

/** The customer has a question ("Savol bor") within the window of three working days. */
export function object(
  input: { orderId: string; text: string },
  actor: ActorRef,
  rt?: Runtime,
): Promise<DispatchResult> {
  return dispatch(input.orderId, { type: "OBJECTION", text: input.text }, actor, rt);
}

/** The owner answered the objection; the customer can accept the report now. */
export async function resolveObjection(
  input: { orderId: string; note: string },
  actorRef: ActorRef,
  rt?: Runtime,
): Promise<void> {
  const r = runtimeOf(rt);
  const actor = requireOwner(actorRef);
  requireCapability(r, "reports.write");
  const orderId = assertUuid(input.orderId, "orderId");
  const note = assertText(input.note, "note", 2000);
  await r.db.transaction(async (tx) => {
    await lockBy(tx, `order:${orderId}`);
    const order = await sales.getOrder(tx, orderId);
    if (!order) throw new NotFoundError("order");
    const report = await tx.query.commissionReports.findFirst({
      where: (t, { eq }) => eq(t.orderId, orderId),
      orderBy: (t, { desc }) => desc(t.version),
    });
    const resolvedAt = (report?.objection as { resolvedAt?: string } | null)?.resolvedAt;
    const events = await sales.listOrderEvents(tx, orderId);
    const state = reportStateFrom({
      events: events.map((e) => ({ seq: e.seq, type: String((e.event as { type?: unknown }).type), at: e.at })),
      reportExists: report !== undefined,
      resolvedAt: asDate(resolvedAt ?? null),
      objectionUntil: order.objectionUntil,
    });
    if (!report || !state?.objectionOpen) {
      throw ValidationError.of("orderId", "no_open_objection", "the customer has no open objection to this report");
    }
    const now = r.now();
    const { eq } = dsl(tx);
    await tx
      .update(commissionReports)
      .set({ objection: { ...((report.objection as object | null) ?? {}), resolvedAt: now.toISOString(), note } })
      .where(eq(commissionReports.id, report.id));
    await ops.appendAudit(tx, {
      actor: auditActor(actor),
      action: "report.resolve_objection",
      entity: "sales.commission_reports",
      entityId: report.id,
      after: { orderId, note },
    });
  });
}
