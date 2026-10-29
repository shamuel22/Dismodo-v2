import type { RenderedExplanation, SessionPhase, SessionStatus } from '@dismodo/contracts';
import { practiceTarget, type EngineContext } from './engine';
import type { PackageRuntime } from './runtime';
import { itemById, liveItems, type ItemRecord, type SessionState } from './state';

export interface LearnerItemView {
  item_id: string;
  phase: Exclude<SessionPhase, 'done'>;
  prompt: string;
  view: unknown;
  context: { id: string; label: string };
  hints: string[];
  hints_left: number;
}

export interface LearnerView {
  status: SessionStatus;
  phase: SessionPhase;
  experience: { title: string; objective: string };
  progress: {
    practice: { done: number; target: number };
    independent: { done: number; target: number };
  };
  step:
    | { kind: 'item'; item: LearnerItemView; can_flag_unfamiliar: boolean }
    | {
        kind: 'feedback';
        item: LearnerItemView;
        result: { correct: boolean; feedback: string };
        can_rate: boolean;
      }
    | {
        kind: 'explanation';
        explanation: RenderedExplanation;
        /** Shown so the learner can say whether it fits; provisional by definition. */
        hypothesis: string | null;
        can_give_feedback: boolean;
      }
    | { kind: 'done' };
  /** Most recent change the engine made and why, in plain words. */
  notice: string | null;
  contexts: { id: string; label: string }[];
}

function itemView(runtime: PackageRuntime, item: ItemRecord): LearnerItemView {
  return {
    item_id: item.item_id,
    phase: item.phase,
    prompt: item.prompt,
    view: item.view,
    context: { id: item.context_id, label: runtime.contexts.get(item.context_id)?.label ?? item.context_id },
    hints: item.hints,
    hints_left: Math.max(0, item.hints_allowed - item.hints.length),
  };
}

/** What a learner-facing client may show. Never includes specs, template values or answer keys. */
export function learnerView(ctx: Pick<EngineContext, 'runtime'>, state: SessionState): LearnerView {
  const { runtime } = ctx;
  const current = state.current;
  let step: LearnerView['step'] = { kind: 'done' };
  if (current.kind === 'item') {
    const item = itemById(state, current.item_id)!;
    step = {
      kind: 'item',
      item: itemView(runtime, item),
      can_flag_unfamiliar: !item.unfamiliar,
    };
  } else if (current.kind === 'feedback') {
    const item = itemById(state, current.item_id)!;
    step = {
      kind: 'feedback',
      item: itemView(runtime, item),
      result: { correct: item.answer!.correct, feedback: item.answer!.feedback },
      can_rate: !item.self_rating,
    };
  } else if (current.kind === 'explanation') {
    const intervention = state.interventions.find((i) => i.seq === current.seq)!;
    step = {
      kind: 'explanation',
      explanation: intervention.explanation!,
      hypothesis: intervention.decision.hypothesis,
      can_give_feedback: intervention.decision.hypothesis !== null && !intervention.learner_feedback,
    };
  }
  const lastFlow = [...state.interventions].reverse().find((i) => !i.explanation);
  return {
    status: state.status,
    phase: state.phase,
    experience: { title: runtime.pkg.title, objective: runtime.pkg.objective },
    progress: {
      practice: {
        done: liveItems(state, 'practice').filter((i) => i.answer).length,
        target: practiceTarget({ runtime } as EngineContext, state),
      },
      independent: {
        done: liveItems(state, 'independent').filter((i) => i.answer).length,
        target: runtime.pkg.session_policy.independent_items,
      },
    },
    step,
    notice: lastFlow && lastFlow.seq >= state.last_seq - 3 ? lastFlow.decision.rationale : null,
    contexts: runtime.pkg.contexts.map((c) => ({ id: c.id, label: c.label })),
  };
}
