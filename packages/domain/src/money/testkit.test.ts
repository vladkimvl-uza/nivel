import { describe, expect, it } from "vitest";
import { repoFile } from "./testkit.ts";

describe("testkit", () => {
  it("repoFile gives the text of documents and fixtures", () => {
    expect(repoFile("docs/DECISIONS.md")).toContain("Р-8");
    expect(JSON.parse(repoFile("fixtures/money-cases.json")).version).toBe(1);
  });

  it("repoFile refuses files the tests were not given", () => {
    expect(() => repoFile("docs/README.md")).toThrow(/not available to tests/);
  });
});
