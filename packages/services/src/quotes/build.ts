// quotes.build (BUILD_PLAN WP-07): the owner puts together the estimate of an order. The calculation is the server's:
// the lines (or a saved configuration) come from the owner, the prices from the market, the scale from the settings.
// The draft becomes the current quote of the order; an earlier sent or expired quote is superseded.
import { type Executor, ops, sales } from "@nivel/db/repos";
import type { BuildLine } from "@nivel/domain/catalog";
import type { Task } from "@nivel/domain/compat";
import type { QuoteTotals } from "@nivel/domain/fee";
import { type ActorRef, auditActor, requireStaff } from "../orders/actor.ts";
import { NotFoundError, ValidationError } from "../orders/errors.ts";
import { freeWindowAvailable } from "../orders/load.ts";
import { lockBy } from "../orders/lock.ts";
import { type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { loadFeeSettings } from "../orders/settings.ts";
import { assertUuid } from "../orders/validate.ts";
import { type ComputedQuote, computeQuoteFor, type ManualLine } from "./compute.ts";
import { quoteColumns, serializeTotals } from "./stored.ts";

export interface BuildQuoteInput {
  orderId: string;
  /** Positions of the catalog; prices are never taken from the caller. */
  lines?: BuildLine[];
  /** Or the lines of a saved configuration (sales.configurations). */
  configurationId?: string;
  /** Works and services the owner enters by hand. */
  manualLines?: ManualLine[];
  tasks?: Task[];
}

export interface BuiltQuote {
  quoteId: string;
  version: number;
  totals: QuoteTotals;
  compatVerdict: ComputedQuote["compatVerdict"];
  shelfLifeHours: number;
}

async function linesOf(ex: Executor, input: BuildQuoteInput): Promise<BuildLine[]> {
  if (input.configurationId !== undefined) {
    if (input.lines !== undefined) {
      throw ValidationError.of("lines", "lines_ambiguous", "give the lines or a configuration, not both");
    }
    const id = assertUuid(input.configurationId, "configurationId");
    const config = await ex.query.configurations.findFirst({
      columns: { items: true },
      where: (t, { eq }) => eq(t.id, id),
    });
    if (!config) throw new NotFoundError("configuration");
    return config.items;
  }
  return input.lines ?? [];
}

export async function build(input: BuildQuoteInput, actor: ActorRef, rt?: Runtime): Promise<BuiltQuote> {
  const r = runtimeOf(rt);
  requireStaff(actor, "building an estimate");
  requireCapability(r, "quotes.write");
  const orderId = assertUuid(input.orderId, "orderId");
  const now = r.now();
  return r.db.transaction(async (tx) => {
    await lockBy(tx, `order:${orderId}`);
    const order = await sales.getOrder(tx, orderId);
    if (!order) throw new NotFoundError("order");
    if (order.status !== "estimate_draft") {
      throw ValidationError.of(
        "orderId",
        "order_not_draft",
        `the estimate of an order in the status ${order.status} cannot change`,
      );
    }
    const lines = await linesOf(tx, input);
    const settings = await loadFeeSettings(tx);
    const computed = await computeQuoteFor(tx, {
      lines,
      ...(input.manualLines === undefined ? {} : { manualLines: input.manualLines }),
      ...(input.tasks === undefined ? {} : { tasks: input.tasks }),
      kind: order.kind === "setup" ? "setup" : "pc",
      complexBuild: order.complexBuild,
      freeWindowAvailable: await freeWindowAvailable(tx, settings),
      now,
    });

    const previous = await sales.latestQuoteOfOrder(tx, orderId);
    if (previous && (previous.status === "sent" || previous.status === "expired")) {
      await sales.setQuoteStatus(tx, previous.id, "superseded");
    }
    const version = (previous?.version ?? 0) + 1;
    const quoteId = await sales.insertQuoteDraft(
      tx,
      {
        orderId,
        version,
        totals: serializeTotals(computed.totals, {
          compatVerdict: computed.compatVerdict,
          shelfLifeHours: computed.shelfLifeHours,
          quoteKind: order.kind === "setup" ? "setup" : "pc",
        }),
        ...quoteColumns(computed.totals),
        settingsVersion: computed.settings.version,
      },
      computed.lines.map((l) => ({
        productId: l.productId,
        titleSnapshot: l.titleSnapshot,
        categoryCode: l.categoryCode,
        feeGroup: l.feeGroup,
        qty: l.qty,
        unitMarketSum: l.unitMarketSum,
        priceDate: l.priceDate,
        confidence: l.confidence,
        returnable: l.returnable,
        isRamOrSsd: l.isRamOrSsd,
        isFurnitureLike: l.isFurnitureLike,
        customerOwned: l.customerOwned,
        purchasedByIp: l.purchasedByIp,
      })),
    );
    await ops.appendAudit(tx, {
      actor: auditActor(actor),
      action: "quote.build",
      entity: "sales.quotes",
      entityId: quoteId,
      after: {
        orderId,
        version,
        purchaseLimit: computed.totals.purchaseLimit,
        feeTotal: computed.totals.fee.total,
        compatVerdict: computed.compatVerdict,
        ruleSetVersion: computed.ruleSetVersion,
        priceSnapshot: computed.priceSnapshot,
      },
    });
    return {
      quoteId,
      version,
      totals: computed.totals,
      compatVerdict: computed.compatVerdict,
      shelfLifeHours: computed.shelfLifeHours,
    };
  });
}
