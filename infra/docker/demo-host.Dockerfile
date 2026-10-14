# syntax=docker/dockerfile:1.7
# The live showcase: two fictional customer sites with the Docent widget
# (apps/demo-host). Node runs the TypeScript directly; jose is the only package.
# The widgets' signing keys come from the volume the seed writes to.

FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# The corepack bundled with Node 24 cannot load pnpm 12.
RUN npm install --global corepack@latest && corepack enable pnpm
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/demo-host apps/demo-host
# Only this package and its production dependencies, nothing else in the workspace.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @docent/demo-host deploy --prod --legacy /out

FROM node:24-alpine AS runtime
RUN adduser -S -u 10001 docent
WORKDIR /app
COPY --from=build /out ./
# The Lumen Notes help center shows the same articles the agent was taught.
COPY fixtures/golden/lumen-notes ./fixtures/golden/lumen-notes
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173 \
    OTHER_PORT=0 \
    DEMO_KEYS_DIR=/data/demo-host/ \
    LUMEN_HELP_DIR=/app/fixtures/golden/lumen-notes/
USER docent
EXPOSE 5173
CMD ["node", "src/server.ts"]
