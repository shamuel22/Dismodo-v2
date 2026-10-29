import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
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
const experienceId = `quarters-${randomUUID().slice(0, 8)}`;
const keys = { a: '', aEvidenceOnly: '', b: '' };

beforeAll(async () => {
  await runMigrations(database.db);
  const suffix = randomUUID().slice(0, 8);
  const a = await ensureTenant(database.db, `sess-a-${suffix}`, 'Sessions A');
  const b = await ensureTenant(database.db, `sess-b-${suffix}`, 'Sessions B');
  keys.a = (await createApiKey(database.db, a.id, 'test')).key;
  keys.aEvidenceOnly = (await createApiKey(database.db, a.id, 'evidence', ['evidence:read'])).key;
  keys.b = (await createApiKey(database.db, b.id, 'test')).key;
  const imported = await call('POST', '/v1/packages', keys.a, { ...demo, experience_id: experienceId });
  expect(imported.statusCode).toBe(201);
  const published = await call('POST', `/v1/packages/${experienceId}/1.0.0/publish`, keys.a, {
    attestation: { reviewer: 'QA', statement: ATTESTATION_STATEMENT },
  });
  expect(published.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

function call(method: 'GET' | 'POST', url: string, key?: string, payload?: unknown, scheme = 'Bearer') {
  return app.inject({
    method,
    url,
    headers: key ? { authorization: `${scheme} ${key}` } : {},
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

const tokenOf = (url: string) => url.split('#')[1]!;
const runtime = (token: string, payload?: unknown) =>
  payload === undefined
    ? call('GET', '/v1/runtime/session', token, undefined, 'Session')
    : call('POST', '/v1/runtime/events', token, payload, 'Session');

interface View {
  status: string;
  phase: string;
  step: { kind: string; item?: { item_id: string; view: { total: number } } };
}

/** A correct answer derived only from what the learner sees: one quarter of the rendered set. */
const correctAnswer = (view: View) => ({
  type: 'answer',
  item_id: view.step.item!.item_id,
  response: { selected: Array.from({ length: view.step.item!.view.total / 4 }, (_, i) => `e${i + 1}`) },
});

async function startSession(learnerRef: string, extra: Record<string, unknown> = {}) {
  const res = await call('POST', '/v1/sessions', keys.a, {
    experience: experienceId,
    learner_ref: learnerRef,
    ...extra,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { session: { session_id: string; url: string }; view: View };
}

async function playToEnd(token: string, first: View) {
  let view = first;
  while (view.status === 'active') {
    const res = await runtime(token, {
      action: view.step.kind === 'item' ? correctAnswer(view) : { type: 'continue' },
    });
    expect(res.statusCode, res.body).toBe(200);
    view = res.json().view;
  }
  return view;
}

describe('sessions', () => {
  it('lists experiences the tenant can run', async () => {
    const res = await call('GET', `/v1/experiences?q=quarter`, keys.a);
    const ids = res.json().experiences.map((e: { experience_id: string }) => e.experience_id);
    expect(ids).toContain(experienceId);
    const own = res
      .json()
      .experiences.find((e: { experience_id: string }) => e.experience_id === experienceId);
    expect(own).toMatchObject({
      owner: 'own',
      experience_ref: `${experienceId}@1.0.0`,
      time_budget_minutes: 8,
    });
    expect(own.contexts.map((c: { id: string }) => c.id)).toEqual([
      'project-tasks',
      'materials',
      'sports-season',
    ]);
  });

  it('starts a session with a learner link whose token stays out of the URL path', async () => {
    const { session, view } = await startSession('learner-1', {
      declared: { familiar_contexts: ['materials'] },
    });
    expect(session.url).toMatch(/^http:\/\/localhost:4100\/s\/#[A-Za-z0-9_-]{43}$/);
    expect(view).toMatchObject({ status: 'active', phase: 'baseline', step: { kind: 'item' } });
    expect(JSON.stringify(view)).not.toMatch(/template_values|part_size|"spec"/);
    const stored = await database.db.execute(
      sql`select token_hash from sessions where id = ${session.session_id}`,
    );
    expect(stored.rows[0]!.token_hash).not.toBe(tokenOf(session.url));
  });

  it('rejects unknown experiences and contexts with clear errors', async () => {
    const missing = await call('POST', '/v1/sessions', keys.a, { experience: 'nope', learner_ref: 'x' });
    expect(missing.json().error.code).toBe('experience_not_found');
    const badContext = await call('POST', '/v1/sessions', keys.a, {
      experience: experienceId,
      learner_ref: 'x',
      declared: { familiar_contexts: ['cooking'] },
    });
    expect(badContext.statusCode).toBe(400);
    expect(badContext.json().error.details.available).toContain('materials');
  });

  it('runs a whole session through the learner link and reports evidence from events', async () => {
    const { session, view } = await startSession('learner-2');
    const token = tokenOf(session.url);
    const end = await playToEnd(token, view);
    expect(end).toMatchObject({ status: 'completed', phase: 'done', step: { kind: 'done' } });

    const evidence = await call('GET', `/v1/sessions/${session.session_id}/evidence`, keys.aEvidenceOnly);
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json()).toMatchObject({
      session_id: session.session_id,
      experience_ref: `${experienceId}@1.0.0`,
      status: 'completed',
      scope: 'this-skill-and-session',
      observations: {
        baseline: { attempted: 1, correct: 1 },
        practice: { attempted: 3, correct: 3 },
        independent: { attempted: 2, correct: 2, hints_used: 0 },
        delayed_check: 'not_measured',
      },
    });
    const observations = await database.db.execute(
      sql`select phase, correct from observations where session_id = ${session.session_id} order by item_id`,
    );
    expect(observations.rows).toHaveLength(6);
  });

  it('never accepts a result from the client: only learner actions', async () => {
    const { session, view } = await startSession('learner-3');
    const forged = await call('POST', `/v1/sessions/${session.session_id}/events`, keys.a, {
      action: { type: 'evaluated', item_id: view.step.item!.item_id, correct: true },
    });
    expect(forged.statusCode).toBe(400);
    const extra = await call('POST', `/v1/sessions/${session.session_id}/events`, keys.a, {
      action: { ...correctAnswer(view), correct: true },
    });
    expect(extra.statusCode).toBe(400);
  });

  it('treats a repeated client_event_id as the same action', async () => {
    const { session, view } = await startSession('learner-4');
    const token = tokenOf(session.url);
    const payload = { client_event_id: 'retry-abc-123', action: correctAnswer(view) };
    const first = await runtime(token, payload);
    const second = await runtime(token, payload);
    expect(first.json().duplicate).toBe(false);
    expect(second.json()).toMatchObject({ duplicate: true, accepted_seq: first.json().accepted_seq });
    const events = await call('GET', `/v1/sessions/${session.session_id}/events`, keys.a);
    expect(events.json().events.filter((e: { actor: string }) => e.actor === 'learner')).toHaveLength(1);
  });

  it('serialises concurrent answers to the same item', async () => {
    const { session, view } = await startSession('learner-5');
    const token = tokenOf(session.url);
    const results = await Promise.all([
      runtime(token, { action: correctAnswer(view) }),
      runtime(token, { action: correctAnswer(view) }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('keeps the event log append-only at the database level', async () => {
    const { session } = await startSession('learner-6');
    // Drizzle wraps driver errors; the trigger's message is on the cause.
    const failure = (query: Promise<unknown>) =>
      query.then(
        () => 'allowed',
        (error: Error) => String((error.cause as Error | undefined)?.message ?? error.message),
      );
    expect(
      await failure(
        database.db.execute(
          sql`update session_events set payload = '{}' where session_id = ${session.session_id}`,
        ),
      ),
    ).toMatch(/append-only \(UPDATE rejected\)/);
    expect(
      await failure(
        database.db.execute(sql`delete from session_events where session_id = ${session.session_id}`),
      ),
    ).toMatch(/append-only \(DELETE rejected\)/);
  });

  it('isolates tenants and sessions', async () => {
    const { session } = await startSession('learner-7');
    expect((await call('GET', `/v1/sessions/${session.session_id}/evidence`, keys.b)).statusCode).toBe(404);
    expect((await call('GET', `/v1/sessions/${session.session_id}`, keys.aEvidenceOnly)).statusCode).toBe(
      403,
    );
    expect((await runtime('A'.repeat(43))).statusCode).toBe(401);
    // Tenant B cannot start a session on tenant A's private experience.
    const res = await call('POST', '/v1/sessions', keys.b, { experience: experienceId, learner_ref: 'x' });
    expect(res.json().error.code).toBe('experience_not_found');
  });

  it('uses earlier sessions of the same learner and skill to avoid repeating problems', async () => {
    const first = await startSession('learner-memory');
    await playToEnd(tokenOf(first.session.url), first.view);
    const second = await startSession('learner-memory');
    await playToEnd(tokenOf(second.session.url), second.view);
    const rows = await database.db.execute(sql`
      select s.id as session, o.identity, o.phase from observations o join sessions s on s.id = o.session_id
      where s.id in (${first.session.session_id}, ${second.session.session_id}) and o.phase <> 'independent'`);
    const bySession = (id: string) => rows.rows.filter((r) => r.session === id).map((r) => r.identity);
    const overlap = bySession(second.session.session_id).filter((id) =>
      bySession(first.session.session_id).includes(id),
    );
    expect(overlap).toEqual([]);
  });

  it('expires learner links', async () => {
    const { session } = await startSession('learner-8');
    const later = buildServer({
      db: database.db,
      logLevel: 'silent',
      now: () => new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    });
    const res = await later.inject({
      method: 'GET',
      url: '/v1/runtime/session',
      headers: { authorization: `Session ${tokenOf(session.url)}` },
    });
    expect(res.statusCode).toBe(410);
    await later.close();
  });

  it('records exposure as soon as an item is shown', async () => {
    const { session } = await startSession('learner-exposure');
    const rows = await database.db.execute(
      sql`select phase, correct from observations where session_id = ${session.session_id}`,
    );
    expect(rows.rows).toEqual([{ phase: 'baseline', correct: null }]);
  });

  it('limits how fast a learner link can be called', async () => {
    const { session } = await startSession('learner-burst');
    const token = tokenOf(session.url);
    const statuses: number[] = [];
    for (let i = 0; i < 92; i++) statuses.push((await runtime(token)).statusCode);
    expect(statuses.slice(0, 90).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await runtime(token)).json().error.code).toBe('rate_limited');
  });
});
