// What follows a status change, after it is written and still inside the same transaction (ARCHITECTURE 4.13): the
// messages and jobs go to ops.outbox (the worker sends and runs them after the commit), the expected payments and the
// reserve entries are written directly when the role of this process may, and travel as jobs when it may not.
// Every outbox row has a key made of the order, the window of the journal and the digest of the event, so that the
// same event never queues the same message twice (the idempotency of dispatch).
import { type Executor, ops, sales } from "@nivel/db/repos";
import { sum } from "@nivel/domain/money";
import type { Effect } from "@nivel/domain/order";
import { OUTBOX_JOB } from "../outbox/contract.ts";
import { PAYMENT_PAIRS } from "../payments/pairs.ts";
import { can, type Runtime } from "./runtime.ts";
import type { OrderRow } from "./snapshot.ts";

export interface CustomerContact {
  id: string;
  lang: "uz" | "ru";
  telegramUserId: number | null;
}

/** A job of the service itself, beside the effects of the domain. */
export interface ExtraJob {
  kind: "job";
  job: string;
  at?: Date;
  key: string;
  payload?: Record<string, unknown>;
}

export type ServiceEffect = Effect | ExtraJob;

export interface EffectEnv {
  rt: Runtime;
  tx: Executor;
  order: OrderRow;
  customer: CustomerContact | null;
  /** `ord:<order>:<window>:<digest>`: the start of every dedupe key of this dispatch. */
  keyPrefix: string;
  now: Date;
  eventType: string;
}

export async function loadCustomerContact(ex: Executor, customerId: string): Promise<CustomerContact | null> {
  // The columns the site may read: the language and the Telegram id are among them.
  const row = await ex.query.customers.findFirst({
    columns: { id: true, lang: true, telegramUserId: true },
    where: (t, { eq }) => eq(t.id, customerId),
  });
  return row ?? null;
}

async function ensureExpectedPayment(env: EffectEnv, kind: keyof typeof PAYMENT_PAIRS, amount: number): Promise<void> {
  const { tx, order } = env;
  if (!can(env.rt, "payments.write")) {
    // The database gives no role but the admin the right to write payments: the admin side picks the job up.
    await ops.enqueueOutbox(tx, {
      kind: "job",
      dedupeKey: `${env.keyPrefix}:pay:${kind}`,
      payload: {
        job: OUTBOX_JOB.PAYMENT_EXPECT,
        orderId: order.id,
        orderNumber: order.number,
        paymentKind: kind,
        amountSum: amount,
      },
    });
    return;
  }
  const existing = await tx.query.payments.findMany({
    columns: { id: true, amountSum: true },
    where: (t, { and, eq, inArray, isNull }) =>
      and(
        eq(t.orderId, order.id),
        eq(t.kind, kind),
        inArray(t.status, ["expected", "confirmed"]),
        isNull(t.reversalOf),
      ),
  });
  if (existing.some((p) => p.amountSum === amount)) return;
  const pair = PAYMENT_PAIRS[kind];
  await sales.expectPayment(tx, {
    orderId: order.id,
    kind,
    direction: pair.direction,
    method: pair.method,
    amountSum: amount,
  });
}

async function enqueue(env: EffectEnv, key: string, payload: Record<string, unknown>, at?: Date): Promise<void> {
  await ops.enqueueOutbox(env.tx, {
    kind: "job",
    dedupeKey: `${env.keyPrefix}:${key}`,
    payload: { orderId: env.order.id, orderNumber: env.order.number, ...payload },
    ...(at ? { sendAfter: at } : {}),
  });
}

export async function runEffects(env: EffectEnv, effects: readonly ServiceEffect[]): Promise<void> {
  const { tx, order } = env;
  for (const [i, effect] of effects.entries()) {
    switch (effect.kind) {
      case "notify":
        await ops.enqueueOutbox(tx, {
          kind: "telegram_message",
          dedupeKey: `${env.keyPrefix}:n${i}`,
          payload: {
            target: effect.to,
            templateKey: effect.templateKey,
            ...(effect.params ? { params: effect.params } : {}),
            orderId: order.id,
            orderNumber: order.number,
            customerId: order.customerId,
            lang: env.customer?.lang ?? "uz",
            ...(effect.to === "customer" ? { telegramUserId: env.customer?.telegramUserId ?? null } : {}),
            ...(effect.to === "owner_topic" && order.tgTopicId !== null ? { topicId: order.tgTopicId } : {}),
          },
        });
        break;
      case "schedule":
        await enqueue(
          env,
          `s:${effect.job}:${effect.at.getTime()}`,
          { job: effect.job, at: effect.at.toISOString() },
          effect.at,
        );
        break;
      case "render_pdf":
        await enqueue(env, `pdf:${effect.doc}`, {
          job: OUTBOX_JOB.PDF_RENDER,
          doc: effect.doc,
          watermarkDraft: effect.watermarkDraft,
        });
        break;
      case "expect_payment":
        await ensureExpectedPayment(env, effect.paymentKind, effect.amount);
        break;
      case "ledger": {
        const reason = `order ${order.number}: ${env.eventType}`;
        if (can(env.rt, "ledger.write")) {
          await sales.appendReserve(tx, {
            fund: effect.fund,
            amountSum: sum(effect.amount),
            reason,
            orderId: order.id,
            at: env.now,
          });
        } else {
          await enqueue(env, `ledger:${effect.fund}`, {
            job: OUTBOX_JOB.LEDGER_APPEND,
            fund: effect.fund,
            amountSum: effect.amount,
            reason,
          });
        }
        break;
      }
      case "set":
        break; // written with the status, see changes.ts
      case "job":
        await enqueue(
          env,
          `x:${effect.key}`,
          { job: effect.job, ...(effect.payload ?? {}), ...(effect.at ? { at: effect.at.toISOString() } : {}) },
          effect.at,
        );
        break;
    }
  }
}
