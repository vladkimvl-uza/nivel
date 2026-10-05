export { createDb, type Db } from "./client.ts";
export { MIGRATIONS_DIR, runMigrations } from "./migrate.ts";
export * from "./schema/index.ts";

/** Application schemas created by the first migration (ARCHITECTURE 3.1). */
export const APP_SCHEMAS = ["catalog", "pricing", "sales", "content", "ai", "bot", "ops"] as const;
/** Database roles created by infra/postgres/init/01-roles.sh (ARCHITECTURE 3.2). */
export const APP_ROLES = ["nivel_migrator", "nivel_web", "nivel_admin", "nivel_bot", "nivel_worker"] as const;
