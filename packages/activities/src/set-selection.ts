import { z } from 'zod';
import {
  MAX_CANDIDATES,
  renderTemplate,
  type ActivityAdapter,
  type RenderedItem,
  type ValidationIssue,
} from '@dismodo/contracts';
import {
  SUPPORTED_DENOMINATORS,
  fractionSymbol,
  fractionWords,
  reduce,
  sameValue,
  type Fraction,
} from './fractions';

export const MAX_TOTAL = 100;

export const FractionSchema = z
  .strictObject({ n: z.int().min(1).max(11), d: z.int().min(2).max(12) })
  .refine((f) => f.n < f.d, 'Use a proper fraction: the numerator must be smaller than the denominator.')
  .refine(
    (f) => SUPPORTED_DENOMINATORS.includes(f.d),
    `Supported denominators: ${SUPPORTED_DENOMINATORS.join(', ')}.`,
  );

export const SetSelectionParams = z.strictObject({
  /** "select": mark the given fraction of a set. "identify": say which fraction of the set is marked. */
  task: z.enum(['select', 'identify']),
  fractions: z.array(FractionSchema).min(1).max(32),
  totals: z.strictObject({ min: z.int().min(2).max(MAX_TOTAL), max: z.int().min(2).max(MAX_TOTAL) }),
  /** Choices shown for "identify" items; every target fraction must be among them. */
  identify_options: z.array(FractionSchema).min(2).max(6).optional(),
});
export type SetSelectionParams = z.infer<typeof SetSelectionParams>;

export const SetSelectionSpec = z.strictObject({
  task: z.enum(['select', 'identify']),
  total: z.int().min(2).max(MAX_TOTAL),
  fraction: FractionSchema,
  options: z.array(FractionSchema).min(2).max(6).optional(),
});
export type SetSelectionSpec = z.infer<typeof SetSelectionSpec>;

export const SetSelectionResponse = z.union([
  z.strictObject({ selected: z.array(z.string().max(8)).max(MAX_TOTAL) }),
  z.strictObject({
    choice: z.strictObject({ n: z.int().min(0).max(MAX_TOTAL), d: z.int().min(1).max(MAX_TOTAL) }),
  }),
]);
export type SetSelectionResponse = z.infer<typeof SetSelectionResponse>;

export interface SetSelectionView {
  task: 'select' | 'identify';
  total: number;
  elements: { id: string }[];
  /** Elements shown as marked ("identify" only). */
  marked?: string[];
  options?: { n: number; d: number; label: string }[];
  item_singular: string;
  item_plural: string;
}

export function partSize(spec: Pick<SetSelectionSpec, 'total' | 'fraction'>): number {
  return (spec.total * spec.fraction.n) / spec.fraction.d;
}

/**
 * A "select" item is diagnostic only if the typical wrong counts differ from the right one; otherwise the
 * evaluator could not tell a misconception from a correct answer (e.g. 1/4 of 4 = 1 = the numerator).
 */
export function isDiagnostic(spec: Pick<SetSelectionSpec, 'task' | 'total' | 'fraction'>): boolean {
  const { total, fraction } = spec;
  if (total % fraction.d !== 0) return false;
  if (spec.task === 'identify') return total > fraction.d;
  const part = partSize(spec);
  const confusable = [fraction.n, fraction.d];
  // For one half the remaining part equals the asked part, so "taking the rest" is not a wrong answer.
  if (2 * fraction.n !== fraction.d) confusable.push(total - part);
  if (fraction.n > 1) confusable.push(total / fraction.d);
  return !confusable.includes(part);
}

const SCENARIO_VARIABLES = {
  select: ['total', 'fraction_text', 'fraction_symbol'],
  identify: ['total', 'marked_count'],
} as const;

const EXPLANATION_VARIABLES = [
  'total',
  'numerator',
  'denominator',
  'fraction_text',
  'fraction_symbol',
  'part_size',
  'group_size',
  'group_count',
  'remaining',
] as const;

function explanationValues(spec: SetSelectionSpec): Record<string, string | number> {
  const part = partSize(spec);
  return {
    total: spec.total,
    numerator: spec.fraction.n,
    denominator: spec.fraction.d,
    fraction_text: fractionWords(spec.fraction),
    fraction_symbol: fractionSymbol(spec.fraction),
    part_size: part,
    group_size: spec.total / spec.fraction.d,
    group_count: spec.fraction.d,
    remaining: spec.total - part,
  };
}

function indexOfEquivalent(list: readonly Fraction[], f: Fraction): number {
  return list.findIndex((candidate) => sameValue(candidate, f));
}

export const setSelection: ActivityAdapter<
  SetSelectionParams,
  SetSelectionSpec,
  SetSelectionResponse,
  SetSelectionView
> = {
  ref: 'set-selection.v1',
  revision: 'set-selection.v1+r1',
  description:
    'A set of countable elements rendered from data. "select": the learner marks a given fraction of the set. ' +
    '"identify": some elements are marked and the learner says which fraction of the set they are.',
  paramsSchema: SetSelectionParams,
  specSchema: SetSelectionSpec,
  responseSchema: SetSelectionResponse,
  contextSlots: ['whole', 'item_singular', 'item_plural'],
  scenarioVariables: (params) => SCENARIO_VARIABLES[params.task],
  explanationVariables: EXPLANATION_VARIABLES,

  checkParams(params) {
    const issues: ValidationIssue[] = [];
    if (params.totals.min > params.totals.max) {
      issues.push({
        path: '/totals',
        code: 'empty_range',
        message: `totals.min (${params.totals.min}) is greater than totals.max (${params.totals.max}).`,
      });
    }
    params.fractions.forEach((f, i) => {
      const earlier = indexOfEquivalent(params.fractions.slice(0, i), f);
      if (earlier !== -1) {
        issues.push({
          path: `/fractions/${i}`,
          code: 'duplicate_fraction',
          message: `${fractionSymbol(f)} has the same value as fractions[${earlier}].`,
        });
        return;
      }
      if (!hasDiagnosticTotal(params, f)) {
        issues.push({
          path: `/fractions/${i}`,
          code: 'no_eligible_total',
          message: `No total between ${params.totals.min} and ${params.totals.max} gives a usable item for ${fractionSymbol(f)}.`,
          hint: `Use a range that includes a multiple of ${f.d} larger than ${f.d}, where the answer differs from ${f.n}, ${f.d} and the remaining part.`,
        });
      }
    });
    if (params.task === 'identify') {
      const options = params.identify_options;
      if (!options) {
        issues.push({
          path: '/identify_options',
          code: 'missing_options',
          message: '"identify" tasks need identify_options.',
        });
      } else {
        options.forEach((o, i) => {
          if (indexOfEquivalent(options.slice(0, i), o) !== -1) {
            issues.push({
              path: `/identify_options/${i}`,
              code: 'duplicate_option',
              message: `${fractionSymbol(o)} has the same value as another option; learners could not tell them apart.`,
            });
          }
        });
        params.fractions.forEach((f, i) => {
          if (indexOfEquivalent(options, f) === -1) {
            issues.push({
              path: `/fractions/${i}`,
              code: 'target_not_in_options',
              message: `${fractionSymbol(f)} is a target but not one of identify_options.`,
            });
          }
        });
      }
    } else if (params.identify_options) {
      issues.push({
        path: '/identify_options',
        code: 'unexpected_options',
        message: 'identify_options only applies to "identify" tasks.',
      });
    }
    return issues;
  },

  checkSpecAgainstParams(params, spec) {
    if (spec.task !== params.task) {
      return { path: '/task', code: 'task_mismatch', message: `The package uses "${params.task}" items.` };
    }
    if (!params.fractions.some((f) => f.n === spec.fraction.n && f.d === spec.fraction.d)) {
      return {
        path: '/fraction',
        code: 'fraction_not_allowed',
        message: `${fractionSymbol(spec.fraction)} is not one of activity.params.fractions (write it exactly as declared).`,
      };
    }
    if (spec.total < params.totals.min || spec.total > params.totals.max) {
      return {
        path: '/total',
        code: 'total_out_of_range',
        message: `${spec.total} is outside ${params.totals.min}–${params.totals.max}.`,
      };
    }
    if (!isDiagnostic(spec)) {
      return {
        path: '/total',
        code: 'not_diagnostic',
        message: `${fractionSymbol(spec.fraction)} of ${spec.total} is not a usable item: either it does not divide evenly or common mistakes give the same answer.`,
      };
    }
    if (spec.task === 'identify') {
      const expected = params.identify_options ?? [];
      const given = spec.options ?? [];
      const same = given.length === expected.length && expected.every((o, i) => sameValue(o, given[i]!));
      if (!same) {
        return {
          path: '/options',
          code: 'options_mismatch',
          message: '"identify" specs must list identify_options in the same order.',
        };
      }
    } else if (spec.options) {
      return { path: '/options', code: 'unexpected_options', message: '"select" specs do not take options.' };
    }
    return null;
  },

  specIdentity(spec) {
    const r = reduce(spec.fraction);
    return `${spec.task}:${spec.total}:${r.n}/${r.d}`;
  },

  enumerateSpecs(params) {
    const seen = new Set<string>();
    const out: SetSelectionSpec[] = [];
    for (const fraction of params.fractions) {
      for (let total = params.totals.min; total <= params.totals.max; total++) {
        const spec: SetSelectionSpec = {
          task: params.task,
          total,
          fraction,
          ...(params.task === 'identify' ? { options: params.identify_options } : {}),
        };
        if (!isDiagnostic(spec)) continue;
        const id = setSelection.specIdentity(spec);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(spec);
        if (out.length > MAX_CANDIDATES) throw new Error('Candidate pool exceeds MAX_CANDIDATES.');
      }
    }
    return out;
  },

  render(spec, context, rng): RenderedItem<SetSelectionSpec, SetSelectionView> {
    const elements = Array.from({ length: spec.total }, (_, i) => ({ id: `e${i + 1}` }));
    const values = explanationValues(spec);
    const view: SetSelectionView = {
      task: spec.task,
      total: spec.total,
      elements,
      item_singular: context.nouns.item_singular ?? 'item',
      item_plural: context.nouns.item_plural ?? 'items',
    };
    let scenarioValues: Record<string, string | number>;
    if (spec.task === 'identify') {
      const marked = rng
        .shuffle(elements.map((e) => e.id))
        .slice(0, partSize(spec))
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
      view.marked = marked;
      view.options = (spec.options ?? []).map((o) => ({
        ...o,
        label: `${fractionSymbol(o)} (${fractionWords(o)})`,
      }));
      scenarioValues = { total: spec.total, marked_count: marked.length };
    } else {
      scenarioValues = {
        total: spec.total,
        fraction_text: values.fraction_text!,
        fraction_symbol: values.fraction_symbol!,
      };
    }
    return {
      spec,
      context_id: context.id,
      prompt: renderTemplate(context.scenario_template, { ...context.nouns, ...scenarioValues }),
      view,
      template_values: { ...context.nouns, ...values },
    };
  },
};

function hasDiagnosticTotal(params: SetSelectionParams, fraction: Fraction): boolean {
  for (let total = params.totals.min; total <= params.totals.max; total++) {
    if (isDiagnostic({ task: params.task, total, fraction })) return true;
  }
  return false;
}
