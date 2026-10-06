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

/** Runs `body` for `runs` generated cases; a failure message carries the seed and case index. */
export function forAll(body: (g: Gen, run: number) => void, opts: { runs?: number; seed?: number } = {}): void {
  const runs = opts.runs ?? 500;
  const seed = opts.seed ?? 20261006;
  for (let run = 0; run < runs; run++) {
    const caseSeed = seed + run * 7919;
    try {
      body(createGen(caseSeed), run);
    } catch (e) {
      throw new Error(`property failed (seed ${caseSeed}, run ${run}): ${(e as Error).message}`, { cause: e });
    }
  }
}
