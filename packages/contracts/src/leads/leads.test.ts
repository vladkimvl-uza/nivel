import { MAX_BUDGET_SUM } from "@nivel/domain/fee";
import { describe, expect, it } from "vitest";
import { BudgetSumSchema, CreateLeadInputSchema, MAX_LEAD_COMMENT } from "./index.ts";

const base = {
  channel: "bot",
  scope: "pc",
  customer: { telegramUserId: 123456789, displayName: "Aziz" },
} as const;

describe("BudgetSumSchema", () => {
  it("accepts whole sums from 0 up to MAX_BUDGET_SUM", () => {
    expect(BudgetSumSchema.parse(0)).toBe(0);
    expect(BudgetSumSchema.parse(15_000_000)).toBe(15_000_000);
    expect(BudgetSumSchema.parse(MAX_BUDGET_SUM)).toBe(MAX_BUDGET_SUM);
  });

  it.each([MAX_BUDGET_SUM + 1, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5000000", null])("rejects %s", (v) => {
    expect(BudgetSumSchema.safeParse(v).success).toBe(false);
  });

  it("names the limit in the message, so that the person sees what to fix", () => {
    const r = BudgetSumSchema.safeParse(MAX_BUDGET_SUM + 1);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain(String(MAX_BUDGET_SUM));
  });
});

describe("CreateLeadInputSchema", () => {
  it("accepts a lead of the bot with a new customer and applies defaults", () => {
    const lead = CreateLeadInputSchema.parse(base);
    expect(lead.lang).toBe("uz");
    expect(lead.customer?.telegramUserId).toBe(123456789);
  });

  it("accepts an existing customer by id", () => {
    const r = CreateLeadInputSchema.safeParse({
      channel: "web",
      scope: "setup",
      customerId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      budgetSum: 25_000_000,
    });
    expect(r.success).toBe(true);
  });

  it("needs a customer or a customer id", () => {
    expect(CreateLeadInputSchema.safeParse({ channel: "web", scope: "pc" }).success).toBe(false);
  });

  it("limits the budget of the client", () => {
    expect(CreateLeadInputSchema.safeParse({ ...base, budgetSum: MAX_BUDGET_SUM }).success).toBe(true);
    expect(CreateLeadInputSchema.safeParse({ ...base, budgetSum: MAX_BUDGET_SUM + 1 }).success).toBe(false);
    expect(CreateLeadInputSchema.safeParse({ ...base, budgetSum: -5 }).success).toBe(false);
  });

  it("checks the phone in E.164 form and the scope", () => {
    expect(CreateLeadInputSchema.safeParse({ ...base, customer: { phoneE164: "+998901234567" } }).success).toBe(true);
    expect(CreateLeadInputSchema.safeParse({ ...base, customer: { phoneE164: "901234567" } }).success).toBe(false);
    expect(CreateLeadInputSchema.safeParse({ ...base, scope: "laptop" }).success).toBe(false);
  });

  it("limits the comment and strips nothing silently", () => {
    expect(CreateLeadInputSchema.safeParse({ ...base, comment: "x".repeat(MAX_LEAD_COMMENT) }).success).toBe(true);
    expect(CreateLeadInputSchema.safeParse({ ...base, comment: "x".repeat(MAX_LEAD_COMMENT + 1) }).success).toBe(false);
  });

  it("checks the wanted date", () => {
    expect(CreateLeadInputSchema.safeParse({ ...base, wantedBy: "2026-11-02" }).success).toBe(true);
    expect(CreateLeadInputSchema.safeParse({ ...base, wantedBy: "2026-13-40" }).success).toBe(false);
  });
});
