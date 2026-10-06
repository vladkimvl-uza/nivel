// What the services put into ops.outbox, for the relay and the jobs of the worker (WP-14) and for the bot (WP-13).
// A message `telegram_message` carries { target, templateKey, params?, orderId?, orderNumber?, customerId?, lang?,
// telegramUserId? (customer only), topicId? (owner topic, when the order has one) }; a `job` carries { job, ... }.
// Jobs that change a status do not exist: the worker applies events with `orders.dispatch` as the system.
//
// The jobs payment.expect, ledger.append and act.sign are written by the bot and the site roles (they have no right to
// the tables themselves), so their payload is a hint, not a fact. Whoever runs them must take every sum, every address
// and every signature from the database and the domain, never from the payload:
//  - payment.expect: the amounts the quote fixes (advance, final fee) come from the quote of the order; the amounts the
//    quote does not fix (fee_extra, remainder_refund, fee_refund, funds_refund) come from the settlement of the
//    cancellation (settle in orders/cancel.ts, kept in the CANCEL event of the journal) and from the money of the order (sales.orderMoney); the payload only names
//    the kind of the payment and is checked against them;
//  - ledger.append: the contribution is computed by the domain (warrantyReserveContribution, taxRiskReserve) from the
//    reserves of the order (ADR-007, item 4) and its receipts, not from the sum in the payload;
//  - act.sign: only for the customer of the order, with the evidence checked again (the Telegram id must be the one of
//    the customer; see acts.sign) and never with the evidence that the payload names alone;
//  - telegram_message to a customer: the address is the Telegram id of customers.<customerId> in the database, not the
//    telegramUserId of the payload; pdf.render derives watermarkDraft from the status of the offer, not from the payload.
// outbox.enqueue refuses the three names above; only the scenarios queue them.

/** Names of the jobs the services queue besides the scheduled ones of the domain (estimate_expiry, report_due, ...). */
export const OUTBOX_JOB = {
  /** { orderId, orderNumber, doc, watermarkDraft, actId? }: a document in uz and ru into ops.files. */
  PDF_RENDER: "pdf.render",
  /** { orderId, orderNumber, paymentKind, amountSum }: only the admin role writes payments; the admin side creates it. */
  PAYMENT_EXPECT: "payment.expect",
  /** { orderId, orderNumber, fund, amountSum, reason }: the worker writes the ledger of the reserves (bot and site cannot). */
  LEDGER_APPEND: "ledger.append",
  /** { orderId, orderNumber, at }: 24 hours after the acceptance; the worker checks the flags when it fires. */
  ACCEPT_REMINDER: "accept_reminder",
  /** { actId, orderId, orderNumber, via, signedAt, actor, evidence? }: the bot cannot write acts; the admin side signs. */
  ACT_SIGN: "act.sign",
  /** { orderId, paymentId? | purchaseId? }: recount the threshold after a payment or a receipt. */
  THRESHOLD_CHECK: "threshold.check",
} as const;

/** Templates the services name themselves (the order automaton names the others: order.accepted, order.report_sent, ...). */
export const OUTBOX_TEMPLATE = {
  /** { number, scope, district?, budgetBand? } to the topic of the owner. */
  LEAD_CREATED: "lead.created",
} as const;
