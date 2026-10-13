#!/usr/bin/env bash
# Daily backup: pg_dump, encrypt with age, keep locally, upload to S3-compatible storage.
# Usage: pnpm backup        (reads .env from the repo root if present)
# Schedule it with cron on the worker host, or a scheduled CI job.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -f "${repo}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${repo}/.env"
  set +a
fi

: "${BACKUP_DATABASE_URL:=postgresql://postgres:postgres@127.0.0.1:5432/docent}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required. Create one with: pnpm backup:keygen}"
local_dir="${BACKUP_LOCAL_DIR:-${repo}/backups}"
[[ "${local_dir}" = /* ]] || local_dir="${repo}/${local_dir#./}"
keep_days="${BACKUP_LOCAL_KEEP_DAYS:-14}"
mkdir -p "${local_dir}"

# Inside the container, localhost means the container. Reach the host instead.
db_url="${BACKUP_DATABASE_URL//@127.0.0.1/@host.docker.internal}"
db_url="${db_url//@localhost/@host.docker.internal}"

docker build --quiet -f "${repo}/infra/docker/backup.Dockerfile" -t docent-backup:local "${repo}" >/dev/null

docker run --rm \
  --add-host host.docker.internal:host-gateway \
  -v "${local_dir}:/backups" \
  -e BACKUP_DATABASE_URL="${db_url}" \
  -e BACKUP_AGE_RECIPIENT \
  -e BACKUP_S3_ENDPOINT -e BACKUP_S3_BUCKET -e BACKUP_S3_REGION \
  -e BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY \
  docent-backup:local docent-dump

find "${local_dir}" -name 'docent-*' -type f -mtime "+${keep_days}" -delete
