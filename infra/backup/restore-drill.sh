#!/usr/bin/env bash
# Restore a backup into a throwaway Postgres and prove it is usable.
# Usage: pnpm backup:restore-drill [path/to/docent-....dump.age]
#
# Checks: restore succeeds, migrations are at head, RLS is forced on every tenant
# table, app roles cannot bypass it, and row counts match the backup manifest.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -f "${repo}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${repo}/.env"
  set +a
fi

identity="${BACKUP_AGE_IDENTITY_FILE:-${HOME}/.config/docent/backup-age-key.txt}"
local_dir="${BACKUP_LOCAL_DIR:-${repo}/backups}"
[[ "${local_dir}" = /* ]] || local_dir="${repo}/${local_dir#./}"
dump="${1:-$(ls -t "${local_dir}"/docent-*.dump.age 2>/dev/null | head -1 || true)}"
[[ -n "${dump}" && -f "${dump}" ]] || { echo "No backup found in ${local_dir}" >&2; exit 1; }
[[ -f "${identity}" ]] || { echo "No age identity at ${identity} (BACKUP_AGE_IDENTITY_FILE)" >&2; exit 1; }
dump="$(cd "$(dirname "${dump}")" && pwd)/$(basename "${dump}")"
counts="${dump%.dump.age}.counts"

run_id="docent-drill-$$"
password="drill-$$"
cleanup() {
  docker rm -f "${run_id}" >/dev/null 2>&1 || true
  docker network rm "${run_id}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "drill: ${dump}"
docker build --quiet -f "${repo}/infra/docker/backup.Dockerfile" -t docent-backup:local "${repo}" >/dev/null
docker build --quiet -f "${repo}/infra/docker/api.Dockerfile" -t docent-api:local "${repo}" >/dev/null
docker network create "${run_id}" >/dev/null
docker run -d --name "${run_id}" --network "${run_id}" \
  -e POSTGRES_PASSWORD="${password}" \
  -v "${repo}/infra/db/sql:/docent-sql:ro" \
  -v "${repo}/infra/backup/verify.sql:/verify.sql:ro" \
  pgvector/pgvector:0.8.1-pg17 >/dev/null

for _ in $(seq 1 60); do
  docker exec "${run_id}" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

psql_admin() { docker exec -i "${run_id}" psql -v ON_ERROR_STOP=1 -U postgres --quiet "$@"; }
psql_admin -d postgres -v owner_password="${password}" -v app_password="${password}" \
  -v worker_password="${password}" -f /docent-sql/roles.sql >/dev/null
psql_admin -d postgres -c "create database docent owner docent_owner" >/dev/null
psql_admin -d docent -f /docent-sql/database.sql >/dev/null

echo "restoring"
docker run --rm -i --network "${run_id}" \
  -v "${identity}:/key:ro" -v "${dump}:/dump.age:ro" \
  docent-backup:local bash -c \
  "age --decrypt --identity /key /dump.age | pg_restore --exit-on-error --no-password \
     -d postgresql://postgres:${password}@${run_id}:5432/docent"

echo "checking migrations"
current="$(docker run --rm --network "${run_id}" \
  -e MIGRATION_DATABASE_URL="postgresql://docent_owner:${password}@${run_id}:5432/docent" \
  docent-api:local docent db current 2>/dev/null)"
echo "  ${current}"
[[ "${current}" == *"(head)"* ]] || { echo "FAIL: restored schema is not at migration head" >&2; exit 1; }

echo "checking row-level security"
psql_admin -d docent -f /verify.sql >/dev/null
leak="$(docker exec "${run_id}" psql -U docent_app -d docent -tAc \
  "select count(*) from memberships" 2>/dev/null || true)"
if [[ "${leak}" != "0" ]]; then
  echo "FAIL: app role sees ${leak} membership rows without tenant context" >&2
  exit 1
fi

if [[ -f "${counts}" ]]; then
  echo "checking row counts"
  restored="$(psql_admin -d docent -tA -F'|' <<'SQL'
select format('select %L, count(*) from %I.%I', c.relname, n.nspname, c.relname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'alembic_version'
order by c.relname
\gexec
SQL
)"
  if ! diff <(sort "${counts}") <(echo "${restored}" | sort) >/dev/null; then
    echo "FAIL: row counts differ from the backup manifest" >&2
    diff <(sort "${counts}") <(echo "${restored}" | sort) >&2 || true
    exit 1
  fi
  echo "  $(wc -l < "${counts}" | tr -d ' ') tables match"
fi

echo "PASS: backup restores cleanly with isolation intact"
