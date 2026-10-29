import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './db/client';
import { buildServer } from './server';

const dist = mkdtempSync(path.join(tmpdir(), 'dismodo-web-'));
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>DISMODO</title>');
writeFileSync(path.join(dist, 'app.js'), 'console.log(1)');
const docsDir = new URL('../../web/src/docs/content', import.meta.url).pathname;
const database = createDatabase(process.env.DATABASE_URL!);
const app = buildServer({ db: database.db, webDistDir: dist, docsDir, logLevel: 'silent' });

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('web app and llms.txt served by the API', () => {
  it('serves files and falls back to index.html for client routes', async () => {
    expect((await app.inject({ url: '/app.js' })).body).toBe('console.log(1)');
    for (const url of ['/', '/docs', '/docs/api', '/s/']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('<title>DISMODO</title>');
    }
  });

  it('never serves the web app for API paths', async () => {
    const res = await app.inject({ url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('serves llms.txt, llms-full.txt and Markdown pages from the docs sources', async () => {
    const index = await app.inject({ url: '/llms.txt' });
    expect(index.headers['content-type']).toContain('text/plain');
    expect(index.body).toMatch(/^# DISMODO/);
    expect(index.body).toContain('/docs/quickstart.md');
    expect((await app.inject({ url: '/docs/quickstart.md' })).body).toMatch(/^# Quickstart/);
    expect((await app.inject({ url: '/llms-full.txt' })).body).toContain('# API reference');
  });
});
