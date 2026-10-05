import { pgSchema } from "drizzle-orm/pg-core";

/** PostgreSQL schema "catalog" (ARCHITECTURE 3.1). Tables are added by the owning work package (WP-06). */
export const catalog = pgSchema("catalog");
