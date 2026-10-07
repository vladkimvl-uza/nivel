// ledger.append (outbox/contract.ts): the site and the bot may not write the reserve ledger, so after HANDOVER and REMAINDER_SETTLED
// they queue this job and the worker books the contribution. The payload is a hint: the sum is worked out here by the domain
// (warrantyReserveContribution, taxRiskReserve, ADR-007 item 4) from the receipts of the order and the state of the fund
// in the database. The database checks the same thing a second time (trigger reserve_ledger_guard: the milestone of the
// order, the time of its own clock, a sum not above the calculation from the receipts).
import type { Db } from "@nivel/db";
import { DbRuleError, ops, sales } from "@nivel/db/repos";
import { type Bp, bp, sum } from "@nivel/domain/money";
import { taxRiskReserve, warrantyReserveContribution } from "@nivel/domain/reserve";
import type { Logger } from "pino";
import { PermanentJobError } from "../../queues/define.ts";

const FUNDS = ["warranty", "tax_risk"] as const;
type Fund = (typeof FUNDS)[number];
const MILESTONE: Record<Fund, string> = { warranty: "HANDOVER", tax_risk: "REMAINDER_SETTLED" };
const TAX_RISK_KEY = "money.tax_risk_active";

export interface FundFacts {
  balance: number;
  closedOrders: number;
  lossesLast12m: number;
  purchasedLast12m: number;
}

/** What the handler needs from the database. */
export interface LedgerPort {
  order(orderId: string): Promise<{ number: string } | null>;
  /** True when the ledger already holds a contribution of this order to this fund. */
  alreadyBooked(orderId: string, fund: Fund): Promise<boolean>;
  receiptsTotal(orderId: string): Promise<number>;
  /** `money.tax_risk_active`: true until the tax authority has answered in writing (R-7); a missing setting is true. */
  taxRiskActive(): Promise<boolean>;
  fundState(): Promise<FundFacts>;
  append(entry: { fund: Fund; amountSum: number; reason: string; orderId: string }): Promise<void>;
}

export interface LedgerDeps {
  log: Logger;
  port: LedgerPort;
}

export type LedgerResult = { booked: number } | { alreadyBooked: true } | { nothingToBook: true };

/** The losses of the last 12 months in basis points of what was bought: the input of the warranty rate (as the order automaton counts it). */
export function lossesBpOf(losses: number, purchased: number): Bp {
  if (losses <= 0) return bp(0);
  if (purchased <= 0) return bp(10_000);
  return bp(Math.min(10_000, Number((BigInt(losses) * 10_000n) / BigInt(purchased))));
}

export async function handleLedgerAppend(deps: LedgerDeps, data: Record<string, unknown>): Promise<LedgerResult> {
  const { orderId, fund } = data;
  if (typeof orderId !== "string" || typeof fund !== "string" || !(FUNDS as readonly string[]).includes(fund)) {
    throw new PermanentJobError("ledger.append: the job must name the order and a fund (warranty or tax_risk)");
  }
  const f = fund as Fund;
  const { port, log } = deps;

  const order = await port.order(orderId);
  if (order === null) throw new PermanentJobError(`ledger.append: the order ${orderId} is not in the database`);

  // One contribution of an order to a fund, ever: the fund has grown since the first try and the rate may differ now.
  if (await port.alreadyBooked(orderId, f)) {
    log.info({ orderId, fund: f }, "ledger.append: already booked");
    return { alreadyBooked: true };
  }

  const receipts = sum(await port.receiptsTotal(orderId));
  let amount: number;
  if (f === "tax_risk") {
    amount = taxRiskReserve(receipts, await port.taxRiskActive());
  } else {
    const state = await port.fundState();
    amount = warrantyReserveContribution(receipts, {
      balance: sum(state.balance),
      closedOrders: state.closedOrders,
      lossesLast12mBp: lossesBpOf(state.lossesLast12m, state.purchasedLast12m),
    });
  }
  if (amount <= 0) {
    log.info({ orderId, fund: f }, "ledger.append: the domain reserves nothing");
    return { nothingToBook: true };
  }
  if (typeof data.amountSum === "number" && data.amountSum !== amount) {
    log.warn(
      { orderId, fund: f, hint: data.amountSum, computed: amount },
      "ledger.append: the hint of the sum differs, the computed one is booked",
    );
  }

  try {
    await port.append({ fund: f, amountSum: amount, reason: `order ${order.number}: ${MILESTONE[f]}`, orderId });
  } catch (error) {
    if (error instanceof DbRuleError) {
      // A second writer, or a retry after the entry was made: the contribution is in the ledger, which is the aim.
      if (error.message.startsWith("reserve_exceeded")) return { alreadyBooked: true };
      if (/^(invalid_reserve|order_not_found)/.test(error.message)) {
        throw new PermanentJobError(`ledger.append refused by the database: ${error.message}`);
      }
    }
    // reserve_not_due: the event of the milestone is not in the journal yet; the job is tried again after a pause.
    throw error;
  }
  log.info({ orderId, fund: f, amountSum: amount }, "ledger.append: booked");
  return { booked: amount };
}

export function createPgLedgerPort(db: Db): LedgerPort {
  return {
    async order(orderId) {
      const row = await sales.getOrder(db, orderId);
      return row === null ? null : { number: row.number };
    },
    async alreadyBooked(orderId, fund) {
      const { rows } = await db.$client.query(
        "select 1 from sales.reserve_ledger where order_id = $1 and fund = $2 and amount_sum > 0 limit 1",
        [orderId, fund],
      );
      return rows.length > 0;
    },
    async receiptsTotal(orderId) {
      return (await sales.orderMoney(db, orderId)).receiptsTotal;
    },
    async taxRiskActive() {
      const row = await ops.getSetting(db, TAX_RISK_KEY);
      if (row === null) return true;
      if (typeof row.value !== "boolean") throw new PermanentJobError(`setting ${TAX_RISK_KEY} must be true or false`);
      return row.value;
    },
    fundState: () => sales.warrantyFundState(db),
    async append(entry) {
      await sales.appendReserve(db, entry);
    },
  };
}
