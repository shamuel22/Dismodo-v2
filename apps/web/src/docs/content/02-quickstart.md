---
slug: quickstart
title: Quickstart
nav: Quickstart
---

# Quickstart

Run DISMODO on your machine, publish the sample experience and play one session. You need Node 24, pnpm 11 and Docker.

## 1. Start the engine

```bash
git clone https://github.com/shamuel22/Dismodo-v2.git dismodo && cd dismodo
pnpm install
cp .env.example .env          # add META_API_KEY to enable Muse Spark / Muse Wonder decisions
pnpm db:up                    # PostgreSQL 17 on localhost:5434
pnpm seed                     # publishes the sample experience parts-of-a-whole@1.0.0
pnpm dev:api                  # API on http://localhost:4100
```

Without `META_API_KEY` everything still works: sessions follow the package's reviewed editorial route, and every decision says so in its trace.

## 2. Create a key for your product

Each product that builds on DISMODO is a **tenant** with its own keys and data.

```bash
pnpm tenant:create --slug acme --name "Acme Onboarding"
# prints an API key once: dsm_xxxxxxxxxxxx_...
export DISMODO_API_KEY=dsm_...
```

## 3. Validate and publish your own package

```bash
pnpm dismodo validate examples/acme-onboarding/experiences/halves-vs-quarters/experience.json
pnpm dismodo import   examples/acme-onboarding/experiences/halves-vs-quarters/experience.json
pnpm dismodo publish  halves-vs-quarters@1.0.0 --reviewer "Your Name"
```

Publishing asks for a reviewer: validation proves structure and behaviour, not that the prose is accurate.

## 4. Start a session

```bash
curl -s http://localhost:4100/v1/sessions \
  -H "Authorization: Bearer $DISMODO_API_KEY" -H "Content-Type: application/json" \
  -d '{"experience": "halves-vs-quarters", "learner_ref": "learner-001"}'
```

The response has a `session.url`. Open it in a browser: that is the learner's page. Use your own pseudonymous `learner_ref`, never an email or a name.

## 5. Read the evidence

```bash
curl -s http://localhost:4100/v1/sessions/<session_id>/evidence \
  -H "Authorization: Bearer $DISMODO_API_KEY"
```

Next: [Experience packages](/docs/packages) explains every field you just published.
