---
slug: packages
title: Experience packages
nav: Experience packages
---

# Experience packages

A package is a versioned JSON document that describes one experience. It is data, never code: the activity and evaluator it uses are reviewed components registered in the engine.

The full JSON Schema is published at [`/v1/schemas/experience.json`](/v1/schemas/experience.json), and the registered components (with their parameter, item and response schemas, template variables and error codes) at [`/v1/components`](/v1/components).

## The main fields

| Field                      | What it holds                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `experience_id`, `version` | Kebab-case id and semantic version. A published version never changes.                                          |
| `objective`                | One learner-facing sentence. It stays fixed while support adapts.                                               |
| `skill`                    | The skill evidence is kept under (per product).                                                                 |
| `activity`                 | `ref` of a registered activity (e.g. `set-selection.v1`) and its `params`.                                      |
| `evaluator`                | `ref` of the grader (e.g. `fraction-of-set.v1`). Only it decides correctness.                                   |
| `contexts`                 | Familiar references (a work project, a box of markers…), each with nouns, a scenario template and its `limits`. |
| `confusions`               | Known mix-ups, the evaluator error codes that signal them, and suggested interventions.                         |
| `interventions`            | Which support steps are allowed, with reviewed editorial content for each explanation.                          |
| `hints`                    | Progressive hints for practice items.                                                                           |
| `tone`                     | Guidance and phrases that must never appear.                                                                    |
| `session_policy`           | Time budget, starting item, practice items, independent checks, hint and intervention limits.                   |
| `reserved_checks`          | Held-out problems for the independent check, never used in practice.                                            |
| `tests`                    | Responses with their expected grading, run against the evaluator at import.                                     |

## Templates

Text fields can use `{{variable}}` placeholders from a closed set: the context's nouns plus the activity's variables. Prompts may only use variables that do not reveal the answer — for an "identify" item, the fraction itself is not available in the prompt. Unknown variables fail validation.

## What validation checks

- Structure, sizes and plain text (no markup), with JSON Pointer paths in every error.
- Components exist and fit together; params are sound (for example, every fraction has a usable total).
- Every allowed explanation has reviewed content; confusions use real error codes and allowed interventions.
- Excluded phrases never appear, matched literally.
- Reserved checks are valid, distinct problems — a new context does not make a problem new — and enough practice problems remain after removing them.
- Every package test passes against the evaluator.

```bash
pnpm dismodo validate path/to/experience.json        # offline, same checks as the API
pnpm dismodo validate path/to/experience.json --json # for scripts and agents
```

Examples of packages that fail, with the messages they produce, are in `experiences/invalid/` in the repository.

## Drafting a package with AI

**Status: Preview.** Describe what you want to teach — audience, settings, typical mistakes — and DISMODO asks a decision model (Muse Wonder, falling back to Muse Spark) to draft a complete package. The engine validates the draft and gives the model one round to repair what validation reports.

```bash
pnpm dismodo draft notes.md --id thirds-in-the-kitchen    # writes thirds-in-the-kitchen.draft.json
```

or `POST /v1/package-drafts` with `{ "source": "…", "experience_id": "…" }`. The draft is never stored or published: you review every fact and sentence, then validate, import and publish it as usual. Validation proves structure and behaviour, not truth.

## Activities available today

| Activity           | Evaluator            | Tasks                                                                                                                     |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `set-selection.v1` | `fraction-of-set.v1` | `select`: mark a fraction of a set. `identify`: say which fraction of a set is marked. Equivalent fractions are accepted. |

New activity families are added as reviewed adapters in the engine; content within a family only needs a package.
