import { describe, expect, it } from "vitest";
import { createGen, createRng, forAll, readRepoFile } from "./testkit.ts";

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

  it("readRepoFile finds the repository root from a test path, with Windows separators too", () => {
    const here = expect.getState().testPath;
    expect(readRepoFile(here, "packages/domain/package.json")).toContain("@nivel/domain");
    const win = (here ?? "").replaceAll("/", "\\");
    expect(readRepoFile(win, "packages/domain/package.json")).toContain("@nivel/domain");
  });

  it("readRepoFile refuses paths outside the domain package", () => {
    expect(() => readRepoFile("/tmp/x.test.ts", "a")).toThrow(/Cannot locate the repository root/);
    expect(() => readRepoFile(undefined, "a")).toThrow(/Cannot locate the repository root/);
  });
});
