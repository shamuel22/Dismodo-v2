# DISMODO

**An adaptive learning engine for builders and AI agents.**

Live at **[dismodo.org](https://dismodo.org)** · [Documentation](https://dismodo.org/docs) ·
[Playground](https://dismodo.org/docs/playground) · [`llms.txt`](https://dismodo.org/llms.txt) · MCP at
`https://dismodo.org/mcp`

> The best learning methodology is the one that adapts to the context, the learning objective, the available
> resources and the learners' profile.

Learning something new can be hard, even when you want to learn it. Often the idea is not the problem: the
example is unfamiliar, a step is too big, or a small confusion repeats. Too often one struggle turns into an
identity: _"I'm bad at math."_

DISMODO treats a struggle as a question to investigate. Builders define **what** to teach and **how to check it**;
DISMODO runs the session, adapts the support to the evidence, and returns a report of what happened, including
what has not been checked yet. It runs inside your product, with your brand, through an API, an SDK, an embeddable
Web Component or an MCP server.

## What it does

A learner is asked to mark one quarter of a team's 20 matches as won. They tap **"I don't know this example"**.
The same problem comes back as _"Your project has 20 tasks"_: the example changed, the goal did not. Later they
mark 6 of 8 tasks and say they are sure. Confident, but wrong, right after an explanation: a critical moment, so
the engine escalates from **Muse Spark** to **Muse Wonder**, which picks _contrast_ from the moves the package allows
and the matching hypothesis the builder reviewed. The learner can disagree with that hypothesis; their words guide
the next step but never change a result. Then come new problems held out from practice, with no hints, graded by a
deterministic evaluator.

| Evidence                              | What DISMODO does                                                      |
| ------------------------------------- | ---------------------------------------------------------------------- |
| "I don't know this example"           | Same problem in a context the learner knows; not counted as an error.  |
| Correct but unsure                    | A short restatement or worked example, then a new item.                |
| Confident but wrong after support     | Escalates to the critical model; contrasts the asked part.             |
| The same mistake twice                | Escalates to the critical model before choosing the next move.         |
| Low time or energy                    | Shortens today's practice without judging ability.                     |
| A model times out or returns nonsense | The package's reviewed editorial route takes over; the call is traced. |

## How it works

```
Builder ──► experience package (JSON, versioned)
            objective · activity · evaluator · familiar contexts · known confusions · reviewed explanations
            │  dismodo validate → structure, meaning and the package's own tests, before anything ships
            ▼
DISMODO engine ── event-sourced session (append-only log) ── deterministic evaluator grades every answer
            │
            ├─ adaptation: Muse Spark (routine) / Muse Wonder (critical) choose ONE move from a closed list;
            │  a controller enforces the package's limits; learner-facing text is always reviewed content
            │
            └─ evidence: computed only from events — observed, interpreted (and by whom), what the learner
               said, and what has not been checked yet
            ▼
Your product  ◄── REST API · TypeScript SDK · <dismodo-session> Web Component · MCP for AI assistants
```

- **Models choose, they don't grade.** A model may only pick an intervention and a confusion id from the package's
  closed lists. Grading is deterministic. Every call (model, tier, latency, tokens, outcome) is recorded and shown in
  the builder console.
- **Two tiers.** `muse-spark-1.3` handles routine decisions within an 8 s budget. `muse-wonder-1.0` handles
  escalations: a rejected hypothesis, the same mistake twice, or confident-but-wrong after an explanation. Each
  session gets at most two critical calls. Providers are pluggable (Meta, OpenAI-compatible, Anthropic).
- **Memory per skill.** The last 5 sessions (90 days) per product, learner and skill, with every effect recorded
  and a reset.
- **Your brand, your data.** Each product (tenant) has its own keys, packages and learners, and identifies
  learners by pseudonymous refs. Learner links carry their token after `#`, so it never reaches server logs.
- **Extensible.** New activity families plug in as adapters ([guide](https://dismodo.org/docs/adapters)). A
  second builder ([Acme Onboarding](examples/acme-onboarding)) shipped its own package with no engine changes.

## Try it

**In the browser:** open the [playground](https://dismodo.org/docs/playground) and play a session; the decision
trace updates live.

**From an AI assistant (MCP):** tools `search_experiences`, `start_session` and `get_evidence`, over Streamable HTTP:

```json
{
  "mcpServers": {
    "dismodo": {
      "type": "http",
      "url": "https://dismodo.org/mcp",
      "headers": { "Authorization": "Bearer dsm_..." }
    }
  }
}
```

**From your backend:**

```bash
curl -X POST https://dismodo.org/v1/sessions \
  -H "Authorization: Bearer dsm_..." -H "Content-Type: application/json" \
  -d '{"experience": "parts-of-a-whole", "learner_ref": "learner-42", "declared": {"familiar_contexts": ["project-tasks"]}}'
# → { "session": { "session_id": "…", "url": "https://dismodo.org/s/#…" } }  give the url to the learner
curl https://dismodo.org/v1/sessions/<session_id>/evidence -H "Authorization: Bearer dsm_..."
```

```html
<!-- or embed the session in your own page -->
<script type="module" src="https://dismodo.org/embed/dismodo-session.js"></script>
<dismodo-session token="…" api="https://dismodo.org"></dismodo-session>
```

Start from the [Quickstart](https://dismodo.org/docs/quickstart). Packages follow a published
[JSON Schema](https://dismodo.org/v1/schemas/experience.json).

## Repository

| Path                           | What it is                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `packages/contracts`           | Zod contracts: packages, interventions, events, adapters                         |
| `packages/activities`          | Activity families and evaluators (`set-selection.v1`, `fraction-of-set.v1`)      |
| `packages/engine`              | Package validator, event-sourced session engine, evidence report                 |
| `packages/adaptation`          | Decision models (Meta, OpenAI-compatible, Anthropic), escalation, package drafts |
| `packages/sdk`, `packages/cli` | TypeScript SDK; `dismodo validate / import / publish / draft`                    |
| `apps/api`                     | Fastify + PostgreSQL API; serves the web app, docs and `llms.txt`                |
| `apps/web`                     | Docs portal, playground, builder console, learner session, `<dismodo-session>`   |
| `apps/mcp`                     | MCP server (stdio and Streamable HTTP)                                           |
| `examples/acme-onboarding`     | A second product built on DISMODO, with its own brand, key and package           |
| `experiences/`                 | Reference package `parts-of-a-whole@1.0.0` and documented invalid examples       |
| `deploy/`                      | Docker images, production compose, Caddy, Cloudflare Tunnel variant, backups     |

## Run it locally

Requirements: Node 24, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env      # add META_API_KEY for the adaptive route (without it, the reviewed editorial route runs)
pnpm db:up && pnpm seed   # Postgres 17 on localhost:5434 + reference package
pnpm dev:api              # API, docs and web app on http://localhost:4100
pnpm check                # lint, format, typecheck and tests (unit + integration against Postgres)
pnpm acceptance           # end-to-end acceptance checks A1–A11, including live MCP
```

Production deployment: [`deploy/README.md`](deploy/README.md).

## Built for the Meta Global AI Developer Hackathon

Indie Developer track · _Build for Your World_. Meta models run inside the product: **Muse Spark** and **Muse
Wonder** make the adaptive decisions, and Muse Wonder drafts packages for builders. **Muse Code** built parts of the
repository (SDK, deployment files, adapters guide, the second builder's package). What was built during the event
and which AI tools were used: [`HACKATHON_SCOPE.md`](HACKATHON_SCOPE.md).

## License

MIT © 2026 Shamuel Perez
