// The snapshot of an order for the automaton of the domain (ARCHITECTURE 4.9, ADR-007). The pure part assembles it from
// plain facts; the loaders read the facts from the database. Two inputs are mandatory for the domain and throw
// RangeError without them: the end of the objection window (orders.objection_until) and the reserves (the state of the
// warranty fund and whether the tax-risk reserve still runs); the basis of the warranty reserve is the receipts.
import { type Executor, ops, sales } from "@nivel/db/repos";
import { type Bp, bp, sum } from "@nivel/domain/money";
import type { OfferStatus, OrderSnapshot } from "@nivel/domain/order";
import { readStoredTotals, type StoredTotals } from "../quotes/stored.ts";
import { dsl } from "./dsl.ts";
import { can, type Runtime } from "./runtime.ts";
import { loadTaxRiskActive } from "./settings.ts";

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;

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
  at: Date;
}

/**
 * The state of the report as the automaton reads it, from the journal of the order: the report is accepted by the
 * customer or by the term, an objection stays open until the owner resolves it (commission_reports.objection.resolvedAt)
 * and a newer objection opens it again. Only what followed the last sending of the report counts.
 */
export function reportStateFrom(i: {
  events: readonly JournalEvent[];
  reportExists: boolean;
  resolvedAt: Date | null;
  objectionUntil: Date | null;
}): OrderSnapshot["report"] | undefined {
  if (!i.reportExists) return undefined;
  const lastSend = i.events.filter((e) => e.type === "SEND_REPORT").reduce((m, e) => Math.max(m, e.seq), 0);
  const since = i.events.filter((e) => e.seq > lastSend);
  const accepted = since.some((e) => e.type === "REPORT_ACCEPTED" || e.type === "REPORT_DEEMED_ACCEPTED");
  const objections = since.filter((e) => e.type === "OBJECTION");
  const last = objections.reduce<Date | null>((m, e) => (m === null || e.at > m ? e.at : m), null);
  const objectionOpen = last !== null && !(i.resolvedAt !== null && i.resolvedAt >= last);
  return { accepted, objectionOpen, objectionUntil: i.objectionUntil };
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

/** What the warranty fund looks like now. Roles that cannot read the ledger get a young fund: the rate is never too low. */
export async function loadReserves(rt: Runtime, ex: Executor, now: Date): Promise<OrderSnapshot["reserves"]> {
  const taxRiskActive = await loadTaxRiskActive(ex);
  if (!can(rt, "ledger.read")) {
    return { warranty: { balance: sum(0), closedOrders: 0, lossesLast12mBp: bp(0) }, taxRiskActive };
  }
  const { sql } = dsl(ex);
  const since = new Date(now.getTime() - YEAR_MS);
  const balance = await sales.reserveBalance(ex, "warranty");
  const { rows } = await ex.execute<{ closed: string; losses: string; purchased: string }>(sql`
    select (select count(*) from sales.orders where status = 'closed')::text as closed,
           coalesce((select sum(cost_from_reserve_sum) from sales.warranty_cases where opened_at >= ${since}), 0)::text as losses,
           coalesce((select sum(amount_sum) from sales.purchases where bought_at >= ${since}), 0)::text as purchased`);
  const r = rows[0];
  return {
    warranty: {
      balance: sum(balance),
      closedOrders: Number(r?.closed ?? 0),
      lossesLast12mBp: lossesBp(Number(r?.losses ?? 0), Number(r?.purchased ?? 0)),
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
  const resolved = (report?.objection as { resolvedAt?: string } | null)?.resolvedAt;

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
      events: events.map((e) => ({ seq: e.seq, type: String((e.event as { type?: unknown }).type), at: e.at })),
      reportExists: report !== undefined,
      resolvedAt: resolved ? new Date(resolved) : null,
      objectionUntil: order.objectionUntil,
    }),
    firstOrderOfCustomer: await isFirstOrder(ex, order.customerId, order.id),
    offer: offers.status,
    appMode: rt.appMode,
    reserves: await loadReserves(rt, ex, now),
  };
  return { inputs, offers, quote };
}
