import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import { builtinRegistry } from '@dismodo/activities';
import type { TierConfig } from '@dismodo/adaptation';
import type { ComponentRegistry } from '@dismodo/contracts';
import { ENGINE_VERSION } from '@dismodo/engine';
import { authenticator } from './auth/plugin';
import type { Database } from './db/client';
import { ApiError } from './errors';
import { catalogRoutes } from './routes/catalog';
import { draftRoutes } from './routes/drafts';
import { learnerRoutes } from './routes/learners';
import { llmsRoutes } from './routes/llms';
import { playgroundRoutes } from './routes/playground';
import { isApiPath, registerWebApp } from './static';
import { metricsRoutes } from './routes/metrics';
import { packageRoutes } from './routes/packages';
import { sessionRoutes } from './routes/sessions';
import { createSessionService, type SessionServiceDeps } from './services/sessions';

export interface ServerDeps {
  db: Database;
  registry?: ComponentRegistry;
  publicBaseUrl?: string;
  sessionPageUrl?: string;
  policies?: SessionServiceDeps['policies'];
  /** Configured decision models, shown on /health (no secrets). */
  decisionModels?: Array<{ tier: string; provider: string; model: string; fault: string | null }>;
  now?: () => Date;
  /** Built web app to serve (landing, docs, session page); skipped when absent. */
  webDistDir?: string;
  /** Markdown sources of the documentation, served as llms.txt and .md pages. */
  docsDir?: string;
  /** Models that draft packages (most capable first) and the reference package they imitate. */
  drafts?: { tiers: TierConfig[]; reference: unknown };
  logLevel?: string;
}

export function buildServer({
  db,
  registry = builtinRegistry,
  publicBaseUrl = 'http://localhost:4100',
  sessionPageUrl = `${publicBaseUrl}/s/`,
  policies,
  decisionModels = [],
  now,
  webDistDir,
  docsDir,
  drafts,
  logLevel = 'info',
}: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: logLevel },
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'rate_limited', message: 'Too many requests; wait a moment and retry.' } });
    }
    if (statusCode && statusCode < 500) {
      return reply
        .status(statusCode)
        .send({ error: { code: 'bad_request', message: (error as Error).message } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Unexpected server error.' } });
  });

  const servesWeb = webDistDir ? registerWebApp(app, webDistDir) : false;
  app.setNotFoundHandler((request, reply) => {
    // Client-side routes of the web app (/docs/..., /s/) resolve to its index.html.
    if (servesWeb && request.method === 'GET' && !isApiPath(request.url)) return reply.sendFile('index.html');
    return reply
      .status(404)
      .send({ error: { code: 'not_found', message: `No route for ${request.method} ${request.url}.` } });
  });

  app.get('/health', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return {
        status: 'ok',
        engine_version: ENGINE_VERSION,
        database: 'ok',
        decision_models: decisionModels,
      };
    } catch {
      return reply
        .status(503)
        .send({ status: 'degraded', engine_version: ENGINE_VERSION, database: 'unreachable' });
    }
  });

  // Cross-origin access only where a third-party page embeds a session: the learner-link endpoints (token in
  // a header, no cookies) and the embed script. Keyed API routes stay same-origin/server-to-server.
  void app.register(cors, {
    delegator: (request, callback) => {
      const url = request.url ?? '';
      const open = url.startsWith('/v1/runtime/') || url.startsWith('/embed/');
      callback(
        null,
        open
          ? { origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type'] }
          : { origin: false },
      );
    },
  });
  // Opt-in per route: learner-facing endpoints are public and need a ceiling.
  void app.register(rateLimit, { global: false });
  const auth = authenticator(db);
  const sessionService = createSessionService({
    db,
    registry,
    sessionPageUrl,
    ...(policies ? { policies } : {}),
    ...(now ? { now } : {}),
  });
  // Registered as a plugin so it loads after rate-limit and its onRoute hook sees every route.
  void app.register(async (api) => {
    catalogRoutes(api, { registry, publicBaseUrl });
    packageRoutes(api, { db, registry, auth });
    sessionRoutes(api, { service: sessionService, auth });
    metricsRoutes(api, { db, auth });
    learnerRoutes(api, { db, auth });
    playgroundRoutes(api, { db, service: sessionService });
    if (docsDir) llmsRoutes(api, { docsDir, publicBaseUrl });
    draftRoutes(api, { registry, auth, tiers: drafts?.tiers ?? [], reference: drafts?.reference ?? null });
  });

  return app;
}
