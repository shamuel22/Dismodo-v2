import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DeclaredContext, SubmitEvent } from '@dismodo/contracts';
import { requireAuth, type authenticator } from '../auth/plugin';
import { ApiError } from '../errors';
import type { SessionService } from '../services/sessions';
import { parseOrThrow } from './packages';

const CreateSession = z.strictObject({
  /** "experience-id@1.0.0" to pin a version, or "experience-id" for the latest published one. */
  experience: z.string().min(3).max(100),
  /** Your own id for the learner; use a pseudonymous id, not an email or name. */
  learner_ref: z.string().regex(/^[A-Za-z0-9_.:@-]{1,128}$/, 'Use 1–128 letters, digits or _ . : @ -'),
  declared: DeclaredContext.default({}),
  /** "fixed" runs the package's editorial route only; useful as a comparison arm. */
  policy: z.enum(['adaptive', 'fixed']).default('adaptive'),
});

const SessionId = z.strictObject({ id: z.uuid() });
const ExperienceQuery = z.strictObject({ q: z.string().max(100).optional() });

export function sessionRoutes(
  app: FastifyInstance,
  deps: { service: SessionService; auth: ReturnType<typeof authenticator> },
) {
  const { service, auth } = deps;

  app.get('/v1/experiences', { preHandler: auth('experiences:read') }, async (request) => {
    const { tenantId } = requireAuth(request);
    const { q } = parseOrThrow(ExperienceQuery, request.query, 'query');
    return { experiences: await service.listExperiences(tenantId, q) };
  });

  app.post('/v1/sessions', { preHandler: auth('sessions:write') }, async (request, reply) => {
    const { tenantId } = requireAuth(request);
    const body = parseOrThrow(CreateSession, request.body, 'session request');
    const created = await service.create({
      tenantId,
      experience: body.experience,
      learnerRef: body.learner_ref,
      declared: body.declared,
      policy: body.policy,
    });
    return reply.status(201).send(created);
  });

  app.get('/v1/sessions/:id', { preHandler: auth('sessions:write') }, async (request) => {
    const { tenantId } = requireAuth(request);
    const { id } = parseOrThrow(SessionId, request.params, 'session id');
    return service.view(await service.findForTenant(tenantId, id));
  });

  app.post('/v1/sessions/:id/events', { preHandler: auth('sessions:write') }, async (request) => {
    const { tenantId } = requireAuth(request);
    const { id } = parseOrThrow(SessionId, request.params, 'session id');
    const session = await service.findForTenant(tenantId, id);
    const body = parseOrThrow(SubmitEvent, request.body, 'event');
    return service.submit(session.id, body.action, body.client_event_id);
  });

  app.get('/v1/sessions/:id/evidence', { preHandler: auth('evidence:read') }, async (request) => {
    const { tenantId } = requireAuth(request);
    const { id } = parseOrThrow(SessionId, request.params, 'session id');
    return service.report(await service.findForTenant(tenantId, id));
  });

  app.get('/v1/sessions/:id/events', { preHandler: auth('evidence:read') }, async (request) => {
    const { tenantId } = requireAuth(request);
    const { id } = parseOrThrow(SessionId, request.params, 'session id');
    return { events: await service.events(await service.findForTenant(tenantId, id)) };
  });

  // Learner runtime: authenticated by the session link token, scoped to one session.
  const sessionFromToken = async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Session ') ? header.slice(8).trim() : undefined;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new ApiError(
        401,
        'invalid_session_token',
        'Send the session token as "Authorization: Session <token>".',
      );
    }
    return service.findByToken(token);
  };

  // About one action per second sustained per session link; generous for a person, tight for a script.
  const runtimeLimit = {
    config: {
      rateLimit: {
        max: 90,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => request.headers.authorization ?? request.ip,
      },
    },
  };

  app.get('/v1/runtime/session', runtimeLimit, async (request) =>
    service.view(await sessionFromToken(request)),
  );

  app.get('/v1/runtime/evidence', runtimeLimit, async (request) =>
    service.learnerReport(await sessionFromToken(request)),
  );

  app.post('/v1/runtime/events', runtimeLimit, async (request) => {
    const session = await sessionFromToken(request);
    const body = parseOrThrow(SubmitEvent, request.body, 'event');
    return service.submit(session.id, body.action, body.client_event_id);
  });
}
