# Hackathon scope — DISMODO

**Event:** Meta Global AI Developer Hackathon (Cerebral Valley), building period Oct 26 – Nov 4, 2026
**Track:** Indie Developer · **Problem statement:** Build for Your World
**Participant:** Shamuel Perez (LUCUO SRL), solo

This document separates what was built during the hackathon from prior materials, as the rules require.
It is updated at the end of every build stage.

## Built during the hackathon

All code in this repository was written during the event. The git history is unaltered and shows the timeline.

| Area                  | Location             | Stage | What it is                                                                                         |
| --------------------- | -------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| Repository foundation | root, `.github/`     | E0    | pnpm workspace, strict TypeScript, lint/format, CI with a real Postgres service.                   |
| Contract primitives   | `packages/contracts` | E0    | Identifiers, semantic versions, component references and locales used by experience packages.      |
| API foundation        | `apps/api`           | E0    | Fastify server, validated environment, Postgres connection, health check and standard error shape. |

## Prior materials (created before the hackathon)

| Material                                     | Notes                                                      |
| -------------------------------------------- | ---------------------------------------------------------- |
| Product brief (`DISMODO_BRIEF_HACKATHON.md`) | Founder's product definition. Planning document, not code. |

## AI tools used

| Tool                                  | Role                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Muse Spark** (Meta Model API)       | Runs inside the engine to propose interventions within allowed limits (from stage E4).            |
| **Muse Code with Muse Wonder** (Meta) | Development agent under review; its commits carry `Co-Authored-By: Muse Code`.                    |
| **Claude Code** (Anthropic)           | Lead engineering agent under the founder's direction; its commits carry `Co-Authored-By: Claude`. |

All AI-generated code and content is reviewed before merge. Grading is done by deterministic evaluators, never by a model.
