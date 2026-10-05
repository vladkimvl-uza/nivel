-- WP-00: extensions, schema usage and default privileges per role (ARCHITECTURE 3.1, 3.2).
-- Runs as nivel_migrator (database owner). Roles are created by infra/postgres/init/01-roles.sh.
-- Table-level rights that differ from these defaults (nivel_web writes, views for payments) are added by WP-06.

-- pg_trgm is a trusted extension: the database owner may create it without superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
REVOKE ALL ON SCHEMA catalog, pricing, sales, content, ai, bot, ops FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA catalog, pricing, sales, content, ai, bot, ops TO nivel_admin;
--> statement-breakpoint
GRANT USAGE ON SCHEMA catalog, pricing, sales, content, ai, ops TO nivel_web;
--> statement-breakpoint
GRANT USAGE ON SCHEMA catalog, pricing, sales, content, bot, ops TO nivel_bot;
--> statement-breakpoint
GRANT USAGE ON SCHEMA catalog, pricing, sales, content, ai, ops TO nivel_worker;
--> statement-breakpoint
-- nivel_admin: everything in application schemas, no DDL.
ALTER DEFAULT PRIVILEGES FOR ROLE nivel_migrator IN SCHEMA catalog, pricing, sales, content, ai, bot, ops
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nivel_admin;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE nivel_migrator IN SCHEMA catalog, pricing, sales, content, ai, bot, ops
  GRANT USAGE, SELECT ON SEQUENCES TO nivel_admin;
--> statement-breakpoint
-- nivel_web: reads catalog, prices, content; AI journal is written by the site (ai.*).
ALTER DEFAULT PRIVILEGES FOR ROLE nivel_migrator IN SCHEMA catalog, pricing, content
  GRANT SELECT ON TABLES TO nivel_web;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE nivel_migrator IN SCHEMA ai
  GRANT SELECT, INSERT ON TABLES TO nivel_web;
--> statement-breakpoint
-- nivel_bot: reads catalog, prices, content; owns its sessions and processed updates.
ALTER DEFAULT PRIVILEGES FOR ROLE nivel_migrator IN SCHEMA catalog, pricing, content
  GRANT SELECT ON TABLES TO nivel_bot;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE nivel_migrator IN SCHEMA bot
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nivel_bot;
--> statement-breakpoint
-- nivel_worker: prices and rates; reads catalog and content.
ALTER DEFAULT PRIVILEGES FOR ROLE nivel_migrator IN SCHEMA pricing
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nivel_worker;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE nivel_migrator IN SCHEMA catalog, content
  GRANT SELECT ON TABLES TO nivel_worker;
--> statement-breakpoint
-- Functions (sales.apply_transition and others) are granted explicitly, never to PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE nivel_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
-- pg-boss creates and owns schema "pgboss" as nivel_worker.
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO nivel_worker', current_database());
END
$$;
