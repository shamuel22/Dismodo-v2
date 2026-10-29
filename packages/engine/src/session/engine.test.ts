import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtinRegistry, partSize, type SetSelectionSpec } from '@dismodo/activities';
import type { DeclaredContext, EngineEvent, LearnerAction, SessionEvent } from '@dismodo/contracts';
import { handleAction, SessionActionError, startSession, type EngineContext } from './engine';
import { editorialPolicy, type AdaptationPolicy } from './policy';
import { buildReport } from './report';
import { buildRuntime } from './runtime';
import { itemById, replay, type SessionState } from './state';
import { learnerView } from './view';

const demo = JSON.parse(
  readFileSync(new URL('../../../../experiences/parts-of-a-whole/experience.json', import.meta.url), 'utf8'),
);
const runtime = buildRuntime(demo, builtinRegistry);
const T0 = Date.parse('2026-10-30T12:00:00Z');

/** Plays a session the way the API does: append the learner action, then the engine events. */
class Driver {
  log: SessionEvent[] = [];
  clock = T0;
  constructor(
    private policy: AdaptationPolicy = editorialPolicy,
    declared: DeclaredContext = {},
    seed = 7,
    readonly seenIdentities: string[] = [],
  ) {
    const at = new Date(this.clock).toISOString();
    startSession(this.ctx(), {
      experienceRef: 'parts-of-a-whole@1.0.0',
      contentHash: 'sha256:test',
      policy: policy.name,
      seed,
      declared,
    }).forEach((event) => this.push({ actor: 'engine', event }, at));
  }
  ctx(): EngineContext {
    return { runtime, policy: this.policy, now: new Date(this.clock), seenIdentities: this.seenIdentities };
  }
  private push(
    entry: { actor: 'engine'; event: EngineEvent } | { actor: 'learner'; action: LearnerAction },
    at: string,
  ) {
    this.log.push({ ...entry, seq: this.log.length + 1, at } as SessionEvent);
  }
  async act(action: LearnerAction, advanceMs = 5_000): Promise<EngineEvent[]> {
    this.clock += advanceMs;
    const { events } = await handleAction(this.ctx(), this.log, action);
    const at = new Date(this.clock).toISOString();
    this.push({ actor: 'learner', action }, at);
    events.forEach((event) => this.push({ actor: 'engine', event }, at));
    return events;
  }
  get state(): SessionState {
    return replay(this.log);
  }
  get currentItem() {
    const current = this.state.current;
    if (current.kind !== 'item') throw new Error(`No current item (${current.kind}).`);
    return itemById(this.state, current.item_id)!;
  }
  /** Answers the current item correctly or with a chosen count. */
  async answer(count?: number) {
    const item = this.currentItem;
    const spec = item.spec as SetSelectionSpec;
    const n = count ?? partSize(spec);
    return this.act({
      type: 'answer',
      item_id: item.item_id,
      response: { selected: Array.from({ length: n }, (_, i) => `e${i + 1}`) },
    });
  }
}

async function completeCorrectly(d: Driver) {
  while (d.state.status === 'active') {
    if (d.state.current.kind === 'item') await d.answer();
    await d.act({ type: 'continue' });
  }
}

describe('session flow', () => {
  it('runs baseline → practice → independent check → completed', async () => {
    const d = new Driver();
    expect(d.state.phase).toBe('baseline');
    expect(d.currentItem.hints_allowed).toBe(0);
    await completeCorrectly(d);
    const state = d.state;
    expect(state.status).toBe('completed');
    expect(state.items.map((i) => i.phase)).toEqual([
      'baseline',
      'practice',
      'practice',
      'practice',
      'independent',
      'independent',
    ]);
    const reserved = new Set(runtime.reserved.map((r) => r.identity));
    const practiceIdentities = state.items.filter((i) => i.phase !== 'independent').map((i) => i.identity);
    expect(practiceIdentities.some((id) => reserved.has(id))).toBe(false);
    expect(new Set(practiceIdentities).size).toBe(practiceIdentities.length);
    expect(state.items.filter((i) => i.phase === 'independent').map((i) => i.identity)).toEqual(
      runtime.reserved.map((r) => r.identity),
    );
    const report = buildReport(state, 2);
    expect(report.observations).toMatchObject({
      baseline: { attempted: 1, correct: 1 },
      practice: { attempted: 3, correct: 3, hints_used: 0, correct_without_hints: 3 },
      independent: { attempted: 2, correct: 2, target: 2, hints_used: 0 },
      delayed_check: 'not_measured',
    });
    expect(report.statements.not_yet_checked[0]).toMatch(/Retention/);
  });

  it('is deterministic for a seed and reproducible from its log', async () => {
    const a = new Driver(editorialPolicy, {}, 99);
    const b = new Driver(editorialPolicy, {}, 99);
    await completeCorrectly(a);
    await completeCorrectly(b);
    expect(a.state.items.map((i) => [i.identity, i.prompt])).toEqual(
      b.state.items.map((i) => [i.identity, i.prompt]),
    );
    const c = new Driver(editorialPolicy, {}, 100);
    await completeCorrectly(c);
    expect(c.state.items.map((i) => i.identity)).not.toEqual(a.state.items.map((i) => i.identity));
  });

  it('prefers problems the learner has not seen in earlier sessions', async () => {
    const first = new Driver();
    await completeCorrectly(first);
    const seen = first.state.items.filter((i) => i.phase !== 'independent').map((i) => i.identity);
    const second = new Driver(editorialPolicy, {}, 7, seen);
    await completeCorrectly(second);
    const practice = second.state.items.filter((i) => i.phase !== 'independent').map((i) => i.identity);
    // 8 practice problems exist: the 4 unseen ones are used before anything repeats.
    expect(practice.filter((id) => seen.includes(id))).toEqual([]);
  });
});

describe('support and adaptation (fixed editorial route)', () => {
  it('chooses the intervention the package suggests for the observed confusion', async () => {
    const d = new Driver();
    await d.answer(); // baseline
    await d.act({ type: 'continue' });
    const events = await d.answer(1); // reads 1/4 as "one item"
    expect(events[0]).toMatchObject({
      type: 'evaluated',
      correct: false,
      error_code: 'count_equals_numerator',
    });
    await d.act({ type: 'continue' });
    const intervention = d.state.interventions[0]!;
    expect(intervention).toMatchObject({
      intervention: 'step-by-step',
      decision: { source: 'editorial', hypothesis: expect.stringMatching(/share of the whole/) },
    });
    expect(intervention.explanation?.steps[0]).toMatch(/^First, how many \w+ are there in total\? \d+\.$/);
    expect(d.state.current.kind).toBe('explanation');
    await d.act({ type: 'continue' });
    expect(d.currentItem.phase).toBe('practice');
  });

  it('does not repeat an intervention already used and respects max_interventions', async () => {
    const d = new Driver();
    await d.answer();
    await d.act({ type: 'continue' });
    for (let i = 0; i < 3; i++) {
      await d.answer(1);
      await d.act({ type: 'continue' });
      if (d.state.current.kind === 'explanation') await d.act({ type: 'continue' });
    }
    const used = d.state.interventions.map((i) => i.intervention);
    expect(used).toEqual(['step-by-step', 'worked-example', 'essential']);
    expect(d.state.phase).toBe('independent');
  });

  it('gives progressive hints in practice only, within the limit', async () => {
    const d = new Driver();
    const baseline = d.currentItem.item_id;
    await expect(d.act({ type: 'hint_request', item_id: baseline })).rejects.toMatchObject({
      code: 'no_hints_left',
    });
    await d.answer();
    await d.act({ type: 'continue' });
    const item = d.currentItem;
    const first = await d.act({ type: 'hint_request', item_id: item.item_id });
    expect(first[0]).toMatchObject({ type: 'hint_given', level: 1 });
    const second = await d.act({ type: 'hint_request', item_id: item.item_id });
    expect((second[0] as { text: string }).text).toMatch(/How many \w+ go in each group\?/);
    await expect(d.act({ type: 'hint_request', item_id: item.item_id })).rejects.toBeInstanceOf(
      SessionActionError,
    );
    await d.answer();
    await completeCorrectly(d);
    const report = buildReport(d.state, 2);
    expect(report.observations.practice).toMatchObject({
      hints_used: 2,
      correct: 3,
      correct_without_hints: 2,
    });
    expect(d.state.items.filter((i) => i.phase === 'independent').every((i) => i.hints_allowed === 0)).toBe(
      true,
    );
  });

  it('records an unfamiliar reference separately from mistakes and swaps the context', async () => {
    const d = new Driver(editorialPolicy, { familiar_contexts: ['sports-season'] });
    const original = d.currentItem;
    expect(original.context_id).toBe('sports-season');
    const events = await d.act({ type: 'unfamiliar_reference', item_id: original.item_id });
    expect(events.map((e) => e.type)).toEqual(['intervention_started', 'context_changed', 'item_presented']);
    const replacement = d.currentItem;
    expect(replacement).toMatchObject({
      identity: original.identity,
      context_id: 'project-tasks',
      replaces: original.item_id,
    });
    expect(replacement.prompt).toMatch(/tasks/);
    await completeCorrectly(d);
    const report = buildReport(d.state, 2);
    // The swapped item is not an error; the learner's statement is reported as their view.
    expect(report.items.find((i) => i.item_id === original.item_id)).toMatchObject({
      unfamiliar_reference: true,
      correct: null,
      error_code: null,
    });
    expect(report.observations.baseline).toEqual({ attempted: 1, correct: 1 });
    expect(report.observations.unfamiliar_references).toEqual(['sports-season']);
    expect(report.statements.learner_view[0]).toBe('Marked as unfamiliar: sports-season.');
    // The sports context is not used again.
    expect(d.state.items.slice(1).every((i) => i.context_id !== 'sports-season')).toBe(true);
  });

  it('records self-ratings and confidence mismatches', async () => {
    const d = new Driver();
    const item = d.currentItem.item_id;
    await d.answer(4);
    await d.act({ type: 'self_rating', item_id: item, rating: 'confident' });
    await expect(d.act({ type: 'self_rating', item_id: item, rating: 'unsure' })).rejects.toMatchObject({
      code: 'already_rated',
    });
    await completeCorrectly(d);
    const report = buildReport(d.state, 2);
    expect(report.observations.confidence_mismatches).toEqual({
      confident_but_incorrect: 1,
      unsure_but_correct: 0,
    });
    expect(report.observations.self_ratings.confident).toBe(1);
  });

  it('lets the learner confirm or correct a hypothesis', async () => {
    const d = new Driver();
    await d.answer();
    await d.act({ type: 'continue' });
    await d.answer(1);
    await d.act({ type: 'continue' });
    await d.act({ type: 'hypothesis_feedback', agrees: false, note: 'I misread the question' });
    const report = buildReport(d.state, 2);
    expect(report.observations.interventions[0]).toMatchObject({ learner_agreed: false });
    expect(report.statements.learner_view.at(-1)).toMatch(/disagreed \("I misread the question"\)/);
  });

  it('shortens practice once when the learner reports low energy', async () => {
    const d = new Driver();
    await d.act({ type: 'energy_check', level: 'low' });
    await completeCorrectly(d);
    expect(d.state.items.filter((i) => i.phase === 'practice')).toHaveLength(2);
    expect(d.state.interventions[0]).toMatchObject({
      intervention: 'shorten-session',
      decision: { source: 'rules' },
    });
  });

  it('moves to the independent check when the time budget runs out', async () => {
    const d = new Driver();
    await d.answer();
    await d.act({ type: 'continue' });
    await d.answer();
    await d.act({ type: 'continue' }, 9 * 60_000);
    expect(d.state.phase).toBe('independent');
    expect(
      d.log.some(
        (e) => e.actor === 'engine' && e.event.type === 'phase_changed' && e.event.reason === 'time_budget',
      ),
    ).toBe(true);
  });
});

describe('controller and fallback', () => {
  it('falls back to the editorial route when the policy fails, and says so', async () => {
    const failing: AdaptationPolicy = {
      name: 'adaptive',
      afterEvaluation: async () => {
        throw new Error('provider timeout');
      },
    };
    const d = new Driver(failing);
    await d.answer();
    await d.act({ type: 'continue' });
    await d.answer(1);
    await d.act({ type: 'continue' });
    expect(d.state.interventions[0]!.decision).toMatchObject({
      source: 'fallback',
      fallback_reason: 'Policy failed: provider timeout',
    });
    expect(d.state.status).toBe('active');
  });

  it('rejects proposals outside the package and uses the fallback', async () => {
    const rogue: AdaptationPolicy = {
      name: 'adaptive',
      afterEvaluation: async () => ({
        kind: 'intervene',
        intervention: 'analogy',
        decision: { source: 'model', rationale: 'x', hypothesis: null, evidence_seqs: [] },
      }),
    };
    const d = new Driver(rogue);
    await d.answer();
    await d.act({ type: 'continue' });
    await d.answer(1);
    await d.act({ type: 'continue' });
    expect(d.state.interventions[0]!).toMatchObject({
      intervention: 'step-by-step',
      decision: {
        source: 'fallback',
        fallback_reason: 'Proposal rejected: "analogy" is not allowed by the package.',
      },
    });
  });
});

describe('guards', () => {
  it('rejects actions that do not fit the session state', async () => {
    const d = new Driver();
    await expect(d.act({ type: 'continue' })).rejects.toMatchObject({ code: 'nothing_to_continue' });
    await expect(d.act({ type: 'answer', item_id: 'i9', response: { selected: [] } })).rejects.toMatchObject({
      code: 'not_current_item',
    });
    await expect(
      d.act({ type: 'answer', item_id: d.currentItem.item_id, response: { choice: 'x' } }),
    ).rejects.toMatchObject({ code: 'invalid_response', statusCode: 400 });
    await d.act({ type: 'pause' });
    await expect(d.answer()).rejects.toMatchObject({ code: 'session_paused' });
    await d.act({ type: 'resume' });
    await completeCorrectly(d);
    await expect(d.act({ type: 'continue' })).rejects.toMatchObject({ code: 'session_closed' });
  });

  it('never exposes specs, template values or answers in the learner view', async () => {
    const d = new Driver();
    const view = learnerView({ runtime }, d.state);
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/part_size|template_values|"spec"|"fraction"/);
    expect(view.step.kind).toBe('item');
    await d.answer(1);
    const feedback = learnerView({ runtime }, d.state);
    expect(feedback.step).toMatchObject({ kind: 'feedback', result: { correct: false }, can_rate: true });
  });
});

describe('regressions from the E3 review', () => {
  it('keeps hints used before a context swap on the replacement item', async () => {
    const d = new Driver(editorialPolicy, { familiar_contexts: ['sports-season'] });
    await d.answer();
    await d.act({ type: 'continue' });
    const item = d.currentItem;
    await d.act({ type: 'hint_request', item_id: item.item_id });
    await d.act({ type: 'hint_request', item_id: item.item_id });
    await d.act({ type: 'unfamiliar_reference', item_id: item.item_id });
    const replacement = d.currentItem;
    expect(replacement.hints).toHaveLength(2);
    await expect(d.act({ type: 'hint_request', item_id: replacement.item_id })).rejects.toMatchObject({
      code: 'no_hints_left',
    });
    await d.answer();
    await completeCorrectly(d);
    expect(buildReport(d.state, 2).observations.practice).toMatchObject({
      hints_used: 2,
      correct_without_hints: 2,
    });
  });

  it('counts flow interventions toward max_interventions', async () => {
    const strict = buildRuntime(
      { ...structuredClone(demo), session_policy: { ...demo.session_policy, max_interventions: 0 } },
      builtinRegistry,
    );
    const ctx = (_log: SessionEvent[]): EngineContext => ({
      runtime: strict,
      policy: editorialPolicy,
      now: new Date(T0),
    });
    const at = new Date(T0).toISOString();
    const log: SessionEvent[] = startSession(ctx([]), {
      experienceRef: 'x@1.0.0',
      contentHash: 'h',
      policy: 'fixed',
      seed: 1,
      declared: {},
    }).map((event, i) => ({ seq: i + 1, at, actor: 'engine', event }));
    const itemId = (replay(log).current as { item_id: string }).item_id;
    const swap = await handleAction(ctx(log), log, { type: 'unfamiliar_reference', item_id: itemId });
    expect(swap.events).toEqual([]);
    const tired = await handleAction(ctx(log), log, { type: 'energy_check', level: 'low' });
    expect(tired.events).toEqual([]);
  });

  it('reports every context ever marked unfamiliar', async () => {
    const d = new Driver();
    for (let i = 0; i < 3; i++) await d.act({ type: 'unfamiliar_reference', item_id: d.currentItem.item_id });
    expect(buildReport(d.state, 2).observations.unfamiliar_references.sort()).toEqual([
      'materials',
      'project-tasks',
      'sports-season',
    ]);
    await expect(
      d.act({ type: 'unfamiliar_reference', item_id: d.currentItem.item_id }),
    ).rejects.toMatchObject({
      code: 'already_flagged',
    });
  });
});
