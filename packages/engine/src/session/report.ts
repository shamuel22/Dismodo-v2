import type { InterventionId, SelfRating, SessionPhase, SessionStatus } from '@dismodo/contracts';
import { liveItems, type ItemRecord, type SessionState } from './state';

export interface ItemEvidence {
  item_id: string;
  phase: Exclude<SessionPhase, 'done'>;
  context_id: string;
  identity: string;
  correct: boolean | null;
  error_code: string | null;
  alternative_codes: string[];
  hints_used: number;
  self_rating: SelfRating | null;
  unfamiliar_reference: boolean;
  /** Milliseconds from presentation to answer. Includes reading and any pause; not a speed score. */
  answer_ms: number | null;
}

export interface SessionReport {
  experience_ref: string;
  content_hash: string;
  components: { activity: string; evaluator: string };
  engine_version: string;
  policy: 'adaptive' | 'fixed';
  status: SessionStatus;
  phase: SessionPhase;
  started_at: string;
  completed_at: string | null;
  observations: {
    baseline: { attempted: number; correct: number } | null;
    practice: { attempted: number; correct: number; hints_used: number; correct_without_hints: number };
    independent: { attempted: number; correct: number; target: number; hints_used: 0 };
    interventions: Array<{
      intervention: InterventionId;
      source: 'editorial' | 'rules' | 'model' | 'fallback';
      hypothesis: string | null;
      learner_agreed: boolean | null;
      next_item_correct: boolean | null;
    }>;
    unfamiliar_references: string[];
    self_ratings: Record<SelfRating, number>;
    /** Where the learner's confidence and the evaluator disagreed; worth a closer look, not a verdict. */
    confidence_mismatches: { confident_but_incorrect: number; unsure_but_correct: number };
    delayed_check: 'not_measured';
  };
  items: ItemEvidence[];
  /** The four kinds of statement are kept apart on purpose. */
  statements: {
    observed: string[];
    interpretation: Array<{ text: string; source: 'editorial' | 'rules' | 'model' | 'fallback' }>;
    learner_view: string[];
    not_yet_checked: string[];
  };
  scope: 'this-skill-and-session';
}

function evidence(item: ItemRecord): ItemEvidence {
  return {
    item_id: item.item_id,
    phase: item.phase,
    context_id: item.context_id,
    identity: item.identity,
    correct: item.answer ? item.answer.correct : null,
    error_code: item.answer?.error_code ?? null,
    alternative_codes: item.answer?.alternative_codes ?? [],
    hints_used: item.hints.length,
    self_rating: item.self_rating ?? null,
    unfamiliar_reference: item.unfamiliar,
    answer_ms: item.answer ? Date.parse(item.answer.at) - Date.parse(item.presented_at) : null,
  };
}

const count = (items: ItemRecord[], predicate: (item: ItemRecord) => boolean) =>
  items.filter(predicate).length;

/** Builds the session report from replayed events only. Deterministic; no model involved. */
export function buildReport(state: SessionState, independentTarget: number): SessionReport {
  const all = state.items.map(evidence);
  const live = liveItems(state);
  const answered = (phase: SessionPhase) => liveItems(state, phase).filter((i) => i.answer);
  const baseline = answered('baseline');
  const practice = answered('practice');
  const independent = answered('independent');
  const ratings: Record<SelfRating, number> = { confident: 0, unsure: 0, guessed: 0 };
  for (const item of live) if (item.self_rating) ratings[item.self_rating]++;

  const interventions = state.interventions.map((i) => {
    const later = state.items.find((item) => item.presented_seq > i.seq && item.answer && !item.replaced_by);
    return {
      intervention: i.intervention,
      source: i.decision.source,
      hypothesis: i.decision.hypothesis,
      learner_agreed: i.learner_feedback ? i.learner_feedback.agrees : null,
      next_item_correct: later ? later.answer!.correct : null,
    };
  });

  const observed: string[] = [];
  if (baseline.length) {
    observed.push(
      `Starting item: ${baseline[0]!.answer!.correct ? 'correct' : 'not correct'}, without hints.`,
    );
  }
  if (practice.length) {
    const withHints = count(practice, (i) => i.hints.length > 0);
    observed.push(
      `Practice: ${count(practice, (i) => i.answer!.correct)} of ${practice.length} correct; hints used on ${withHints} item(s).`,
    );
  }
  if (independent.length) {
    observed.push(
      `Independent check (held-out problems, no hints): ${count(independent, (i) => i.answer!.correct)} of ${independent.length} correct.`,
    );
  }
  for (const i of interventions) {
    if (i.next_item_correct !== null) {
      observed.push(
        `After "${i.intervention}", the next item was ${i.next_item_correct ? 'correct' : 'not correct'} in this session.`,
      );
    }
  }
  const allUnfamiliar = [...new Set(state.items.filter((i) => i.unfamiliar).map((i) => i.context_id))];

  const learnerView: string[] = [];
  if (allUnfamiliar.length) learnerView.push(`Marked as unfamiliar: ${allUnfamiliar.join(', ')}.`);
  const rated = Object.entries(ratings).filter(([, n]) => n > 0);
  if (rated.length) learnerView.push(`Self-ratings: ${rated.map(([r, n]) => `${r} ×${n}`).join(', ')}.`);
  for (const i of state.interventions) {
    if (i.learner_feedback) {
      learnerView.push(
        `On "${i.decision.hypothesis}": ${i.learner_feedback.agrees ? 'agreed' : 'disagreed'}${i.learner_feedback.note ? ` ("${i.learner_feedback.note}")` : ''}.`,
      );
    }
  }

  const interpretation: SessionReport['statements']['interpretation'] = [];
  for (const d of [...state.interventions, ...state.decisions].sort((a, b) => a.seq - b.seq)) {
    if (d.decision.hypothesis)
      interpretation.push({ text: `Provisional: ${d.decision.hypothesis}`, source: d.decision.source });
    if (d.decision.model_interpretation) {
      interpretation.push({ text: `Model reading: ${d.decision.model_interpretation}`, source: 'model' });
    }
  }

  const notYetChecked = ['Retention over time (delayed check not measured).'];
  if (independent.length < independentTarget) notYetChecked.push('The independent check was not completed.');
  notYetChecked.push('Transfer to other kinds of problems or settings outside this activity.');
  notYetChecked.push('Help the learner may have had outside this product.');

  return {
    experience_ref: state.experience_ref,
    content_hash: state.content_hash,
    components: state.components,
    engine_version: state.engine_version,
    policy: state.policy,
    status: state.status,
    phase: state.phase,
    started_at: state.started_at,
    completed_at: state.completed_at,
    observations: {
      baseline: state.items.some((i) => i.phase === 'baseline')
        ? { attempted: baseline.length, correct: count(baseline, (i) => i.answer!.correct) }
        : null,
      practice: {
        attempted: practice.length,
        correct: count(practice, (i) => i.answer!.correct),
        hints_used: practice.reduce((n, i) => n + i.hints.length, 0),
        correct_without_hints: count(practice, (i) => i.answer!.correct && i.hints.length === 0),
      },
      independent: {
        attempted: independent.length,
        correct: count(independent, (i) => i.answer!.correct),
        target: independentTarget,
        hints_used: 0,
      },
      interventions,
      unfamiliar_references: allUnfamiliar,
      self_ratings: ratings,
      confidence_mismatches: {
        confident_but_incorrect: count(
          live,
          (i) => i.self_rating === 'confident' && i.answer?.correct === false,
        ),
        unsure_but_correct: count(
          live,
          (i) => (i.self_rating === 'unsure' || i.self_rating === 'guessed') && i.answer?.correct === true,
        ),
      },
      delayed_check: 'not_measured',
    },
    items: all,
    statements: { observed, interpretation, learner_view: learnerView, not_yet_checked: notYetChecked },
    scope: 'this-skill-and-session',
  };
}
