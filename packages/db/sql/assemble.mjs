// Fills an empty custom drizzle migration with the SQL of packages/db/sql (WP-06, ARCHITECTURE 2.3).
// The integrator runs it after merging:
//   pnpm db:generate                       -> drizzle-kit generate (tables from src/schema/*.ts)
//   pnpm --filter @nivel/db run generate:custom --name <name>   -> empty custom migration
//   node packages/db/sql/assemble.mjs packages/db/migrations/<timestamp>_<name>.sql
// Files are read in module order, then by file name; statements inside a file are separated by the line
// "--> statement-breakpoint" (function bodies keep their own semicolons).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SQL_DIR = dirname(fileURLToPath(import.meta.url));
// ops first: generic guards that later files attach to tables; roles last: grants need every object.
export const MODULE_ORDER = ["ops", "catalog", "pricing", "sales", "content", "ai", "bot", "roles"];
const BREAKPOINT = "--> statement-breakpoint";

/** All SQL files in the order they run. */
export function sqlFiles(dir = SQL_DIR) {
  return MODULE_ORDER.flatMap((module) => {
    let names = [];
    try {
      names = readdirSync(join(dir, module)).filter((n) => n.endsWith(".sql"));
    } catch {
      return [];
    }
    return names.sort().map((n) => join(dir, module, n));
  });
}

/** The migration body: file contents joined with breakpoints. */
export function assemble(dir = SQL_DIR) {
  const parts = sqlFiles(dir).map((f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n").trim());
  return `${parts.join(`\n${BREAKPOINT}\n`)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: node packages/db/sql/assemble.mjs <custom-migration.sql>");
    process.exit(2);
  }
  writeFileSync(target, assemble());
  console.info(`wrote ${sqlFiles().length} sql files to ${target}`);
}
