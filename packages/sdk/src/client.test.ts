import { describe, expect, it, vi } from 'vitest';
import type { ExperiencePackage } from '@dismodo/contracts';
import { createClient, createRuntimeClient, DismodoApiError, tokenFromSessionUrl } from './index';

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Mock fetch that records every call and answers through `handler` (default: empty 200). */
function mockFetch(handler: (call: FetchCall) => Response = () => jsonResponse({})) {
  const calls: FetchCall[] = [];
  const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

const pkg = { experience_id: 'parts-of-a-whole', version: '1.0.0' } as unknown as ExperiencePackage;
const action = { type: 'continue' } as const;

describe('createClient packages', () => {
  it('validates a package', async () => {
    const { calls, fetchFn } = mockFetch(() => jsonResponse({ valid: true, issues: [], summary: null }));
    const client = createClient({ baseUrl: 'http://api.test/', apiKey: 'dsm_test', fetch: fetchFn });
    await expect(client.packages.validate(pkg)).resolves.toEqual({ valid: true, issues: [], summary: null });
    expect(calls).toEqual([
      {
        url: 'http://api.test/v1/packages/validate',
        method: 'POST',
        headers: { Authorization: 'Bearer dsm_test', 'Content-Type': 'application/json' },
        body: pkg,
      },
    ]);
  });

  it('imports, lists and gets packages', async () => {
    const { calls, fetchFn } = mockFetch(() => jsonResponse({}));
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'dsm_test', fetch: fetchFn });
    await client.packages.import(pkg);
    await client.packages.list();
    await client.packages.get('parts-of-a-whole', '1.0.0');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST http://api.test/v1/packages',
      'GET http://api.test/v1/packages',
      'GET http://api.test/v1/packages/parts-of-a-whole/1.0.0',
    ]);
    expect(calls[1]?.headers).toEqual({ Authorization: 'Bearer dsm_test' });
    expect(calls[1]?.body).toBeUndefined();
  });

  it('publishes with the attestation statement fetched verbatim', async () => {
    const statement = 'I reviewed this package: its facts are accurate.';
    const { calls, fetchFn } = mockFetch((call) =>
      call.url.endsWith('/v1/packages/attestation')
        ? jsonResponse({ statement })
        : jsonResponse({ package: { experience_id: 'exp' } }),
    );
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'dsm_test', fetch: fetchFn });
    await client.packages.publish('my-exp', '1.2.3', { reviewer: 'Ana', contentHash: 'sha256:abc' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://api.test/v1/packages/attestation' });
    expect(calls[0]?.headers).toEqual({});
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: 'http://api.test/v1/packages/my-exp/1.2.3/publish',
      headers: { Authorization: 'Bearer dsm_test', 'Content-Type': 'application/json' },
      body: { attestation: { reviewer: 'Ana', statement }, content_hash: 'sha256:abc' },
    });
  });

  it('omits content_hash when publishing without one', async () => {
    const { calls, fetchFn } = mockFetch((call) =>
      call.url.endsWith('/attestation') ? jsonResponse({ statement: 'S' }) : jsonResponse({}),
    );
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    await client.packages.publish('exp-one', '0.1.0', { reviewer: 'Bo' });
    expect(calls[1]?.body).toEqual({ attestation: { reviewer: 'Bo', statement: 'S' } });
  });
});

describe('createClient experiences and sessions', () => {
  it('searches experiences with and without a query', async () => {
    const { calls, fetchFn } = mockFetch(() => jsonResponse({ experiences: [] }));
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    await client.experiences.search();
    await client.experiences.search('quarter & half');
    expect(calls.map((c) => c.url)).toEqual([
      'http://api.test/v1/experiences',
      'http://api.test/v1/experiences?q=quarter%20%26%20half',
    ]);
  });

  it('starts a session mapping camelCase fields to the API shape', async () => {
    const created = { session: { session_id: 's1', url: 'http://x/s/#tok' }, view: { status: 'active' } };
    const { calls, fetchFn } = mockFetch(() => jsonResponse(created, 201));
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    await expect(
      client.sessions.start({
        experience: 'exp@1.0.0',
        learnerRef: 'learner-1',
        declared: { familiar_contexts: ['materials'], energy: 'ok' },
        policy: 'fixed',
      }),
    ).resolves.toEqual(created);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://api.test/v1/sessions' });
    expect(calls[0]?.body).toEqual({
      experience: 'exp@1.0.0',
      learner_ref: 'learner-1',
      declared: { familiar_contexts: ['materials'], energy: 'ok' },
      policy: 'fixed',
    });
    await client.sessions.start({ experience: 'exp', learnerRef: 'learner-2' });
    expect(calls[1]?.body).toEqual({ experience: 'exp', learner_ref: 'learner-2' });
  });

  it('gets, submits to, and reads evidence and events for a session', async () => {
    const { calls, fetchFn } = mockFetch(() => jsonResponse({}));
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    await client.sessions.get('sess-1');
    await client.sessions.submit('sess-1', action, { clientEventId: 'evt-12345' });
    await client.sessions.evidence('sess-1');
    await client.sessions.events('sess-1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://api.test/v1/sessions/sess-1',
      'POST http://api.test/v1/sessions/sess-1/events',
      'GET http://api.test/v1/sessions/sess-1/evidence',
      'GET http://api.test/v1/sessions/sess-1/events',
    ]);
    expect(calls[1]?.body).toEqual({ client_event_id: 'evt-12345', action });
  });

  it('generates a valid client_event_id when submit has none', async () => {
    const { calls, fetchFn } = mockFetch(() => jsonResponse({}));
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    await client.sessions.submit('sess-1', action);
    await client.sessions.submit('sess-1', action, {});
    const ids = calls.map((c) => (c.body as { client_event_id: string }).client_event_id);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('createClient learners, metrics and catalog', () => {
  it('reads and resets learner history', async () => {
    const { calls, fetchFn } = mockFetch(() => jsonResponse({}));
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    await client.learners.history('learner@x');
    await client.learners.resetHistory('learner@x', { skillKey: 'fractions|set-selection.v1' });
    await client.learners.resetHistory('learner@x', {});
    await client.learners.resetHistory('learner@x');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://api.test/v1/learners/learner%40x/history',
      'POST http://api.test/v1/learners/learner%40x/history/reset',
      'POST http://api.test/v1/learners/learner%40x/history/reset',
      'POST http://api.test/v1/learners/learner%40x/history/reset',
    ]);
    expect(calls[1]?.body).toEqual({ skill_key: 'fractions|set-selection.v1' });
    expect(calls[2]?.body).toEqual({});
    expect(calls[3]?.body).toEqual({});
  });

  it('reads decision metrics', async () => {
    const metrics = { models: [], decisions: [], routes: [], note: 'n' };
    const { calls, fetchFn } = mockFetch(() => jsonResponse(metrics));
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    await expect(client.metrics.decisions()).resolves.toEqual(metrics);
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://api.test/v1/metrics/decisions' });
  });

  it('calls the public catalog without an API key', async () => {
    const { calls, fetchFn } = mockFetch(() => jsonResponse({}));
    const anonymous = createClient({ baseUrl: 'http://api.test', fetch: fetchFn });
    await anonymous.catalog.experienceSchema();
    await anonymous.catalog.components();
    expect(calls.map((c) => c.url)).toEqual([
      'http://api.test/v1/schemas/experience.json',
      'http://api.test/v1/components',
    ]);
    expect(calls.every((c) => !('Authorization' in c.headers))).toBe(true);

    const { calls: keyedCalls, fetchFn: keyedFetch } = mockFetch(() => jsonResponse({}));
    const keyed = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: keyedFetch });
    await keyed.catalog.components();
    expect(keyedCalls[0]?.headers).toEqual({});
  });
});

describe('error mapping', () => {
  it('throws DismodoApiError with status, code, message and details', async () => {
    const { fetchFn } = mockFetch(() =>
      jsonResponse(
        { error: { code: 'experience_not_found', message: 'Nope.', details: { available: ['a'] } } },
        404,
      ),
    );
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    const error = await client.experiences.search().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DismodoApiError);
    expect(error).toMatchObject({
      name: 'DismodoApiError',
      status: 404,
      code: 'experience_not_found',
      message: 'Nope.',
      details: { available: ['a'] },
    });
  });

  it('keeps 429 distinguishable as rate_limited', async () => {
    const { fetchFn } = mockFetch(() =>
      jsonResponse({ error: { code: 'rate_limited', message: 'Too many requests.' } }, 429),
    );
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    const error = await client.metrics.decisions().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DismodoApiError);
    expect((error as DismodoApiError).status).toBe(429);
    expect((error as DismodoApiError).code).toBe('rate_limited');
  });

  it('maps a 429 without a body code to rate_limited and other failures to http_error', async () => {
    const bare = (status: number) =>
      ({
        ok: false,
        status,
        json: async () => {
          throw new Error('not json');
        },
      }) as unknown as Response;
    const { fetchFn } = mockFetch(() => bare(429));
    const limited = await createClient({ baseUrl: 'http://api.test', fetch: fetchFn })
      .catalog.components()
      .catch((e: unknown) => e);
    expect(limited).toMatchObject({ status: 429, code: 'rate_limited' });

    const { fetchFn: failingFetch } = mockFetch(() => bare(500));
    const failed = await createClient({ baseUrl: 'http://api.test', fetch: failingFetch })
      .catalog.components()
      .catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(DismodoApiError);
    expect(failed).toMatchObject({ status: 500, code: 'http_error' });
  });

  it('propagates an attestation failure instead of publishing', async () => {
    const { calls, fetchFn } = mockFetch(() =>
      jsonResponse({ error: { code: 'internal_error', message: 'Down.' } }, 500),
    );
    const client = createClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fetchFn });
    await expect(client.packages.publish('e', '1.0.0', { reviewer: 'Ana' })).rejects.toMatchObject({
      code: 'internal_error',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('runtime client and token parsing', () => {
  it('reads the token after # and rejects urls without one', () => {
    expect(tokenFromSessionUrl('http://localhost:4100/s/#abc-DEF_123')).toBe('abc-DEF_123');
    expect(tokenFromSessionUrl('http://localhost:4100/s/')).toBeNull();
    expect(tokenFromSessionUrl('http://localhost:4100/s/#')).toBeNull();
    expect(tokenFromSessionUrl('not a url at all')).toBeNull();
  });

  it('views and submits with the Session authorization scheme', async () => {
    const { calls, fetchFn } = mockFetch(() => jsonResponse({ view: {} }));
    const runtime = createRuntimeClient({
      baseUrl: 'http://api.test/',
      sessionToken: 'tok123',
      fetch: fetchFn,
    });
    await runtime.view();
    await runtime.submit(action, { clientEventId: 'evt-99999' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://api.test/v1/runtime/session',
      'POST http://api.test/v1/runtime/events',
    ]);
    expect(calls.every((c) => c.headers.Authorization === 'Session tok123')).toBe(true);
    expect(calls[1]?.body).toEqual({ client_event_id: 'evt-99999', action });
    expect(runtime.tokenFromSessionUrl('http://x/s/#tok123')).toBe('tok123');
  });

  it('generates a client_event_id for runtime submits too', async () => {
    const { calls, fetchFn } = mockFetch(() => jsonResponse({}));
    const runtime = createRuntimeClient({ baseUrl: 'http://api.test', sessionToken: 't', fetch: fetchFn });
    await runtime.submit({ type: 'answer', item_id: 'i1', response: { selected: ['e1'] } });
    const body = calls[0]?.body as { client_event_id: string; action: unknown };
    expect(body.client_event_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(body.action).toEqual({ type: 'answer', item_id: 'i1', response: { selected: ['e1'] } });
  });

  it('maps runtime errors the same way', async () => {
    const { fetchFn } = mockFetch(() =>
      jsonResponse({ error: { code: 'session_expired', message: 'Gone.' } }, 410),
    );
    const runtime = createRuntimeClient({ baseUrl: 'http://api.test', sessionToken: 't', fetch: fetchFn });
    await expect(runtime.view()).rejects.toMatchObject({ status: 410, code: 'session_expired' });
  });
});
