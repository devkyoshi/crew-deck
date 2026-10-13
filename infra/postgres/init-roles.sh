#!/bin/sh
# Runs once on first container start. Creates the restricted application role.
# It is NOT a superuser and has NOBYPASSRLS, so row-level security always applies to it.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE crew_app LOGIN PASSWORD '${APP_ROLE_PASSWORD:-crew_app_dev}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO crew_app;
GRANT USAGE ON SCHEMA public TO crew_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crew_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO crew_app;
SQL
