// Fills an empty custom drizzle migration with the SQL of packages/db/sql (WP-06, ARCHITECTURE 2.3).
// The integrator runs it after merging:
//   pnpm db:generate                       -> drizzle-kit generate (tables from src/schema/*.ts)
//   pnpm --filter @nivel/db run generate:custom --name <name>   -> empty custom migration
//   node packages/db/sql/assemble.mjs packages/db/migrations/<timestamp>_<name>.sql
// The base (the module directories) is the migration `wp06_sql`: it was applied to the databases and never changes. Every
// later migration has one source file in `changes/<name>.sql`, named like the migration (without the timestamp), and
// holds only what that migration does (CREATE OR REPLACE FUNCTION for a function that changes, new objects, grants).
// Files of the base are read in module order, then by file name; statements inside a file are separated by the line
// "--> statement-breakpoint" (function bodies keep their own semicolons).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SQL_DIR = dirname(fileURLToPath(import.meta.url));
// ops first: generic guards that later files attach to tables; roles last: grants need every object.
export const MODULE_ORDER = ["ops", "catalog", "pricing", "sales", "content", "ai", "bot", "roles"];
/** The migration made of the module directories. */
export const BASE_NAME = "wp06_sql";
/** The directory of the sources of the later migrations; it is not a module. */
export const CHANGES_DIR = "changes";
const BREAKPOINT = "--> statement-breakpoint";

/**
 * All SQL files of the base in the order they run. A module without a directory is skipped (bot has no SQL yet); a
 * directory that is not in MODULE_ORDER is an error, because its triggers and grants would silently stay out of the
 * migration. The changes directory is not part of the base.
 */
export function sqlFiles(dir = SQL_DIR) {
  const unlisted = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== CHANGES_DIR && !MODULE_ORDER.includes(d.name))
    .map((d) => d.name);
  if (unlisted.length > 0) {
    throw new Error(`sql modules missing from MODULE_ORDER in assemble.mjs: ${unlisted.join(", ")}`);
  }
  return MODULE_ORDER.flatMap((module) => {
    let names = [];
    try {
      names = readdirSync(join(dir, module)).filter((n) => n.endsWith(".sql"));
    } catch (e) {
      if (e && e.code === "ENOENT") return [];
      throw e;
    }
    return names.sort().map((n) => join(dir, module, n));
  });
}

const read = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();

/** The body of the base migration: file contents joined with breakpoints. */
export function assemble(dir = SQL_DIR) {
  return `${sqlFiles(dir).map(read).join(`\n${BREAKPOINT}\n`)}\n`;
}

/** The names of the later migrations that have a source file, in the order of their names. */
export function changeNames(dir = SQL_DIR) {
  try {
    return readdirSync(join(dir, CHANGES_DIR))
      .filter((n) => n.endsWith(".sql"))
      .map((n) => n.slice(0, -".sql".length))
      .sort();
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }
}

/** The body of a later migration: its source file with CRLF turned into LF. */
export function assembleChange(name, dir = SQL_DIR) {
  if (!changeNames(dir).includes(name)) {
    throw new Error(`no source file ${CHANGES_DIR}/${name}.sql for the migration ${name}`);
  }
  return `${read(join(dir, CHANGES_DIR, `${name}.sql`))}\n`;
}

/** The body of the migration file `<14 digits>_<name>.sql`: the base for `wp06_sql`, the change file for any other. */
export function assembleFor(migrationFile, dir = SQL_DIR) {
  const match = /^\d{14}_(.+)\.sql$/.exec(basename(migrationFile));
  if (!match) throw new Error(`${migrationFile} is not a migration file (<timestamp>_<name>.sql)`);
  const name = match[1];
  return name === BASE_NAME ? assemble(dir) : assembleChange(name, dir);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: node packages/db/sql/assemble.mjs <custom-migration.sql>");
    process.exit(2);
  }
  writeFileSync(target, assembleFor(target));
  console.info(`wrote the source of ${basename(target)} to ${target}`);
}
