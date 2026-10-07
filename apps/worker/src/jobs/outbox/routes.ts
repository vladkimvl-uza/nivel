// Where a job of ops.outbox goes (ARCHITECTURE 9, services/outbox/contract.ts). The relay does not run the jobs itself: it
// hands each to the queue of pg-boss that owns it, and pg-boss gives it the retries (five attempts, a growing pause) and the
// record in ops.app_errors after the last one.
/**
 * The names of the jobs the services queue (packages/services/src/outbox/contract.ts). The package does not export the
 * contract object, so the worker keeps its own copy; `contract.test.ts` compares it with the source of the contract.
 * TODO(integrator): export OUTBOX_JOB and OUTBOX_TEMPLATE from `@nivel/services` (outbox/index.ts) and drop this copy.
 */
export const OUTBOX_JOB = {
  PDF_RENDER: "pdf.render",
  PAYMENT_EXPECT: "payment.expect",
  LEDGER_APPEND: "ledger.append",
  ACCEPT_REMINDER: "accept_reminder",
  ACT_SIGN: "act.sign",
  THRESHOLD_CHECK: "threshold.check",
} as const;

/** The queues of the worker that the outbox feeds. */
export const QUEUE = {
  relay: "outbox.relay",
  paymentExpect: "payment.expect",
  ledgerAppend: "ledger.append",
  webRevalidate: "web.revalidate",
  thresholdCheck: "threshold.check",
  /** The jobs the order calendar sets (the automaton's `schedule` effect and the reminder 24 hours after ACCEPT). */
  ordersScheduled: "orders.scheduled",
  /** WP-12 makes this queue; the relay sends to it only when the flag `feature.pdf` is on and the queue exists. */
  pdfRender: "pdf.render",
} as const;

/** Jobs of the order calendar: they carry their own name in the data and share one queue. */
export const ORDER_CALENDAR_JOBS: readonly string[] = [
  OUTBOX_JOB.ACCEPT_REMINDER,
  "estimate_expiry",
  "objection_window",
  "report_due",
  "refund_due",
  "warranty_end",
  "aftercare",
];

const DIRECT: Readonly<Record<string, string>> = {
  [OUTBOX_JOB.PAYMENT_EXPECT]: QUEUE.paymentExpect,
  [OUTBOX_JOB.LEDGER_APPEND]: QUEUE.ledgerAppend,
  [OUTBOX_JOB.THRESHOLD_CHECK]: QUEUE.thresholdCheck,
  [OUTBOX_JOB.PDF_RENDER]: QUEUE.pdfRender,
  "web.revalidate": QUEUE.webRevalidate,
};

/** The queue of a job by its name; a name the worker does not know is the name of a queue of another domain. */
export function queueOfJob(job: string): string {
  if (ORDER_CALENDAR_JOBS.includes(job)) return QUEUE.ordersScheduled;
  return DIRECT[job] ?? job;
}

/** What the relay refuses to run at all (the contract: nothing queues it and a signature is never made from a job). */
export const REFUSED_JOBS: Readonly<Record<string, string>> = {
  [OUTBOX_JOB.ACT_SIGN]:
    "act.sign is reserved: the bot signs an act through sales.sign_act, and a job never carries a signature",
};
