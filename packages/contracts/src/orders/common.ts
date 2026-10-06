// Scalars shared by the order, lead, payment and purchase schemas (WP-07). A whole sum is always an integer: money
// never travels as a float (ARCHITECTURE 4.2) and a sum the client sends is never trusted, only bounded.
import { type Sum, sum } from "@nivel/domain/money";
import { z } from "zod";

/** Ids are uuid v7 in the database (`uuidv7()`); anything else never reaches a query. */
export const UuidSchema = z.uuid();

/** Highest whole sum any single money field accepts: one trillion, the same bound as the budget (MAX_BUDGET_SUM). */
export const MAX_SUM = 1_000_000_000_000;

/** A whole sum from `min` to `max` as the branded `Sum`; the message names the bounds. */
export const sumBetween = (min: number, max: number = MAX_SUM) =>
  z
    .number({ error: "Sum must be a number" })
    .int({ error: "Sum must be a whole number of sums" })
    .min(min, { error: `Sum must be at least ${min}` })
    .max(max, { error: `Sum must not exceed ${max}` })
    .transform((n): Sum => sum(n));

/** An instant: a Date, or an ISO 8601 string with an offset (bot callbacks and JSON bodies carry text). */
export const InstantSchema = z.union([z.date(), z.iso.datetime({ offset: true }).transform((s) => new Date(s))]);

/** Free text that is not blank after trimming, at most `max` characters. */
export const textUpTo = (max: number) => z.string().trim().min(1, { error: "Text must not be empty" }).max(max);
