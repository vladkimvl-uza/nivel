import { defineConfig } from "drizzle-kit";

// Run through `pnpm db:migrate` / `pnpm db:generate` (root .env.local is loaded by tools/dev-run.mjs).
const url = process.env.DATABASE_URL_MIGRATOR;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  migrations: { prefix: "timestamp" },
  schemaFilter: ["catalog", "pricing", "sales", "content", "ai", "bot", "ops"],
  strict: true,
  verbose: true,
  ...(url ? { dbCredentials: { url } } : {}),
});
