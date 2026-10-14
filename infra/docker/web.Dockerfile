# syntax=docker/dockerfile:1.7
# Docent web app (Next.js standalone output).
# API_INTERNAL_URL is baked into the /api rewrite at build time, and also read at
# runtime by server components. Pass the same value to both.

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
# The corepack bundled with Node 24 cannot load pnpm 12.
RUN npm install --global corepack@latest && corepack enable pnpm
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@docent/web..."
COPY packages/api-client packages/api-client
COPY apps/web apps/web
ARG API_INTERNAL_URL=http://api:8000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
# Public settings are inlined into the build, so they are build arguments.
ARG NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_WIDGET_ORIGIN NEXT_PUBLIC_CONTACT_EMAIL \
    NEXT_PUBLIC_SOCIAL_X NEXT_PUBLIC_SOCIAL_LINKEDIN NEXT_PUBLIC_SOCIAL_GITHUB \
    NEXT_PUBLIC_SOCIAL_YOUTUBE NEXT_PUBLIC_SOCIAL_DISCORD NEXT_PUBLIC_SOCIAL_INSTAGRAM \
    NEXT_PUBLIC_SHOWCASE_PUBLIC_URL NEXT_PUBLIC_SHOWCASE_APP_URL NEXT_PUBLIC_SIGNUPS_OPEN
RUN pnpm --filter @docent/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S docent && adduser -S -G docent -u 10001 docent
COPY --from=build --chown=docent:docent /repo/apps/web/.next/standalone ./
COPY --from=build --chown=docent:docent /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=docent:docent /repo/apps/web/public ./apps/web/public
USER docent
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/login || exit 1
CMD ["node", "apps/web/server.js"]
