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
const keys: Record<'a' | 'aRead' | 'b', string> = { a: '', aRead: '', b: '' };
// Unique experience id per run so tests never collide with seeded data or earlier runs.
const experienceId = `quarters-${randomUUID().slice(0, 8)}`;
const pkg = { ...structuredClone(demo), experience_id: experienceId };

beforeAll(async () => {
  await runMigrations(database.db);
  const suffix = randomUUID().slice(0, 8);
  const a = await ensureTenant(database.db, `test-a-${suffix}`, 'Tenant A');
  const b = await ensureTenant(database.db, `test-b-${suffix}`, 'Tenant B');
  keys.a = (await createApiKey(database.db, a.id, 'test')).key;
  keys.aRead = (await createApiKey(database.db, a.id, 'read-only', ['experiences:read'])).key;
  keys.b = (await createApiKey(database.db, b.id, 'test')).key;
});

afterAll(async () => {
  await app.close();
  await database.close();
});

const call = (method: 'GET' | 'POST', url: string, key?: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: key ? { authorization: `Bearer ${key}` } : {},
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

describe('package import and publishing', () => {
  it('requires a valid key with the right scope', async () => {
    expect((await call('POST', '/v1/packages', undefined, pkg)).statusCode).toBe(401);
    expect((await call('POST', '/v1/packages', 'dsm_aaaaaaaaaaaa_' + 'x'.repeat(43), pkg)).statusCode).toBe(
      401,
    );
    const forbidden = await call('POST', '/v1/packages', keys.aRead, pkg);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('forbidden');
  });

  it('validates without storing (dry run)', async () => {
    const res = await call('POST', '/v1/packages/validate', keys.a, { ...pkg, title: 'Bad <b>' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ valid: false, issues: [{ path: '/title' }] });
  });

  it('rejects an invalid package with understandable issues', async () => {
    const res = await call('POST', '/v1/packages', keys.a, {
      ...pkg,
      evaluator: { ref: 'essay-grader.v1', config: {} },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: 'invalid_package',
      details: {
        issues: [
          { path: '/evaluator/ref', code: 'unknown_evaluator', hint: 'Registered: fraction-of-set.v1.' },
        ],
      },
    });
  });

  it('imports a valid package as an immutable draft, idempotently', async () => {
    const first = await call('POST', '/v1/packages', keys.a, pkg);
    expect(first.statusCode).toBe(201);
    expect(first.json().package).toMatchObject({
      ref: `${experienceId}@1.0.0`,
      status: 'draft',
      visibility: 'private',
      components: { activity: 'set-selection.v1+r1', evaluator: 'fraction-of-set.v1+r1' },
      validation: { tests_passed: 5, tests_total: 5 },
    });
    // Same content with different key order is the same package.
    const reordered = Object.fromEntries(Object.entries(pkg).reverse());
    const again = await call('POST', '/v1/packages', keys.a, reordered);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({
      created: false,
      package: { content_hash: first.json().package.content_hash },
    });
  });

  it('refuses different content under an existing version', async () => {
    const res = await call('POST', '/v1/packages', keys.a, { ...pkg, summary: 'Changed after import.' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('version_conflict');
  });

  it('keeps tenants apart', async () => {
    expect((await call('GET', `/v1/packages/${experienceId}/1.0.0`, keys.b)).statusCode).toBe(404);
    const list = await call('GET', '/v1/packages', keys.b);
    expect(list.json().packages.map((p: { experience_id: string }) => p.experience_id)).not.toContain(
      experienceId,
    );
    // Tenant B may use the same experience id independently.
    expect((await call('POST', '/v1/packages', keys.b, pkg)).statusCode).toBe(201);
  });

  it('publishes only with the review statement and the reviewed hash', async () => {
    const url = `/v1/packages/${experienceId}/1.0.0/publish`;
    const missing = await call('POST', url, keys.a, {
      attestation: { reviewer: 'QA', statement: 'looks fine' },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.details.statement).toBe(ATTESTATION_STATEMENT);

    const stale = await call('POST', url, keys.a, {
      attestation: { reviewer: 'QA', statement: ATTESTATION_STATEMENT },
      content_hash: 'sha256:0000',
    });
    expect(stale.statusCode).toBe(409);

    const ok = await call('POST', url, keys.a, {
      attestation: { reviewer: 'QA', statement: ATTESTATION_STATEMENT },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().package).toMatchObject({ status: 'published' });
    expect(ok.json().package.published_at).toBeTruthy();
  });

  it('rejects oversized bodies and prototype poisoning', async () => {
    const huge = { ...pkg, summary: 'x'.repeat(300 * 1024) };
    const tooLarge = await call('POST', '/v1/packages', keys.a, huge);
    expect(tooLarge.statusCode).toBe(413);
    const poisoned = await app.inject({
      method: 'POST',
      url: '/v1/packages',
      headers: { authorization: `Bearer ${keys.a}`, 'content-type': 'application/json' },
      payload: '{"__proto__": {"admin": true}}',
    });
    expect(poisoned.statusCode).toBe(400);
  });
});

describe('public catalog', () => {
  it('publishes the package JSON Schema', async () => {
    const res = await call('GET', '/v1/schemas/experience.json');
    expect(res.statusCode).toBe(200);
    const schema = res.json();
    expect(schema.title).toBe('DISMODO experience package');
    expect(schema.required).toContain('experience_id');
    expect(schema.additionalProperties).toBe(false);
  });

  it('describes registered components for builders and agents', async () => {
    const res = await call('GET', '/v1/components');
    const body = res.json();
    expect(body.activities[0]).toMatchObject({ ref: 'set-selection.v1', revision: 'set-selection.v1+r1' });
    expect(body.activities[0].params_schema.properties.task.enum).toEqual(['select', 'identify']);
    expect(Object.keys(body.evaluators[0].error_codes)).toContain('count_equals_numerator');
    expect(body.interventions.map((i: { id: string }) => i.id)).toContain('worked-example');
  });
});
