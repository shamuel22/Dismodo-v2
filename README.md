# DISMODO

**An adaptive learning engine for builders and AI agents.**

Builders define _what_ to teach and _how to check it_ in a versioned experience package. DISMODO runs the
adaptive session: it observes attempts, hints, self-ratings and unfamiliar references, picks an allowed
intervention (proposed by Meta's **Muse Spark**, enforced by a deterministic controller), and returns
evidence computed from validated events — never from model claims.

> Status: under active development for the Meta Global AI Developer Hackathon (Indie Developer track).
> See [`PLAN_DESARROLLO.md`](PLAN_DESARROLLO.md) for the live build plan and [`HACKATHON_SCOPE.md`](HACKATHON_SCOPE.md)
> for what was built during the event.

## Local development

Requirements: Node 24, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env      # add META_API_KEY
pnpm db:up                # Postgres 17 on localhost:5434
pnpm dev:api              # API on http://localhost:4100
pnpm check                # lint, format, typecheck, tests
```

## Repository layout

| Path                 | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `packages/contracts` | Zod contracts shared by the engine, API, SDK and MCP |
| `apps/api`           | HTTP API (Fastify + PostgreSQL)                      |
| `experiences/`       | Experience packages (JSON, versioned)                |
| `docs/`              | Builder documentation                                |

## License

MIT © LUCUO SRL
