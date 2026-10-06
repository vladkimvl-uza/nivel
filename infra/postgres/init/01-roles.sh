#!/usr/bin/env bash
# Creates Nivel database roles and databases on first cluster init.
# Passwords come from the container environment (values live in .env.local / server .env).
set -euo pipefail

for v in NIVEL_MIGRATOR_PASSWORD NIVEL_WEB_PASSWORD NIVEL_ADMIN_PASSWORD NIVEL_BOT_PASSWORD NIVEL_WORKER_PASSWORD NIVEL_UMAMI_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "01-roles.sh: $v is not set" >&2
    exit 1
  fi
done

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_pw="$NIVEL_MIGRATOR_PASSWORD" \
  -v web_pw="$NIVEL_WEB_PASSWORD" \
  -v admin_pw="$NIVEL_ADMIN_PASSWORD" \
  -v bot_pw="$NIVEL_BOT_PASSWORD" \
  -v worker_pw="$NIVEL_WORKER_PASSWORD" \
  -v umami_pw="$NIVEL_UMAMI_PASSWORD" <<'SQL'
-- DDL owner: runs migrations only (pnpm db:migrate, one-off migrate container)
CREATE ROLE nivel_migrator LOGIN PASSWORD :'migrator_pw';
-- application roles: no DDL; table rights come from migrations (default privileges)
CREATE ROLE nivel_web LOGIN PASSWORD :'web_pw';
CREATE ROLE nivel_admin LOGIN PASSWORD :'admin_pw';
CREATE ROLE nivel_bot LOGIN PASSWORD :'bot_pw';
CREATE ROLE nivel_worker LOGIN PASSWORD :'worker_pw';
-- analytics (Umami, profile "analytics"): own database, no access to nivel
CREATE ROLE nivel_umami LOGIN PASSWORD :'umami_pw';

CREATE DATABASE nivel OWNER nivel_migrator;
CREATE DATABASE nivel_umami OWNER nivel_umami;

REVOKE ALL ON DATABASE nivel FROM PUBLIC;
GRANT CONNECT ON DATABASE nivel TO nivel_web, nivel_admin, nivel_bot, nivel_worker;
REVOKE ALL ON DATABASE nivel_umami FROM PUBLIC;
-- the test harness creates nivel_s<slot>_*_test databases owned by nivel_migrator
ALTER ROLE nivel_migrator CREATEDB;
-- application roles never hold a lock or an idle transaction for long (ops.next_number locks the counter row)
ALTER ROLE nivel_web SET lock_timeout = '5s';
ALTER ROLE nivel_admin SET lock_timeout = '5s';
ALTER ROLE nivel_bot SET lock_timeout = '5s';
ALTER ROLE nivel_worker SET lock_timeout = '5s';
ALTER ROLE nivel_web SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE nivel_admin SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE nivel_bot SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE nivel_worker SET idle_in_transaction_session_timeout = '60s';
SQL

echo "01-roles.sh: roles and databases created"
