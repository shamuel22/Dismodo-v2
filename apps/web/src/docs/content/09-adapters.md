---
slug: adapters
title: Adapters
nav: Adapters
status: Preview
---

# Adapters

**Status: Preview.** An adapter is reviewed code in the engine that defines one activity family or one grader. Builders never ship code: a package names an adapter by its `ref` and configures it with data. This page is for engineers adding a new family. If you only need new content, write a package instead — see [Experience packages](/docs/packages).

The contracts are `ActivityAdapter` and `EvaluatorAdapter` in `packages/contracts/src/components.ts`. The one family shipped today is `set-selection.v1` with its grader `fraction-of-set.v1`, in `packages/activities`. Read those two files alongside this page; they are the reference implementation.

## When you need an adapter, and when a package is enough

A package is enough when the new content fits a family that already exists. Changing the objective, the contexts and their nouns, the fractions and totals in `params`, the hints, the reserved checks or the package tests is package work. The example `halves-vs-quarters@1.0.0` changes the objective and condition of `set-selection.v1` with no engine change.

You need a new adapter when the kind of item itself changes: a different item shape, a different response shape, a different way of generating candidate items, or a different notion of a correct answer. Ordering steps of a procedure, for example, cannot be expressed as marking a fraction of a set, so it needs a new `ActivityAdapter`. If the grading logic changes — new error patterns to recognise, a new idea of equivalent answers — it also needs a new (or revised) `EvaluatorAdapter` whose `activityRefs` names the activity.

Adapters are registered in code and reviewed like any other engine change. There is no upload path for them, and a package that names an unregistered `ref` fails validation.

## The ActivityAdapter contract

An `ActivityAdapter<Params, Spec, Response, View>` has four type parameters: what a builder may configure, what one item is, what a learner may answer, and what the runtime renders. The engine relies on every member below; leaving one vague breaks a check somewhere else.

### Identity: `ref`, `revision`, `description`

`ref` is the string a package writes in `activity.ref` (for example `set-selection.v1`). It is the lookup key in the registry and never changes for a given family.

`revision` is the implementation revision (for example `set-selection.v1+r1`). When a package is validated, the summary records the revisions it resolved to. When a session starts, `session_started` records those revisions, and every `evaluated` event records the evaluator revision. A session therefore pins the exact code that generated and graded its items, so behaviour cannot change under a running package. Any change that alters generation, rendering or grading needs a new `revision` value.

`description` is a plain sentence or two saying what the family does. It is shown where registered components are listed (`GET /v1/components`).

### `paramsSchema`

A Zod schema for the builder-facing configuration. Validation parses `activity.params` with it before anything else about the activity runs; a parse failure is reported with JSON Pointer paths under `/activity/params`. Keep it strict (`z.strictObject` in the shipped family) so misspelled keys fail instead of being ignored. The schema carries what a schema can carry: types, bounds, allowed values. Anything it cannot express belongs in `checkParams`.

### `checkParams(params)`

Semantic checks on already-parsed params, returning a list of `ValidationIssue` values (`{ path, code, message, hint? }`). Paths are relative to the params; validation prefixes them with `/activity/params`. Return an empty list when the params are sound.

This is where cross-field rules live. In `set-selection.v1` it reports, among others: an empty totals range (`totals.min > totals.max`), two fractions with the same value, a fraction for which no total in range gives a usable item, and missing, duplicated or incomplete `identify_options`. Write these checks so that every params value that passes can actually generate items — validation later enumerates the pool and fails if too few practice problems remain.

### `specSchema`

A Zod schema for one item, exactly as a spec is written in a package's `reserved_checks` and `tests`. Validation parses each reserved check and each package test spec with it. A spec is the smallest unit the learner works on: for `set-selection.v1`, a task (`select` or `identify`), a total and a fraction, plus options for `identify` items.

### `responseSchema`

A Zod schema for a learner's response. Validation parses each package test response with it, and the engine parses every `answer` action with it at runtime before grading; a mismatch is rejected as `invalid_response` without reaching the evaluator. For `set-selection.v1` a response is either `{ selected: string[] }` or `{ choice: { n, d } }`, depending on the task.

### `checkSpecAgainstParams(params, spec)`

Whether one spec could be produced under these params. It returns a single `ValidationIssue` or `null` when the spec fits; the path is relative to the spec. Validation calls it for every reserved check, and a misfit is reported under that check's path.

In the shipped family it rejects a spec whose task differs from `params.task`, a fraction not listed in `params.fractions` (written exactly as declared), a total outside the configured range, a non-diagnostic item (one where a common mistake gives the same count as the right answer, so the evaluator could not tell them apart), and options that do not match `identify_options`. If `enumerateSpecs` would never produce a spec, this method should say why.

### `specIdentity(spec)`

A canonical string identifying the underlying problem, independent of context nouns. Two specs with the same identity count as the same exercise, even if they look different: `set-selection.v1` reduces the fraction first, so `1/4` of 20 and `2/8` of 20 on the same task share the identity `select:20:1/4`.

Held-out checks depend on this being right. Validation rejects a second reserved check whose identity is already reserved ("contexts do not make a problem new"), removes every reserved identity from the enumerated pool to form the practice pool, and counts distinct reserved identities against `session_policy.independent_items`. At runtime the engine filters the practice pool by identity so a learner does not meet a reserved problem in practice, and does not repeat a problem already seen in this or an earlier session of the same skill when a fresh one is available. If `specIdentity` is too fine, held-out problems leak into practice. If it is too coarse, distinct problems are wrongly treated as one and pools shrink.

### `enumerateSpecs(params)`

Every spec the generator can produce under these params, deduplicated by `specIdentity`. Validation calls it once per package to size the candidate pool. The runtime calls it again to build the practice pool, so it must be deterministic and free of side effects.

The pool is bounded by `MAX_CANDIDATES` (10,000) from `packages/contracts`. The shipped `enumerateSpecs` throws once the pool exceeds that bound rather than returning an unbounded list. Keep generation narrow enough — through the params ranges — that real packages stay well under it, and use `checkParams` to reject ranges that cannot produce usable items at all.

### `scenarioVariables(params)` and `explanationVariables`

Template variables come in two sets, and the split is a safety property.

`scenarioVariables(params)` returns the variable names a context's scenario template — the learner's prompt — may use under these params. It is a function of params because the answer depends on the task: `set-selection.v1` allows `total`, `fraction_text` and `fraction_symbol` for `select` items, but only `total` and `marked_count` for `identify` items. It must never reveal the answer. For an `identify` item the fraction is the answer, so its text and symbol are withheld; a prompt that named it would give the item away.

`explanationVariables` is a fixed list of names that hint templates and reviewed editorial templates may use. It may include worked quantities the prompt must hide: in the shipped family, `part_size`, `group_size`, `group_count`, `remaining`, `numerator` and `denominator`, alongside the scenario-safe names.

Validation enforces the split. A scenario template may use only its context's nouns plus `scenarioVariables`; hints and editorial templates may use only the nouns shared by every context plus `explanationVariables`. An unknown variable fails validation with the available names listed. `render` must uphold its side of the bargain: put scenario-safe values into the prompt, worked values only into `template_values` for explanations, and never put the answer key in `view`.

### `contextSlots`

The noun slots every context must fill, as a list of names (for example `whole`, `item_singular`, `item_plural`). Contexts may add more nouns, but validation fails any context missing a declared slot. These are the nouns the adapter's own rendering relies on; `render` reads them from `context.nouns` and should fall back sensibly only where the family allows it.

### `render(spec, context, rng)`

Turns one spec into a `RenderedItem`: the spec again, the `context_id`, the learner-facing `prompt` (the context's scenario template filled with nouns and scenario values), the `view` data the runtime renders, and `template_values` available to explanation templates for this item.

The `rng` is a seeded `Rng` (`int`, `pick`, `shuffle`). The engine seeds it per session and per item, so the same session replays exactly. Use only this source for any randomness — which elements are marked, in the shipped family — never `Math.random`. Two renders of the same spec with the same seed must agree, and the test suite checks that. The `view` must never contain the answer key; `set-selection.v1` tests assert the rendered view carries no `part_size`, while `template_values` does hold it for explanations.

## The EvaluatorAdapter contract

An `EvaluatorAdapter<Config, Spec, Response>` is the only component allowed to decide whether a response is correct. It has `ref`, `revision` and `description` with the same meaning as the activity's, plus the members below.

### `configSchema` and `activityRefs`

`configSchema` is a Zod schema for `evaluator.config` in the package (an empty strict object when the grader needs no configuration, as `fraction-of-set.v1` shows). `activityRefs` lists the activity refs this evaluator can grade. Validation rejects a package whose evaluator does not name its activity (`incompatible_evaluator`), and checks that every confusion signal and every expected test error code is one the evaluator declares.

### `evaluate(config, spec, response)`

Returns an `Evaluation`: `correct`, `error_code` (null when correct), `alternative_codes`, and short factual `feedback` derived from the response, with no model involved. Evaluation must be deterministic: the same config, spec and response always give the same result. The engine calls it for every answer and records the outcome, including the evaluator revision, in an `evaluated` event; package tests are also run through it at validation time.

Grading is by meaning, not by exact form, where the family allows equivalent answers. `fraction-of-set.v1` grades `select` items by the number of distinct valid elements chosen — any subset of the right size is correct, duplicates ignored — and `identify` items by fraction value, so `2/8` is as correct as `1/4`. Decide what equivalence means for your family and encode it here, in one place.

### `errorCodes`, precedence and `alternative_codes`

`errorCodes` declares every error code the evaluator may return, with what it means, in precedence order. Only declared codes may ever be returned; the test suite sweeps responses and asserts every reported code is declared. Package confusions may only signal declared codes, and a package test may only expect a declared code.

When a response is wrong, report the first matching code in that order as `error_code`. When the same response matches several patterns equally well, the first still wins, but the rest go in `alternative_codes`, in precedence order. A non-empty list means the response alone cannot tell the confusions apart; the controller may then ask for a check that does. For `3/4` of 20, selecting 5 matches both `selected_complement` (the rest of the set) and `single_group_only` (one equal group), so the result is `error_code: "selected_complement"` with `alternative_codes: ["single_group_only"]`. Do not guess between confusions the evidence cannot separate, and do not leave `alternative_codes` empty when two codes genuinely explain the same response.

Invalid responses come first in the order: a response of the wrong shape, or naming elements that are not in the item, is `invalid_response` before any misconception is considered.

## Registering components

Build a registry with `createRegistry(activities, evaluators)` from `packages/activities/src/registry.ts` and pass it wherever packages are validated or sessions run. The `builtinRegistry` in `packages/activities` is built this way from the shipped components. Registration is plain code:

```ts
export const builtinRegistry: ComponentRegistry = createRegistry(
  [setSelection as ActivityAdapter],
  [fractionOfSet as EvaluatorAdapter],
);
```

Duplicate `ref` values within either list throw at registry construction. Lookups return `undefined` for unknown refs, which validation turns into `unknown_activity` or `unknown_evaluator` with the registered refs listed as a hint.

Once an adapter is registered, package validation checks the following automatically — the adapter author writes no validation code for any of it:

- The activity and evaluator exist, and the evaluator's `activityRefs` includes the activity.
- `activity.params` parses against `paramsSchema`, then `checkParams` issues are reported under `/activity/params`. `evaluator.config` parses against `configSchema`. Pool and test checks only run when params and config are sound.
- Every context fills every `contextSlots` noun, and every scenario template uses only nouns plus `scenarioVariables`, with well-formed `{{name}}` placeholders.
- Hint and editorial templates use only shared nouns plus `explanationVariables`.
- Every confusion signal and every expected test `error_code` is declared in the evaluator's `errorCodes`.
- Every reserved check parses against `specSchema`, satisfies `checkSpecAgainstParams`, and has a distinct `specIdentity`.
- `enumerateSpecs` sizes the candidate pool; after reserved identities are removed, enough practice problems must remain for practice items, the optional baseline item and one worked example, and enough distinct reserved checks must exist for `session_policy.independent_items`.
- Every package test runs through `evaluate`: its spec and response parse against `specSchema` and `responseSchema`, and the result must match the expected `correct` and, when given, `error_code`.

At runtime the same registry supplies the components a session pins: `buildRuntime` re-validates the package, parses params and reserved specs once more, builds the practice pool from `enumerateSpecs` minus reserved identities, and `render` and `evaluate` are called with those parsed values.

## Illustrative skeleton: ordering steps

_Illustrative only — this family does not exist in the engine._ It shows the shape of a tiny family, "put the steps of a procedure in order", with the detail left out. A real adapter needs full schemas, checks and tests (next section).

```ts
import { z } from 'zod';
import {
  MAX_CANDIDATES,
  renderTemplate,
  type ActivityAdapter,
  type EvaluatorAdapter,
} from '@dismodo/contracts';

// Params: the procedures a builder may draw on. Spec: one concrete ordering item, its
// steps in correct order. Response: the learner's ordering, as step ids.
// View: the same steps, shuffled for display through the seeded rng.
const Procedure = z.strictObject({
  id: z.string().min(1),
  steps: z.array(z.string().min(1)).min(3),
});
export const StepOrderParams = z.strictObject({
  procedures: z.array(Procedure).min(1),
  step_counts: z.strictObject({ min: z.int().min(3), max: z.int().min(3) }),
});
export const StepOrderSpec = z.strictObject({
  procedure_id: z.string().min(1),
  steps: z.array(z.string().min(1)).min(3), // in correct order
});
export const StepOrderResponse = z.strictObject({
  ordered: z.array(z.string().min(1)),
});
type StepOrderSpec = z.infer<typeof StepOrderSpec>;
type StepOrderResponse = z.infer<typeof StepOrderResponse>;

export const stepOrder: ActivityAdapter<
  z.infer<typeof StepOrderParams>,
  StepOrderSpec,
  StepOrderResponse,
  { steps: string[] }
> = {
  ref: 'step-order.v1',
  revision: 'step-order.v1+r1',
  description: 'The learner puts the shuffled steps of a familiar procedure in order.',
  paramsSchema: StepOrderParams,
  specSchema: StepOrderSpec,
  responseSchema: StepOrderResponse,
  contextSlots: ['procedure'],
  scenarioVariables: () => ['step_count'],
  explanationVariables: ['step_count', 'first_step', 'last_step'],

  checkParams: (params) =>
    params.step_counts.min > params.step_counts.max
      ? [
          {
            path: '/step_counts',
            code: 'empty_range',
            message: 'step_counts.min is greater than step_counts.max.',
          },
        ]
      : [],
  checkSpecAgainstParams: (params, spec) => {
    const procedure = params.procedures.find((p) => p.id === spec.procedure_id);
    if (!procedure)
      return {
        path: '/procedure_id',
        code: 'procedure_not_allowed',
        message: 'Not one of params.procedures.',
      };
    if (spec.steps.join('\n') !== procedure.steps.join('\n'))
      return {
        path: '/steps',
        code: 'steps_mismatch',
        message: 'Not the steps of this procedure.',
      };
    return null;
  },
  specIdentity: (spec) => `${spec.procedure_id}:${spec.steps.join('>')}`,
  enumerateSpecs: (params) => {
    const specs = params.procedures
      .filter((p) => p.steps.length >= params.step_counts.min && p.steps.length <= params.step_counts.max)
      .map((p) => ({ procedure_id: p.id, steps: p.steps }));
    if (specs.length > MAX_CANDIDATES) throw new Error('Candidate pool exceeds MAX_CANDIDATES.');
    return specs;
  },
  render: (spec, context, rng) => ({
    spec,
    context_id: context.id,
    // Only {{procedure}} (a noun) and {{step_count}} (a scenario variable) may appear here.
    prompt: renderTemplate(context.scenario_template, {
      ...context.nouns,
      step_count: spec.steps.length,
    }),
    view: { steps: rng.shuffle(spec.steps) },
    template_values: {
      ...context.nouns,
      step_count: spec.steps.length,
      first_step: spec.steps[0]!,
      last_step: spec.steps.at(-1)!,
    },
  }),
};

export const stepOrderGrader: EvaluatorAdapter<Record<string, never>, StepOrderSpec, StepOrderResponse> = {
  ref: 'step-order-grader.v1',
  revision: 'step-order-grader.v1+r1',
  description: 'Grades an ordering by how it differs from the correct order.',
  configSchema: z.strictObject({}),
  activityRefs: ['step-order.v1'],
  errorCodes: {
    invalid_response: 'The response does not fit the item (wrong shape or unknown steps).',
    reversed: 'The steps are in reverse order.',
    first_step_wrong: 'The first step is not the first step of the procedure.',
    order_wrong: 'The steps are in the wrong order.',
  },
  evaluate: (_config, spec, response) => {
    const fail = (error_code: string, feedback: string) => ({
      correct: false,
      error_code,
      alternative_codes: [] as string[],
      feedback,
    });
    if (
      response.ordered.length !== spec.steps.length ||
      response.ordered.some((id) => !spec.steps.includes(id))
    )
      return fail('invalid_response', 'Arrange every step shown.');
    if (response.ordered.every((id, i) => id === spec.steps[i]))
      return {
        correct: true,
        error_code: null,
        alternative_codes: [],
        feedback: 'In order.',
      };
    const reversed = [...spec.steps].reverse();
    if (response.ordered.every((id, i) => id === reversed[i]))
      return fail('reversed', 'The steps run backwards.');
    if (response.ordered[0] !== spec.steps[0])
      return fail('first_step_wrong', 'That is not how the procedure starts.');
    return fail('order_wrong', 'Some steps are out of order.');
  },
};
```

Note what the skeleton must not do: `scenarioVariables` offers only `step_count`, never the correct order; `render` shuffles through the seeded `rng` and keeps the correct order out of `view`; `specIdentity` names the procedure and its correct order, so the same procedure in another context is still the same held-out problem.

## Testing expectations

A new adapter is not done when it compiles. Follow `packages/activities/src/set-selection.test.ts`: property-style tests that run over every enumerated spec, not a handful of examples.

At minimum, cover the following:

- **Generation.** For sound params, `enumerateSpecs` returns many specs; their `specIdentity` values are all distinct; every spec satisfies `checkSpecAgainstParams` (returns null); and every spec is usable by the family's own diagnostic rules. Also test identities directly: two specs that are the same problem under different surface forms share an identity.
- **Params.** Sound params give `checkParams` `[]`. Broken params give the expected `[path, code]` pairs, in order — empty ranges, duplicates, values with no eligible item, missing options.
- **Rendering.** Rendering with a fixed seed is reproducible: two renders with `seededRng(42)` agree. The prompt equals the expected filled template. The view has the expected shape and never contains the answer, while `template_values` holds the worked values explanations need. `scenarioVariables` excludes anything that would name the answer where the task requires hiding it.
- **Grading, over every enumerated spec.** A correct response is accepted for every spec the generator can produce — in the shipped tests, every subset of the right size for every enumerated `select` item. Duplicates in a response are handled as the evaluator promises. Wrong responses give the expected `error_code` and `alternative_codes`, including a case where two confusions explain the same response and both are reported. Unknown elements and wrong response shapes give `invalid_response`. Equivalent answers (such as `2/8` for `1/4`) are accepted.
- **Declared codes only.** Sweep a range of responses and assert every non-null `error_code` (and every `alternative_codes` entry) is a key of `errorCodes`.

Run the family's tests with the workspace test command before asking for review.
