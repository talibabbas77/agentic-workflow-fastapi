#!/usr/bin/env bash
# Runs once when the local Postgres volume is first created.
# Creates Docent roles plus the dev and test databases.
set -euo pipefail

psql_admin() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" "$@"
}

psql_admin --dbname postgres \
  -v owner_password="$DOCENT_OWNER_PASSWORD" \
  -v app_password="$DOCENT_APP_PASSWORD" \
  -v worker_password="$DOCENT_WORKER_PASSWORD" \
  -f /docent-sql/roles.sql

for db in docent docent_test; do
  psql_admin --dbname postgres -c "create database ${db} owner docent_owner"
  psql_admin --dbname "${db}" -f /docent-sql/database.sql
done
