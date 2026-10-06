import { describe, expect, it } from "vitest";
import { classifyDbError, pingDatabase } from "./health.ts";

describe("classifyDbError", () => {
  it("maps authentication failures to db_auth", () => {
    expect(
      classifyDbError(
        Object.assign(new Error('password authentication failed for user "nivel_web"'), { code: "28P01" }),
      ),
    ).toBe("db_auth");
  });

  it("maps network failures and timeouts to db_unreachable", () => {
    expect(
      classifyDbError(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:54329"), { code: "ECONNREFUSED" })),
    ).toBe("db_unreachable");
    expect(classifyDbError(new Error("Connection terminated due to connection timeout"))).toBe("db_unreachable");
  });

  it("maps anything else to db_error", () => {
    expect(classifyDbError(Object.assign(new Error('relation "x" does not exist'), { code: "42P01" }))).toBe(
      "db_error",
    );
    expect(classifyDbError("boom")).toBe("db_error");
  });
});

describe("pingDatabase", () => {
  it("reports not_configured without a connection string", async () => {
    expect(await pingDatabase(undefined)).toEqual({ ok: false, error: "not_configured" });
  });
});
