import { describe, expect, it } from "vitest";
import { LOG_REDACT_PATHS } from "./log.ts";

describe("LOG_REDACT_PATHS", () => {
  it("keeps the pino logger name visible", () => {
    expect(LOG_REDACT_PATHS).not.toContain("name");
  });

  it("redacts personal data at the top level and one level down", () => {
    for (const k of ["phone", "address", "passport", "initData", "authorization", "cookie"]) {
      expect(LOG_REDACT_PATHS).toContain(k);
      expect(LOG_REDACT_PATHS).toContain(`*.${k}`);
    }
    expect(LOG_REDACT_PATHS).toContain("*.name");
    expect(LOG_REDACT_PATHS).toContain("req.headers.cookie");
  });
});
