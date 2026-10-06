// WP-06: command line of the seed. Run through the migrator role, never through an application role:
//   node ../../tools/dev-run.mjs migrator -- node seed/cli.ts <seed|reset>      (from packages/db)
// `seed` adds the rules and the demo layer to a migrated database; `reset` rebuilds the database from scratch.
// The integrator wires them as `pnpm db:seed` and `pnpm db:reset`.
import { pathToFileURL } from "node:url";
import { resetDatabase, type SeedAllResult, seedAll } from "./reset.ts";

/** Runs one command against the database of `url`; returns what was seeded. */
export async function run(
  command: string | undefined,
  url: string | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<SeedAllResult> {
  if (command !== "seed" && command !== "reset") throw new Error("usage: cli.ts <seed|reset>");
  if (!url) throw new Error("DATABASE_URL_MIGRATOR is not set (run through tools/dev-run.mjs, after pnpm env:init)");
  return command === "seed" ? seedAll(url, env) : resetDatabase(url, env);
}

// Only when started as a script, not when a test imports `run`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv[2], process.env.DATABASE_URL_MIGRATOR)
    .then((result) => console.info(JSON.stringify(result)))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
