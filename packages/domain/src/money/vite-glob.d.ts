// The domain package compiles without Vite or Node types on purpose (pure code, ARCHITECTURE 4.1).
// Tests read repository files (fixtures, documents) through Vite's import.meta.glob; this declares the single call they need.
interface ImportMeta {
  glob(pattern: string | string[], options: { eager: true; query: "?raw"; import: "default" }): Record<string, string>;
}
