import { describe, expect, it } from "vitest";
import { createGen, createRng, forAll, repoFile, shuffle } from "./testkit.ts";

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

  it("forAll keeps the cause of a failure that is not an Error", () => {
    expect(() =>
      forAll(
        () => {
          throw "plain string";
        },
        { runs: 1, seed: 1 },
      ),
    ).toThrow("property failed (seed 1, run 0): plain string");
    expect(() =>
      forAll(
        () => {
          throw null;
        },
        { runs: 1, seed: 1 },
      ),
    ).toThrow("property failed (seed 1, run 0): null");
  });

  it("forAll refuses an async body: its failures would never be seen", () => {
    expect(() => forAll((async () => {}) as unknown as () => undefined, { runs: 1 })).toThrow(TypeError);
  });

  it("shuffle is a permutation, reproducible by seed, and reaches every order", () => {
    const xs = [1, 2, 3, 4];
    const a = shuffle(createGen(5), xs);
    expect([...a].sort()).toEqual(xs);
    expect(shuffle(createGen(5), xs)).toEqual(a);
    expect(xs).toEqual([1, 2, 3, 4]); // the input is not touched
    const seen = new Set<string>();
    for (let seed = 0; seed < 2000; seed++) seen.add(shuffle(createGen(seed), xs).join());
    expect(seen.size).toBe(24); // 4! orders, all reachable
  });

  it("repoFile gives the text of documents and fixtures", () => {
    expect(repoFile("docs/DECISIONS.md")).toContain("Р-8");
    expect(JSON.parse(repoFile("fixtures/money-cases.json")).version).toBe(1);
  });

  it("repoFile refuses files the tests were not given", () => {
    expect(() => repoFile("docs/README.md")).toThrow(/not available to tests/);
  });
});
