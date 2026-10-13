#!/usr/bin/env bash
# Create an age key pair for backups. The private key never goes on a server.
# Prints the public recipient to put in BACKUP_AGE_RECIPIENT.
set -euo pipefail

key_file="${1:-${HOME}/.config/docent/backup-age-key.txt}"
if [[ -f "${key_file}" ]]; then
  echo "Key already exists at ${key_file}" >&2
else
  mkdir -p "$(dirname "${key_file}")"
  repo="$(cd "$(dirname "$0")/../.." && pwd)"
  docker build --quiet -f "${repo}/infra/docker/backup.Dockerfile" -t docent-backup:local "${repo}" >/dev/null
  docker run --rm docent-backup:local age-keygen 2>/dev/null > "${key_file}"
  chmod 600 "${key_file}"
  echo "Private key written to ${key_file}. Keep a copy offline. Losing it means losing the backups." >&2
fi
grep -o 'age1[0-9a-z]*' "${key_file}" | head -1
