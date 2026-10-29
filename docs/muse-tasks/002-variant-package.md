# Muse task 002 — builder variant package `halves-vs-quarters@1.0.0`

You are working in a git worktree of DISMODO, an adaptive learning engine. Builders contribute experiences as
versioned JSON packages; the engine validates and runs them. Read first:
`experiences/parts-of-a-whole/experience.json` (reference package), `experiences/invalid/README.md`,
`packages/contracts/src/package.ts` (contract), `packages/activities/src/set-selection.ts` and
`packages/activities/src/fraction-of-set.ts` (the activity family and evaluator you must use),
`packages/engine/src/validate-package.ts` (what validation checks).

## Goal

Act as a second, independent builder ("Acme Onboarding", a workplace training product) and author a variant
that changes the **objective and condition** within the supported family, not just the look:
learners **identify** whether a marked part of a set is one half or one quarter (or three quarters), instead of
selecting one quarter.

## Allowed files

Create only:

- `examples/acme-onboarding/experiences/halves-vs-quarters/experience.json`
- `examples/acme-onboarding/experiences/halves-vs-quarters/README.md` (what it teaches, why each confusion and
  context exists, how to validate/import it)
  Do not modify any other file. Do not change engine code: the point is that a builder needs none.

## Requirements

- `schema: "dismodo.experience/1"`, `experience_id: "halves-vs-quarters"`, `version: "1.0.0"`, `locale: "en"`.
- `activity.ref: "set-selection.v1"` with `task: "identify"`, fractions 1/2, 1/4 and 3/4,
  `identify_options` listing exactly those three (distinct values), totals range chosen so the practice pool is
  large enough after reserving checks.
- `evaluator.ref: "fraction-of-set.v1"`, `config: {}`.
- Skill: `{ "id": "halves-and-quarters", "name": "Halves and quarters of a set" }`.
- At least two contexts relevant to workplace onboarding (e.g. a shift roster, a delivery of parcels, onboarding
  checklist items), each with `nouns` (`whole`, `item_singular`, `item_plural`, plus any extra noun shared by all
  contexts), a `scenario_template` that may only use `{{total}}`, `{{marked_count}}` and context nouns (the
  activity forbids revealing the fraction in identify prompts), and honest `limits`.
- Confusions using only evaluator codes for identify items: `chose_complement`, `wrong_numerator`,
  `wrong_fraction`, each with suggested interventions that are in `interventions.allowed`.
- Interventions: allow at least `essential`, `worked-example`, `contrast`, `swap-context`, `fade-support`;
  reviewed editorial content for every allowed explanation-kind intervention, using only explanation variables
  (`total`, `numerator`, `denominator`, `fraction_text`, `fraction_symbol`, `part_size`, `group_size`,
  `group_count`, `remaining`) and nouns shared by all contexts.
- `hints`: 2–3 progressive hints. `session_policy` similar to the reference (baseline true, short session).
- Tone: adult, respectful, plain English; include `must_not_phrases` like the reference.
- `reserved_checks`: at least as many distinct problems as `independent_items`, valid under the params.
- `tests`: at least 6, covering a correct choice, an equivalent fraction (e.g. 2/4 for 1/2), and each
  confusion code.
- Plain text only (no `<` or `>`), all ids kebab-case.

## Verify before finishing

From the worktree root:

```
pnpm install --offline || pnpm install
pnpm dismodo validate examples/acme-onboarding/experiences/halves-vs-quarters/experience.json
```

It must print "is a valid package" with all tests passing. Then commit on the current branch with a message
ending with:
`Co-Authored-By: Muse Code <noreply@meta.com>`
