import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import { builtinRegistry } from '@dismodo/activities';
import type { ComponentRegistry } from '@dismodo/contracts';
import { authenticator } from './auth/plugin';
import type { Database } from './db/client';
import { ApiError } from './errors';
import { catalogRoutes } from './routes/catalog';
import { packageRoutes } from './routes/packages';
import { sessionRoutes } from './routes/sessions';
import { createSessionService, type SessionServiceDeps } from './services/sessions';

export const ENGINE_VERSION = '0.1.0';

export interface ServerDeps {
  db: Database;
  registry?: ComponentRegistry;
  publicBaseUrl?: string;
  sessionPageUrl?: string;
  policies?: SessionServiceDeps['policies'];
  now?: () => Date;
  logLevel?: string;
}

export function buildServer({
  db,
  registry = builtinRegistry,
  publicBaseUrl = 'http://localhost:4100',
  sessionPageUrl = `${publicBaseUrl}/s/`,
  policies,
  now,
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

  app.setNotFoundHandler((request, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'not_found', message: `No route for ${request.method} ${request.url}.` } }),
  );

  app.get('/health', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok', engine_version: ENGINE_VERSION, database: 'ok' };
    } catch {
      return reply
        .status(503)
        .send({ status: 'degraded', engine_version: ENGINE_VERSION, database: 'unreachable' });
    }
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
  });

  return app;
}
