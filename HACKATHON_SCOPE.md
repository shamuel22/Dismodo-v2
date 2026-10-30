# Hackathon scope — DISMODO

**Event:** Meta Global AI Developer Hackathon (Cerebral Valley), building period Oct 26 – Nov 4, 2026
**Track:** Indie Developer · **Problem statement:** Build for Your World
**Participant:** Shamuel Perez, solo

This document separates what was built during the hackathon from prior materials, as the rules require.
It is updated at the end of every build stage.

## Built during the hackathon

All code in this repository was written during the event. The git history is unaltered and shows the timeline.

| Area | Location | Stage | What it is |
| --- | --- | --- | --- |
| Repository foundation | root, `.github/` | E0 | pnpm workspace, strict TypeScript, lint/format, CI with a real Postgres service. |
| API foundation | `apps/api` | E0 | Fastify server, validated environment, Postgres connection, health check and standard error shape. |
| Experience package contract | `packages/contracts` | E1 | Versioned package schema with size caps and guards, intervention catalog, activity/evaluator adapter interfaces, safe flat templates, canonical JSON. |
| Activity family and evaluator | `packages/activities` | E1–E2 | `set-selection.v1` (diagnostic-only items, canonical problem identity, seeded rendering) and `fraction-of-set.v1` (equivalent answers, error codes with precedence and declared ambiguity). |
| Package validator | `packages/engine` | E1 | Structural, semantic and pool checks; held-out checks kept out of practice; package tests run against the evaluator. |
| Package API | `apps/api` | E1 | Tenants and scoped API keys, immutable idempotent import, publishing with reviewer attestation, public JSON Schema and component catalog. |
| Builder CLI | `packages/cli` | E1 | `dismodo validate / import / publish`, human or JSON output. |
| Demo and example packages | `experiences/` | E1 | `parts-of-a-whole@1.0.0` and three documented invalid packages. |
| Session engine | `packages/engine`, `apps/api` | E3 | Event-sourced sessions (append-only log enforced by a database trigger), learner link tokens kept out of URLs, idempotent submissions, evidence report computed only from events. |
| Adaptive decisions | `packages/adaptation`, `apps/api` | E4 | Provider-agnostic decision models (Meta Model API, OpenAI-compatible, Anthropic), Muse Spark routine tier and Muse Wonder critical tier, controller checks, editorial fallback, model-call traces and metrics. |
| Memory per skill | `apps/api`, `packages/engine` | E5 | Short, tenant- and skill-scoped history with recorded effects, learner history view and reset. |
| Web app | `apps/web`, `apps/api` | E6 | Landing per `DESIGN.md` (animated brand from the approved logo, typed phrase, scroll-only reveal), public playground endpoint, learner evidence, web app served by the API. |
| Embeddable session | `apps/web/src/embed.tsx` | E7 | `<dismodo-session>` Web Component in a shadow root, served by the API; CORS limited to learner-link routes. |
| Second product (example) | `examples/acme-onboarding/` | E7 | A separate portal with its own brand and key that publishes its own package, starts sessions with the SDK, embeds the session and shows managers the evidence. |
| MCP server | `apps/mcp` | E8 | Consumer tools `search_experiences`, `start_session`, `get_evidence` over stdio and Streamable HTTP, built on the SDK; tested with the official MCP client and Claude Code. |
| Builder console | `apps/web/src/docs/ConsolePage.tsx`, `apps/api` | E8 | Sessions, evidence, full decision traces, model metrics and the adaptive vs fixed comparison. |
| AI package drafts | `packages/adaptation/src/drafts.ts`, `apps/api`, `packages/cli` | E8 | Muse Wonder (Muse Spark fallback) drafts a package from a builder's notes; the engine validates it and the model repairs once; never stored or published without review. |
| TypeScript SDK | `packages/sdk` | E6 | **Built by Muse Code** from task `docs/muse-tasks/001-sdk.md`; reviewed and merged by the lead engineer (one test type fix). |
| Builder variant package | `examples/acme-onboarding/` | E6 | **Built by Muse Code** acting as a second, independent builder (task `docs/muse-tasks/002-variant-package.md`): `halves-vs-quarters@1.0.0`, valid with no engine changes. |

## Prior materials (created before the hackathon)

| Material | Notes |
| --- | --- |
| Product brief (`DISMODO_BRIEF_HACKATHON.md`) | Founder's product definition. Planning document, not code. |
| UI/UX direction (`DESIGN.md`) | Founder's identity and interface rules (v3.0, Oct 29, 2026). |
| Brand assets (`logo_dismodo.png`, `icono_fondo.png`) | Approved logo and icon provided by the founder; used unchanged (favicons are resized copies of the icon). |

## AI tools used

| Tool | Role |
| --- | --- |
| **Muse Spark 1.3** (Meta Model API) | Runs inside the engine as the routine decision tier: chooses the next support step and the matching reviewed hypothesis from closed lists; every call is traced. |
| **Muse Wonder 1.0** (Meta Model API) | Runs inside the engine as the critical decision tier for escalated moments (rejected hypothesis, repeated mistake, confident but incorrect after support), and drafts experience packages for builders from their notes. |
| **Muse Code with Muse Wonder** (Meta) | Second development agent working from written task specs in isolated git worktrees; built the TypeScript SDK and the Acme variant package. Its commits carry `Co-Authored-By: Muse Code`; every change was reviewed before merge. |
| **Claude Code** (Anthropic Opus 5.5) | Lead engineering agent under the founder's direction; its commits carry `Co-Authored-By: Claude`. |
| **Codex** (OpenAI GPT-6.1) | Read-only design and security reviewer at stage boundaries (contract, isolation, adaptation). Wrote no project code; findings and resolutions are logged in `PLAN_DESARROLLO.md`. |

All AI-generated code and content is reviewed before merge. Grading is done by deterministic evaluators, never by a model.
