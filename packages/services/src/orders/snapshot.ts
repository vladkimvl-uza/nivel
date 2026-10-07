// The snapshot of an order for the automaton of the domain (ARCHITECTURE 4.9, ADR-007). The pure part assembles it from
// plain facts; the loaders read the facts from the database. Two inputs are mandatory for the domain and throw
// RangeError without them: the end of the objection window (orders.objection_until) and the reserves (the state of the
// warranty fund and whether the tax-risk reserve still runs); the basis of the warranty reserve is the receipts.
import { type Executor, ops, sales } from "@nivel/db/repos";
import { type Bp, bp, sum } from "@nivel/domain/money";
import type { OfferStatus, OrderSnapshot } from "@nivel/domain/order";
import { readStoredTotals, type StoredTotals } from "../quotes/stored.ts";
import type { Runtime } from "./runtime.ts";
import { loadTaxRiskActive } from "./settings.ts";

export interface SnapshotOrder {
  status: OrderSnapshot["status"];
  kind: OrderSnapshot["kind"];
  feePrepaid: boolean;
  fundsReceived: boolean;
  firstOrderMeetingDone: boolean;
  purchaseNotBefore: Date | null;
}

export interface SnapshotQuote {
  id: string;
  status: string;
  validUntil: Date | null;
  stored: StoredTotals;
  purchaseLimit: number;
  feeTotal: number;
  advance: number;
  final: number;
  manuallyChecked: boolean;
  hasNonReturnable: boolean;
}

export interface SnapshotInputs {
  order: SnapshotOrder;
  quote: SnapshotQuote | undefined;
  money: OrderSnapshot["money"];
  purchasesComplete: boolean;
  report: OrderSnapshot["report"];
  firstOrderOfCustomer: boolean;
  offer: OrderSnapshot["offer"];
  appMode: OrderSnapshot["appMode"];
  reserves: OrderSnapshot["reserves"];
}

export function assembleSnapshot(i: SnapshotInputs): OrderSnapshot {
  const q = i.quote;
  return {
    status: i.order.status,
    kind: i.order.kind,
    flags: {
      feePrepaid: i.order.feePrepaid,
      fundsReceived: i.order.fundsReceived,
      firstOrderMeetingDone: i.order.firstOrderMeetingDone,
    },
    ...(q === undefined
      ? {}
      : {
          quote: {
            id: q.id,
            status: q.status,
            ...(q.validUntil === null ? {} : { validUntil: q.validUntil }),
            compatVerdict: q.stored.compatVerdict,
            manuallyChecked: q.manuallyChecked,
            eligibility: q.stored.eligibility,
            purchaseLimit: sum(q.purchaseLimit),
            advance: sum(q.advance),
            final: sum(q.final),
            hasNonReturnable: q.hasNonReturnable,
          },
        }),
    money: i.money,
    purchasesComplete: i.purchasesComplete,
    ...(i.report === undefined ? {} : { report: i.report }),
    firstOrderOfCustomer: i.firstOrderOfCustomer,
    grandTotal: sum(q === undefined ? 0 : q.purchaseLimit + q.feeTotal),
    ...(i.order.purchaseNotBefore === null ? {} : { purchaseNotBefore: i.order.purchaseNotBefore }),
    offer: i.offer,
    appMode: i.appMode,
    reserves: i.reserves,
  };
}

// ---- pure facts -------------------------------------------------------------------------------------------------

export interface LineFact {
  id: string;
  qty: number;
  purchasedByIp: boolean;
  customerOwned: boolean;
}
export interface PurchaseFact {
  quoteLineId: string | null;
  qty: number;
  amountSum: number;
  refundOf: string | null;
}

/**
 * Every line the sole proprietor buys is bought in full and not returned (a line may be bought in several purchases),
 * or the customer agreed to a replacement (consent `replacement`) and something was bought.
 */
export function purchasesCompleteOf(
  lines: readonly LineFact[],
  purchases: readonly PurchaseFact[],
  replacementGranted: boolean,
): boolean {
  const toBuy = lines.filter((l) => l.purchasedByIp && !l.customerOwned);
  const satisfied = toBuy.every((line) => {
    const mine = purchases.filter((p) => p.quoteLineId === line.id);
    const bought = mine.filter((p) => p.refundOf === null).reduce((n, p) => n + p.qty, 0);
    const net = mine.reduce((n, p) => n + p.amountSum, 0);
    return bought >= line.qty && net > 0;
  });
  if (satisfied) return true;
  return replacementGranted && purchases.some((p) => p.refundOf === null);
}

export interface JournalEvent {
  seq: number;
  type: string;
}

/**
 * The state of the report as the automaton reads it, from the journal of the order: the report is accepted by the
 * customer or by the term, an objection stays open until the owner resolves it and a newer objection opens it again.
 * Only what followed the last sending of the report counts.
 *
 * The resolution is compared with the journal by the sequence number, never by time: the journal is stamped by the clock
 * of the database and the resolution by the clock of the process, and two clocks must not be compared.
 */
export function reportStateFrom(i: {
  events: readonly JournalEvent[];
  reportExists: boolean;
  /** `commission_reports.objection.resolvedAfterSeq`: the last objection of the journal that the owner has answered. */
  resolvedAfterSeq: number | null;
  objectionUntil: Date | null;
}): OrderSnapshot["report"] | undefined {
  if (!i.reportExists) return undefined;
  const accepted = sinceLastReport(i.events).some(
    (e) => e.type === "REPORT_ACCEPTED" || e.type === "REPORT_DEEMED_ACCEPTED",
  );
  const lastObjection = lastObjectionSeq(i.events);
  const objectionOpen = lastObjection !== null && lastObjection > (i.resolvedAfterSeq ?? 0);
  return { accepted, objectionOpen, objectionUntil: i.objectionUntil };
}

function sinceLastReport(events: readonly JournalEvent[]): JournalEvent[] {
  const lastSend = events.filter((e) => e.type === "SEND_REPORT").reduce((m, e) => Math.max(m, e.seq), 0);
  return events.filter((e) => e.seq > lastSend);
}

/** The sequence number of the newest objection to the report that is out now, or null when there is none. */
export function lastObjectionSeq(events: readonly JournalEvent[]): number | null {
  return sinceLastReport(events)
    .filter((e) => e.type === "OBJECTION")
    .reduce<number | null>((m, e) => (m === null || e.seq > m ? e.seq : m), null);
}

/** The state of the objection as `commission_reports.objection` keeps it; a number only, never a time. */
export function resolvedAfterSeqOf(objection: unknown): number | null {
  const v = (objection as { resolvedAfterSeq?: unknown } | null | undefined)?.resolvedAfterSeq;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Losses in basis points of what was bought: the input of the warranty reserve rate (CONCEPT 2.6). */
export function lossesBp(losses: number, purchased: number): Bp {
  if (losses <= 0) return bp(0);
  if (purchased <= 0) return bp(10_000);
  return bp(Math.min(10_000, Number((BigInt(losses) * 10_000n) / BigInt(purchased))));
}

// ---- readers ----------------------------------------------------------------------------------------------------

/** Statuses of an order the customer has really started: the first order of a customer is one without any of these. */
const STARTED = [
  "accepted",
  "purchasing",
  "report_due",
  "report_sent",
  "settled",
  "assembling",
  "testing",
  "ready",
  "delivering",
  "handed_over",
  "closed",
] as const;

export async function isFirstOrder(ex: Executor, customerId: string, orderId: string): Promise<boolean> {
  const other = await ex.query.orders.findFirst({
    columns: { id: true },
    where: (t, { and, eq, inArray, ne }) =>
      and(eq(t.customerId, customerId), ne(t.id, orderId), inArray(t.status, [...STARTED])),
  });
  return other === undefined;
}

const OFFER_RANK: Record<OfferStatus, number> = { stub: 0, lawyer_approved: 1, published: 2 };

export interface OfferChoice {
  uzId: string | null;
  ruId: string | null;
  status: OrderSnapshot["offer"];
}

/**
 * The offers of an order: the versions fixed on it, or, before the acceptance, the best current version of each language
 * (published, else approved by the lawyer, else a stub). The customer accepts exactly those.
 */
export async function loadOffers(ex: Executor, fixed: { uz: string | null; ru: string | null }): Promise<OfferChoice> {
  const rows = await ex.query.legalDocuments.findMany({
    columns: { id: true, lang: true, status: true, createdAt: true },
    where: (t, { eq }) => eq(t.kind, "offer"),
  });
  const pick = (lang: "uz" | "ru", fixedId: string | null) => {
    const mine = rows.filter((r) => r.lang === lang && (fixedId === null || r.id === fixedId));
    const best = [...mine].sort(
      (a, b) => OFFER_RANK[b.status] - OFFER_RANK[a.status] || b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    return best ? { id: best.id, status: best.status } : { id: null, status: "stub" as const };
  };
  const uz = pick("uz", fixed.uz);
  const ru = pick("ru", fixed.ru);
  return { uzId: uz.id, ruId: ru.id, status: { uz: uz.status, ru: ru.status } };
}

/**
 * What the warranty fund looks like now, for every role alike: sales.warranty_fund_state() answers four aggregates and no
 * row of a register, so the site and the bot, which cannot read the ledger, the orders or the cases, no longer count a
 * young fund (the rate of 2 %) while the worker counts a mature one: the contribution does not depend on who pressed.
 */
export async function loadReserves(ex: Executor, now: Date): Promise<OrderSnapshot["reserves"]> {
  // One after the other: inside a transaction both go through the same connection, which serves one query at a time.
  const taxRiskActive = await loadTaxRiskActive(ex);
  const fund = await sales.warrantyFundState(ex, now);
  return {
    warranty: {
      balance: sum(fund.balance),
      closedOrders: fund.closedOrders,
      lossesLast12mBp: lossesBp(fund.lossesLast12m, fund.purchasedLast12m),
    },
    taxRiskActive,
  };
}

export type OrderRow = NonNullable<Awaited<ReturnType<typeof sales.getOrder>>>;

/** Everything the automaton needs about an order, read inside the transaction of the dispatch (roles that read orders). */
export async function loadSnapshotInputs(
  rt: Runtime,
  ex: Executor,
  order: OrderRow,
  now: Date,
): Promise<{ inputs: SnapshotInputs; offers: OfferChoice; quote: Awaited<ReturnType<typeof sales.getQuote>> }> {
  const quote = order.currentQuoteId ? await sales.getQuote(ex, order.currentQuoteId) : null;
  const money = await sales.orderMoney(ex, order.id);
  const purchases = quote ? await sales.listPurchases(ex, order.id) : [];
  const replacement = quote ? await ops.consentGranted(ex, order.id, "replacement") : false;
  const offers = await loadOffers(ex, { uz: order.offerVersionUzId, ru: order.offerVersionRuId });

  const report = await ex.query.commissionReports.findFirst({
    columns: { objection: true },
    where: (t, { eq }) => eq(t.orderId, order.id),
    orderBy: (t, { desc }) => desc(t.version),
  });
  const events = report ? await sales.listOrderEvents(ex, order.id) : [];

  const inputs: SnapshotInputs = {
    order: {
      status: order.status,
      kind: order.kind,
      feePrepaid: order.feePrepaid,
      fundsReceived: order.fundsReceived,
      firstOrderMeetingDone: order.firstOrderMeetingDone,
      purchaseNotBefore: order.purchaseNotBefore,
    },
    quote: quote
      ? {
          id: quote.id,
          status: quote.status,
          validUntil: quote.validUntil,
          stored: readStoredTotals(quote.totals),
          purchaseLimit: quote.purchaseLimit,
          feeTotal: quote.feeTotal,
          advance: quote.feeAdvance,
          final: quote.feeFinal,
          manuallyChecked: quote.manuallyCheckedBy !== null,
          hasNonReturnable: quote.lines.some((l) => l.returnable === "no" && !l.customerOwned),
        }
      : undefined,
    money,
    purchasesComplete: quote
      ? purchasesCompleteOf(
          quote.lines.map((l) => ({
            id: l.id,
            qty: l.qty,
            purchasedByIp: l.purchasedByIp,
            customerOwned: l.customerOwned,
          })),
          purchases.map((p) => ({
            quoteLineId: p.quoteLineId,
            qty: p.qty,
            amountSum: p.amountSum,
            refundOf: p.refundOf,
          })),
          replacement,
        )
      : false,
    report: reportStateFrom({
      events: events.map((e) => ({ seq: e.seq, type: String((e.event as { type?: unknown }).type) })),
      reportExists: report !== undefined,
      resolvedAfterSeq: resolvedAfterSeqOf(report?.objection),
      objectionUntil: order.objectionUntil,
    }),
    firstOrderOfCustomer: await isFirstOrder(ex, order.customerId, order.id),
    offer: offers.status,
    appMode: rt.appMode,
    reserves: await loadReserves(ex, now),
  };
  return { inputs, offers, quote };
}
