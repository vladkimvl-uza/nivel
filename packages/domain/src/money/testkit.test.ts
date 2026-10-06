import { describe, expect, it } from "vitest";
import { createGen, createRng, forAll, repoFile } from "./testkit.ts";

describe("testkit", () => {
  it("the generator is reproducible by seed and stays in range", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const g = createGen(7);
    for (let i = 0; i < 200; i++) {
      const n = g.int(-3, 3);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
      expect(["a", "b"]).toContain(g.pick(["a", "b"]));
      expect(typeof g.bool()).toBe("boolean");
    }
  });

  it("forAll reports the seed of a failing case", () => {
    expect(() =>
      forAll(
        (_g, run) => {
          if (run === 2) throw new Error("boom");
        },
        { runs: 5, seed: 100 },
      ),
    ).toThrow("property failed (seed 15938, run 2): boom");
  });

  it("repoFile gives the text of documents and fixtures", () => {
    expect(repoFile("docs/DECISIONS.md")).toContain("Р-8");
    expect(JSON.parse(repoFile("fixtures/money-cases.json")).version).toBe(1);
  });

  it("repoFile refuses files the tests were not given", () => {
    expect(() => repoFile("docs/README.md")).toThrow(/not available to tests/);
  });
});
