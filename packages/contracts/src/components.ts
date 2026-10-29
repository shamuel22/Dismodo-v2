import type { z } from 'zod';
import type { ValidationIssue } from './issues';

/** Deterministic random source; the engine seeds it per session so items are reproducible. */
export interface Rng {
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
  shuffle<T>(values: readonly T[]): T[];
}

/** Upper bound on the candidate pool an activity may enumerate for one package. */
export const MAX_CANDIDATES = 10_000;

/** Values a context gives to templates (nouns, verbs); validated against the adapter's context slots. */
export type ContextNouns = Readonly<Record<string, string>>;

/** A concrete, renderable item the learner works on. Built from a spec plus a context. */
export interface RenderedItem<Spec = unknown, View = unknown> {
  spec: Spec;
  context_id: string;
  /** Learner-facing prompt, already rendered from the context's scenario template. */
  prompt: string;
  /** Data the runtime renders (e.g. elements of a set). Never contains the answer key. */
  view: View;
  /** Values available to explanation templates for this item. */
  template_values: Readonly<Record<string, string | number>>;
}

/**
 * Adapter for an activity family. Registered in code and reviewed; packages reference it by `ref`.
 * Builders configure it through `params`; they never ship code.
 */
export interface ActivityAdapter<Params = unknown, Spec = unknown, Response = unknown, View = unknown> {
  readonly ref: string;
  /** Implementation revision; sessions pin it so behavior cannot change under a running package. */
  readonly revision: string;
  readonly description: string;
  readonly paramsSchema: z.ZodType<Params>;
  /** Shape of a single item, as written in reserved checks and package tests. */
  readonly specSchema: z.ZodType<Spec>;
  readonly responseSchema: z.ZodType<Response>;
  /** Noun slots every context must fill (e.g. item_plural). Contexts may add more nouns. */
  readonly contextSlots: readonly string[];
  /** Variables a scenario (the item prompt) may use under these params. Must never reveal the answer. */
  scenarioVariables(params: Params): readonly string[];
  /** Variables explanation templates may use (may include worked quantities). */
  readonly explanationVariables: readonly string[];
  /** Checks that need more than a schema (non-empty ranges, divisibility...). Paths are relative to params. */
  checkParams(params: Params): ValidationIssue[];
  /** Whether a spec could be produced under these params; null when it fits. Path relative to the spec. */
  checkSpecAgainstParams(params: Params, spec: Spec): ValidationIssue | null;
  /**
   * Canonical identity of the underlying problem, independent of context nouns. Two specs with the same
   * identity count as the same exercise (used to keep held-out checks unseen).
   */
  specIdentity(spec: Spec): string;
  /** Every spec the generator can produce under these params, deduplicated, bounded by MAX_CANDIDATES. */
  enumerateSpecs(params: Params): Spec[];
  render(
    spec: Spec,
    context: { id: string; nouns: ContextNouns; scenario_template: string },
    rng: Rng,
  ): RenderedItem<Spec, View>;
}

export interface Evaluation {
  correct: boolean;
  /** Machine-readable error class when incorrect; one of the evaluator's declared codes. */
  error_code: string | null;
  /**
   * Other declared error codes that explain the same response equally well, in precedence order. A non-empty
   * list means the response alone cannot tell the confusions apart; the controller may ask for a check that does.
   */
  alternative_codes: string[];
  /** Short, factual feedback derived from the response; no model involved. */
  feedback: string;
}

/** Deterministic grader. The only component allowed to decide whether a response is correct. */
export interface EvaluatorAdapter<Config = unknown, Spec = unknown, Response = unknown> {
  readonly ref: string;
  readonly revision: string;
  readonly description: string;
  readonly configSchema: z.ZodType<Config>;
  /** Activity refs this evaluator can grade. */
  readonly activityRefs: readonly string[];
  /** Every error code the evaluator may return, with what it means, in precedence order. */
  readonly errorCodes: Readonly<Record<string, string>>;
  evaluate(config: Config, spec: Spec, response: Response): Evaluation;
}

export interface ComponentRegistry {
  activity(ref: string): ActivityAdapter | undefined;
  evaluator(ref: string): EvaluatorAdapter | undefined;
  activities(): ActivityAdapter[];
  evaluators(): EvaluatorAdapter[];
}
