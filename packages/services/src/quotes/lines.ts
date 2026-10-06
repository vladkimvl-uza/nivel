// Lines of a build, checked on the server before anything is calculated (WP-03 request to WP-07). The compatibility
// engine throws RangeError for a quantity above MAX_LINE_QTY (after the lines of a product are merged), for more than
// MAX_LINES lines and for more than one processor, board, case or PSU (or a quantity above 1 of them). A RangeError is a
// caller bug there; for a person at the site or in the bot it is a mistake in the input, so it is a ValidationError
// with a readable text, found here, before `checkCompatibility` is called. The same limits as zod schema:
// @nivel/contracts BuildLinesSchema (the apps check the shape at their door, the services never trust it).
import type { BuildLine, CatalogLookup, CategoryCode, ProductId } from "@nivel/domain/catalog";
import { MAX_LINE_QTY, MAX_LINES } from "@nivel/domain/compat";
import { ValidationError, type ValidationIssue } from "../orders/errors.ts";

export interface NormalizedLine {
  productId: ProductId;
  qty: number;
  customerOwned: boolean;
}

/** A PC has exactly one of each (the rules compare against the first one only). */
const SINGLE_PC_CATEGORIES: readonly CategoryCode[] = ["cpu", "mb", "case", "psu"];

/**
 * Validates the lines and merges the lines of one product (the order of first appearance stays).
 * Throws one ValidationError with every problem found.
 */
export function normalizeBuildLines(
  lines: readonly BuildLine[],
  lookup: CatalogLookup,
  opts: { singlePcParts?: boolean } = {},
): NormalizedLine[] {
  if (!Array.isArray(lines)) throw ValidationError.of("lines", "not_a_list", "The lines of a build must be a list");
  if (lines.length > MAX_LINES) {
    throw ValidationError.of(
      "lines",
      "too_many_lines",
      `A build holds at most ${MAX_LINES} lines, got ${lines.length}`,
    );
  }

  const issues: ValidationIssue[] = [];
  const merged = new Map<ProductId, NormalizedLine>();
  for (const [i, line] of lines.entries()) {
    if (line === null || typeof line !== "object") {
      issues.push({
        path: `lines.${i}`,
        code: "line_invalid",
        message: "A line must be an object with a product and a quantity",
      });
      continue;
    }
    if (typeof line.productId !== "string" || line.productId === "") {
      issues.push({
        path: `lines.${i}.productId`,
        code: "product_id_invalid",
        message: "A line needs the id of a product",
      });
      continue;
    }
    if (!Number.isSafeInteger(line.qty) || line.qty < 1) {
      issues.push({
        path: `lines.${i}.qty`,
        code: "qty_invalid",
        message: `Quantity of ${line.productId} must be a whole number of at least 1, got ${String(line.qty)}`,
      });
      continue;
    }
    if (line.customerOwned !== undefined && typeof line.customerOwned !== "boolean") {
      issues.push({
        path: `lines.${i}.customerOwned`,
        code: "customer_owned_invalid",
        message: "customerOwned must be true or false",
      });
      continue;
    }
    if (!lookup.get(line.productId)) {
      issues.push({
        path: `lines.${i}.productId`,
        code: "unknown_product",
        message: `Product ${line.productId} is not in the catalog or is not verified`,
      });
      continue;
    }
    const owned = line.customerOwned === true;
    const seen = merged.get(line.productId);
    if (seen !== undefined && seen.customerOwned !== owned) {
      issues.push({
        path: `lines.${i}.customerOwned`,
        code: "mixed_ownership",
        message: `Product ${line.productId} is the customer's in one line and ours in another: split the quantity into two products or one owner`,
      });
      continue;
    }
    const total = (seen?.qty ?? 0) + line.qty;
    if (total > MAX_LINE_QTY) {
      issues.push({
        path: `lines.${i}.qty`,
        code: "qty_too_large",
        message: `Quantity of ${line.productId} must not exceed ${MAX_LINE_QTY} after the lines of the product are merged, got ${total}`,
      });
    }
    if (seen === undefined)
      merged.set(line.productId, { productId: line.productId, qty: line.qty, customerOwned: owned });
    else seen.qty = total;
  }

  if (opts.singlePcParts !== false) {
    for (const category of SINGLE_PC_CATEGORIES) {
      const parts = [...merged.values()].filter((l) => lookup.get(l.productId)?.category === category);
      const count = parts.reduce((n, l) => n + l.qty, 0);
      if (count > 1) {
        issues.push({
          path: `category.${category}`,
          code: "single_part_violated",
          message: `A PC build holds one "${category}" part, got ${count}`,
        });
      }
    }
  }
  if (issues.length > 0) throw new ValidationError(issues);
  return [...merged.values()];
}
