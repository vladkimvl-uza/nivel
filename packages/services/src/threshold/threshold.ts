// threshold.status (ARCHITECTURE 4.8): where the year stands against the registration threshold of the VAT payer (NK art.
// 462 part 9). Deals of the year are the receipts of purchases plus the fee received minus the fee refunded plus the
// income of the other activity of the sole proprietor (the view sales.v_deal_volume_by_year); "committed" are the
// accepted estimates that have not been bought yet (the limit of the purchase plus the fee).
import { sales } from "@nivel/db/repos";
import { isoDateInTashkent } from "@nivel/domain/calendar";
import { sum } from "@nivel/domain/money";
import { type DealEntry, type ThresholdStatus, thresholdStatus } from "@nivel/domain/threshold";
import { dsl } from "../orders/dsl.ts";
import { ValidationError } from "../orders/errors.ts";
import { type Runtime, requireCapability, runtimeOf } from "../orders/runtime.ts";
import { loadThresholdSettings } from "../orders/settings.ts";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export async function status(input: { year?: number } = {}, rt?: Runtime): Promise<ThresholdStatus> {
  const r = runtimeOf(rt);
  // The money of the whole business: the owner's panel and the worker read it, the bot and the site do not.
  requireCapability(r, "ledger.read");
  const year = input.year ?? Number(isoDateInTashkent(r.now()).slice(0, 4));
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw ValidationError.of("year", "year_invalid", `year must be a whole number from ${MIN_YEAR} to ${MAX_YEAR}`);
  }
  const { sql } = dsl(r.db);
  const [settings, volume, committedRows] = await Promise.all([
    loadThresholdSettings(r.db),
    sales.dealVolume(r.db, year),
    r.db.execute<{ committed: string }>(sql`
      select coalesce(sum(q.purchase_limit + q.fee_total), 0)::text as committed
        from sales.orders o join sales.quotes q on q.id = o.current_quote_id
       where o.status = 'accepted'`),
  ]);
  // One entry per kind, dated within the year: the domain takes the sum of the year.
  const date = `${year}-12-31`;
  const entries: DealEntry[] = [
    { kind: "receipt", amount: sum(volume.receiptsSum), date },
    { kind: "fee_in", amount: sum(volume.feeInSum), date },
    { kind: "fee_refund", amount: sum(volume.feeRefundSum), date },
    { kind: "other_income", amount: sum(volume.otherIncomeSum), date },
  ];
  return thresholdStatus(entries, sum(Number(committedRows.rows[0]?.committed ?? 0)), year, settings);
}
