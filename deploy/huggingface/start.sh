#!/usr/bin/env bash
# Boot the whole showcase inside one Hugging Face Space container.
#
# A free Space keeps no disk between restarts, so every boot starts clean:
# a fresh database, the migrations, then the demo companies loaded again.
# The site answers within a minute; the demo data follows a minute or two later.
#
# Space secrets (Settings, Variables and secrets):
#   LLM_API_KEY      required: a Groq key (console.groq.com/keys), or another
#                    OpenAI-compatible provider's key with LLM_BASE_URL and LLM_MODEL
#   OWNER_EMAIL      your login, and OWNER_PASSWORD (at least 10 characters)
# Optional: PUBLIC_URL (https://<owner>-<space>.hf.space; set it as a variable so
# the build sees it too), LLM_BASE_URL, LLM_MODEL, SEED_CONVERSATIONS=1,
# SIGNUPS_OPEN=true.

set -euo pipefail

export PUBLIC_URL=${PUBLIC_URL:-https://${SPACE_HOST:-localhost:7860}}
PUBLIC_URL=${PUBLIC_URL%/}
DATA=${DATA_DIR:-/tmp/docent}
LOGS=$DATA/logs
PG=/usr/lib/postgresql/17/bin
mkdir -p "$DATA/objects" "$DATA/demo-host" "$LOGS"
secret() { python -c 'import secrets; print(secrets.token_hex(24))'; }
log() { printf '[docent] %s\n' "$*"; }
log "public address: $PUBLIC_URL"

# Postgres with pgvector. The socket (only this container's user can reach it)
# trusts that user; connections over TCP need the passwords made below.
if [ ! -f "$DATA/pg/PG_VERSION" ]; then
  "$PG/initdb" -D "$DATA/pg" -U postgres --auth-local=trust --auth-host=scram-sha-256 \
    --encoding=UTF8 --locale=C.UTF-8 >/dev/null
fi
"$PG/pg_ctl" -D "$DATA/pg" -l "$LOGS/postgres.log" -w start \
  -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA -c max_connections=60" >/dev/null
db_owner=$(secret) db_app=$(secret) db_worker=$(secret)
admin() { psql -h "$DATA" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
admin -d postgres -v owner_password="$db_owner" -v app_password="$db_app" \
  -v worker_password="$db_worker" -f /app/infra/db/sql/roles.sql
admin -d postgres -c "alter role docent_owner password '$db_owner'" \
  -c "alter role docent_app password '$db_app'" -c "alter role docent_worker password '$db_worker'"
admin -d postgres -tAc "select 1 from pg_database where datname = 'docent'" | grep -q 1 \
  || admin -d postgres -c "create database docent owner docent_owner"
admin -d docent -f /app/infra/db/sql/database.sql

# Docent's settings for this Space.
export DOCENT_ENV=${DOCENT_ENV:-production}
export DOCENT_DEMO=1
export SECRET_KEY=${SECRET_KEY:-$(secret)}
export INTERNAL_TOKEN=${INTERNAL_TOKEN:-$(secret)}
export DATABASE_URL="postgresql://docent_app:${db_app}@127.0.0.1:5432/docent"
export WORKER_DATABASE_URL="postgresql://docent_worker:${db_worker}@127.0.0.1:5432/docent"
export MIGRATION_DATABASE_URL="postgresql://docent_owner:${db_owner}@127.0.0.1:5432/docent"
export WORKER_URL=http://127.0.0.1:8001
export WEB_ORIGIN=$PUBLIC_URL SITE_URL=$PUBLIC_URL WIDGET_ORIGIN=$PUBLIC_URL DEMO_HOST_ORIGIN=$PUBLIC_URL
export SIGNUPS_OPEN=${SIGNUPS_OPEN:-false}
export FORWARDED_ALLOW_IPS="127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
export OBJECT_STORE_URL="file://$DATA/objects"
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export LLM_BASE_URL=${LLM_BASE_URL:-https://api.groq.com/openai/v1}
export LLM_MODEL=${LLM_MODEL:-llama-3.3-70b-versatile}
case "$LLM_MODEL" in
  *gpt-oss*) export LLM_REASONING_EFFORT=${LLM_REASONING_EFFORT:-low} ;;
  *) export LLM_REASONING_EFFORT=${LLM_REASONING_EFFORT:-} ;;
esac
export LLM_MAX_CONCURRENCY=${LLM_MAX_CONCURRENCY:-2}
export SMTP_HOST=127.0.0.1 SMTP_PORT=1025
export LOG_JSON=true
[ -n "${LLM_API_KEY:-}" ] \
  || log "LLM_API_KEY is not set: every question will be handed to the team. Add it in the Space settings."

# Long-running services. Each logs with its name; if one stops, the container
# stops and the Space starts it again.
services=()
run() {
  local name=$1
  shift
  ("$@" 2>&1 | sed -u "s/^/[$name] /") &
  services+=("$!")
}

run mailpit /usr/local/bin/mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025
run ollama env OLLAMA_HOST=127.0.0.1:11434 /usr/bin/ollama serve
cd /app
docent db migrate
run api docent api --host 127.0.0.1 --port 8000
run worker docent worker --host 127.0.0.1 --port 8001
run web env -C /web PORT=3000 HOSTNAME=127.0.0.1 API_INTERNAL_URL=http://127.0.0.1:8000 \
  node apps/web/server.js
run demo env -C /demo HOST=127.0.0.1 PORT=5173 OTHER_PORT=0 PUBLIC_URL="$PUBLIC_URL" \
  DOCENT_URL="$PUBLIC_URL" SHOWCASE_PRIVATE_CHATS=1 DEMO_KEYS_DIR="$DATA/demo-host/" \
  LUMEN_HELP_DIR=/demo/fixtures/golden/lumen-notes/ node src/server.ts
run caddy /usr/bin/caddy run --config /app/deploy/huggingface/Caddyfile --adapter caddyfile

# The demo companies, once the API answers. Not a service: it finishes.
(
  for _ in $(seq 1 120); do
    curl -fsS -o /dev/null http://127.0.0.1:8000/healthz && break
    sleep 2
  done
  if [ -z "${OWNER_EMAIL:-}" ] || [ -z "${OWNER_PASSWORD:-}" ]; then
    log "Set the OWNER_EMAIL and OWNER_PASSWORD secrets to log in to the app and /admin."
  fi
  flags=(--no-conversations)
  if [ "${SEED_CONVERSATIONS:-}" = "1" ]; then flags=(); fi
  SEED_OWNER_PASSWORD=${OWNER_PASSWORD:-$(secret)} SEED_DEMO_PASSWORD=$(secret) \
    docent seed --owner-email "${OWNER_EMAIL:-owner@docent.local}" \
    --owner-name "${OWNER_NAME:-Talib Abbas}" --api-url http://127.0.0.1:8000 \
    --fixtures /app/fixtures --demo-keys "$DATA/demo-host" "${flags[@]}" 2>&1 \
    | sed -u 's/^/[seed] /' | grep -v "SEED_OWNER_PASSWORD\|password" || true
  log "ready: $PUBLIC_URL"
) &

wait -n "${services[@]}"
log "a service stopped; the Space will restart"
exit 1
