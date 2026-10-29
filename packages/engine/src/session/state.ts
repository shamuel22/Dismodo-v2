import type {
  DecisionRecord,
  DeclaredContext,
  EnergyLevel,
  EngineEvent,
  InterventionId,
  LearnerAction,
  RenderedExplanation,
  SelfRating,
  SessionEvent,
  SessionPhase,
  SessionStatus,
} from '@dismodo/contracts';

export interface ItemRecord {
  item_id: string;
  phase: Exclude<SessionPhase, 'done'>;
  identity: string;
  spec: unknown;
  context_id: string;
  prompt: string;
  view: unknown;
  template_values: Record<string, string | number>;
  hints_allowed: number;
  hints: string[];
  presented_seq: number;
  presented_at: string;
  replaces?: string;
  replaced_by?: string;
  unfamiliar: boolean;
  answer?: {
    seq: number;
    at: string;
    response: unknown;
    correct: boolean;
    error_code: string | null;
    alternative_codes: string[];
    feedback: string;
  };
  self_rating?: SelfRating;
}

export interface InterventionRecord {
  seq: number;
  at: string;
  intervention: InterventionId;
  explanation: RenderedExplanation | null;
  decision: DecisionRecord;
  /** Item whose result led to the intervention. */
  after_item: string | null;
  learner_feedback?: { agrees: boolean; note?: string; seq: number };
}

export type CurrentStep =
  | { kind: 'item'; item_id: string }
  | { kind: 'feedback'; item_id: string }
  | { kind: 'explanation'; seq: number }
  | { kind: 'done' };

export interface SessionState {
  experience_ref: string;
  content_hash: string;
  components: { activity: string; evaluator: string };
  engine_version: string;
  policy: 'adaptive' | 'fixed';
  seed: number;
  declared: DeclaredContext;
  started_at: string;
  status: SessionStatus;
  phase: SessionPhase;
  current: CurrentStep;
  items: ItemRecord[];
  interventions: InterventionRecord[];
  context_id: string | null;
  unfamiliar_contexts: string[];
  energy: EnergyLevel | null;
  last_seq: number;
  last_at: string;
  completed_at: string | null;
}

export function itemById(state: SessionState, itemId: string): ItemRecord | undefined {
  return state.items.find((item) => item.item_id === itemId);
}

/** Items that count toward results: answered or pending, but not ones re-rendered in another context. */
export function liveItems(state: SessionState, phase?: SessionPhase): ItemRecord[] {
  return state.items.filter((item) => !item.replaced_by && (!phase || item.phase === phase));
}

/** Rebuilds session state from its event log. Pure and deterministic. */
export function replay(events: readonly SessionEvent[]): SessionState {
  const [first, ...rest] = events;
  if (!first || first.actor !== 'engine' || first.event.type !== 'session_started') {
    throw new Error('A session log must start with session_started.');
  }
  const started = first.event;
  let state: SessionState = {
    experience_ref: started.experience_ref,
    content_hash: started.content_hash,
    components: started.components,
    engine_version: started.engine_version,
    policy: started.policy,
    seed: started.seed,
    declared: started.declared,
    started_at: first.at,
    status: 'active',
    phase: 'baseline',
    current: { kind: 'done' },
    items: [],
    interventions: [],
    context_id: null,
    unfamiliar_contexts: [],
    energy: started.declared.energy ?? null,
    last_seq: first.seq,
    last_at: first.at,
    completed_at: null,
  };
  for (const event of rest) state = apply(state, event);
  return state;
}

export function apply(state: SessionState, event: SessionEvent): SessionState {
  const next: SessionState = {
    ...state,
    items: state.items.map((item) => ({ ...item, hints: [...item.hints] })),
    interventions: [...state.interventions],
    unfamiliar_contexts: [...state.unfamiliar_contexts],
    last_seq: event.seq,
    last_at: event.at,
  };
  if (event.actor === 'learner') applyLearner(next, event.seq, event.action);
  else applyEngine(next, event.seq, event.at, event.event);
  return next;
}

function applyLearner(state: SessionState, seq: number, action: LearnerAction) {
  switch (action.type) {
    case 'answer': {
      // The engine's "evaluated" event carries the result; the raw response is kept for evidence.
      const item = itemById(state, action.item_id);
      if (item)
        item.answer = { ...(item.answer ?? emptyAnswer(seq, state.last_at)), response: action.response };
      return;
    }
    case 'unfamiliar_reference': {
      const item = itemById(state, action.item_id);
      if (item) {
        item.unfamiliar = true;
        if (!state.unfamiliar_contexts.includes(item.context_id))
          state.unfamiliar_contexts.push(item.context_id);
      }
      return;
    }
    case 'self_rating': {
      const item = itemById(state, action.item_id);
      if (item) item.self_rating = action.rating;
      return;
    }
    case 'hypothesis_feedback': {
      const last = state.interventions.at(-1);
      if (last) {
        state.interventions[state.interventions.length - 1] = {
          ...last,
          learner_feedback: { agrees: action.agrees, ...(action.note ? { note: action.note } : {}), seq },
        };
      }
      return;
    }
    case 'energy_check':
      state.energy = action.level;
      return;
    default:
      // hint_request, continue, pause, resume and abandon take effect through engine events.
      return;
  }
}

function emptyAnswer(seq: number, at: string): NonNullable<ItemRecord['answer']> {
  return { seq, at, response: null, correct: false, error_code: null, alternative_codes: [], feedback: '' };
}

function applyEngine(state: SessionState, seq: number, at: string, event: EngineEvent) {
  switch (event.type) {
    case 'session_started':
      throw new Error('session_started can only be the first event.');
    case 'item_presented': {
      state.items.push({
        item_id: event.item_id,
        phase: event.phase,
        identity: event.identity,
        spec: event.spec,
        context_id: event.context_id,
        prompt: event.prompt,
        view: event.view,
        template_values: event.template_values,
        hints_allowed: event.hints_allowed,
        hints: [],
        presented_seq: seq,
        presented_at: at,
        unfamiliar: false,
        ...(event.replaces ? { replaces: event.replaces } : {}),
      });
      if (event.replaces) {
        const old = itemById(state, event.replaces);
        if (old) old.replaced_by = event.item_id;
      }
      state.context_id = event.context_id;
      state.phase = event.phase;
      state.current = { kind: 'item', item_id: event.item_id };
      return;
    }
    case 'evaluated': {
      const item = itemById(state, event.item_id);
      if (item) {
        item.answer = {
          seq,
          at,
          response: item.answer?.response ?? null,
          correct: event.correct,
          error_code: event.error_code,
          alternative_codes: event.alternative_codes,
          feedback: event.feedback,
        };
      }
      state.current = { kind: 'feedback', item_id: event.item_id };
      return;
    }
    case 'hint_given': {
      itemById(state, event.item_id)?.hints.push(event.text);
      return;
    }
    case 'context_changed':
      state.context_id = event.to;
      return;
    case 'intervention_started': {
      const lastAnswered = [...state.items].reverse().find((item) => item.answer);
      state.interventions.push({
        seq,
        at,
        intervention: event.intervention,
        explanation: event.explanation,
        decision: event.decision,
        after_item: lastAnswered?.item_id ?? null,
      });
      state.current = event.explanation ? { kind: 'explanation', seq } : state.current;
      return;
    }
    case 'phase_changed':
      state.phase = event.to;
      if (event.to === 'done') state.current = { kind: 'done' };
      return;
    case 'status_changed':
      state.status = event.to;
      if (event.to === 'completed' || event.to === 'abandoned') {
        state.completed_at = at;
        state.current = { kind: 'done' };
      }
      return;
  }
}
