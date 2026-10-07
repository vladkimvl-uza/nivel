import { describe, expect, it } from "vitest";
import { pickUtm } from "./utm.ts";

describe("pickUtm", () => {
  it("takes the five standard marks", () => {
    expect(
      pickUtm({ utm_source: "instagram", utm_medium: "story", utm_campaign: "oct", utm_content: "a", utm_term: "pc" }),
    ).toEqual({ utm_source: "instagram", utm_medium: "story", utm_campaign: "oct", utm_content: "a", utm_term: "pc" });
  });

  it("takes nothing else and nothing empty or long", () => {
    expect(pickUtm({ foo: "x", utm_source: "  ", utm_medium: "m".repeat(201), utm_term: " ok " })).toEqual({
      utm_term: "ok",
    });
  });

  it("takes the first of a repeated mark", () => {
    expect(pickUtm({ utm_source: ["a", "b"] })).toEqual({ utm_source: "a" });
    expect(pickUtm({ utm_source: [] })).toEqual({});
  });

  it("is empty without marks", () => {
    expect(pickUtm({})).toEqual({});
  });
});
