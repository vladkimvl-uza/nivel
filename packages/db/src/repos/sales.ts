// Repositories of the sales schema: customers, leads, configurations, orders and their journal, quotes, payments,
// purchases, reserves (ARCHITECTURE 3.3, 3.4, 4.13). Rules the database enforces surface as DbRuleError.
import { randomBytes } from "node:crypto";
import { type Sum, sum } from "@nivel/domain/money";
import type { Actor, OrderEvent, OrderStatus } from "@nivel/domain/order";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { legalDocuments } from "../schema/content.ts";
import {
  configurations,
  customers,
  leads,
  orderEvents,
  orders,
  otherIncome,
  payments,
  purchases,
  quoteLines,
  quotes,
  reserveLedger,
} from "../schema/sales.ts";
import { expectUpdated, guarded } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { consentGranted, nextNumber } from "./ops.ts";
import { MS_PER_HOUR, TASHKENT_UTC_OFFSET_HOURS } from "./time.ts";

export type CustomerInsert = Omit<typeof customers.$inferInsert, "id" | "createdAt" | "erasedAt">;
export type OrderRow = typeof orders.$inferSelect;
export type QuoteRow = typeof quotes.$inferSelect;
export type QuoteInsert = Omit<typeof quotes.$inferInsert, "id" | "createdAt">;
export type QuoteLineInsert = Omit<typeof quoteLines.$inferInsert, "id" | "quoteId">;
export type PaymentRow = typeof payments.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
export type PurchaseInsert = Omit<typeof purchases.$inferInsert, "id" | "boughtAt" | "refundOf">;

/** Business calendar year (Asia/Tashkent, UTC+5): numbers restart on 1 January local time. */
export function tashkentYear(at: Date): number {
  return new Date(at.getTime() + TASHKENT_UTC_OFFSET_HOURS * MS_PER_HOUR).getUTCFullYear();
}

// ---- customers --------------------------------------------------------------------------------------------------
export async function createCustomer(db: Executor, input: CustomerInsert): Promise<string> {
  const [row] = await guarded(() => db.insert(customers).values(input).returning({ id: customers.id }));
  if (!row) throw new Error("customer was not written");
  return row.id;
}

/**
 * What every public role may read of a customer: the column rights of the site (00_grants.sql) are the narrowest, and a
 * SELECT of a column the role has no right to (the phone, the address, the Telegram name) fails with 42501 and rolls
 * back the transaction of the caller. The bot reads the rest with its own query.
 */
export type CustomerView = Pick<
  typeof customers.$inferSelect,
  "id" | "displayName" | "lang" | "district" | "telegramUserId" | "age18Confirmed" | "createdAt"
>;
const customerView = {
  id: customers.id,
  displayName: customers.displayName,
  lang: customers.lang,
  district: customers.district,
  telegramUserId: customers.telegramUserId,
  age18Confirmed: customers.age18Confirmed,
  createdAt: customers.createdAt,
};

export async function findCustomerByTelegramId(db: Executor, telegramUserId: number): Promise<CustomerView | null> {
  const [row] = await db.select(customerView).from(customers).where(eq(customers.telegramUserId, telegramUserId));
  return row ?? null;
}

// ---- configurations ---------------------------------------------------------------------------------------------
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 8 characters of base32 for /s/{code}: 40 random bits. */
export function newPublicCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => BASE32[b % 32]).join("");
}

export type ConfigurationInsert = Omit<typeof configurations.$inferInsert, "id" | "createdAt" | "publicCode"> & {
  publicCode?: string;
};

/** A saved configuration never changes; a changed one is saved again with parentId. */
export async function saveConfiguration(
  db: Executor,
  input: ConfigurationInsert,
): Promise<{ id: string; publicCode: string }> {
  const publicCode = input.publicCode ?? newPublicCode();
  const [row] = await guarded(() =>
    db
      .insert(configurations)
      .values({ ...input, publicCode })
      .returning({ id: configurations.id, publicCode: configurations.publicCode }),
  );
  if (!row) throw new Error("configuration was not written");
  return row;
}

export async function getConfigurationByCode(db: Executor, publicCode: string) {
  const [row] = await db.select().from(configurations).where(eq(configurations.publicCode, publicCode));
  return row ?? null;
}

// ---- leads ------------------------------------------------------------------------------------------------------
export type LeadInput = Omit<typeof leads.$inferInsert, "id" | "number" | "createdAt" | "status" | "rejectReason"> & {
  now?: Date;
};

/** Creates a lead with the next number L-<year>-NNNN (gap-free: call inside the transaction of the whole request). */
export async function createLead(db: Executor, input: LeadInput): Promise<{ id: string; number: string }> {
  const { now = new Date(), ...values } = input;
  const number = await nextNumber(db, "L", tashkentYear(now));
  const [row] = await guarded(() =>
    db
      .insert(leads)
      .values({ ...values, number })
      .returning({ id: leads.id, number: leads.number }),
  );
  if (!row) throw new Error("lead was not written");
  return row;
}

export async function setLeadStatus(
  db: Executor,
  id: string,
  status: "in_review" | "converted" | "rejected" | "spam",
  rejectReason?: string,
): Promise<void> {
  const rows = await guarded(() =>
    db
      .update(leads)
      .set({ status, rejectReason: rejectReason ?? null })
      .where(eq(leads.id, id))
      .returning({ id: leads.id }),
  );
  expectUpdated(rows, "lead", id);
}

// ---- orders -----------------------------------------------------------------------------------------------------
export type OrderInput = Pick<typeof orders.$inferInsert, "customerId" | "kind"> &
  Partial<Pick<typeof orders.$inferInsert, "leadId" | "slot" | "complexBuild" | "assignee">> & { now?: Date };

/** A new order is an estimate draft with the next number NV-<year>-NNNN. */
export async function createOrder(db: Executor, input: OrderInput): Promise<{ id: string; number: string }> {
  const { now = new Date(), ...values } = input;
  const number = await nextNumber(db, "NV", tashkentYear(now));
  const [row] = await guarded(() =>
    db
      .insert(orders)
      .values({ ...values, number })
      .returning({ id: orders.id, number: orders.number }),
  );
  if (!row) throw new Error("order was not written");
  return row;
}

export async function getOrder(db: Executor, id: string): Promise<OrderRow | null> {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row ?? null;
}

export async function getOrderByNumber(db: Executor, number: string): Promise<OrderRow | null> {
  const [row] = await db.select().from(orders).where(eq(orders.number, number));
  return row ?? null;
}

export interface TransitionInput {
  orderId: string;
  /** An OrderEvent of packages/domain (its `type` selects the edge of the status graph). */
  event: { type: OrderEvent["type"] } & Record<string, unknown>;
  /**
   * Who acts. The bot as `owner` or `assistant` names the Telegram id of an active account of that role
   * (ops.admin_users.telegram_user_id): the database checks it and raises actor_not_allowed for any other id. For the
   * other roles the id is the caller's own reference (admin user id, customer, "system"); it must not be empty.
   */
  actor: { kind: Actor; id: string };
  /** Status the caller read; a different current status raises stale_status (retry after a fresh read). */
  expectedFrom?: OrderStatus;
  guardSnapshot?: Record<string, unknown>;
  /**
   * Order columns to set together with the status (snake_case names). The function whitelists them by the pair
   * (actor, event): a customer writes only the fields of its event (accepted_at and the offer versions with ACCEPT,
   * handed_over_at and warranty_until with HANDOVER), and each of them once; the money fields are the owner's.
   */
  changes?: Record<string, unknown>;
}

/**
 * The only way to change an order status: calls sales.apply_transition(), which writes the status, the event of the
 * journal and the audit row in the caller's transaction. The service adds ops.outbox rows to the same transaction.
 */
export async function applyTransition(
  db: Executor,
  i: TransitionInput,
): Promise<{ seq: number; from: OrderStatus; to: OrderStatus }> {
  const { rows } = await guarded(() =>
    db.execute<{ out_seq: number; out_from: OrderStatus; out_to: OrderStatus }>(sql`
      select * from sales.apply_transition(
        ${i.orderId}::uuid, ${JSON.stringify(i.event)}::jsonb, ${i.actor.kind}, ${i.actor.id},
        ${i.expectedFrom ?? null}, ${i.guardSnapshot ? JSON.stringify(i.guardSnapshot) : null}::jsonb,
        ${JSON.stringify(i.changes ?? {})}::jsonb)`),
  );
  const r = rows[0];
  if (!r) throw new Error("apply_transition returned no row");
  return { seq: r.out_seq, from: r.out_from, to: r.out_to };
}

export async function listOrderEvents(db: Executor, orderId: string) {
  return db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId)).orderBy(asc(orderEvents.seq));
}

// ---- quotes -----------------------------------------------------------------------------------------------------
/** Inserts a draft quote with its lines and makes it the current quote of the order. */
export async function insertQuoteDraft(db: Executor, quote: QuoteInsert, lines: QuoteLineInsert[]): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await guarded(() =>
      tx
        .insert(quotes)
        .values({ ...quote, status: "draft" })
        .returning({ id: quotes.id }),
    );
    if (!row) throw new Error("quote was not written");
    if (lines.length > 0)
      await guarded(() => tx.insert(quoteLines).values(lines.map((l) => ({ ...l, quoteId: row.id }))));
    await tx.update(orders).set({ currentQuoteId: row.id }).where(eq(orders.id, quote.orderId));
    return row.id;
  });
}

export async function getQuote(db: Executor, id: string) {
  const [row] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!row) return null;
  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.id));
  return { ...row, lines };
}

/** draft -> sent: the owner's manual check mark and the send time; after this the quote never changes. */
export async function markQuoteSent(
  db: Executor,
  id: string,
  o: { checkedBy: string; at?: Date; validUntil?: Date; watermarkDraft?: boolean },
): Promise<void> {
  const at = o.at ?? new Date();
  const rows = await guarded(() =>
    db
      .update(quotes)
      .set({
        status: "sent",
        sentAt: at,
        manuallyCheckedBy: o.checkedBy,
        manuallyCheckedAt: at,
        validUntil: o.validUntil ?? null,
        ...(o.watermarkDraft !== undefined ? { watermarkDraft: o.watermarkDraft } : {}),
      })
      .where(eq(quotes.id, id))
      .returning({ id: quotes.id }),
  );
  expectUpdated(rows, "quote", id);
}

export async function markQuoteAccepted(
  db: Executor,
  id: string,
  acceptance: Record<string, unknown>,
  at: Date = new Date(),
): Promise<void> {
  const rows = await guarded(() =>
    db
      .update(quotes)
      .set({ status: "accepted", acceptedAt: at, acceptance })
      .where(eq(quotes.id, id))
      .returning({ id: quotes.id }),
  );
  expectUpdated(rows, "quote", id);
}

export async function setQuoteStatus(db: Executor, id: string, status: "expired" | "superseded"): Promise<void> {
  const rows = await guarded(() =>
    db.update(quotes).set({ status }).where(eq(quotes.id, id)).returning({ id: quotes.id }),
  );
  expectUpdated(rows, "quote", id);
}

// ---- payments ---------------------------------------------------------------------------------------------------
export type PaymentInput = Pick<
  typeof payments.$inferInsert,
  "orderId" | "kind" | "direction" | "method" | "amountSum"
> &
  Partial<Pick<typeof payments.$inferInsert, "payerIsCustomer" | "thirdPartyStatementFileId">>;

/** An expected payment (QR shown, transfer awaited). The pair kind x method x direction is checked by the database. */
export async function expectPayment(db: Executor, input: PaymentInput): Promise<string> {
  const [row] = await guarded(() =>
    db
      .insert(payments)
      .values({ ...input, status: "expected" })
      .returning({ id: payments.id }),
  );
  if (!row) throw new Error("payment was not written");
  return row.id;
}

export interface ConfirmInput {
  by: string;
  at?: Date;
  fiscalReceiptNo?: string;
  bankDocNo?: string;
  payerIsCustomer?: boolean;
  thirdPartyStatementFileId?: string;
}

/** expected -> confirmed; a fee payment without a fiscal receipt number is refused by the database. */
export async function confirmPayment(db: Executor, id: string, c: ConfirmInput): Promise<PaymentRow> {
  const at = c.at ?? new Date();
  const [row] = await guarded(() =>
    db
      .update(payments)
      .set({
        status: "confirmed",
        confirmedBy: c.by,
        confirmedAt: at,
        occurredAt: at,
        fiscalReceiptNo: c.fiscalReceiptNo ?? null,
        bankDocNo: c.bankDocNo ?? null,
        ...(c.payerIsCustomer !== undefined ? { payerIsCustomer: c.payerIsCustomer } : {}),
        ...(c.thirdPartyStatementFileId ? { thirdPartyStatementFileId: c.thirdPartyStatementFileId } : {}),
      })
      .where(eq(payments.id, id))
      .returning(),
  );
  if (!row) throw new Error(`payment ${id} not found`);
  return row;
}

export async function voidPayment(db: Executor, id: string): Promise<void> {
  const rows = await guarded(() =>
    db.update(payments).set({ status: "void" }).where(eq(payments.id, id)).returning({ id: payments.id }),
  );
  expectUpdated(rows, "payment", id);
}

/**
 * A confirmed payment is corrected with a confirmed reversing row of the negative amount: the whole payment, or the
 * part `amountSum` (positive). The original is read here, never taken from the caller; the database refuses a
 * reversal of an unconfirmed payment and reversals that together exceed the payment (invalid_reversal).
 */
export async function reversePayment(
  db: Executor,
  originalId: string,
  c: ConfirmInput & { amountSum?: number },
): Promise<string> {
  const at = c.at ?? new Date();
  const [original] = await db.select().from(payments).where(eq(payments.id, originalId));
  if (!original) throw new Error(`payment ${originalId} not found`);
  const [row] = await guarded(() =>
    db
      .insert(payments)
      .values({
        orderId: original.orderId,
        kind: original.kind,
        direction: original.direction,
        method: original.method,
        amountSum: -(c.amountSum ?? original.amountSum),
        status: "confirmed",
        reversalOf: original.id,
        confirmedBy: c.by,
        confirmedAt: at,
        occurredAt: at,
        fiscalReceiptNo: c.fiscalReceiptNo ?? null,
        bankDocNo: c.bankDocNo ?? null,
      })
      .returning({ id: payments.id }),
  );
  if (!row) throw new Error("reversal was not written");
  return row.id;
}

export async function listPayments(db: Executor, orderId: string): Promise<PaymentRow[]> {
  return db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(asc(payments.createdAt), asc(payments.id));
}

// ---- purchases --------------------------------------------------------------------------------------------------
/**
 * Records a purchase. The database refuses it above the quote limit without a limit_overrun consent, above the
 * confirmed purchase funds (never our own money), and a receipt-less purchase without the consent.
 */
export async function recordPurchase(db: Executor, input: PurchaseInsert): Promise<string> {
  const [row] = await guarded(() => db.insert(purchases).values(input).returning({ id: purchases.id }));
  if (!row) throw new Error("purchase was not written");
  return row.id;
}

/** A return to the shop: a row of the negative amount that frees the limit and the funds again. */
export async function returnPurchase(
  db: Executor,
  purchaseId: string,
  o: { amountSum: number; boughtBy: string; receiptNo?: string },
): Promise<string> {
  const [orig] = await db.select().from(purchases).where(eq(purchases.id, purchaseId));
  if (!orig) throw new Error(`purchase ${purchaseId} not found`);
  const [row] = await guarded(() =>
    db
      .insert(purchases)
      .values({
        orderId: orig.orderId,
        vendorId: orig.vendorId,
        productId: orig.productId,
        quoteLineId: orig.quoteLineId,
        qty: orig.qty,
        amountSum: -Math.abs(o.amountSum),
        refundOf: orig.id,
        paidVia: orig.paidVia,
        receiptKind: orig.receiptKind === "none_with_consent" ? "esf" : orig.receiptKind,
        receiptNo: o.receiptNo ?? orig.receiptNo,
        esfStatus: orig.receiptKind === "none_with_consent" ? "pending" : orig.esfStatus,
        boughtBy: o.boughtBy,
      })
      .returning({ id: purchases.id }),
  );
  if (!row) throw new Error("return was not written");
  return row.id;
}

export async function listPurchases(db: Executor, orderId: string): Promise<PurchaseRow[]> {
  return db
    .select()
    .from(purchases)
    .where(eq(purchases.orderId, orderId))
    .orderBy(asc(purchases.boughtAt), asc(purchases.id));
}

// ---- the money of an order as the order automaton sees it ---------------------------------------------------------
export interface OrderMoney {
  /** Confirmed purchase_funds + purchase_topup, reversals included. */
  fundsReceived: Sum;
  /** Sum of purchases, returns to shops included (negative rows). */
  receiptsTotal: Sum;
  /** Confirmed remainder_refund + funds_refund. */
  refunded: Sum;
  documentedLosses: Sum;
  hasLimitOverrunConsent: boolean;
}

/** Same sums the database closes the order with (ARCHITECTURE 3.4): fundsReceived = receiptsTotal + refunded + losses. */
export async function orderMoney(db: Executor, orderId: string): Promise<OrderMoney> {
  const { rows } = await db.execute<{ funds: string; refunded: string; spent: string; losses: string }>(sql`
    select
      coalesce((select sum(amount_sum) from sales.payments
                 where order_id = ${orderId}::uuid and status = 'confirmed' and kind in ('purchase_funds', 'purchase_topup')), 0)::text as funds,
      coalesce((select sum(amount_sum) from sales.payments
                 where order_id = ${orderId}::uuid and status = 'confirmed' and kind in ('remainder_refund', 'funds_refund')), 0)::text as refunded,
      coalesce((select sum(amount_sum) from sales.purchases where order_id = ${orderId}::uuid), 0)::text as spent,
      coalesce((select documented_losses_sum from sales.orders where id = ${orderId}::uuid), 0)::text as losses`);
  const r = rows[0];
  return {
    // sum() throws RangeError for anything beyond a safe integer: a bigint column is never silently rounded.
    fundsReceived: sum(Number(r?.funds ?? 0)),
    receiptsTotal: sum(Number(r?.spent ?? 0)),
    refunded: sum(Number(r?.refunded ?? 0)),
    documentedLosses: sum(Number(r?.losses ?? 0)),
    hasLimitOverrunConsent: await consentGranted(db, orderId, "limit_overrun"),
  };
}

export interface OrderContext {
  order: OrderRow;
  quote: Awaited<ReturnType<typeof getQuote>>;
  money: OrderMoney;
  /** Status of the offer versions fixed on the order; `stub` when none is fixed yet. */
  offer: { uz: "stub" | "lawyer_approved" | "published"; ru: "stub" | "lawyer_approved" | "published" };
}

/** Everything the order snapshot of packages/domain needs from the database, read in one place. */
export async function loadOrderContext(db: Executor, orderId: string): Promise<OrderContext | null> {
  const order = await getOrder(db, orderId);
  if (!order) return null;
  const quote = order.currentQuoteId ? await getQuote(db, order.currentQuoteId) : null;
  const statusOf = async (id: string | null) => {
    if (!id) return "stub" as const;
    const [d] = await db
      .select({ status: legalDocuments.status })
      .from(legalDocuments)
      .where(eq(legalDocuments.id, id));
    return d?.status ?? ("stub" as const);
  };
  return {
    order,
    quote,
    money: await orderMoney(db, orderId),
    offer: { uz: await statusOf(order.offerVersionUzId), ru: await statusOf(order.offerVersionRuId) },
  };
}

// ---- reserves, other income, deals ------------------------------------------------------------------------------
export async function appendReserve(
  db: Executor,
  r: { fund: "warranty" | "tax_risk"; amountSum: number; reason: string; orderId?: string; at?: Date },
): Promise<string> {
  const [row] = await guarded(() =>
    db
      .insert(reserveLedger)
      .values({
        fund: r.fund,
        amountSum: r.amountSum,
        reason: r.reason,
        orderId: r.orderId ?? null,
        ...(r.at ? { at: r.at } : {}),
      })
      .returning({ id: reserveLedger.id }),
  );
  if (!row) throw new Error("reserve row was not written");
  return row.id;
}

export async function reserveBalance(db: Executor, fund: "warranty" | "tax_risk"): Promise<number> {
  const { rows } = await db.execute<{ s: string }>(
    sql`select coalesce(sum(amount_sum), 0)::text as s from sales.reserve_ledger where fund = ${fund}`,
  );
  return Number(rows[0]?.s ?? 0);
}

export async function addOtherIncome(
  db: Executor,
  i: { year: number; period: string; amountSum: number; note?: string; enteredBy: string },
): Promise<string> {
  const [row] = await guarded(() =>
    db
      .insert(otherIncome)
      .values({ ...i, note: i.note ?? null })
      .returning({ id: otherIncome.id }),
  );
  if (!row) throw new Error("income was not written");
  return row.id;
}

export interface DealVolume {
  year: number;
  receiptsSum: number;
  feeInSum: number;
  feeRefundSum: number;
  otherIncomeSum: number;
  dealsSum: number;
}

/** Deals of a year for the registration threshold; zeros when nothing happened in the year. */
export async function dealVolume(db: Executor, year: number): Promise<DealVolume> {
  const { rows } = await db.execute<Record<string, string>>(
    sql`select receipts_sum::text, fee_in_sum::text, fee_refund_sum::text, other_income_sum::text, deals_sum::text
          from sales.v_deal_volume_by_year where year = ${year}`,
  );
  const r = rows[0];
  return {
    year,
    receiptsSum: Number(r?.receipts_sum ?? 0),
    feeInSum: Number(r?.fee_in_sum ?? 0),
    feeRefundSum: Number(r?.fee_refund_sum ?? 0),
    otherIncomeSum: Number(r?.other_income_sum ?? 0),
    dealsSum: Number(r?.deals_sum ?? 0),
  };
}

/** Orders in the given statuses, oldest first (reminders, estimate expiry, report deadlines). */
export async function listOrdersByStatus(
  db: Executor,
  statuses: OrderRow["status"][],
  limit = 100,
): Promise<OrderRow[]> {
  return db.select().from(orders).where(inArray(orders.status, statuses)).orderBy(asc(orders.createdAt)).limit(limit);
}

export async function latestQuoteOfOrder(db: Executor, orderId: string) {
  const [row] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.orderId, orderId))
    .orderBy(desc(quotes.version))
    .limit(1);
  return row ?? null;
}
