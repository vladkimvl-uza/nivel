// The domain package compiles without Node types on purpose (pure code, ARCHITECTURE 4.1).
// Tests read repository files (fixtures, documents); this declares the single call they need.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
