import { z } from 'zod';
import type { EvaluatorAdapter, Evaluation } from '@dismodo/contracts';
import { fractionSymbol, sameValue } from './fractions';
import { partSize, type SetSelectionResponse, type SetSelectionSpec } from './set-selection';

/** Error codes in precedence order: the first matching code is reported. */
const ERROR_CODES = {
  invalid_response: 'The response does not fit the item (wrong shape or unknown elements).',
  count_equals_numerator: 'Selected as many elements as the numerator: the fraction was read as a count.',
  count_equals_denominator:
    'Selected as many elements as the denominator: counted the parts, not a share of the whole.',
  selected_complement: 'Selected the rest of the set instead of the asked part.',
  single_group_only: 'Selected one equal group when several groups were asked for (numerator ignored).',
  off_by_one: 'One element more or fewer than the asked part: likely a counting slip.',
  unrelated_count: 'The selected amount does not match a known pattern.',
  chose_complement: 'Chose the fraction for the unmarked part.',
  wrong_numerator: 'Right number of equal parts, wrong number of them taken.',
  wrong_fraction: 'The chosen fraction does not match the marked part.',
} as const;

export type FractionOfSetErrorCode = keyof typeof ERROR_CODES;

const fail = (error_code: FractionOfSetErrorCode, feedback: string): Evaluation => ({
  correct: false,
  error_code,
  alternative_codes: [],
  feedback,
});

/** Reports the first matching pattern and keeps the others that explain the response equally well. */
const failMatching = (matches: FractionOfSetErrorCode[], feedback: string): Evaluation => ({
  correct: false,
  error_code: matches[0]!,
  alternative_codes: matches.slice(1),
  feedback,
});

export const fractionOfSet: EvaluatorAdapter<
  Record<string, never>,
  SetSelectionSpec,
  SetSelectionResponse
> = {
  ref: 'fraction-of-set.v1',
  revision: 'fraction-of-set.v1+r1',
  description:
    'Grades "select" by the number of distinct valid elements chosen (any subset of the right size is correct) and ' +
    '"identify" by fraction value (equivalent fractions such as 2/8 and 1/4 are both correct).',
  configSchema: z.strictObject({}),
  activityRefs: ['set-selection.v1'],
  errorCodes: ERROR_CODES,

  evaluate(_config, spec, response) {
    const part = partSize(spec);
    const { total, fraction } = spec;

    if (spec.task === 'select') {
      if (!('selected' in response)) return fail('invalid_response', 'Select elements to answer this item.');
      const unique = new Set(response.selected);
      for (const id of unique) {
        const index = /^e([1-9]\d*)$/.exec(id);
        if (!index || Number(index[1]) > total)
          return fail('invalid_response', `"${id}" is not part of this set.`);
      }
      const count = unique.size;
      const said = `You selected ${count} of ${total}.`;
      if (count === part) {
        return {
          correct: true,
          error_code: null,
          alternative_codes: [],
          feedback: `${count} of ${total} is ${fractionSymbol(fraction)} of the whole.`,
        };
      }
      const matches: FractionOfSetErrorCode[] = [];
      if (count === fraction.n) matches.push('count_equals_numerator');
      if (count === fraction.d) matches.push('count_equals_denominator');
      if (count === total - part) matches.push('selected_complement');
      if (fraction.n > 1 && count === total / fraction.d) matches.push('single_group_only');
      if (Math.abs(count - part) === 1) matches.push('off_by_one');
      return failMatching(matches.length > 0 ? matches : ['unrelated_count'], said);
    }

    if (!('choice' in response)) return fail('invalid_response', 'Choose a fraction to answer this item.');
    const choice = response.choice;
    if (choice.n > choice.d)
      return fail('invalid_response', 'A part of a set cannot be larger than the set.');
    const said = `You chose ${fractionSymbol(choice)}.`;
    if (sameValue(choice, fraction)) {
      return {
        correct: true,
        error_code: null,
        alternative_codes: [],
        feedback: `${part} of ${total} is ${fractionSymbol(choice)} of the whole.`,
      };
    }
    if (sameValue(choice, { n: fraction.d - fraction.n, d: fraction.d }))
      return fail('chose_complement', said);
    if (choice.d === fraction.d) return fail('wrong_numerator', said);
    return fail('wrong_fraction', said);
  },
};
