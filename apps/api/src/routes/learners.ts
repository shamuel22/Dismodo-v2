import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAuth, type authenticator } from '../auth/plugin';
import type { Database } from '../db/client';
import { historyResets, learners, sessions } from '../db/schema';
import { ApiError } from '../errors';
import { learnerHistory } from '../services/history';
import { parseOrThrow } from './packages';

const LearnerParams = z.strictObject({ learner_ref: z.string().regex(/^[A-Za-z0-9_.:@-]{1,128}$/) });
const ResetBody = z.strictObject({
  /** Limit the reset to one skill key (as shown by GET .../history); omit to reset every skill. */
  skill_key: z.string().max(200).optional(),
});

/** What DISMODO remembers about a learner, and the learner's way to make it forget. */
export function learnerRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: ReturnType<typeof authenticator> },
) {
  const { db, auth } = deps;

  const findLearner = async (tenantId: string, ref: string) => {
    const [row] = await db
      .select()
      .from(learners)
      .where(and(eq(learners.tenantId, tenantId), eq(learners.externalRef, ref)));
    if (!row) throw new ApiError(404, 'not_found', 'No learner with this reference in your tenant.');
    return row;
  };

  app.get('/v1/learners/:learner_ref/history', { preHandler: auth('evidence:read') }, async (request) => {
    const { tenantId } = requireAuth(request);
    const { learner_ref } = parseOrThrow(LearnerParams, request.params, 'learner reference');
    const learner = await findLearner(tenantId, learner_ref);
    const skills = await db
      .selectDistinct({ skillKey: sessions.skillKey })
      .from(sessions)
      .where(and(eq(sessions.tenantId, tenantId), eq(sessions.learnerId, learner.id)));
    return {
      learner_ref,
      scope: 'Per skill, within your tenant; last 5 sessions and 90 days, since the latest reset.',
      skills: await Promise.all(
        skills.map(async ({ skillKey }) => ({
          skill_key: skillKey,
          ...(await learnerHistory(db, { tenantId, learnerId: learner.id, skillKey })),
        })),
      ),
    };
  });

  app.post(
    '/v1/learners/:learner_ref/history/reset',
    { preHandler: auth('sessions:write') },
    async (request, reply) => {
      const { tenantId } = requireAuth(request);
      const { learner_ref } = parseOrThrow(LearnerParams, request.params, 'learner reference');
      const body = parseOrThrow(ResetBody, request.body ?? {}, 'reset request');
      const learner = await findLearner(tenantId, learner_ref);
      const [row] = await db
        .insert(historyResets)
        .values({ tenantId, learnerId: learner.id, skillKey: body.skill_key ?? null })
        .returning();
      return reply.status(201).send({
        learner_ref,
        skill_key: row!.skillKey,
        reset_at: row!.createdAt.toISOString(),
        note: 'Earlier evidence is no longer used to orient sessions. The event log itself is kept unchanged.',
      });
    },
  );
}
