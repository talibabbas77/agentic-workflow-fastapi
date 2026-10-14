# syntax=docker/dockerfile:1.7
# Docent API and worker image. Same image, different command:
#   docent api | docent worker | docent db migrate
# The API also serves the embeddable widget, built in the first stage.

FROM node:24-alpine AS widget
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# The corepack bundled with Node 24 cannot load pnpm 12.
RUN npm install --global corepack@latest && corepack enable pnpm
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/widget/package.json apps/widget/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @docent/widget
COPY apps/widget apps/widget
RUN pnpm --filter @docent/widget build && pnpm --filter @docent/widget size

FROM python:3.14-slim-bookworm AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.14 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/.python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
COPY apps/api/alembic.ini ./
COPY apps/api/alembic ./alembic
COPY apps/api/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

FROM python:3.14-slim-bookworm AS runtime
RUN useradd --create-home --uid 10001 docent \
 && mkdir -p /data/objects && chown docent:docent /data/objects
WORKDIR /app
COPY --from=build --chown=docent:docent /app /app
COPY --from=widget /repo/apps/widget/dist /app/apps/widget/dist
# Production unless told otherwise: an image deployed without DOCENT_ENV refuses the
# default secrets and sets Secure cookies, instead of running as a laptop would.
# compose.yaml sets DOCENT_ENV=local for development.
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LOG_JSON=true \
    DOCENT_ENV=production
USER docent
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('HEALTH_PORT', '8000'), timeout=2)" || exit 1
CMD ["docent", "api", "--host", "0.0.0.0", "--port", "8000"]
