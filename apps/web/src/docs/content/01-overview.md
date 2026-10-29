---
slug: ''
title: What is DISMODO
nav: Overview
---

# What is DISMODO

DISMODO is an adaptive learning engine. You bring what to teach and how to check it; DISMODO runs the session, adapts the support to each learner and returns evidence of what happened.

It is meant to sit inside **your** product. Your learners never have to see the DISMODO brand, a course catalog or a chat window.

## How it works, in one pass

1. **You describe an experience** in a versioned JSON package: the objective, the activity and its evaluator, familiar contexts, known confusions, reviewed explanations and hints.
2. **DISMODO validates it** — structure, meaning and the package's own tests — before it can be published.
3. **You start a session** for a learner and get a link (or drive it through the API from your own interface).
4. **The engine runs the session**: a starting item, practice with support, then new held-out problems with no hints.
5. **Adaptation happens between steps.** When an answer or a self-rating calls for it, a decision model (Muse Spark, or Muse Wonder for harder moments) picks the next support step from what your package allows. A deterministic controller enforces the limits; the reviewed editorial route takes over if a model is unavailable.
6. **You read the evidence**, computed only from validated events: what was observed, what was interpreted and by whom, what the learner said, and what has not been checked yet.

## What it is not

- **Not a chatbot.** Sessions are activities with state and grading, not open conversation.
- **Not a grader made of prompts.** Only the package's evaluator decides whether an answer is correct.
- **Not a learner profile.** Evidence is kept per skill, scoped to your product, and can be reset by the learner.

## Where to go next

- [Quickstart](/docs/quickstart) — run it locally and play a session in a few minutes.
- [Try it in the playground](/docs/playground) — no key needed.
- Integrations: [API](/docs/api) · [MCP](/docs/mcp) · [SDK](/docs/sdk)
