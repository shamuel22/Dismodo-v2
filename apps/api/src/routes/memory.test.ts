import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { buildServer } from '../server';
import { ATTESTATION_STATEMENT } from '../services/packages';
import { createApiKey, ensureTenant } from '../services/tenants';

const demo = JSON.parse(
  readFileSync(new URL('../../../../experiences/parts-of-a-whole/experience.json', import.meta.url), 'utf8'),
);
const database = createDatabase(process.env.DATABASE_URL!);
const app = buildServer({ db: database.db, logLevel: 'silent' });
const keys = { a: '', b: '' };
const experienceId = `memory-${randomUUID().slice(0, 8)}`;
// Same content, different skill: memory must not carry over.
const otherSkillId = `memory-other-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  await runMigrations(database.db);
  const suffix = randomUUID().slice(0, 8);
  const a = await ensureTenant(database.db, `mem-a-${suffix}`, 'Memory A');
  const b = await ensureTenant(database.db, `mem-b-${suffix}`, 'Memory B');
  keys.a = (await createApiKey(database.db, a.id, 'test')).key;
  keys.b = (await createApiKey(database.db, b.id, 'test')).key;
  for (const [key, pkg] of [
    [keys.a, { ...demo, experience_id: experienceId }],
    [keys.a, { ...demo, experience_id: otherSkillId, skill: { id: 'another-skill', name: 'Another skill' } }],
    [keys.b, { ...demo, experience_id: experienceId }],
  ] as const) {
    expect((await call(key, 'POST', '/v1/packages', pkg)).statusCode).toBe(201);
    await call(key, 'POST', `/v1/packages/${pkg.experience_id}/1.0.0/publish`, {
      attestation: { reviewer: 'QA', statement: ATTESTATION_STATEMENT },
    });
  }
});
afterAll(async () => {
  await app.close();
  await database.close();
});

function call(key: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${key}` },
    ...(payload ? { payload: payload as object } : {}),
  });
}

async function start(key: string, experience: string, learner: string, extra: Record<string, unknown> = {}) {
  const res = await call(key, 'POST', '/v1/sessions', { experience, learner_ref: learner, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

/** Session 1: the learner says the first reference (Work project) is unfamiliar, then finishes. */
async function sessionMarkingWorkUnfamiliar(key: string, learner: string) {
  const { session, view } = await start(key, experienceId, learner);
  expect(view.step.item.context.id).toBe('project-tasks');
  let v = (
    await call(key, 'POST', `/v1/sessions/${session.session_id}/events`, {
      action: { type: 'unfamiliar_reference', item_id: view.step.item.item_id },
    })
  ).json().view;
  while (v.status === 'active') {
    const action =
      v.step.kind === 'item'
        ? {
            type: 'answer',
            item_id: v.step.item.item_id,
            response: { selected: Array.from({ length: v.step.item.view.total / 4 }, (_, i) => `e${i + 1}`) },
          }
        : { type: 'continue' };
    v = (await call(key, 'POST', `/v1/sessions/${session.session_id}/events`, { action })).json().view;
  }
}

describe('memory per skill (A7)', () => {
  it('lets an earlier session change where the next one starts, and says so', async () => {
    const learner = `l-${randomUUID().slice(0, 6)}`;
    await sessionMarkingWorkUnfamiliar(keys.a, learner);
    const second = await start(keys.a, experienceId, learner);
    expect(second.view.step.item.context.id).toBe('materials');
    const evidence = (await call(keys.a, 'GET', `/v1/sessions/${second.session.session_id}/evidence`)).json();
    expect(evidence.history).toEqual({
      sessions: 1,
      effects: [
        'Marked unfamiliar in an earlier session, so used last: Work project.',
        'Earlier support and its outcomes are available to the decision service as provisional evidence.',
      ],
    });
  });

  it('lets a declaration made now outweigh an older one', async () => {
    const learner = `l-${randomUUID().slice(0, 6)}`;
    await sessionMarkingWorkUnfamiliar(keys.a, learner);
    const second = await start(keys.a, experienceId, learner, {
      declared: { familiar_contexts: ['project-tasks'] },
    });
    expect(second.view.step.item.context.id).toBe('project-tasks');
  });

  it('keeps the fixed route free of history, as a clean comparison arm', async () => {
    const learner = `l-${randomUUID().slice(0, 6)}`;
    await sessionMarkingWorkUnfamiliar(keys.a, learner);
    const fixed = await start(keys.a, experienceId, learner, { policy: 'fixed' });
    expect(fixed.view.step.item.context.id).toBe('project-tasks');
  });

  it('never carries memory across skills or tenants', async () => {
    const learner = `l-${randomUUID().slice(0, 6)}`;
    await sessionMarkingWorkUnfamiliar(keys.a, learner);
    expect((await start(keys.a, otherSkillId, learner)).view.step.item.context.id).toBe('project-tasks');
    expect((await start(keys.b, experienceId, learner)).view.step.item.context.id).toBe('project-tasks');
  });

  it('shows what is remembered and forgets it on request', async () => {
    const learner = `l-${randomUUID().slice(0, 6)}`;
    await sessionMarkingWorkUnfamiliar(keys.a, learner);
    const history = (await call(keys.a, 'GET', `/v1/learners/${learner}/history`)).json();
    expect(history.skills).toEqual([
      expect.objectContaining({
        skill_key: 'fraction-of-a-set|set-selection.v1',
        sessions: 1,
        unfamiliar_contexts: ['project-tasks'],
        last_independent: { correct: 2, attempted: 2 },
      }),
    ]);
    expect((await call(keys.b, 'GET', `/v1/learners/${learner}/history`)).statusCode).toBe(404);

    const reset = await call(keys.a, 'POST', `/v1/learners/${learner}/history/reset`, {});
    expect(reset.statusCode).toBe(201);
    const after = (await call(keys.a, 'GET', `/v1/learners/${learner}/history`)).json();
    expect(after.skills[0]).toMatchObject({ sessions: 0, unfamiliar_contexts: [] });
    expect((await start(keys.a, experienceId, learner)).view.step.item.context.id).toBe('project-tasks');
  });
});
