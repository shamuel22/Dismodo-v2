import {
  deriveSeed,
  renderTemplate,
  seededRng,
  type DeclaredContext,
  type EngineEvent,
  type LearnerAction,
  type SessionEvent,
  type SessionPhase,
} from '@dismodo/contracts';
import {
  checkProposal,
  editorialPolicy,
  renderExplanation,
  type AdaptationPolicy,
  type Decision,
} from './policy';
import { ENGINE_VERSION, type PackageRuntime } from './runtime';
import { apply, itemById, liveItems, replay, type ItemRecord, type SessionState } from './state';

/** An action the session cannot take in its current state. Nothing is recorded. */
export class SessionActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

export interface EngineContext {
  runtime: PackageRuntime;
  policy: AdaptationPolicy;
  now: Date;
  /** Problem identities this learner already saw in earlier sessions of the same skill. */
  seenIdentities?: readonly string[];
}

/** Accumulates engine events while keeping the working state in sync. */
class Emitter {
  readonly events: EngineEvent[] = [];
  constructor(
    public state: SessionState,
    private readonly at: string,
  ) {}
  emit(event: EngineEvent) {
    this.events.push(event);
    this.state = apply(this.state, { seq: this.state.last_seq + 1, at: this.at, actor: 'engine', event });
  }
}

export interface StartOptions {
  experienceRef: string;
  contentHash: string;
  policy: 'adaptive' | 'fixed';
  seed: number;
  declared: DeclaredContext;
}

/** Events that open a session: the start record and the first item. */
export function startSession(ctx: EngineContext, options: StartOptions): EngineEvent[] {
  const at = ctx.now.toISOString();
  const started: EngineEvent = {
    type: 'session_started',
    experience_ref: options.experienceRef,
    content_hash: options.contentHash,
    components: { activity: ctx.runtime.activity.revision, evaluator: ctx.runtime.evaluator.revision },
    engine_version: ENGINE_VERSION,
    policy: options.policy,
    seed: options.seed >>> 0,
    declared: options.declared,
  };
  const em = new Emitter(replay([{ seq: 1, at, actor: 'engine', event: started }]), at);
  const phase = ctx.runtime.pkg.session_policy.baseline ? 'baseline' : 'practice';
  if (phase === 'practice')
    em.emit({ type: 'phase_changed', from: 'baseline', to: 'practice', reason: 'no_baseline' });
  presentNew(ctx, em, phase);
  return [started, ...em.events];
}

/**
 * Validates a learner action against the session and returns the engine events it causes. The caller
 * stores the action and the events atomically, in order, right after the current log.
 */
export async function handleAction(
  ctx: EngineContext,
  log: readonly SessionEvent[],
  action: LearnerAction,
): Promise<{ events: EngineEvent[]; state: SessionState }> {
  const before = replay(log);
  validateAction(ctx.runtime, before, action);
  const at = ctx.now.toISOString();
  const afterAction = apply(before, { seq: before.last_seq + 1, at, actor: 'learner', action });
  const em = new Emitter(afterAction, at);

  switch (action.type) {
    case 'answer': {
      const item = itemById(em.state, action.item_id)!;
      const response = ctx.runtime.activity.responseSchema.safeParse(action.response);
      if (!response.success) {
        throw new SessionActionError('invalid_response', 'The response does not match this activity.', 400);
      }
      const result = ctx.runtime.evaluator.evaluate(ctx.runtime.evaluatorConfig, item.spec, response.data);
      em.emit({
        type: 'evaluated',
        item_id: item.item_id,
        correct: result.correct,
        error_code: result.error_code,
        alternative_codes: result.alternative_codes,
        feedback: result.feedback,
        evaluator: ctx.runtime.evaluator.revision,
      });
      break;
    }
    case 'hint_request': {
      const item = itemById(em.state, action.item_id)!;
      const level = item.hints.length + 1;
      em.emit({
        type: 'hint_given',
        item_id: item.item_id,
        level,
        text: renderTemplate(ctx.runtime.pkg.hints[level - 1]!, item.template_values),
      });
      break;
    }
    case 'unfamiliar_reference':
      swapContext(ctx, em, itemById(em.state, action.item_id)!);
      break;
    case 'energy_check':
      if (action.level === 'low') shortenSession(ctx, em);
      break;
    case 'continue':
      if (em.state.current.kind === 'feedback') {
        const item = itemById(em.state, em.state.current.item_id)!;
        const intervened = await maybeIntervene(ctx, em, item);
        if (!intervened) advance(ctx, em);
      } else {
        advance(ctx, em);
      }
      break;
    case 'pause':
      em.emit({ type: 'status_changed', to: 'paused', reason: 'learner_paused' });
      break;
    case 'resume':
      em.emit({ type: 'status_changed', to: 'active', reason: 'learner_resumed' });
      break;
    case 'abandon':
      em.emit({ type: 'status_changed', to: 'abandoned', reason: 'learner_left' });
      break;
    case 'self_rating':
    case 'hypothesis_feedback':
      // Recorded as learner evidence; the adaptive policy reads them at the next decision.
      break;
  }
  return { events: em.events, state: em.state };
}

function validateAction(runtime: PackageRuntime, state: SessionState, action: LearnerAction): void {
  if (state.status === 'completed' || state.status === 'abandoned') {
    throw new SessionActionError('session_closed', `The session is ${state.status}.`);
  }
  if (state.status === 'paused' && !['resume', 'abandon', 'energy_check'].includes(action.type)) {
    throw new SessionActionError('session_paused', 'Resume the session first.');
  }
  const current = state.current;
  const currentItem = (itemId: string) => {
    if (current.kind !== 'item' || current.item_id !== itemId) {
      throw new SessionActionError('not_current_item', `${itemId} is not the item waiting for an answer.`);
    }
    return itemById(state, itemId)!;
  };
  switch (action.type) {
    case 'answer':
      currentItem(action.item_id);
      return;
    case 'unfamiliar_reference':
      if (currentItem(action.item_id).unfamiliar) {
        throw new SessionActionError('already_flagged', 'This example is already marked as unfamiliar.');
      }
      return;
    case 'hint_request': {
      const item = currentItem(action.item_id);
      if (item.hints.length >= item.hints_allowed) {
        throw new SessionActionError(
          'no_hints_left',
          item.hints_allowed === 0 ? 'This item is answered without hints.' : 'No more hints for this item.',
        );
      }
      if (item.hints.length >= runtime.pkg.hints.length)
        throw new SessionActionError('no_hints_left', 'No more hints.');
      return;
    }
    case 'self_rating': {
      const item = itemById(state, action.item_id);
      if (!item?.answer) throw new SessionActionError('not_answered', 'Rate an item after answering it.');
      if (item.self_rating) throw new SessionActionError('already_rated', 'This item already has a rating.');
      return;
    }
    case 'hypothesis_feedback': {
      const last = state.interventions.at(-1);
      if (!last?.decision.hypothesis) {
        throw new SessionActionError('no_hypothesis', 'There is no hypothesis to confirm or correct.');
      }
      if (last.learner_feedback)
        throw new SessionActionError('already_answered', 'Feedback was already given.');
      return;
    }
    case 'continue':
      if (current.kind !== 'feedback' && current.kind !== 'explanation') {
        throw new SessionActionError('nothing_to_continue', 'Answer the current item first.');
      }
      return;
    case 'pause':
      if (state.status !== 'active') throw new SessionActionError('not_active', 'The session is not active.');
      return;
    case 'resume':
      if (state.status !== 'paused') throw new SessionActionError('not_paused', 'The session is not paused.');
      return;
    case 'energy_check':
    case 'abandon':
      return;
  }
}

async function maybeIntervene(ctx: EngineContext, em: Emitter, item: ItemRecord): Promise<boolean> {
  if (em.state.phase === 'independent') return false;
  const input = { runtime: ctx.runtime, state: em.state, item };
  let decision: Decision;
  let fallbackReason: string | null = null;
  try {
    decision = await ctx.policy.afterEvaluation(input);
    if (decision.kind === 'intervene') {
      const verdict = checkProposal(ctx.runtime, em.state, decision.intervention);
      if (!verdict.ok) fallbackReason = `Proposal rejected: ${verdict.reason}`;
    }
  } catch (error) {
    fallbackReason = `Policy failed: ${(error as Error).message}`;
    decision = { kind: 'continue' };
  }
  if (fallbackReason !== null) {
    decision = await editorialPolicy.afterEvaluation(input);
    if (decision.kind === 'intervene') {
      if (!checkProposal(ctx.runtime, em.state, decision.intervention).ok) return false;
      decision = {
        ...decision,
        decision: { ...decision.decision, source: 'fallback', fallback_reason: fallbackReason },
      };
    }
  }
  if (decision.kind !== 'intervene') return false;
  em.emit({
    type: 'intervention_started',
    intervention: decision.intervention,
    explanation: renderExplanation(ctx.runtime, decision.intervention, item),
    decision: decision.decision,
  });
  return em.state.current.kind === 'explanation';
}

/** Re-renders the current problem in a reference the learner has not marked unfamiliar. */
function swapContext(ctx: EngineContext, em: Emitter, item: ItemRecord) {
  if (!checkProposal(ctx.runtime, em.state, 'swap-context').ok) return;
  const target = contextPreference(ctx, em.state).find((id) => id !== item.context_id);
  if (!target) return;
  em.emit({
    type: 'intervention_started',
    intervention: 'swap-context',
    explanation: null,
    decision: {
      source: 'rules',
      rationale: `The learner marked "${ctx.runtime.contexts.get(item.context_id)?.label}" as unfamiliar; the same problem is shown with another reference.`,
      hypothesis: 'The example was unfamiliar; this says nothing about the concept itself.',
      evidence_seqs: [item.presented_seq, em.state.last_seq],
    },
  });
  em.emit({ type: 'context_changed', from: item.context_id, to: target, reason: 'unfamiliar_reference' });
  present(ctx, em, item.phase, item.spec, target, item.item_id);
}

/** Shortens today's practice once when the learner reports low energy (if the package allows it). */
function shortenSession(ctx: EngineContext, em: Emitter) {
  if (!checkProposal(ctx.runtime, em.state, 'shorten-session').ok) return;
  if (em.state.interventions.some((i) => i.intervention === 'shorten-session')) return;
  em.emit({
    type: 'intervention_started',
    intervention: 'shorten-session',
    explanation: null,
    decision: {
      source: 'rules',
      rationale: `The learner reported low energy; practice is shortened to ${practiceTarget(ctx, em.state)} item(s) and progress is kept.`,
      hypothesis: null,
      evidence_seqs: [em.state.last_seq],
    },
  });
}

export function practiceTarget(ctx: EngineContext, state: SessionState): number {
  const planned = ctx.runtime.pkg.session_policy.practice_items;
  const shortened = state.interventions.some((i) => i.intervention === 'shorten-session');
  return shortened ? Math.max(1, Math.ceil(planned / 2)) : planned;
}

function answeredCount(state: SessionState, phase: SessionPhase): number {
  return liveItems(state, phase).filter((item) => item.answer).length;
}

function changePhase(em: Emitter, to: SessionPhase, reason: string) {
  em.emit({ type: 'phase_changed', from: em.state.phase, to, reason });
}

/** Moves the session forward after feedback or an explanation. */
function advance(ctx: EngineContext, em: Emitter) {
  const policy = ctx.runtime.pkg.session_policy;
  const state = em.state;
  const overBudget = ctx.now.getTime() - Date.parse(state.started_at) > policy.time_budget_minutes * 60_000;

  if (state.phase === 'baseline') {
    changePhase(em, 'practice', 'baseline_done');
    return presentNew(ctx, em, 'practice');
  }
  if (state.phase === 'practice') {
    const done = answeredCount(state, 'practice');
    if (done < practiceTarget(ctx, state) && !(overBudget && done >= 1))
      return presentNew(ctx, em, 'practice');
    changePhase(
      em,
      'independent',
      overBudget && done < practiceTarget(ctx, state) ? 'time_budget' : 'practice_done',
    );
    return presentNew(ctx, em, 'independent');
  }
  if (state.phase === 'independent' && answeredCount(state, 'independent') < policy.independent_items) {
    return presentNew(ctx, em, 'independent');
  }
  changePhase(em, 'done', 'checks_done');
  em.emit({ type: 'status_changed', to: 'completed', reason: 'all_items_done' });
}

/** Familiar contexts first (as declared), then the package order; never ones marked unfamiliar. */
function contextPreference(ctx: EngineContext, state: SessionState): string[] {
  const declared = (state.declared.familiar_contexts ?? []).filter((id) => ctx.runtime.contexts.has(id));
  const ordered = [...new Set([...declared, ...ctx.runtime.contexts.keys()])];
  return ordered.filter((id) => !state.unfamiliar_contexts.includes(id));
}

function currentContext(ctx: EngineContext, state: SessionState): string {
  if (state.context_id && !state.unfamiliar_contexts.includes(state.context_id)) return state.context_id;
  return contextPreference(ctx, state)[0] ?? state.context_id ?? ctx.runtime.pkg.contexts[0]!.id;
}

function presentNew(ctx: EngineContext, em: Emitter, phase: Exclude<SessionPhase, 'done'>) {
  const { runtime } = ctx;
  const state = em.state;
  if (phase === 'independent') {
    const reserved = runtime.reserved[liveItems(state, 'independent').length]!;
    // A held-out problem keeps its identity in any context, so an unfamiliar reference is swapped out.
    const context = state.unfamiliar_contexts.includes(reserved.context_id)
      ? currentContext(ctx, state)
      : reserved.context_id;
    return present(ctx, em, phase, reserved.spec, context);
  }
  const seenHere = new Set(state.items.map((item) => item.identity));
  const seenBefore = new Set(ctx.seenIdentities ?? []);
  const identity = (spec: unknown) => runtime.activity.specIdentity(spec);
  const fresh = runtime.practicePool.filter(
    (s) => !seenHere.has(identity(s)) && !seenBefore.has(identity(s)),
  );
  const notInSession = runtime.practicePool.filter((s) => !seenHere.has(identity(s)));
  const candidates = fresh.length > 0 ? fresh : notInSession.length > 0 ? notInSession : runtime.practicePool;
  const rng = seededRng(deriveSeed(state.seed, 1000 + state.items.length));
  present(ctx, em, phase, rng.pick(candidates), currentContext(ctx, state));
}

function present(
  ctx: EngineContext,
  em: Emitter,
  phase: Exclude<SessionPhase, 'done'>,
  spec: unknown,
  contextId: string,
  replaces?: string,
) {
  const { runtime } = ctx;
  const context = runtime.contexts.get(contextId)!;
  const itemNumber = em.state.items.length + 1;
  const rendered = runtime.activity.render(
    spec,
    { id: context.id, nouns: context.nouns, scenario_template: context.scenario_template },
    seededRng(deriveSeed(em.state.seed, itemNumber)),
  );
  em.emit({
    type: 'item_presented',
    item_id: `i${itemNumber}`,
    phase,
    identity: runtime.activity.specIdentity(spec),
    spec,
    context_id: contextId,
    prompt: rendered.prompt,
    view: rendered.view,
    template_values: { ...rendered.template_values },
    hints_allowed:
      phase === 'practice'
        ? Math.min(runtime.pkg.session_policy.max_hints_per_item, runtime.pkg.hints.length)
        : 0,
    ...(replaces ? { replaces } : {}),
  });
}
