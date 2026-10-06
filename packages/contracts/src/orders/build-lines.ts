// Server-side schema of the lines of a build (WP-03 request to WP-07). `checkCompatibility` throws RangeError for
// quantities and line counts outside these limits; here the same limits are a validation error with a readable
// message, so that a client mistake is a 4xx answer and never a 500. Only the lines are checked: the catalog decides
// whether a product is a processor, a board, a case or a PSU (one of each, quantity 1), see services/configs.
import type { BuildLine, ProductId } from "@nivel/domain/catalog";
import { MAX_LINE_QTY, MAX_LINES } from "@nivel/domain/compat";
import { z } from "zod";
import { ProductIdSchema } from "../catalog/index.ts";

export const BuildLineInputSchema = z.strictObject({
  productId: ProductIdSchema,
  qty: z
    .number({ error: "Quantity must be a number" })
    .int({ error: "Quantity must be a whole number" })
    .min(1, { error: "Quantity must be at least 1" })
    .max(MAX_LINE_QTY, { error: `Quantity of one line must not exceed ${MAX_LINE_QTY}` }),
  customerOwned: z.boolean().exactOptional(),
}) satisfies z.ZodType<BuildLine>;

/**
 * At most MAX_LINES lines; lines of the same product are merged and the merged quantity is bounded by MAX_LINE_QTY
 * too (the domain merges them before it checks). A price or any other key sent by the client is refused.
 */
export const BuildLinesSchema = z
  .array(BuildLineInputSchema)
  .max(MAX_LINES, { error: `A build holds at most ${MAX_LINES} lines` })
  .superRefine((lines, ctx) => {
    const merged = new Map<ProductId, number>();
    for (const [index, line] of lines.entries()) {
      const qty = (merged.get(line.productId) ?? 0) + line.qty;
      merged.set(line.productId, qty);
      if (qty > MAX_LINE_QTY) {
        ctx.addIssue({
          code: "custom",
          path: [index, "qty"],
          message: `Quantity of ${line.productId} must not exceed ${MAX_LINE_QTY} after the lines of the product are merged`,
        });
      }
    }
  }) satisfies z.ZodType<BuildLine[]>;

export type BuildLinesInput = z.infer<typeof BuildLinesSchema>;
