import { describe, expect, it } from "vitest";
import { isUuid, jobIdOf } from "./ids.ts";

describe("jobIdOf: the same key is the same id of a job, so pg-boss keeps one job", () => {
  it("is a UUID that does not change for one key and differs for another", () => {
    const a = jobIdOf("objection_window:6b1f8f9e:1");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(jobIdOf("objection_window:6b1f8f9e:1")).toBe(a);
    expect(jobIdOf("objection_window:6b1f8f9e:2")).not.toBe(a);
  });
});

describe("isUuid", () => {
  it("accepts a UUID and nothing else", () => {
    expect(isUuid("6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11")).toBe(true);
    for (const v of ["", "order-1", 5, null, undefined, "6b1f8f9e-0c3a-4a58-9a0e-3f2d8c1f7a11x", "a".repeat(150_000)]) {
      expect(isUuid(v)).toBe(false);
    }
  });
});
