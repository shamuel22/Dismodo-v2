import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@dismodo/activities';
import { validatePackage } from './validate-package';

const demo = JSON.parse(
  readFileSync(new URL('../../../experiences/parts-of-a-whole/experience.json', import.meta.url), 'utf8'),
);

/** Fresh deep copy of the demo package with a mutation applied. */
function variant(mutate: (pkg: any) => void): unknown {
  const pkg = structuredClone(demo);
  mutate(pkg);
  return pkg;
}

function codes(input: unknown): Array<[string, string]> {
  const result = validatePackage(input, builtinRegistry);
  return result.issues.map((issue) => [issue.path, issue.code]);
}

describe('validatePackage', () => {
  it('accepts the demo package and summarises it', () => {
    const result = validatePackage(demo, builtinRegistry);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({
      candidate_pool: 10,
      practice_pool: 8,
      reserved_checks: 2,
      tests_passed: 5,
      tests_total: 5,
      components: { activity: 'set-selection.v1+r1', evaluator: 'fraction-of-set.v1+r1' },
    });
  });

  it('reports structural problems with JSON pointers', () => {
    expect(
      codes(
        variant((p) => {
          p.version = '1.0';
          p.extra = true;
          delete p.objective;
        }),
      ),
    ).toEqual([
      ['/version', 'invalid_format'],
      ['/objective', 'invalid_type'],
      ['', 'unrecognized_keys'],
    ]);
  });

  it('rejects markup in learner-facing text', () => {
    expect(codes(variant((p) => (p.title = 'Quarters <script>')))).toEqual([['/title', 'custom']]);
  });

  it('rejects documents nested too deeply', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 20; i++) deep = [deep];
    expect(codes(variant((p) => (p.summary = deep)))).toEqual([['', 'too_deep']]);
  });

  it('rejects reserved dictionary keys', () => {
    expect(codes(variant((p) => (p.contexts[0].nouns.constructor = 'x')))).toContainEqual([
      '/contexts/0/nouns/constructor',
      'invalid_key',
    ]);
  });

  it('names unknown and incompatible components with what is registered', () => {
    const result = validatePackage(
      variant((p) => (p.evaluator.ref = 'sql-result.v1')),
      builtinRegistry,
    );
    expect(result.issues[0]).toMatchObject({
      path: '/evaluator/ref',
      code: 'unknown_evaluator',
      hint: 'Registered: fraction-of-set.v1.',
    });
  });

  it('validates activity params with their own schema and semantics', () => {
    expect(codes(variant((p) => (p.activity.params.totals = { min: 2, max: 7 })))).toEqual([
      ['/activity/params/fractions/0', 'no_eligible_total'],
    ]);
    expect(codes(variant((p) => (p.activity.params.task = 'guess')))).toEqual([
      ['/activity/params/task', 'invalid_value'],
    ]);
  });

  it('checks template variables per location', () => {
    expect(
      codes(
        variant(
          (p) => (p.contexts[0].scenario_template = 'Mark {{part_size}} of {{total}} {{item_plural}}.'),
        ),
      ),
    ).toEqual([['/contexts/0/scenario_template', 'unknown_template_variable']]);
    // "state" exists in every context, so explanations may use it; a noun only one context has may not.
    expect(
      codes(
        variant((p) => {
          p.contexts[0].nouns.manager = 'lead';
          p.interventions.editorial.essential.body_template = 'Ask your {{manager}}.';
        }),
      ),
    ).toEqual([['/interventions/editorial/essential/body_template', 'unknown_template_variable']]);
    expect(codes(variant((p) => (p.contexts[1].scenario_template = 'Broken {{total}')))).toEqual([
      ['/contexts/1/scenario_template', 'malformed_placeholder'],
    ]);
  });

  it('requires every context to fill the activity slots', () => {
    expect(codes(variant((p) => delete p.contexts[2].nouns.item_plural))).toContainEqual([
      '/contexts/2/nouns',
      'missing_context_slot',
    ]);
  });

  it('cross-checks interventions, editorial content and confusions', () => {
    expect(
      codes(
        variant((p) => {
          delete p.interventions.editorial.contrast;
          p.confusions[0].suggested.push('analogy');
          p.confusions[1].signals.push('made_up_code');
        }),
      ),
    ).toEqual([
      ['/interventions/editorial', 'missing_editorial'],
      ['/confusions/0/suggested/2', 'suggestion_not_allowed'],
      ['/confusions/1/signals/1', 'unknown_error_code'],
    ]);
    expect(
      codes(
        variant((p) => {
          p.contexts = [p.contexts[0]];
          p.reserved_checks[0].context_id = 'project-tasks';
        }),
      ),
    ).toEqual([['/interventions/allowed', 'swap_needs_contexts']]);
  });

  it('checks excluded phrases literally and case-insensitively', () => {
    expect(codes(variant((p) => (p.objective = 'Obviously find one quarter of a set.')))).toEqual([
      ['/objective', 'tone_violation'],
    ]);
    // A phrase with regex characters is matched as plain text, never compiled.
    expect(codes(variant((p) => p.tone.must_not_phrases.push('(a+)+$')))).toEqual([]);
  });

  it('keeps reserved checks valid, distinct and out of practice', () => {
    // Same problem in another context is still the same problem.
    expect(
      codes(
        variant((p) => (p.reserved_checks[1].spec = { task: 'select', total: 28, fraction: { n: 1, d: 4 } })),
      ),
    ).toEqual([
      ['/reserved_checks/1/spec', 'duplicate_reserved_check'],
      ['/reserved_checks', 'not_enough_reserved_checks'],
    ]);
    expect(
      codes(
        variant((p) => (p.reserved_checks[1].spec = { task: 'select', total: 36, fraction: { n: 2, d: 8 } })),
      ),
    ).toEqual([
      ['/reserved_checks/1/spec/fraction', 'fraction_not_allowed'],
      ['/reserved_checks', 'not_enough_reserved_checks'],
    ]);
    expect(
      codes(
        variant((p) => (p.reserved_checks[0].spec = { task: 'select', total: 16, fraction: { n: 1, d: 4 } })),
      ),
    ).toEqual([
      ['/reserved_checks/0/spec/total', 'not_diagnostic'],
      ['/reserved_checks', 'not_enough_reserved_checks'],
    ]);
    expect(codes(variant((p) => (p.reserved_checks[0].context_id = 'kitchen')))).toEqual([
      ['/reserved_checks/0/context_id', 'unknown_context'],
    ]);
    expect(codes(variant((p) => (p.session_policy.independent_items = 3)))).toEqual([
      ['/reserved_checks', 'not_enough_reserved_checks'],
    ]);
    expect(codes(variant((p) => (p.activity.params.totals = { min: 8, max: 20 })))).toEqual([
      ['/reserved_checks/0/spec/total', 'total_out_of_range'],
      ['/reserved_checks/1/spec/total', 'total_out_of_range'],
      ['/reserved_checks', 'not_enough_reserved_checks'],
      ['/activity/params', 'practice_pool_too_small'],
    ]);
  });

  it('fails when the practice pool cannot cover a session', () => {
    const result = validatePackage(
      variant((p) => (p.activity.params.totals = { min: 8, max: 36 })),
      builtinRegistry,
    );
    // 8,12,20,24,28,32,36 → 7 candidates, 2 reserved → 5 left, session needs 3 + baseline + example = 5
    expect(result.ok).toBe(true);
    expect(
      codes(
        variant((p) => {
          p.activity.params.totals = { min: 8, max: 36 };
          p.session_policy.practice_items = 4;
        }),
      ),
    ).toEqual([['/activity/params', 'practice_pool_too_small']]);
  });

  it('runs package tests against the evaluator', () => {
    expect(codes(variant((p) => (p.tests[0].expect.correct = false)))).toEqual([['/tests/0', 'test_failed']]);
    expect(codes(variant((p) => (p.tests[1].expect.error_code = 'count_equals_denominator')))).toEqual([
      ['/tests/1', 'test_failed'],
    ]);
    expect(codes(variant((p) => (p.tests[1].response = { pick: ['e1'] })))).toContainEqual([
      '/tests/1/response',
      'invalid_union',
    ]);
  });
});
