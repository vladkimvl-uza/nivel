// Repositories by module (WP-06). Import by module namespace to avoid name clashes:
//   import { sales, ops } from "@nivel/db/repos";  (the integrator adds the export "./repos" to package.json)
export * as ai from "./ai.ts";
export * as bot from "./bot.ts";
export * as catalog from "./catalog.ts";
export * as content from "./content.ts";
export { type DbRuleCode, DbRuleError, guarded, toRuleError } from "./errors.ts";
export type { Database, Executor, Tx } from "./executor.ts";
export * as ops from "./ops.ts";
export * as pricing from "./pricing.ts";
export * as sales from "./sales.ts";
