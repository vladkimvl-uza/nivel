// zod schemas for DTOs, action inputs, product specs, settings and CSV/XLSX rows (ARCHITECTURE 2.1).
// Owners add modules under src/<area>/ (catalog — WP-03, orders/leads/payments/purchases — WP-07, pricing — WP-15).
import type { Locale, Localized } from "@nivel/domain/money";
import { z } from "zod";

export const LocaleSchema = z.enum(["uz", "ru"]) satisfies z.ZodType<Locale>;

/** Localized text: uz is required to publish (R-25); both keys always present. */
export const LocalizedSchema = z.object({ uz: z.string(), ru: z.string() }) satisfies z.ZodType<Localized>;
