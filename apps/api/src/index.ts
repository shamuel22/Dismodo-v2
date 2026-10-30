import { readFileSync } from 'node:fs';
import { createModelPolicy, decisionTiersFromEnv } from '@dismodo/adaptation';
import { editorialPolicy } from '@dismodo/engine';
import { createDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { loadEnv } from './env';
import { buildServer } from './server';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await runMigrations(database.db);
const tiers = decisionTiersFromEnv(process.env);
// Drafting a whole package is slower and longer than a decision: same models, more room.
const draftTiers = [tiers.critical, tiers.routine]
  .filter((t): t is NonNullable<typeof t> => !!t)
  .map((t) => ({ model: t.model, timeoutMs: 180_000, maxTokens: 16_000 }));
const reference = JSON.parse(
  readFileSync(new URL('../../../experiences/parts-of-a-whole/experience.json', import.meta.url), 'utf8'),
);
const app = buildServer({
  db: database.db,
  policies: { adaptive: createModelPolicy(tiers), fixed: editorialPolicy },
  decisionModels: tiers.summary,
  drafts: { tiers: draftTiers, reference },
  publicBaseUrl: env.PUBLIC_BASE_URL,
  ...(env.SESSION_PAGE_URL ? { sessionPageUrl: env.SESSION_PAGE_URL } : {}),
  webDistDir: new URL('../../web/dist', import.meta.url).pathname,
  docsDir: new URL('../../web/src/docs/content', import.meta.url).pathname,
  logLevel: env.LOG_LEVEL,
  trustProxyHops: env.TRUST_PROXY_HOPS,
});

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(
  { decision_models: tiers.summary },
  tiers.summary.length ? 'decision models ready' : 'no decision model configured: editorial route only',
);
