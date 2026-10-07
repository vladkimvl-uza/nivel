// What the services put into ops.outbox, for the relay and the jobs of the worker (WP-14) and for the bot (WP-13).
// A message `telegram_message` carries { target, templateKey, params?, orderId?, orderNumber?, customerId?, lang?,
// telegramUserId? (customer only), topicId? (owner topic, when the order has one) }; a `job` carries { job, ... }.
// Jobs that change a status do not exist: the worker applies events with `orders.dispatch` as the system.
//
// The job payment.expect is queued by the site only (it may not write payments, and the bot expects its own payments through
// sales.expect_payment); ledger.append is queued by the site and by the bot (neither may write the ledger: the worker computes
// the contribution); act.sign is reserved: the bot signs the press of the button itself through sales.sign_act, and nothing
// queues it any more. Their payload is a
// hint, not a fact. Whoever runs them must take every sum, every address and every signature from the database and the domain,
// never from the payload:
//  - payment.expect: payments.expectFromJob (the worker, or the bot) does it: the amounts the quote fixes (advance, final fee,
//    purchase funds) come from the accepted quote of the order; the amounts the quote does not fix (fee_extra, fee_refund,
//    funds_refund) come from the settlement of the cancellation (settle in orders/cancel.ts, kept in the order with the CANCEL
//    event) and the refund of the remainder from the money of the order (sales.orderMoney); the payload only names the kind of
//    the payment and a sum in it that is not the same is refused. The bot expects the payments of its own events directly, and
//    both write them through sales.expect_payment (the database checks the pair, the sum, the order and a repeat);
//  - ledger.append: the contribution is computed by the domain (warrantyReserveContribution, taxRiskReserve) from the
//    reserves of the order (ADR-007, item 4) and its receipts, not from the sum in the payload; the state of the warranty fund
//    is the same for every role (sales.warranty_fund_state);
//  - act.sign: reserved. The press of the button of a customer is signed through sales.sign_act only with the Telegram id of the
//    customer of the order (see acts.sign), never with evidence that a payload names;
//  - telegram_message to a customer: the address is the Telegram id of customers.<customerId> in the database, not the
//    telegramUserId of the payload; pdf.render derives watermarkDraft from the status of the offer, not from the payload.
// outbox.enqueue refuses the three names above; only the scenarios queue them.

/** Names of the jobs the services queue besides the scheduled ones of the domain (estimate_expiry, report_due, ...). */
export const OUTBOX_JOB = {
  /** { orderId, orderNumber, doc, watermarkDraft, actId? }: a document in uz and ru into ops.files. */
  PDF_RENDER: "pdf.render",
  /** { orderId, orderNumber, paymentKind, amountSum }: queued by the site; the worker runs payments.expectFromJob (the sum is its own). */
  PAYMENT_EXPECT: "payment.expect",
  /** { orderId, orderNumber, fund, amountSum, reason }: the worker writes the ledger of the reserves (bot and site cannot). */
  LEDGER_APPEND: "ledger.append",
  /** { orderId, orderNumber, at }: 24 hours after the acceptance; the worker checks the flags when it fires. */
  ACCEPT_REMINDER: "accept_reminder",
  /** Reserved, nothing queues it: the bot signs the press of the button through sales.sign_act. */
  ACT_SIGN: "act.sign",
  /** { orderId, paymentId? | purchaseId? }: recount the threshold after a payment or a receipt. */
  THRESHOLD_CHECK: "threshold.check",
} as const;

/** Templates the services name themselves (the order automaton names the others: order.accepted, order.report_sent, ...). */
export const OUTBOX_TEMPLATE = {
  /** { number, scope, district?, budgetBand? } to the topic of the owner. */
  LEAD_CREATED: "lead.created",
} as const;
