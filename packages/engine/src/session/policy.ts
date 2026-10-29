import {
  interventionKind,
  renderTemplate,
  type DecisionRecord,
  type InterventionId,
  type RenderedExplanation,
} from '@dismodo/contracts';
import type { PackageRuntime } from './runtime';
import type { ItemRecord, SessionState } from './state';

export type Decision =
  | { kind: 'continue'; decision?: DecisionRecord }
  | { kind: 'intervene'; intervention: InterventionId; decision: DecisionRecord };

export interface PolicyInput {
  runtime: PackageRuntime;
  state: SessionState;
  /** The item just evaluated. */
  item: ItemRecord;
}

/**
 * Chooses what happens after an evaluated answer. Policies only propose: the controller checks every
 * proposal against the package and session limits before anything reaches the learner.
 */
export interface AdaptationPolicy {
  readonly name: 'adaptive' | 'fixed';
  afterEvaluation(input: PolicyInput): Promise<Decision>;
}

/** Explanation interventions in the order the fixed route tries them when no confusion matches. */
const EDITORIAL_ORDER: InterventionId[] = [
  'worked-example',
  'step-by-step',
  'essential',
  'contrast',
  'analogy',
];

export function interventionsUsed(state: SessionState): InterventionId[] {
  return state.interventions.map((i) => i.intervention);
}

/** Confusions in the package whose signals match the evaluator's codes for this answer. */
export function matchingConfusions(runtime: PackageRuntime, item: ItemRecord) {
  const codes = [item.answer?.error_code, ...(item.answer?.alternative_codes ?? [])].filter(
    Boolean,
  ) as string[];
  return runtime.pkg.confusions.filter((c) => c.signals.some((s) => codes.includes(s)));
}

/**
 * The package's fixed editorial route: the reviewed path a builder gets with no model at all. It is also
 * the fallback whenever a model is unavailable or proposes something the controller rejects, and the
 * comparison arm for measuring what adaptation adds.
 */
export const editorialPolicy: AdaptationPolicy = {
  name: 'fixed',
  async afterEvaluation({ runtime, state, item }) {
    if (item.answer?.correct) return { kind: 'continue' };
    const used = interventionsUsed(state);
    const allowed = new Set(runtime.pkg.interventions.allowed);
    const usable = (id: InterventionId) =>
      allowed.has(id) && interventionKind(id) === 'explanation' && !used.includes(id);
    const confusions = matchingConfusions(runtime, item);
    for (const confusion of confusions) {
      const pick = confusion.suggested.find(usable);
      if (pick) {
        return {
          kind: 'intervene',
          intervention: pick,
          decision: {
            source: 'editorial',
            rationale: `The answer matches a pattern the package describes: ${confusion.description}`,
            hypothesis: confusion.description,
            evidence_seqs: [item.presented_seq, item.answer!.seq],
          },
        };
      }
    }
    const pick = EDITORIAL_ORDER.find(usable);
    if (!pick) return { kind: 'continue' };
    return {
      kind: 'intervene',
      intervention: pick,
      decision: {
        source: 'editorial',
        rationale: 'The answer did not match the task; the package suggests this explanation next.',
        hypothesis: null,
        evidence_seqs: [item.presented_seq, item.answer!.seq],
      },
    };
  },
};

export type ControllerVerdict = { ok: true } | { ok: false; reason: string };

/** Hard limits every proposal must respect, whichever policy made it. */
export function checkProposal(
  runtime: PackageRuntime,
  state: SessionState,
  intervention: InterventionId,
): ControllerVerdict {
  const pkg = runtime.pkg;
  if (!pkg.interventions.allowed.includes(intervention)) {
    return { ok: false, reason: `"${intervention}" is not allowed by the package.` };
  }
  if (state.phase === 'independent') return { ok: false, reason: 'No support during the independent check.' };
  if (state.interventions.length >= pkg.session_policy.max_interventions) {
    return { ok: false, reason: 'The session reached max_interventions.' };
  }
  if (interventionKind(intervention) === 'explanation' && !pkg.interventions.editorial[intervention]) {
    return { ok: false, reason: `"${intervention}" has no reviewed content.` };
  }
  return { ok: true };
}

export function renderExplanation(
  runtime: PackageRuntime,
  intervention: InterventionId,
  item: ItemRecord,
): RenderedExplanation | null {
  const content = runtime.pkg.interventions.editorial[intervention];
  if (!content) return null;
  const values = item.template_values;
  return {
    intervention,
    title: content.title,
    body: renderTemplate(content.body_template, values),
    steps: (content.steps_template ?? []).map((step) => renderTemplate(step, values)),
  };
}
