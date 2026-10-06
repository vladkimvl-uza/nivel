// The one calculation of an estimate (ARCHITECTURE 4.6, 4.13): the lines come from the client, everything else from
// the database: prices from the market, the fee group and returnability from the catalog, the scale from the settings
// of the owner. Whatever sums the client sent are not looked at. Used by `quotes.build` (a draft of the owner) and by
// `configs.save` (the saved configuration of the site).
import { CategoryCodeSchema } from "@nivel/contracts/catalog";
import type { Executor } from "@nivel/db/repos";
import type { BuildLine, CategoryCode, FeeGroup } from "@nivel/domain/catalog";
import { type CompatResult, checkCompatibility, MAX_LINE_QTY, MAX_LINES, type Task } from "@nivel/domain/compat";
import { computeQuote, type FeeSettings, type QuoteLineInput, type QuoteTotals } from "@nivel/domain/fee";
import { sum } from "@nivel/domain/money";
import { ValidationError, type ValidationIssue } from "../orders/errors.ts";
import { loadFeeSettings } from "../orders/settings.ts";
import { assertTasks } from "../orders/validate.ts";
import { loadCatalogFor } from "./catalog.ts";
import { normalizeBuildLines } from "./lines.ts";
import type { CompatVerdict } from "./stored.ts";

const HOUR_MS = 3_600_000;
const MAX_SUM = 1_000_000_000_000;
const FEE_GROUPS: readonly string[] = ["pc", "mount", "outside_scale"];
/** Categories of "furniture, light, decor, acoustics": an estimate made only of them is valid 72 hours (ARCHITECTURE 4.6). */
const FURNITURE_LIKE: readonly CategoryCode[] = [
  "desk",
  "desk_frame",
  "desk_top",
  "chair",
  "light",
  "speakers",
  "acoustic_panel",
  "decor",
];

/** A line the owner enters by hand: works, a licence, a partner service. Not a position of the catalog. */
export interface ManualLine {
  title: string;
  categoryCode: CategoryCode;
  feeGroup: FeeGroup;
  qty: number;
  unitSum: number;
  /** Bought by the sole proprietor from the money of the customer (default). Works of the owner are not. */
  purchasedByIp?: boolean;
  customerOwned?: boolean;
}

export interface ComputeInput {
  lines: readonly BuildLine[];
  manualLines?: readonly ManualLine[];
  tasks?: readonly Task[];
  kind: "pc" | "setup";
  complexBuild?: boolean;
  freeWindowAvailable: boolean;
  now: Date;
}

/** A row of sales.quote_lines before the quote exists. */
export interface QuoteLineDraft {
  productId: string | null;
  titleSnapshot: string;
  categoryCode: CategoryCode;
  feeGroup: FeeGroup;
  qty: number;
  unitMarketSum: number;
  priceDate: string | null;
  confidence: "high" | "medium" | "low" | null;
  returnable: "yes" | "no" | "unknown";
  isRamOrSsd: boolean;
  isFurnitureLike: boolean;
  customerOwned: boolean;
  purchasedByIp: boolean;
}

export interface ComputedQuote {
  totals: QuoteTotals;
  lines: QuoteLineDraft[];
  compat: CompatResult | null;
  compatVerdict: CompatVerdict;
  shelfLifeHours: number;
  settings: FeeSettings;
  ruleSetVersion: number | null;
  /** The prices the estimate used, by product: what the customer was shown on that day. */
  priceSnapshot: Record<string, { asOf: string; median: number | null; from: number | null; confidence: string }>;
}

function checkManualLines(manual: readonly ManualLine[]): ManualLine[] {
  const issues: ValidationIssue[] = [];
  manual.forEach((m, i) => {
    const at = `manualLines.${i}`;
    if (typeof m.title !== "string" || m.title.trim() === "" || m.title.length > 200) {
      issues.push({
        path: `${at}.title`,
        code: "title_invalid",
        message: "A line needs a title of 1 to 200 characters",
      });
    }
    if (!CategoryCodeSchema.safeParse(m.categoryCode).success) {
      issues.push({
        path: `${at}.categoryCode`,
        code: "category_unknown",
        message: `Unknown category ${String(m.categoryCode)}`,
      });
    }
    if (!FEE_GROUPS.includes(m.feeGroup)) {
      issues.push({
        path: `${at}.feeGroup`,
        code: "fee_group_unknown",
        message: `Unknown fee group ${String(m.feeGroup)}`,
      });
    }
    if (!Number.isSafeInteger(m.qty) || m.qty < 1 || m.qty > MAX_LINE_QTY) {
      issues.push({
        path: `${at}.qty`,
        code: "qty_invalid",
        message: `Quantity must be a whole number from 1 to ${MAX_LINE_QTY}`,
      });
    }
    if (!Number.isSafeInteger(m.unitSum) || m.unitSum < 0 || m.unitSum > MAX_SUM) {
      issues.push({
        path: `${at}.unitSum`,
        code: "sum_invalid",
        message: `The sum must be a whole number of sums from 0 to ${MAX_SUM}`,
      });
    }
  });
  if (issues.length > 0) throw new ValidationError(issues);
  return [...manual];
}

export async function computeQuoteFor(ex: Executor, input: ComputeInput): Promise<ComputedQuote> {
  const tasks = input.tasks === undefined ? [] : assertTasks(input.tasks);
  const manual = checkManualLines(input.manualLines ?? []);
  // Before the catalog is read for them: a value that is not a list, or a list of thousands, is not looked up at all.
  if (!Array.isArray(input.lines))
    throw ValidationError.of("lines", "not_a_list", "The lines of a build must be a list");
  if (input.lines.length > MAX_LINES) {
    throw ValidationError.of(
      "lines",
      "too_many_lines",
      `A build holds at most ${MAX_LINES} lines, got ${input.lines.length}`,
    );
  }
  const view = await loadCatalogFor(
    ex,
    input.lines.map((l) => l?.productId),
  );
  const normalized = normalizeBuildLines(input.lines, view.lookup, { singlePcParts: input.kind === "pc" });
  const settings = await loadFeeSettings(ex);

  const lines: QuoteLineDraft[] = [];
  const inputs: QuoteLineInput[] = [];
  const warnings: QuoteTotals["warnings"] = [];
  const priceSnapshot: ComputedQuote["priceSnapshot"] = {};
  const issues: ValidationIssue[] = [];
  let demo = false;

  for (const line of normalized) {
    const product = view.lookup.get(line.productId);
    if (!product) continue; // normalizeBuildLines has refused every unknown product
    const price = view.prices.get(line.productId);
    const unit = price?.median ?? price?.from ?? null;
    if (price === undefined || unit === null) {
      issues.push({
        path: `lines.${line.productId}`,
        code: "no_price",
        message: `Product ${line.productId} has no market price yet`,
      });
      continue;
    }
    if (price.median === null || price.confidence === "low") {
      warnings.push({ key: "quote.price_uncertain", params: { productId: line.productId } });
    }
    demo ||= product.isDemo || price.isDemo;
    priceSnapshot[line.productId] = {
      asOf: price.asOf,
      median: price.median,
      from: price.from,
      confidence: price.confidence,
    };
    const isRamOrSsd = product.category === "ram" || product.category === "ssd";
    const isFurnitureLike = FURNITURE_LIKE.includes(product.category);
    lines.push({
      productId: product.id,
      titleSnapshot: `${product.brand} ${product.model}`,
      categoryCode: product.category,
      feeGroup: product.feeGroup,
      qty: line.qty,
      unitMarketSum: unit,
      priceDate: price.asOf,
      confidence: price.confidence,
      returnable: product.returnable ? "yes" : "no",
      isRamOrSsd,
      isFurnitureLike,
      customerOwned: line.customerOwned,
      purchasedByIp: !line.customerOwned,
    });
    inputs.push({
      key: product.id,
      productId: product.id,
      group: product.feeGroup,
      qty: line.qty,
      unitSum: sum(unit),
      isRamOrSsd,
      isFurnitureLike,
      customerOwned: line.customerOwned,
      purchasedByIp: !line.customerOwned,
    });
  }
  if (issues.length > 0) throw new ValidationError(issues);

  for (const [i, m] of manual.entries()) {
    const owned = m.customerOwned === true;
    const purchased = !owned && m.purchasedByIp !== false;
    const isFurnitureLike = FURNITURE_LIKE.includes(m.categoryCode);
    lines.push({
      productId: null,
      titleSnapshot: m.title.trim(),
      categoryCode: m.categoryCode,
      feeGroup: m.feeGroup,
      qty: m.qty,
      unitMarketSum: m.unitSum,
      priceDate: null,
      confidence: null,
      returnable: "unknown",
      isRamOrSsd: false,
      isFurnitureLike,
      customerOwned: owned,
      purchasedByIp: purchased,
    });
    inputs.push({
      key: `manual-${i}`,
      group: m.feeGroup,
      qty: m.qty,
      unitSum: sum(m.unitSum),
      isRamOrSsd: false,
      isFurnitureLike,
      customerOwned: owned,
      purchasedByIp: purchased,
    });
  }
  if (demo) warnings.push({ key: "quote.demo_data" });

  let totals: QuoteTotals;
  try {
    totals = computeQuote(inputs, settings, {
      now: input.now,
      kind: input.kind,
      complexBuild: input.complexBuild === true,
      freeWindowAvailable: input.freeWindowAvailable,
      confirmed: true, // an estimate always carries its term: SEND_ESTIMATE refuses one without it
    });
  } catch (e) {
    if (e instanceof RangeError) throw ValidationError.of("lines", "quote_invalid", e.message);
    throw e;
  }
  totals.warnings.push(...warnings);

  let compat: CompatResult | null = null;
  let compatVerdict: CompatVerdict = "incomplete"; // a desk setup has no plan of the room here: the rules cannot run
  if (input.kind === "pc") {
    try {
      compat = checkCompatibility(
        normalized.map((l) => ({ productId: l.productId, qty: l.qty, customerOwned: l.customerOwned })),
        view.lookup,
        { tasks, settings: view.compat },
      );
    } catch (e) {
      if (e instanceof RangeError) throw ValidationError.of("lines", "build_invalid", e.message);
      throw e;
    }
    compatVerdict = compat.verdict;
  }

  const validUntil = totals.validUntil;
  if (!validUntil) throw new Error("the domain did not set the term of a confirmed estimate");
  return {
    totals,
    lines,
    compat,
    compatVerdict,
    shelfLifeHours: Math.round((validUntil.getTime() - input.now.getTime()) / HOUR_MS),
    settings,
    ruleSetVersion: view.ruleSetVersion,
    priceSnapshot,
  };
}
