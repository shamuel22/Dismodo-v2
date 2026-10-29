import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModelPolicy, ModelError, type DecisionModel } from '@dismodo/adaptation';
import { editorialPolicy } from '@dismodo/engine';
import { createDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { buildServer } from '../server';
import { ATTESTATION_STATEMENT } from '../services/packages';
import { createApiKey, ensureTenant } from '../services/tenants';

const demo = JSON.parse(
  readFileSync(new URL('../../../../experiences/parts-of-a-whole/experience.json', import.meta.url), 'utf8'),
);
let calls = 0;
/** Fails on its first call (timeout), then proposes "contrast" citing the latest evidence. */
const flaky: DecisionModel = {
  provider: 'test',
  model: 'flaky-1',
  async complete(req) {
    calls++;
    if (calls === 1) throw new ModelError('timeout', 'deadline exceeded', 8000);
    const user = JSON.parse(req.user);
    return {
      content: JSON.stringify({
        action: 'intervene',
        intervention: user.candidates.find((c: { id: string }) => c.id === 'contrast')
          ? 'contrast'
          : user.candidates[1].id,
        hypothesis: 'Took the remaining part instead of the asked part.',
        rationale: 'Comparing both parts makes the asked one clear.',
        evidence_seqs: [user.evidence.at(-1).seq],
        bridge: '',
      }),
      latency_ms: 1400,
      input_tokens: 900,
      output_tokens: 120,
      reasoning_tokens: 60,
    };
  },
};

const database = createDatabase(process.env.DATABASE_URL!);
const app = buildServer({
  db: database.db,
  logLevel: 'silent',
  policies: {
    adaptive: createModelPolicy({ routine: { model: flaky, timeoutMs: 1000, maxTokens: 500 } }),
    fixed: editorialPolicy,
  },
  decisionModels: [{ tier: 'routine', provider: 'test', model: 'flaky-1', fault: null }],
});
const experienceId = `adaptive-${randomUUID().slice(0, 8)}`;
let key = '';

beforeAll(async () => {
  await runMigrations(database.db);
  const tenant = await ensureTenant(database.db, `adapt-${randomUUID().slice(0, 8)}`, 'Adaptive');
  key = (await createApiKey(database.db, tenant.id, 'test')).key;
  await call('POST', '/v1/packages', { ...demo, experience_id: experienceId });
  await call('POST', `/v1/packages/${experienceId}/1.0.0/publish`, {
    attestation: { reviewer: 'QA', statement: ATTESTATION_STATEMENT },
  });
});
afterAll(async () => {
  await app.close();
  await database.close();
});

function call(method: 'GET' | 'POST', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${key}` },
    ...(payload ? { payload: payload as object } : {}),
  });
}

async function playWithMistakes(policy: 'adaptive' | 'fixed') {
  const created = (
    await call('POST', '/v1/sessions', { experience: experienceId, learner_ref: `l-${policy}`, policy })
  ).json();
  const id = created.session.session_id;
  let view = created.view;
  let wrong = 2;
  while (view.status === 'active') {
    let action: unknown = { type: 'continue' };
    if (view.step.kind === 'item') {
      const total = view.step.item.view.total;
      const practice = view.step.item.phase === 'practice';
      const count = practice && wrong-- > 0 ? total - total / 4 : total / 4; // "took the rest", then right
      action = {
        type: 'answer',
        item_id: view.step.item.item_id,
        response: { selected: Array.from({ length: count }, (_, i) => `e${i + 1}`) },
      };
    }
    const res = await call('POST', `/v1/sessions/${id}/events`, { action });
    expect(res.statusCode, res.body).toBe(200);
    view = res.json().view;
  }
  return id as string;
}

describe('adaptive sessions through the API', () => {
  it('reports configured models on /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json().decision_models).toEqual([
      { tier: 'routine', provider: 'test', model: 'flaky-1', fault: null },
    ]);
  });

  it('traces model calls, fallbacks and the fixed-vs-adaptive comparison', async () => {
    const adaptive = await playWithMistakes('adaptive');
    await playWithMistakes('fixed');

    const events = (await call('GET', `/v1/sessions/${adaptive}/events`)).json().events;
    const decisions = events
      .filter(
        (e: { actor: string; event?: { type: string } }) =>
          e.actor === 'engine' && e.event?.type === 'intervention_started',
      )
      .map((e: { event: { decision: { source: string } } }) => e.event.decision.source);
    expect(decisions).toEqual(['fallback', 'model']);

    const metrics = (await call('GET', '/v1/metrics/decisions')).json();
    expect(metrics.models).toEqual([
      expect.objectContaining({
        provider: 'test',
        model: 'flaky-1',
        tier: 'routine',
        calls: 2,
        ok: 1,
        failures: { timeout: 1 },
      }),
    ]);
    expect(metrics.routes.map((r: { policy: string }) => r.policy)).toEqual(['adaptive', 'fixed']);
    for (const route of metrics.routes) {
      expect(route).toMatchObject({
        sessions: 1,
        completed: 1,
        independent_attempted: 2,
        practice_attempted: 3,
      });
    }
    expect(metrics.decisions).toEqual(
      expect.arrayContaining([
        { source: 'editorial', type: 'intervention_started', n: 2 },
        { source: 'fallback', type: 'intervention_started', n: 1 },
        { source: 'model', type: 'intervention_started', n: 1 },
      ]),
    );
  });
});
