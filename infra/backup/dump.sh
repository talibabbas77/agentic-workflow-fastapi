#!/usr/bin/env bash
# Runs inside the backup image. Dumps, encrypts, optionally uploads.
#
# Required env:
#   BACKUP_DATABASE_URL   role that can bypass RLS (Neon project owner, or local superuser).
#                         RLS is forced on tenant tables, so docent_owner cannot dump them.
#   BACKUP_AGE_RECIPIENT  age public key (age1...). The private key stays offline.
# Optional env:
#   BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_REGION (default auto),
#   BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"

out_dir=/backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="docent-${stamp}"
dump="${out_dir}/${name}.dump.age"
counts="${out_dir}/${name}.counts"

echo "dumping database"
pg_dump --format=custom --compress=6 --no-password "${BACKUP_DATABASE_URL}" \
  | age --encrypt --recipient "${BACKUP_AGE_RECIPIENT}" --output "${dump}"

# Row counts per table, so the restore drill can confirm nothing went missing.
psql --no-password --tuples-only --no-align --field-separator='|' "${BACKUP_DATABASE_URL}" <<'SQL' > "${counts}"
select format('select %L, count(*) from %I.%I', c.relname, n.nspname, c.relname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'alembic_version'
order by c.relname
\gexec
SQL

size="$(du -h "${dump}" | cut -f1)"
echo "wrote ${dump} (${size})"

if [[ -n "${BACKUP_S3_ENDPOINT:-}" && -n "${BACKUP_S3_BUCKET:-}" ]]; then
  region="${BACKUP_S3_REGION:-auto}"
  upload() {
    local file="$1" key="$2"
    curl --fail --silent --show-error \
      --aws-sigv4 "aws:amz:${region}:s3" \
      --user "${BACKUP_S3_ACCESS_KEY_ID}:${BACKUP_S3_SECRET_ACCESS_KEY}" \
      --upload-file "${file}" \
      "${BACKUP_S3_ENDPOINT%/}/${BACKUP_S3_BUCKET}/${key}"
  }
  # Prefixes map to bucket lifecycle rules: daily 35 days, weekly 90, monthly 400.
  prefixes=("daily")
  [[ "$(date -u +%u)" == "7" ]] && prefixes+=("weekly")
  [[ "$(date -u +%d)" == "01" ]] && prefixes+=("monthly")
  for prefix in "${prefixes[@]}"; do
    upload "${dump}" "${prefix}/${name}.dump.age"
    upload "${counts}" "${prefix}/${name}.counts"
    echo "uploaded ${prefix}/${name}.dump.age"
  done
fi
