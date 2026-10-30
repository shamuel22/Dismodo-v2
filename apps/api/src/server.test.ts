import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './db/client';
import { buildServer } from './server';

const database = createDatabase(process.env.DATABASE_URL!);
const app = buildServer({ db: database.db, logLevel: 'silent' });

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('server', () => {
  it('reports healthy when Postgres answers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('reports degraded when Postgres is unreachable', async () => {
    const broken = createDatabase('postgres://nobody:nothing@127.0.0.1:1/none');
    const brokenApp = buildServer({ db: broken.db, logLevel: 'silent' });
    const res = await brokenApp.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', database: 'unreachable' });
    await brokenApp.close();
    await broken.close();
  });

  it('takes the client address from X-Forwarded-For only behind a trusted proxy', async () => {
    const ipOf = async (trustProxyHops: number) => {
      const server = buildServer({ db: database.db, logLevel: 'silent', trustProxyHops });
      server.get('/test-ip', (request) => ({ ip: request.ip }));
      const res = await server.inject({
        method: 'GET',
        url: '/test-ip',
        headers: { 'x-forwarded-for': '203.0.113.7' },
      });
      await server.close();
      return res.json().ip;
    };
    expect(await ipOf(1)).toBe('203.0.113.7');
    expect(await ipOf(0)).toBe('127.0.0.1');
  });

  it('answers unknown routes with the standard error shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'No route for GET /nope.' } });
  });
});
