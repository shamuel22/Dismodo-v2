# Muse task 004 — documentation page "Adapters": adding a new activity family

You are working in a git worktree of DISMODO. Builders configure experiences with JSON packages; when they need a
new kind of activity, an engineer adds a reviewed **adapter** in code. Read first:
`packages/contracts/src/components.ts` (ActivityAdapter, EvaluatorAdapter, ComponentRegistry),
`packages/activities/src/set-selection.ts`, `packages/activities/src/fraction-of-set.ts`,
`packages/activities/src/registry.ts`, `packages/activities/src/set-selection.test.ts`,
`packages/engine/src/validate-package.ts`, and the existing docs in `apps/web/src/docs/content/*.md`
(follow their tone, front matter and structure exactly).

## Goal

Write `apps/web/src/docs/content/09-adapters.md` with front matter:

```
---
slug: adapters
title: Adapters
nav: Adapters
status: Preview
---
```

Content (plain, precise English; 60–75 character reading lines are handled by CSS, just write paragraphs):

1. When you need an adapter (new activity family) vs. when a package is enough (new content in a family).
2. The `ActivityAdapter` contract, method by method, with what the engine relies on each for (params schema and
   `checkParams`, spec schema, `specIdentity` and why held-out checks depend on it, `enumerateSpecs` and the
   MAX_CANDIDATES bound, `scenarioVariables` vs `explanationVariables` and why prompts must not reveal answers,
   `contextSlots`, `render` with a seeded RNG, `revision` pinning).
3. The `EvaluatorAdapter` contract: deterministic grading, `errorCodes` in precedence order, `alternative_codes`
   for ambiguous answers, equivalent answers.
4. Registering components and what validation then checks automatically.
5. A short, illustrative skeleton (clearly labelled "Illustrative") of a tiny new family — for example ordering
   steps of a procedure — showing the shape only. Do not claim it exists.
6. Testing expectations: property tests over every enumerated spec, as `set-selection.test.ts` does.
   Only describe behaviour that exists in the code. No invented APIs or npm packages.

## Allowed files

Create only `apps/web/src/docs/content/09-adapters.md`. Modify nothing else.

## Verify before finishing

```
pnpm install --offline || pnpm install
pnpm --filter @dismodo/web typecheck
pnpm exec prettier --check apps/web/src/docs/content/09-adapters.md || pnpm exec prettier --write apps/web/src/docs/content/09-adapters.md
```

Commit on the current branch with a message ending with:
`Co-Authored-By: Muse Code <noreply@meta.com>`
