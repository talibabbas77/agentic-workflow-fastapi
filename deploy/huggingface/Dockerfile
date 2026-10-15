# syntax=docker/dockerfile:1.7
# Docent on a free Hugging Face Space, in one container: Postgres with pgvector,
# Ollama for the embedding model, the API, the worker, the web app, the demo
# sites, Mailpit, and Caddy on port 7860. The chat model is a hosted API
# (Groq by default; see start.sh). This file is all the Space needs: it fetches
# the code from GitHub, so a "Factory rebuild" picks up new commits.

ARG REPO_URL=https://github.com/talibabbas77/agentic-workflow-fastapi.git
ARG BRANCH=main

FROM alpine:3.22 AS source
ARG REPO_URL
ARG BRANCH
RUN apk add --no-cache git
# A new commit on GitHub changes this file, so the clone below runs again
# instead of reusing the build cache.
ADD https://api.github.com/repos/talibabbas77/agentic-workflow-fastapi/commits/main /tmp/latest-commit.json
RUN git clone --depth 1 --branch "$BRANCH" "$REPO_URL" /src

# The embeddable widget (static files the API serves).
FROM node:24-alpine AS widget
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install --global corepack@latest && corepack enable pnpm
WORKDIR /repo
COPY --from=source /src/package.json /src/pnpm-lock.yaml /src/pnpm-workspace.yaml ./
COPY --from=source /src/apps/widget apps/widget
RUN pnpm install --frozen-lockfile --filter @docent/widget && pnpm --filter @docent/widget build

# The API and worker: a Python virtual environment.
FROM python:3.14-slim-bookworm AS api
COPY --from=ghcr.io/astral-sh/uv:0.11.14 /uv /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY --from=source /src/apps/api/pyproject.toml /src/apps/api/uv.lock /src/apps/api/.python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY --from=source /src/apps/api/alembic.ini ./
COPY --from=source /src/apps/api/alembic ./alembic
COPY --from=source /src/apps/api/src ./src
RUN uv sync --locked --no-dev

# Node stages on Debian, to match the glibc runtime below.
FROM node:24-bookworm-slim AS node-base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN npm install --global corepack@latest && corepack enable pnpm
WORKDIR /repo
COPY --from=source /src/package.json /src/pnpm-lock.yaml /src/pnpm-workspace.yaml ./

# The web app: landing page, sign in, the admin app (Next.js standalone).
FROM node-base AS web
ARG PUBLIC_URL=""
COPY --from=source /src/apps/web/package.json apps/web/
COPY --from=source /src/packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile --filter "@docent/web..."
COPY --from=source /src/packages/api-client packages/api-client
COPY --from=source /src/apps/web apps/web
# Without PUBLIC_URL the demo links are relative, which works on one address.
RUN API_INTERNAL_URL=http://127.0.0.1:8000 \
    NEXT_PUBLIC_SITE_URL="$PUBLIC_URL" \
    NEXT_PUBLIC_WIDGET_ORIGIN="$PUBLIC_URL" \
    NEXT_PUBLIC_SHOWCASE_PUBLIC_URL="$PUBLIC_URL/lumen-notes" \
    NEXT_PUBLIC_SHOWCASE_APP_URL="$PUBLIC_URL/parcelwise" \
    NEXT_PUBLIC_SIGNUPS_OPEN=false \
    NEXT_PUBLIC_SOCIAL_GITHUB=https://github.com/talibabbas77/agentic-workflow-fastapi \
    pnpm --filter @docent/web build

# The demo sites: only their own package and its production dependencies.
FROM node-base AS demo
COPY --from=source /src/apps/demo-host apps/demo-host
RUN pnpm --filter @docent/demo-host deploy --prod --legacy /out

# Ollama for the embedding model, CPU parts only. The release also carries about
# 5 GB of GPU libraries; they are filtered out as the download streams through.
FROM debian:bookworm-slim AS ollama
ARG OLLAMA_VERSION=0.40.3
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl zstd \
 && mkdir -p /opt/ollama \
 && curl -fsSL "https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-amd64.tar.zst" \
    | zstd -d | tar -x -C /opt/ollama --wildcards \
      --exclude='*cuda_*' --exclude='*rocm*' --exclude='*vulkan*' --exclude='*mlx*' \
 && /opt/ollama/bin/ollama --version

FROM python:3.14-slim-bookworm AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg libstdc++6 \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17 postgresql-17-pgvector \
 && apt-get purge -y gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 user
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=ollama /opt/ollama/bin/ollama /usr/bin/ollama
COPY --from=ollama /opt/ollama/lib/ollama /usr/lib/ollama
COPY --from=caddy:2.10.0-alpine /usr/bin/caddy /usr/bin/caddy
COPY --from=axllent/mailpit:v1.27 /mailpit /usr/local/bin/mailpit

COPY --from=api --chown=user /app /app
COPY --from=widget --chown=user /repo/apps/widget/dist /app/apps/widget/dist
COPY --from=source --chown=user /src/fixtures /app/fixtures
COPY --from=source --chown=user /src/infra/db/sql /app/infra/db/sql
COPY --from=source --chown=user /src/deploy/huggingface /app/deploy/huggingface
COPY --from=web --chown=user /repo/apps/web/.next/standalone /web
COPY --from=web --chown=user /repo/apps/web/.next/static /web/apps/web/.next/static
COPY --from=web --chown=user /repo/apps/web/public /web/apps/web/public
COPY --from=demo --chown=user /out /demo
COPY --from=source --chown=user /src/fixtures/golden/lumen-notes /demo/fixtures/golden/lumen-notes

USER user
ENV HOME=/home/user \
    PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    OLLAMA_MODELS=/home/user/.ollama/models \
    NODE_ENV=production
# The embedding model is part of the image, so a restart does not download it again.
RUN (OLLAMA_HOST=127.0.0.1:11434 ollama serve >/tmp/ollama.log 2>&1 &) \
 && for _ in $(seq 1 30); do ollama list >/dev/null 2>&1 && break; sleep 1; done \
 && ollama pull embeddinggemma \
 && ollama list

EXPOSE 7860
CMD ["bash", "/app/deploy/huggingface/start.sh"]
