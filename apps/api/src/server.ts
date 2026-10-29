import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { builtinRegistry } from '@dismodo/activities';
import type { ComponentRegistry } from '@dismodo/contracts';
import { authenticator } from './auth/plugin';
import type { Database } from './db/client';
import { ApiError } from './errors';
import { catalogRoutes } from './routes/catalog';
import { packageRoutes } from './routes/packages';

export const ENGINE_VERSION = '0.1.0';

export interface ServerDeps {
  db: Database;
  registry?: ComponentRegistry;
  publicBaseUrl?: string;
  logLevel?: string;
}

export function buildServer({
  db,
  registry = builtinRegistry,
  publicBaseUrl = 'http://localhost:4100',
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

  const auth = authenticator(db);
  catalogRoutes(app, { registry, publicBaseUrl });
  packageRoutes(app, { db, registry, auth });

  return app;
}
