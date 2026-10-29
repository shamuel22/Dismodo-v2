import type { FastifyInstance } from 'fastify';
import { requireAuth, type authenticator } from '../auth/plugin';
import type { Database } from '../db/client';
import { decisionMetrics } from '../services/metrics';

export function metricsRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: ReturnType<typeof authenticator> },
) {
  app.get('/v1/metrics/decisions', { preHandler: deps.auth('evidence:read') }, async (request) => {
    const { tenantId } = requireAuth(request);
    return decisionMetrics(deps.db, tenantId);
  });
}
