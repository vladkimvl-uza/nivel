import { orders } from "@nivel/services";
import { describe, expect, it } from "vitest";
import { errorText, GUARD_TEXT, guardText, SERVICE_FALLBACK } from "./messages.ts";

const ALL_GUARDS = [
  "actor_not_allowed",
  "invalid_transition",
  "estimate_expired",
  "manual_check_missing",
  "compat_block",
  "not_eligible",
  "offer_not_published",
  "consent_missing",
  "payments_incomplete",
  "purchase_too_early",
  "meeting_required",
  "limit_exceeded",
  "funds_exceeded",
  "purchases_incomplete",
  "not_reconciled",
  "report_objection_open",
  "final_payment_missing",
  "act_missing",
  "passport_missing",
] as const;

const CYRILLIC = /[А-Яа-яЁё]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

describe("the text of a refusal of the automaton", () => {
  it("exists in Russian for every GuardError of the table 4.9", () => {
    expect(Object.keys(GUARD_TEXT).sort()).toEqual([...ALL_GUARDS].sort());
    for (const code of ALL_GUARDS) {
      expect(GUARD_TEXT[code], code).toMatch(CYRILLIC);
      expect(GUARD_TEXT[code], code).not.toMatch(LATIN_WORD);
    }
  });
  it("tells the owner what to do, not only what is wrong", () => {
    expect(guardText("not_reconciled")).toContain("поступило");
    expect(guardText("limit_exceeded")).toContain("согласие");
    expect(guardText("funds_exceeded")).toContain("Своими деньгами");
  });
  it("says something humane for a code it does not know", () => {
    expect(guardText("brand_new_error")).toBe(SERVICE_FALLBACK);
  });
});

describe("the text of an exception of the services", () => {
  it("names the field and the reason in Russian for a ValidationError", () => {
    const e = orders.ValidationError.of("receiptNo", "receipt_no_required", "a fiscal receipt needs its number");
    const text = errorText(e);
    expect(text).toMatch(CYRILLIC);
    expect(text).toContain("номер");
    expect(text).not.toContain("fiscal");
  });
  it("joins every issue of one error", () => {
    const e = new orders.ValidationError([
      { path: "amountSum", code: "sum_invalid", message: "x" },
      { path: "qty", code: "qty_invalid", message: "y" },
    ]);
    const text = errorText(e);
    expect(text).toContain("сумма");
    expect(text).toContain("количество");
  });
  it("never lets English text of the services reach the screen", () => {
    const e = orders.ValidationError.of("x", "some_new_code", "the English explanation");
    expect(errorText(e)).not.toContain("English");
    expect(errorText(e)).toMatch(CYRILLIC);
  });
  it("says that the role may not for a ForbiddenError, and that the thing is gone for a NotFoundError", () => {
    expect(errorText(new orders.ForbiddenError("the admin role cannot do this"))).toContain("недоступно");
    expect(errorText(new orders.NotFoundError("order"))).toContain("не найден");
    expect(errorText(new orders.NotFoundError("payment"))).toContain("Платёж");
  });
  it("reports a broken installation as such, and any other error as a failure to try again", () => {
    expect(errorText(new orders.ConfigError("setting missing"))).toContain("настройк");
    expect(errorText(new Error("ECONNRESET at 10.0.0.1"))).toBe(SERVICE_FALLBACK);
    expect(errorText("a string")).toBe(SERVICE_FALLBACK);
  });
});
