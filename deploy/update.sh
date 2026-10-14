#!/usr/bin/env bash
# Deploy the latest code to a server set up by install.sh: pull, rebuild, restart.
# Data, settings, and the Ollama sign-in are kept.
#
#   sudo /opt/docent/deploy/update.sh

set -euo pipefail
cd "$(dirname "$0")"
git -C .. pull --ff-only
docker compose build
docker compose up -d
docker image prune -f >/dev/null
docker builder prune -af >/dev/null
docker compose ps
