# Muse task 003 — production deployment files (Docker, Caddy, backups)

You are working in a git worktree of DISMODO (pnpm monorepo, Node 24, TypeScript run with `tsx`, Fastify API in
`apps/api`, Vite web app in `apps/web` whose build the API serves, MCP server in `apps/mcp`, PostgreSQL 17).
Read first: `README.md`, `package.json` (root scripts), `apps/api/src/index.ts`, `apps/api/src/env.ts`,
`apps/api/src/server.ts` (how `webDistDir` and `docsDir` are resolved), `apps/mcp/src/http.ts`, `.env.example`,
`docker-compose.yml` (dev database only).

## Goal

Production deployment for one Ubuntu 24.04 VPS (4 CPU, 8 GB RAM) with one public domain.

## Allowed files (create only these; do not modify any other file)

- `deploy/Dockerfile` — multi-stage: install with pnpm (corepack), build `@dismodo/web`
  (`pnpm --filter @dismodo/web build`), final image runs the API with `tsx` as a non-root user. The final image
  must contain: the workspace packages the API imports at runtime, `apps/web/dist`, `apps/web/src/docs/content`
  (served as llms.txt), `apps/api/drizzle` (migrations), `experiences/` (reference package). Exposes 4100.
  Healthcheck on `/health`.
- `deploy/Dockerfile.mcp` — image for the MCP HTTP server (`pnpm --filter @dismodo/mcp http`), non-root, port 4200,
  with `MCP_HOST=0.0.0.0` and `MCP_ALLOWED_HOSTS` set from env (the container sits behind Caddy).
- `deploy/docker-compose.prod.yml` — services `db` (postgres:17-alpine, named volume, healthcheck, NOT published
  to the host), `api` (depends on healthy db, env from `deploy/.env`, restart unless-stopped), `mcp`, `caddy`
  (ports 80/443, volumes for data/config). Internal network only between services.
- `deploy/Caddyfile` — `{$DISMODO_DOMAIN}` with automatic TLS; `/mcp` → mcp:4200; everything else → api:4100;
  sensible security headers (HSTS, X-Content-Type-Options, Referrer-Policy no-referrer, frame-ancestors only
  where needed: the embed script must stay loadable cross-origin; do not add a CSP that breaks the SPA).
- `deploy/.env.production.example` — every variable the API/MCP need (see `.env.example`), with
  `PUBLIC_BASE_URL=https://${DISMODO_DOMAIN}` style placeholders, `DATABASE_URL` pointing at the `db` service,
  no real secrets.
- `deploy/backup.sh` — `pg_dump` from the db container to a dated, gzipped file in `deploy/backups/`, keeping
  the last 14; safe `set -euo pipefail`; documented cron line in a comment.
- `deploy/README.md` — step-by-step for a fresh Ubuntu 24.04 VPS: Docker install, DNS, copy env, `docker compose
-f deploy/docker-compose.prod.yml up -d --build`, seeding (`pnpm seed` equivalent inside the api container),
  creating a tenant key, backups/cron, updating, checking logs. Plain English, honest about what was not tested.

## Constraints

- Do not change application code. If something cannot work without a code change, write it in deploy/README.md
  under "Open questions" instead.
- No secrets in files. No `latest` tags except official base images pinned by major (node:24-_, postgres:17-_,
  caddy:2-*).

## Verify before finishing

```
docker build -f deploy/Dockerfile -t dismodo-api:test .
docker build -f deploy/Dockerfile.mcp -t dismodo-mcp:test .
docker compose -f deploy/docker-compose.prod.yml config >/dev/null
bash -n deploy/backup.sh
```

If Docker is not available in your sandbox, say so in your final message and still check the files carefully.
Commit on the current branch with a message ending with:
`Co-Authored-By: Muse Code <noreply@meta.com>`
