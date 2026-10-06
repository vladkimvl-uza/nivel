// Input of `services.leads.create` (WP-07): a request of a person who is not a customer yet, or of a known one.
// Budgets of the client are bounded by MAX_BUDGET_SUM of the fee module: `partsBudgetFromTotal` throws RangeError above it.
import { MAX_BUDGET_SUM } from "@nivel/domain/fee";
import { z } from "zod";
import { textUpTo, UuidSchema } from "../orders/common.ts";

export const MAX_LEAD_COMMENT = 2000;

/** The budget the client names, whole sums, from 0 up to MAX_BUDGET_SUM. */
export const BudgetSumSchema = z
  .number({ error: "Budget must be a number" })
  .int({ error: "Budget must be a whole number of sums" })
  .min(0, { error: "Budget must not be negative" })
  .max(MAX_BUDGET_SUM, { error: `Budget must not exceed ${MAX_BUDGET_SUM} sums` });

export const LEAD_CHANNELS = ["web", "bot", "tma", "admin", "ai"] as const;
export const LEAD_SCOPES = ["pc", "pc_periph", "setup", "podbor"] as const;

export const NewCustomerSchema = z.strictObject({
  displayName: textUpTo(120).exactOptional(),
  phoneE164: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/, { error: "Phone must be in the international form +998901234567" })
    .exactOptional(),
  telegramUserId: z.number().int().positive().exactOptional(),
  telegramUsername: textUpTo(64).exactOptional(),
  district: textUpTo(80).exactOptional(),
  age18Confirmed: z.boolean().exactOptional(),
});

export const CreateLeadInputSchema = z
  .strictObject({
    channel: z.enum(LEAD_CHANNELS),
    scope: z.enum(LEAD_SCOPES),
    lang: z.enum(["uz", "ru"]).default("uz"),
    district: textUpTo(80).exactOptional(),
    wantedBy: z.iso.date().exactOptional(),
    budgetSum: BudgetSumSchema.exactOptional(),
    comment: z.string().trim().max(MAX_LEAD_COMMENT).exactOptional(),
    utm: z.record(z.string().max(40), z.string().max(200)).exactOptional(),
    configurationId: UuidSchema.exactOptional(),
    customerId: UuidSchema.exactOptional(),
    customer: NewCustomerSchema.exactOptional(),
  })
  .refine((v) => v.customerId !== undefined || v.customer !== undefined, {
    error: "A lead needs a customer or a customer id",
    path: ["customer"],
  });

export type CreateLeadInput = z.infer<typeof CreateLeadInputSchema>;
