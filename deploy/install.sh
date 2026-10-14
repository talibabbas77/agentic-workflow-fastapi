#!/usr/bin/env bash
# Put the Docent showcase on a fresh Ubuntu 22.04 or 24.04 server, in one go.
#
#   curl -fsSL https://raw.githubusercontent.com/talibabbas77/agentic-workflow-fastapi/main/deploy/install.sh \
#     | sudo OWNER_EMAIL=you@example.com bash
#
# What it does, safe to run again at any time:
#   1. Installs Docker, and adds swap on a small server so the build fits.
#   2. Clones the repository to /opt/docent (or updates it).
#   3. Writes deploy/.env once: free sslip.io hostnames for this server's IP
#      (or your own DOMAIN), and fresh random secrets and passwords.
#   4. Builds and starts everything behind Caddy, which gets HTTPS certificates.
#   5. Downloads the embedding model and asks you to sign Ollama in, once.
#   6. Loads the fictional demo companies and prints the addresses and logins.
#
# Settings, all optional: OWNER_EMAIL, OWNER_NAME, DOMAIN (then point app., api.,
# and demo. at this server first), REPO_URL, BRANCH, DIR, SIGNUPS_OPEN=true,
# SKIP_SIGNIN=1 (seed without the chat model; sign in later and run it again).

set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/talibabbas77/agentic-workflow-fastapi.git}
BRANCH=${BRANCH:-main}
DIR=${DIR:-/opt/docent}
OWNER_NAME=${OWNER_NAME:-Talib Abbas}

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run as root, for example with sudo."
command -v apt-get >/dev/null || fail "this script is for Ubuntu or Debian."

say "1/6 Docker"
apt-get update -qq
apt-get install -y -qq git curl openssl ca-certificates >/dev/null
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null || fail "docker compose is missing."

memory_mb=$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
if [ "$memory_mb" -lt 6000 ] && [ "$(swapon --show | wc -l)" -eq 0 ]; then
  say "Adding 4 GB of swap: this server has ${memory_mb} MB of memory"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "2/6 Code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" pull --quiet --ff-only origin "$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$DIR"
fi
cd "$DIR/deploy"

if [ ! -f .env ]; then
  say "3/6 Settings"
  if [ -z "${OWNER_EMAIL:-}" ]; then
    read -r -p "Your email (your login, and for HTTPS certificate notices): " OWNER_EMAIL < /dev/tty
  fi
  [ -n "${OWNER_EMAIL:-}" ] || fail "OWNER_EMAIL is needed."
  if [ -n "${DOMAIN:-}" ]; then
    base="$DOMAIN"
  else
    ip=$(curl -4 -fsS https://api.ipify.org) || fail "could not find this server's public IP."
    base="${ip//./-}.sslip.io"
  fi
  secret() { openssl rand -hex 32; }
  password() { openssl rand -base64 18 | tr -d '/+=' | cut -c1-16; }
  umask 077
  cat > .env <<ENV
# Written by install.sh on $(date -u +%Y-%m-%d). Keep it private: it holds every secret.
APP_HOST=app.${base}
API_HOST=api.${base}
DEMO_HOST=demo.${base}
ACME_EMAIL=${OWNER_EMAIL}
OWNER_EMAIL=${OWNER_EMAIL}
OWNER_NAME=${OWNER_NAME}
SIGNUPS_OPEN=${SIGNUPS_OPEN:-false}
SECRET_KEY=$(secret)
INTERNAL_TOKEN=$(secret)
POSTGRES_PASSWORD=$(secret)
DB_OWNER_PASSWORD=$(secret)
DB_APP_PASSWORD=$(secret)
DB_WORKER_PASSWORD=$(secret)
OWNER_PASSWORD=Docent-$(password)
DEMO_PASSWORD=Demo-$(password)
GITHUB_URL=${REPO_URL%.git}
ENV
  umask 022
else
  say "3/6 Settings: keeping the existing deploy/.env"
fi
set -a; . ./.env; set +a

say "4/6 Build and start (the first build takes 10 to 20 minutes)"
docker compose build
docker compose up -d
docker image prune -f >/dev/null
docker builder prune -af >/dev/null

for _ in $(seq 1 60); do
  docker compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)" \
    >/dev/null 2>&1 && break
  sleep 5
done

say "5/6 Models"
docker compose exec -T ollama ollama pull embeddinggemma
seed_flags=()
if [ "${SKIP_SIGNIN:-}" = "1" ]; then
  seed_flags+=(--no-conversations)
elif timeout 90 docker compose exec -T ollama ollama run "${LLM_MODEL:-gemma4:cloud}" "Reply with OK" >/dev/null 2>&1; then
  echo "Ollama is signed in and the chat model answers."
else
  echo "The chat model runs on Ollama's cloud, so this server needs your Ollama account once."
  echo "Open the link below, sign in, and approve this server. The script continues after that."
  docker compose exec ollama ollama signin < /dev/tty || {
    echo "Sign-in did not finish. Seeding without demo conversations; run this script again later."
    seed_flags+=(--no-conversations)
  }
fi

say "6/6 Demo data (a few minutes: the agent answers the demo conversations)"
docker compose run --rm -T \
  -e SEED_OWNER_PASSWORD="$OWNER_PASSWORD" -e SEED_DEMO_PASSWORD="$DEMO_PASSWORD" \
  api docent seed --owner-email "$OWNER_EMAIL" --owner-name "$OWNER_NAME" \
  --api-url http://api:8000 --fixtures /app/fixtures --demo-keys /data/demo-host \
  "${seed_flags[@]}"

umask 077
cat > credentials.txt <<DONE
Docent showcase, $(date -u +%Y-%m-%d)

  Landing page and app   https://${APP_HOST}
  Platform admin         https://${APP_HOST}/admin
  Demo sites             https://${DEMO_HOST}/lumen-notes   (anyone, no login)
                         https://${DEMO_HOST}/parcelwise    (pick a demo customer)

  Your login             ${OWNER_EMAIL} / ${OWNER_PASSWORD}
  Demo teammates         docent-maya.chen@mailinator.com and the others / ${DEMO_PASSWORD}
DONE
umask 022
say "Done"
cat credentials.txt
echo
echo "These are saved in $DIR/deploy/credentials.txt (readable by root only)."
echo "HTTPS certificates can take a minute on the first visit."
