// services.orders.dispatch (ARCHITECTURE 4.13, BUILD_PLAN WP-07): the only way an order changes its status. In ONE
// transaction: the order is locked, the snapshot is read, the automaton of the domain decides, the services check the
// facts it delegates, and then the status, the journal of events, the audit row (sales.apply_transition) and the rows
// of ops.outbox are written. A refused event writes nothing. The same event sent twice is recognised and answered with
// the result of the first time: no second journal row, no second message.
import { DbRuleError, type Executor, sales } from "@nivel/db/repos";
import { sum } from "@nivel/domain/money";
import {
  type GuardError,
  type OrderEvent,
  type OrderStatus,
  type TransitionResult,
  transition,
} from "@nivel/domain/order";
import { OUTBOX_JOB } from "../outbox/contract.ts";
import { type ActorRef, checkActor } from "./actor.ts";
import { POINT_BY_STATUS, paidFee, purchaseTotals, settle } from "./cancel.ts";
import { buildChanges } from "./changes.ts";
import { type CustomerContact, loadCustomerContact, runEffects, type ServiceEffect } from "./effects.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.ts";
import { serviceGuard } from "./guards.ts";
import { canonicalJson, eventDigest, eventIdentity } from "./keys.ts";
import { lockBy } from "./lock.ts";
import { markQuoteAccepted } from "./quote-accept.ts";
import { type Runtime, runtimeOf } from "./runtime.ts";
import { loadCalendar, loadFeeSettings } from "./settings.ts";
import { assembleSnapshot, loadSnapshotInputs, type OrderRow, resolvedAfterSeqOf } from "./snapshot.ts";
import { assertUuid } from "./validate.ts";
import { loadWebInputs, webHead } from "./web.ts";

export type { ActorRef } from "./actor.ts";
export type DispatchResult = { ok: true; status: OrderStatus } | { ok: false; error: GuardError };

/** CANCEL with the owner inputs the settlement needs; the amounts of `settlement` are recomputed by the server. */
export type CancelEventInput = Extract<OrderEvent, { type: "CANCEL" }> & {
  /** Share of the assembly done, in basis points (cancellation during the assembly). */
  assemblyDoneBp?: number;
  /** Losses with documents the owner enters together with the cancellation. */
  documentedLosses?: number;
};
export type DispatchEvent = OrderEvent | CancelEventInput;

export interface DispatchHooks {
  /**
   * Writes that belong to the event and must stand or fall with it (the quote is marked sent together with
   * SEND_ESTIMATE). Runs inside the transaction, after the lock and the check for a repeat, before the snapshot.
   */
  before?: (tx: Executor, order: OrderRow) => Promise<void>;
  /** Writes that follow the event in the same transaction (the report is stamped as sent). `order` is the one before the event. */
  after?: (tx: Executor, info: { order: OrderRow; status: OrderStatus; now: Date }) => Promise<void>;
}

/** Answers that mean "the database refused the same way the automaton would have". */
const GUARD_CODES: ReadonlySet<string> = new Set<GuardError>([
  "actor_not_allowed",
  "invalid_transition",
  "payments_incomplete",
  "limit_exceeded",
  "funds_exceeded",
  "not_reconciled",
  "consent_missing",
]);

const HOUR_MS = 3_600_000;
/** Events of the customer the site role can evaluate with the customer views alone (the rest needs the journal, the reports, the acts). */
const WEB_EVENTS: ReadonlySet<string> = new Set(["ACCEPT"]);

class GuardAbort extends Error {
  readonly error: GuardError;
  constructor(error: GuardError) {
    super(error);
    this.error = error;
  }
}

/** Runs `fn` in a transaction; a refusal rolls everything back and becomes the answer, never an exception. */
export async function inDispatchTransaction(
  rt: Runtime,
  fn: (tx: Executor) => Promise<DispatchResult>,
): Promise<DispatchResult> {
  try {
    return await rt.db.transaction(async (tx) => {
      const result = await fn(tx);
      if (!result.ok) throw new GuardAbort(result.error);
      return result;
    });
  } catch (e) {
    if (e instanceof GuardAbort) return { ok: false, error: e.error };
    if (e instanceof DbRuleError && GUARD_CODES.has(e.code)) return { ok: false, error: e.code as GuardError };
    throw e;
  }
}

function normalizeEvent(raw: unknown): DispatchEvent {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw ValidationError.of("event", "event_invalid", "the event must be an object with a type");
  }
  const e = { ...(raw as Record<string, unknown>) };
  if (typeof e.type !== "string" || e.type === "") {
    throw ValidationError.of("event.type", "event_invalid", "the event needs a type");
  }
  // Events travel as JSON through the bot and the site: instants arrive as text.
  if (typeof e.receivedAt === "string") e.receivedAt = new Date(e.receivedAt);
  if (e.settlement !== null && typeof e.settlement === "object") {
    const s = { ...(e.settlement as Record<string, unknown>) };
    if (typeof s.dueBy === "string") s.dueBy = new Date(s.dueBy);
    e.settlement = s;
  }
  return e as unknown as DispatchEvent;
}

interface JournalRow {
  seq: number;
  actorKind: string;
  actorId: string;
  event: Record<string, unknown>;
  fromStatus: string;
  toStatus: string;
}

/**
 * The window of the journal an event belongs to: from the last event that changed the status. An event that repeats one
 * of the window by the same actor is a repeat (the same click, a retry after a lost answer); the same event in an older
 * window (a second REVISE after a new estimate) is a new one. `anchor` is the number of the first event of the window.
 * `answeredThrough` is the number of the last event the owner has answered (an objection to the report): the status does
 * not change when the customer objects, so the answer is what ends the window of that event; the same words said again
 * after the answer are a new objection, said twice before it - one.
 */
export function windowOf(
  journal: readonly JournalRow[],
  digest: string,
  actor: ActorRef,
  answeredThrough = 0,
): { anchor: number; repeat: boolean } {
  const anchor = journal.filter((e) => e.fromStatus !== e.toStatus).reduce((m, e) => Math.max(m, e.seq), 0);
  const repeat = journal
    .filter((e) => e.seq >= anchor && e.seq > answeredThrough)
    .some(
      (e) => e.actorKind === actor.kind && e.actorId === actor.id && eventDigest(eventIdentity(e.event)) === digest,
    );
  return { anchor, repeat };
}

/** The status change, inside the transaction `tx` the caller opened with `inDispatchTransaction`. */
export async function dispatchInTx(
  rt: Runtime,
  tx: Executor,
  orderIdRaw: string,
  rawEvent: DispatchEvent,
  rawActor: ActorRef,
  hooks: DispatchHooks = {},
): Promise<DispatchResult> {
  const orderId = assertUuid(orderIdRaw, "orderId");
  const actor = checkActor(rawActor);
  const event = normalizeEvent(rawEvent);
  // One event at a time per order: the second request sees what the first one did. An advisory lock, because the
  // roles of the bot and the worker may not UPDATE the order and so cannot SELECT ... FOR UPDATE.
  await lockBy(tx, `order:${orderId}`);

  const web = rt.role === "web";
  const order = web ? await webHead(tx, orderId) : await sales.getOrder(tx, orderId);
  // The same answer for an order that does not exist and for one of another customer: nothing to learn about it.
  if (!order) throw new NotFoundError("order");
  if (actor.kind === "customer" && actor.id !== order.customerId) throw new NotFoundError("order");
  if (web && !WEB_EVENTS.has(event.type)) {
    throw new ForbiddenError(
      `the site role cannot evaluate ${event.type}: the customer views do not show what it needs`,
    );
  }

  const digest = eventDigest(eventIdentity(JSON.parse(canonicalJson(event)) as Record<string, unknown>));
  let anchor = 0;
  if (!web) {
    const journal = await sales.listOrderEvents(tx, orderId);
    let answeredThrough = 0;
    if (event.type === "OBJECTION") {
      const report = await tx.query.commissionReports.findFirst({
        columns: { objection: true },
        where: (t, { eq }) => eq(t.orderId, orderId),
        orderBy: (t, { desc }) => desc(t.version),
      });
      answeredThrough = resolvedAfterSeqOf(report?.objection) ?? 0;
    }
    const w = windowOf(
      journal.map((j) => ({
        seq: j.seq,
        actorKind: j.actorKind,
        actorId: j.actorId,
        event: j.event,
        fromStatus: j.fromStatus,
        toStatus: j.toStatus,
      })),
      digest,
      actor,
      answeredThrough,
    );
    if (w.repeat) return { ok: true, status: order.status };
    anchor = w.anchor;
  }

  await hooks.before?.(tx, order);

  const now = rt.now();
  const [settings, calendar] = await Promise.all([loadFeeSettings(tx), loadCalendar(tx)]);
  const loaded = web ? await loadWebInputs(rt, tx, order, now) : await loadSnapshotInputs(rt, tx, order, now);

  let decided: DispatchEvent = event;
  let documentedLosses: number | undefined;
  if (event.type === "CANCEL") {
    const point = POINT_BY_STATUS[order.status];
    if (point === undefined || point !== event.point) return { ok: false, error: "invalid_transition" };
    const input = event as CancelEventInput;
    const totals = await purchaseTotals(tx, orderId);
    documentedLosses = input.documentedLosses;
    decided = {
      ...event,
      settlement: settle(
        {
          order,
          feeTotal: loaded.inputs.quote?.feeTotal ?? 0,
          point,
          ...(input.assemblyDoneBp === undefined ? {} : { assemblyDoneBp: input.assemblyDoneBp }),
          ...(documentedLosses === undefined ? {} : { documentedLosses }),
          fundsReceived: loaded.inputs.money.fundsReceived,
          now,
          settings,
          calendar,
        },
        await paidFee(tx, orderId),
        totals,
      ),
    };
  }

  let result: TransitionResult;
  try {
    result = transition(assembleSnapshot(loaded.inputs), decided as OrderEvent, actor.kind, now, calendar, settings);
  } catch (e) {
    if (e instanceof RangeError) throw ValidationError.of("event", "event_invalid", e.message);
    throw e;
  }
  if (!result.ok) return { ok: false, error: result.error };

  const refused = await serviceGuard({ tx, order, inputs: loaded.inputs, now }, decided as OrderEvent);
  if (refused !== undefined) return { ok: false, error: refused };

  const effects: ServiceEffect[] = [...result.effects];
  if (event.type === "ACCEPT") {
    // A reminder 24 hours after the acceptance if the prepayment has not come (the worker checks the flags when it fires).
    effects.push({
      kind: "job",
      job: OUTBOX_JOB.ACCEPT_REMINDER,
      at: new Date(now.getTime() + 24 * HOUR_MS),
      key: "accept_reminder",
    });
  }
  if (event.type === "DISPATCH" && loaded.inputs.quote && loaded.inputs.quote.final > 0) {
    // The final part of the fee is expected from the moment the PC goes to the customer.
    effects.push({ kind: "expect_payment", paymentKind: "fee_final", amount: sum(loaded.inputs.quote.final) });
  }

  const applied = await sales.applyTransition(tx, {
    orderId,
    event: JSON.parse(canonicalJson(decided)) as { type: OrderEvent["type"] } & Record<string, unknown>,
    actor,
    expectedFrom: order.status,
    guardSnapshot: {
      eventDigest: digest,
      window: anchor,
      role: rt.role,
      flags: assembleSnapshot(loaded.inputs).flags,
      money: loaded.inputs.money,
      ...(loaded.inputs.quote ? { quoteId: loaded.inputs.quote.id } : {}),
    },
    changes: buildChanges({
      order,
      event: decided as OrderEvent,
      actor: actor.kind,
      effects: result.effects,
      now,
      offers: loaded.offers,
      ...(documentedLosses === undefined ? {} : { documentedLosses }),
    }),
  });

  const customer: CustomerContact | null = await loadCustomerContact(tx, order.customerId);
  await runEffects(
    {
      rt,
      tx,
      order,
      customer,
      keyPrefix: `ord:${orderId}:${anchor}:${digest.slice(0, 16)}`,
      now,
      eventType: event.type,
    },
    effects,
  );

  if (event.type === "ACCEPT" && loaded.inputs.quote) {
    await markQuoteAccepted(rt, tx, loaded.inputs.quote.id, now, {
      channel: event.channel,
      consentIds: event.consentIds,
      offerVersionUzId: loaded.offers.uzId,
      offerVersionRuId: loaded.offers.ruId,
      actorId: actor.id,
    });
  }
  await hooks.after?.(tx, { order, status: applied.to, now });
  return { ok: true, status: applied.to };
}

/**
 * Applies an event of the order automaton (ARCHITECTURE 4.9, 4.13). Throws ValidationError for input that is not an
 * event, NotFoundError for an order the actor cannot see; a refusal by a rule is `{ ok: false, error }`.
 */
export async function dispatch(
  orderId: string,
  event: DispatchEvent,
  actor: ActorRef,
  rt?: Runtime,
): Promise<DispatchResult> {
  const r = runtimeOf(rt);
  return inDispatchTransaction(r, (tx) => dispatchInTx(r, tx, orderId, event, actor));
}
