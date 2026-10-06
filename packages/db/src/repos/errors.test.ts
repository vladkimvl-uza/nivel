import { describe, expect, it } from "vitest";
import { DbRuleError, guarded, toRuleError } from "./errors.ts";

const pg = (code: string, message: string, constraint?: string) =>
  Object.assign(new Error(message), { code, constraint });

describe("toRuleError", () => {
  it.each([
    ["limit_exceeded: purchases 10 exceed the limit 5", "limit_exceeded"],
    ["funds_exceeded: purchases 10 exceed the received purchase funds 5", "funds_exceeded"],
    ["not_reconciled: funds 1, purchases 0", "not_reconciled"],
    ["consent_missing: a purchase without a receipt needs the consent", "consent_missing"],
    ["actor_not_allowed: nivel_web as owner cannot apply ACCEPT", "actor_not_allowed"],
    ["change_not_allowed: customer may not write the order field funds_received", "change_not_allowed"],
    ["payments_incomplete: no confirmed fee advance for the order", "payments_incomplete"],
    ["consent_mismatch: the consent non_returnable names another customer than the order x", "consent_mismatch"],
    ["number_not_allowed: nivel_web may only take lead numbers of the current year, not NV 2026", "number_not_allowed"],
    ["counters_only_grow: the counters of a day cannot go down", "counters_only_grow"],
    ["invalid_transition: ACCEPT is not allowed from estimate_draft", "invalid_transition"],
    ["direct_status_change: orders.status is changed only by sales.apply_transition()", "direct_status_change"],
    ["append_only: ops.audit_log forbids UPDATE", "append_only"],
    ["immutable: a sent quote keeps its totals", "immutable"],
    ["text_hash_mismatch: text_sha256 of offer version v1 does not match its text", "text_hash_mismatch"],
    ["invalid_payment: fee_advance is not paid by bank_transfer_ip", "invalid_payment"],
    ["invalid_evidence: the press needs the id of the message", "invalid_evidence"],
    ["evidence_mismatch: the press is not the press of the customer", "evidence_mismatch"],
    ["act_already_signed: the act was signed at 2026-10-06", "act_already_signed"],
    ["act_not_found: 0190a1b2", "act_not_found"],
  ])("maps %s", (message, code) => {
    const e = toRuleError(pg("23514", message));
    expect(e).toBeInstanceOf(DbRuleError);
    expect(e?.code).toBe(code);
  });

  it("maps a plain CHECK, unique, foreign key and permission error with the constraint name", () => {
    expect(
      toRuleError(pg("23514", 'new row violates check constraint "payments_fee_chk"', "payments_fee_chk")),
    ).toMatchObject({
      code: "check_violation",
      constraint: "payments_fee_chk",
    });
    expect(toRuleError(pg("23505", "duplicate key", "orders_number_key"))).toMatchObject({
      code: "unique_violation",
      constraint: "orders_number_key",
    });
    expect(toRuleError(pg("23503", "foreign key", "orders_current_quote_fk"))).toMatchObject({
      code: "foreign_key_violation",
    });
    expect(toRuleError(pg("42501", "permission denied for table payments"))).toMatchObject({
      code: "permission_denied",
    });
    expect(toRuleError(pg("40001", "stale_status: expected a, actual b"))).toMatchObject({ code: "stale_status" });
  });

  it("looks through the Drizzle wrapper to the driver error", () => {
    const wrapped = Object.assign(new Error("Failed query: ..."), { cause: pg("23514", "limit_exceeded: x") });
    expect(toRuleError(wrapped)?.code).toBe("limit_exceeded");
  });

  it("ignores everything that is not a rule of the database", () => {
    expect(toRuleError(new Error("connect ECONNREFUSED"))).toBeNull();
    expect(toRuleError(pg("42P01", 'relation "x" does not exist'))).toBeNull();
    expect(toRuleError("boom")).toBeNull();
    expect(toRuleError(null)).toBeNull();
    expect(toRuleError(pg("23514", ""))).toBeNull();
  });

  it("returns an existing DbRuleError as is", () => {
    const e = new DbRuleError("immutable", "x");
    expect(toRuleError(e)).toBe(e);
  });
});

describe("guarded", () => {
  it("passes the result through", async () => {
    await expect(guarded(async () => 42)).resolves.toBe(42);
  });
  it("rethrows a rule violation as DbRuleError and other errors unchanged", async () => {
    await expect(
      guarded(async () => {
        throw pg("23514", "funds_exceeded: nope");
      }),
    ).rejects.toMatchObject({ name: "DbRuleError", code: "funds_exceeded" });
    const plain = new Error("network");
    await expect(
      guarded(async () => {
        throw plain;
      }),
    ).rejects.toBe(plain);
  });
});
