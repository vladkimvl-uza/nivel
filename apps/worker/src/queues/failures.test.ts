import { describe, expect, it } from "vitest";
import { alertDayKey, fingerprintOf, sanitizeMessage } from "./failures.ts";

describe("sanitizeMessage: the error table has no personal data (DATA-MAP: no PD in stacks)", () => {
  it("masks phone numbers, card numbers, e-mail addresses and bot tokens", () => {
    const raw =
      "failed for +998 90 123-45-67, card 8600 1234 5678 9012, mail a.b@example.uz, token 123456789:AAE-abcdefghijklmnopqrstuvwxyz0123456";
    const out = sanitizeMessage(raw);
    expect(out).not.toMatch(/998 90/);
    expect(out).not.toMatch(/8600/);
    expect(out).not.toMatch(/example\.uz/);
    expect(out).not.toMatch(/AAE-/);
    expect(out).toContain("failed for");
  });

  it("masks long digit runs but keeps short numbers a reader needs (an HTTP status, an attempt)", () => {
    expect(sanitizeMessage("HTTP 502 on attempt 3, id 4012345678901")).toBe("HTTP 502 on attempt 3, id <num>");
  });

  it("cuts a long message and keeps only its first lines", () => {
    const out = sanitizeMessage(`${"x".repeat(900)}\nsecond line`, 200);
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it("answers a text for anything: an Error, a string, an object, nothing", () => {
    expect(sanitizeMessage(undefined)).toBe("unknown error");
    expect(sanitizeMessage(null)).toBe("unknown error");
    expect(sanitizeMessage(new Error("boom"))).toBe("boom");
    expect(sanitizeMessage({ code: "E1" })).toBe('{"code":"E1"}');
    expect(sanitizeMessage("plain")).toBe("plain");
  });
});

describe("fingerprintOf: one row of ops.app_errors for one kind of failure", () => {
  const boom = (m: string) => new Error(m);

  it("is the same for the same queue and error, and differs by queue", () => {
    expect(fingerprintOf("payment.expect", boom("db down"))).toBe(fingerprintOf("payment.expect", boom("db down")));
    expect(fingerprintOf("payment.expect", boom("db down"))).not.toBe(fingerprintOf("ledger.append", boom("db down")));
  });

  it("does not split one failure into many rows because an id or a number in the text changes", () => {
    const a = fingerprintOf("ledger.append", boom("order 6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11 refused 4012345 sums"));
    const b = fingerprintOf("ledger.append", boom("order 0a5d1c42-77de-4c2b-8f31-9e6a2b4c8d90 refused 987654 sums"));
    expect(a).toBe(b);
  });

  it("tells a different error of the same queue apart", () => {
    expect(fingerprintOf("q", boom("db down"))).not.toBe(fingerprintOf("q", new TypeError("db down")));
    expect(fingerprintOf("q", boom("db down"))).not.toBe(fingerprintOf("q", boom("disk full")));
  });

  it("is a short hex text", () => {
    expect(fingerprintOf("q", boom("x"))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("alertDayKey: an alert goes once a day for one failure", () => {
  it("is the calendar day of Tashkent", () => {
    expect(alertDayKey(new Date("2026-10-12T18:59:00Z"))).toBe("2026-10-12");
    expect(alertDayKey(new Date("2026-10-12T19:00:00Z"))).toBe("2026-10-13");
  });
});
