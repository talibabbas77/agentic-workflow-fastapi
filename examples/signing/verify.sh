#!/usr/bin/env bash
# Runs every signing example and checks the API accepts its token.
# Needs a local API (pnpm dev:api) and the demo widget key from `pnpm seed`.
# Languages whose toolchain is missing are skipped; PHP runs in Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/examples/signing"
API="${API_URL:-http://127.0.0.1:8000}"
WIDGET_ORIGIN="${WIDGET_ORIGIN:-http://localhost:8000}"
PARENT="http://localhost:5173"
KEY_FILE="$ROOT/.data/demo-host/lumen-notes.json"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[[ -f "$KEY_FILE" ]] || { echo "No demo key at $KEY_FILE. Run pnpm seed first." >&2; exit 1; }

DOCENT_WIDGET_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["widget"])' "$KEY_FILE")"
DOCENT_KEY_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["kid"])' "$KEY_FILE")"
DOCENT_PRIVATE_KEY="$(uv run --quiet --directory "$ROOT/apps/api" python -c '
import json, sys
from cryptography.hazmat.primitives import serialization as s
from jwt.algorithms import ECAlgorithm
key = ECAlgorithm.from_jwk(json.dumps(json.load(open(sys.argv[1]))["private_jwk"]))
print(key.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode())
' "$KEY_FILE")"
export DOCENT_WIDGET_ID DOCENT_KEY_ID DOCENT_PRIVATE_KEY

failures=0

check() {
  local name="$1" token="$2" status
  status="$(curl -s -o "$WORK/$name.json" -w '%{http_code}' -X POST "$API/v1/widget/sessions" \
    -H "origin: $WIDGET_ORIGIN" -H 'content-type: application/json' \
    -d "{\"widget\":\"$DOCENT_WIDGET_ID\",\"parent_origin\":\"$PARENT\",\"token\":\"$token\"}")"
  if [[ "$status" == 201 ]] && grep -q '"mode":"identified"' "$WORK/$name.json"; then
    echo "pass  $name"
  else
    echo "FAIL  $name ($status) $(cat "$WORK/$name.json")"
    failures=$((failures + 1))
  fi
}

skip() { echo "skip  $1 ($2 not installed)"; }

# Node: reuse the demo host's jose install.
mkdir -p "$WORK/node" && cp "$HERE/node.mjs" "$WORK/node/"
ln -s "$ROOT/apps/demo-host/node_modules" "$WORK/node/node_modules"
check node "$(node "$WORK/node/node.mjs")"

# Python: the API environment already has PyJWT with crypto.
check python "$(uv run --quiet --directory "$ROOT/apps/api" python "$HERE/python.py")"

if command -v ruby >/dev/null && command -v gem >/dev/null; then
  gem install jwt --silent --no-document --install-dir "$WORK/gems" >/dev/null
  check ruby "$(GEM_HOME="$WORK/gems" GEM_PATH="$WORK/gems" ruby "$HERE/ruby.rb")"
else
  skip ruby ruby
fi

if command -v go >/dev/null; then
  mkdir -p "$WORK/go" && cp "$HERE/go/main.go" "$WORK/go/"
  (cd "$WORK/go" && go mod init docent.example/signing >/dev/null 2>&1 \
    && go get github.com/golang-jwt/jwt/v5 >/dev/null 2>&1)
  check go "$(cd "$WORK/go" && go run .)"
else
  skip go go
fi

if command -v docker >/dev/null; then
  mkdir -p "$WORK/php" && cp "$HERE/php.php" "$WORK/php/"
  docker run --rm -v "$WORK/php:/app" -w /app composer:2 \
    require --quiet --ignore-platform-reqs firebase/php-jwt >/dev/null
  check php "$(docker run --rm -v "$WORK/php:/app" -w /app \
    -e DOCENT_WIDGET_ID -e DOCENT_KEY_ID -e DOCENT_PRIVATE_KEY php:8.2-cli php php.php)"
else
  skip php docker
fi

exit "$failures"
