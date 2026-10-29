import { describe, expect, it } from 'vitest';
import { fractionOfSet } from './fraction-of-set';
import { fractionWords, sameValue } from './fractions';
import { seededRng } from './rng';
import {
  isDiagnostic,
  partSize,
  setSelection,
  type SetSelectionParams,
  type SetSelectionSpec,
} from './set-selection';

const context = {
  id: 'project-tasks',
  nouns: { whole: 'project', item_singular: 'task', item_plural: 'tasks' },
  scenario_template: 'A {{whole}} has {{total}} {{item_plural}}. Mark {{fraction_text}} of them as done.',
};
const identifyContext = {
  ...context,
  scenario_template: '{{marked_count}} of the {{total}} {{item_plural}} are done. What fraction is done?',
};

const selectParams: SetSelectionParams = {
  task: 'select',
  fractions: [
    { n: 1, d: 4 },
    { n: 3, d: 4 },
    { n: 1, d: 2 },
    { n: 2, d: 3 },
  ],
  totals: { min: 2, max: 60 },
};
const identifyParams: SetSelectionParams = {
  task: 'identify',
  fractions: [
    { n: 1, d: 2 },
    { n: 1, d: 4 },
  ],
  totals: { min: 4, max: 24 },
  identify_options: [
    { n: 1, d: 2 },
    { n: 1, d: 4 },
    { n: 3, d: 4 },
  ],
};

const grade = (spec: SetSelectionSpec, response: Parameters<typeof fractionOfSet.evaluate>[2]) =>
  fractionOfSet.evaluate({}, spec, response);
const ids = (count: number, offset = 0) => Array.from({ length: count }, (_, i) => `e${i + 1 + offset}`);

describe('set-selection.v1 generation', () => {
  it('only enumerates diagnostic, unique items within range', () => {
    const specs = setSelection.enumerateSpecs(selectParams);
    expect(specs.length).toBeGreaterThan(20);
    const identities = new Set(specs.map(setSelection.specIdentity));
    expect(identities.size).toBe(specs.length);
    for (const spec of specs) {
      expect(isDiagnostic(spec)).toBe(true);
      expect(setSelection.checkSpecAgainstParams(selectParams, spec)).toBeNull();
      expect(Number.isInteger(partSize(spec))).toBe(true);
    }
  });

  it('excludes items where a misconception gives the right count', () => {
    // 1/4 of 4 = 1 = numerator; 1/2 of 4 = 2 = denominator = complement; 1/4 of 8 = 2 ≠ 1, 4, 6 → usable
    expect(isDiagnostic({ task: 'select', total: 4, fraction: { n: 1, d: 4 } })).toBe(false);
    expect(isDiagnostic({ task: 'select', total: 4, fraction: { n: 1, d: 2 } })).toBe(false);
    expect(isDiagnostic({ task: 'select', total: 16, fraction: { n: 1, d: 4 } })).toBe(false); // 4 = d
    expect(isDiagnostic({ task: 'select', total: 8, fraction: { n: 1, d: 4 } })).toBe(true);
    // one half: taking "the rest" gives the same right count, so it does not disqualify the item
    expect(isDiagnostic({ task: 'select', total: 10, fraction: { n: 1, d: 2 } })).toBe(true);
  });

  it('treats equivalent fractions on the same total as one problem', () => {
    const a = setSelection.specIdentity({ task: 'select', total: 20, fraction: { n: 1, d: 4 } });
    const b = setSelection.specIdentity({ task: 'select', total: 20, fraction: { n: 2, d: 8 } });
    expect(a).toBe(b);
  });

  it('renders the prompt from the context without revealing the count', () => {
    const item = setSelection.render(
      { task: 'select', total: 20, fraction: { n: 1, d: 4 } },
      context,
      seededRng(1),
    );
    expect(item.prompt).toBe('A project has 20 tasks. Mark one quarter of them as done.');
    expect(item.view.elements).toHaveLength(20);
    expect(JSON.stringify(item.view)).not.toContain('"part_size"');
    expect(item.template_values.part_size).toBe(5);
  });

  it('marks exactly the fraction for identify items, reproducibly per seed', () => {
    const spec: SetSelectionSpec = {
      task: 'identify',
      total: 12,
      fraction: { n: 1, d: 4 },
      options: identifyParams.identify_options,
    };
    const a = setSelection.render(spec, identifyContext, seededRng(42));
    const b = setSelection.render(spec, identifyContext, seededRng(42));
    expect(a.view.marked).toHaveLength(3);
    expect(a.view.marked).toEqual(b.view.marked);
    expect(a.prompt).toBe('3 of the 12 tasks are done. What fraction is done?');
    expect(a.prompt).not.toContain('quarter');
  });

  it('limits scenario variables so identify prompts cannot name the answer', () => {
    expect(setSelection.scenarioVariables(identifyParams)).not.toContain('fraction_text');
    expect(setSelection.scenarioVariables(selectParams)).toContain('fraction_text');
  });
});

describe('set-selection.v1 params', () => {
  it('accepts sound params', () => {
    expect(setSelection.checkParams(selectParams)).toEqual([]);
    expect(setSelection.checkParams(identifyParams)).toEqual([]);
  });

  it('reports empty ranges, duplicates, and fractions without usable totals', () => {
    const issues = setSelection.checkParams({
      task: 'select',
      fractions: [
        { n: 1, d: 4 },
        { n: 2, d: 8 },
        { n: 1, d: 12 },
      ],
      totals: { min: 2, max: 10 },
    });
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      ['/fractions/1', 'duplicate_fraction'],
      ['/fractions/2', 'no_eligible_total'],
    ]);
    expect(setSelection.checkParams({ ...selectParams, totals: { min: 30, max: 10 } })[0]?.code).toBe(
      'empty_range',
    );
  });

  it('requires identify options that include every target and are distinct in value', () => {
    const issues = setSelection.checkParams({
      ...identifyParams,
      identify_options: [
        { n: 1, d: 2 },
        { n: 2, d: 4 },
      ],
    });
    expect(issues.map((i) => i.code)).toEqual(['duplicate_option', 'target_not_in_options']);
    expect(setSelection.checkParams({ ...identifyParams, identify_options: undefined })[0]?.code).toBe(
      'missing_options',
    );
  });
});

describe('fraction-of-set.v1 evaluator', () => {
  it('accepts every subset of the right size for every enumerated item', () => {
    const rng = seededRng(7);
    for (const spec of setSelection.enumerateSpecs(selectParams)) {
      const part = partSize(spec);
      const subset = rng.shuffle(ids(spec.total)).slice(0, part);
      expect(grade(spec, { selected: subset }).correct, JSON.stringify(spec)).toBe(true);
      expect(grade(spec, { selected: [...subset, subset[0]!] }).correct).toBe(true); // duplicates ignored
      expect(grade(spec, { selected: ids(part + 1) }).correct).toBe(false);
    }
  });

  it('classifies typical mistakes deterministically', () => {
    const quarter: SetSelectionSpec = { task: 'select', total: 20, fraction: { n: 1, d: 4 } };
    expect(grade(quarter, { selected: ids(1) }).error_code).toBe('count_equals_numerator');
    expect(grade(quarter, { selected: ids(4) }).error_code).toBe('count_equals_denominator');
    expect(grade(quarter, { selected: ids(15) }).error_code).toBe('selected_complement');
    expect(grade(quarter, { selected: ids(6) }).error_code).toBe('off_by_one');
    expect(grade(quarter, { selected: ids(10) }).error_code).toBe('unrelated_count');

    const threeQuarters: SetSelectionSpec = { task: 'select', total: 20, fraction: { n: 3, d: 4 } };
    // For 3/4 the rest and one group are both 5: the response cannot tell them apart, and says so.
    expect(grade(threeQuarters, { selected: ids(5) })).toMatchObject({
      error_code: 'selected_complement',
      alternative_codes: ['single_group_only'],
    });
    const twoThirds: SetSelectionSpec = { task: 'select', total: 24, fraction: { n: 2, d: 3 } };
    expect(grade(twoThirds, { selected: ids(8) })).toMatchObject({
      error_code: 'selected_complement',
      alternative_codes: ['single_group_only'],
    });
    const twoFifths: SetSelectionSpec = { task: 'select', total: 20, fraction: { n: 2, d: 5 } };
    expect(grade(twoFifths, { selected: ids(4) })).toMatchObject({
      error_code: 'single_group_only',
      alternative_codes: [],
    });
    expect(grade(threeQuarters, { selected: ids(15) }).correct).toBe(true);
  });

  it('rejects unknown elements and wrong response shapes', () => {
    const spec: SetSelectionSpec = { task: 'select', total: 8, fraction: { n: 1, d: 4 } };
    expect(grade(spec, { selected: ['e1', 'e9'] }).error_code).toBe('invalid_response');
    expect(grade(spec, { selected: ['e0', 'e1'] }).error_code).toBe('invalid_response');
    expect(grade(spec, { selected: ['x1', 'e1'] }).error_code).toBe('invalid_response');
    expect(grade(spec, { choice: { n: 1, d: 4 } }).error_code).toBe('invalid_response');
  });

  it('accepts equivalent fractions on identify items', () => {
    const spec: SetSelectionSpec = {
      task: 'identify',
      total: 8,
      fraction: { n: 1, d: 4 },
      options: identifyParams.identify_options,
    };
    expect(grade(spec, { choice: { n: 1, d: 4 } }).correct).toBe(true);
    expect(grade(spec, { choice: { n: 2, d: 8 } }).correct).toBe(true);
    expect(grade(spec, { choice: { n: 3, d: 4 } }).error_code).toBe('chose_complement');
    expect(grade(spec, { choice: { n: 2, d: 4 } }).error_code).toBe('wrong_numerator');
    expect(grade(spec, { choice: { n: 1, d: 3 } }).error_code).toBe('wrong_fraction');
    expect(grade(spec, { choice: { n: 5, d: 4 } }).error_code).toBe('invalid_response');
    expect(grade(spec, { selected: ['e1'] }).error_code).toBe('invalid_response');
  });

  it('only reports declared error codes', () => {
    const declared = new Set(Object.keys(fractionOfSet.errorCodes));
    const spec: SetSelectionSpec = { task: 'select', total: 24, fraction: { n: 2, d: 3 } };
    for (let count = 0; count <= 24; count++) {
      const code = grade(spec, { selected: ids(count) }).error_code;
      if (code) expect(declared.has(code)).toBe(true);
    }
  });
});

describe('fraction words', () => {
  it('names proper fractions', () => {
    expect(fractionWords({ n: 1, d: 4 })).toBe('one quarter');
    expect(fractionWords({ n: 3, d: 4 })).toBe('three quarters');
    expect(fractionWords({ n: 2, d: 3 })).toBe('two thirds');
    expect(sameValue({ n: 2, d: 8 }, { n: 1, d: 4 })).toBe(true);
  });
});
