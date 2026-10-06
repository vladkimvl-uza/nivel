// Test helper: seeded property runner. fast-check 4.10.2 is in the pnpm catalog but is not a dependency of
// @nivel/domain yet (integrator request); this runner has the same shape so the properties port one-to-one.

/** mulberry32: small deterministic PRNG, reproducible by seed. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Gen {
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  pick<T>(xs: readonly T[]): T;
  bool(): boolean;
}

export function createGen(seed: number): Gen {
  const rng = createRng(seed);
  return {
    int: (min, max) => min + Math.floor(rng() * (max - min + 1)),
    pick: (xs) => xs[Math.floor(rng() * xs.length)] as (typeof xs)[number],
    bool: () => rng() < 0.5,
  };
}

/** Fisher-Yates shuffle on the seeded generator; returns a new array. */
export function shuffle<T>(g: Gen, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = g.int(0, i);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Runs `body` for `runs` generated cases; a failure message carries the seed and case index. The body must be synchronous. */
export function forAll(body: (g: Gen, run: number) => undefined, opts: { runs?: number; seed?: number } = {}): void {
  const runs = opts.runs ?? 500;
  const seed = opts.seed ?? 20261006;
  for (let run = 0; run < runs; run++) {
    const caseSeed = seed + run * 7919;
    let result: unknown;
    try {
      result = body(createGen(caseSeed), run);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`property failed (seed ${caseSeed}, run ${run}): ${reason}`, { cause: e });
    }
    if (result instanceof Promise) {
      throw new TypeError("forAll body must be synchronous: a returned Promise would hide its failures");
    }
  }
}

/** Repository files the tests compare the code with: the owner documents and the shared money cases (read at transform time). */
const repoFiles = import.meta.glob(
  ["../../../../docs/{DECISIONS,CONCEPT,ARCHITECTURE}.md", "../../../testing/fixtures/money-cases.json"],
  { eager: true, query: "?raw", import: "default" },
);

/** Text of a repository file by its path tail, e.g. "docs/DECISIONS.md" or "fixtures/money-cases.json". */
export function repoFile(tail: string): string {
  const key = Object.keys(repoFiles).find((k) => k.endsWith(`/${tail}`));
  const text = key === undefined ? undefined : repoFiles[key];
  if (text === undefined) throw new Error(`Repository file is not available to tests: ${tail}`);
  return text;
}
