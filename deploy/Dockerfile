# syntax=docker/dockerfile:1
# DISMODO API image: Fastify API (tsx) serving the built web app.
# The API loads TypeScript sources from the workspace packages at runtime
# (their package.json "main" points at ./src/index.ts), so the final image
# keeps the workspace sources and node_modules; only the web app is compiled.

FROM node:24-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /app

# Workspace manifests first so the install layer is cached.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/activities/package.json packages/activities/package.json
COPY packages/adaptation/package.json packages/adaptation/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY examples/acme-onboarding/package.json examples/acme-onboarding/package.json
RUN pnpm install --frozen-lockfile

# Sources. apps/api/src/index.ts resolves, relative to itself:
#   ../../../experiences/parts-of-a-whole/experience.json
#   ../../web/dist and ../../web/src/docs/content
# and apps/api/src/db/migrate.ts resolves ../../drizzle.
# The layout below preserves exactly those relative paths.
COPY apps ./apps
COPY packages ./packages
COPY experiences ./experiences
RUN pnpm --filter @dismodo/web build

FROM node:24-bookworm-slim AS runtime
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
ENV NODE_ENV=production
WORKDIR /app

# Workspace packages the API imports at runtime (@dismodo/adaptation,
# @dismodo/engine, @dismodo/activities, @dismodo/contracts and their
# transitive workspace dependencies), plus root node_modules (tsx lives
# in the root devDependencies; pnpm's per-package node_modules with the
# workspace symlinks ride along inside apps/ and packages/).
COPY --from=builder --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/api ./apps/api
COPY --from=builder --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=node:node /app/apps/mcp/package.json ./apps/mcp/package.json
COPY --from=builder --chown=node:node /app/packages ./packages
# Built web app (served by the API) and the docs Markdown sources
# (../../web/src/docs/content, served as /llms.txt and /docs/*.md).
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=builder --chown=node:node /app/apps/web/src/docs/content ./apps/web/src/docs/content
# Drizzle migrations (../../drizzle relative to apps/api/src/db).
COPY --from=builder --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle
# Reference experience package read at startup and by the seed script.
COPY --from=builder --chown=node:node /app/experiences ./experiences

USER node
EXPOSE 4100
# /health runs "select 1" against Postgres: 503 while the DB is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node_modules/.bin/tsx", "apps/api/src/index.ts"]
