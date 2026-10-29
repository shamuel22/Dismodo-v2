import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { DeclaredContext } from '@dismodo/contracts';
import type { Database } from '../db/client';
import type { SessionService } from '../services/sessions';
import { ensureTenant } from '../services/tenants';
import { parseOrThrow } from './packages';

export const PLAYGROUND_TENANT = 'dismodo-playground';

const PlaygroundRequest = z.strictObject({
  experience: z.string().min(3).max(100).default('parts-of-a-whole'),
  declared: DeclaredContext.default({}),
  policy: z.enum(['adaptive', 'fixed']).default('adaptive'),
  /** Anonymous id kept by the visitor's browser so earlier playground sessions can inform later ones. */
  learner_ref: z
    .string()
    .regex(/^playground-[a-z0-9]{16}$/)
    .optional(),
});

/**
 * Lets anyone try a real session without an API key: public experiences only, an isolated tenant,
 * anonymous learner ids and a tight rate limit. Everything else goes through keyed endpoints.
 */
export function playgroundRoutes(app: FastifyInstance, deps: { db: Database; service: SessionService }) {
  let tenantId: string | null = null;
  app.post(
    '/v1/playground/sessions',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseOrThrow(PlaygroundRequest, request.body ?? {}, 'playground request');
      tenantId ??= (await ensureTenant(deps.db, PLAYGROUND_TENANT, 'DISMODO playground')).id;
      const learnerRef = body.learner_ref ?? `playground-${randomBytes(8).toString('hex')}`;
      const created = await deps.service.create({
        tenantId,
        experience: body.experience,
        learnerRef,
        declared: body.declared,
        policy: body.policy,
      });
      return reply.status(201).send({ ...created, learner_ref: learnerRef });
    },
  );
}
