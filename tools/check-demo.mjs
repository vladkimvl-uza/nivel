// Production launch check (ARCHITECTURE 10.1): no demo data in what customers see. Skipped outside production.
// Tables appear with WP-06; until then a production run reports that nothing is checkable yet.
import { createRequire } from "node:module";
import { join } from "node:path";
import { isMain, loadRootEnv, ROOT } from "./lib/env.mjs";

export const DEMO_CHECKS = [
  {
    table: "catalog.products",
    sql: "select count(*)::int as n from catalog.products where is_demo and status = 'verified'",
  },
  {
    table: "catalog.base_builds",
    sql: "select count(*)::int as n from catalog.base_builds where is_demo and is_showcase",
  },
  {
    table: "pricing.market_prices",
    sql: "select count(*)::int as n from pricing.market_prices mp where mp.is_demo and mp.as_of = (select max(as_of) from pricing.market_prices x where x.product_id = mp.product_id)",
  },
  {
    table: "content.idea_posts",
    sql: "select count(*)::int as n from content.idea_posts where is_demo and status = 'published'",
  },
];

export async function checkDemo(connectionString) {
  // pg is a dependency of packages/db; tools have no dependencies of their own.
  const pg = createRequire(join(ROOT, "packages", "db", "package.json"))("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const problems = [];
    let checked = 0;
    for (const c of DEMO_CHECKS) {
      const { rows } = await client.query("select to_regclass($1) is not null as present", [c.table]);
      if (!rows[0].present) continue;
      checked++;
      const r = await client.query(c.sql);
      if (r.rows[0].n > 0) problems.push(`${c.table}: ${r.rows[0].n} demo row(s) visible to customers`);
    }
    return { checked, problems };
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  if (process.env.APP_MODE !== "production") {
    console.log(`check-demo: skipped (APP_MODE=${process.env.APP_MODE || "development"})`);
    process.exit(0);
  }
  const { checked, problems } = await checkDemo(process.env.DATABASE_URL_ADMIN);
  if (problems.length > 0) {
    console.error(`check-demo: demo data in production:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`check-demo: ${checked}/${DEMO_CHECKS.length} tables checked, no demo data visible`);
}
