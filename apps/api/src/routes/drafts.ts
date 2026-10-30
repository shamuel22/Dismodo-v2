import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { draftPackage, MAX_DRAFT_SOURCE, type TierConfig } from '@dismodo/adaptation';
import { Slug, type ComponentRegistry } from '@dismodo/contracts';
import { requireAuth, type authenticator } from '../auth/plugin';
import { ApiError } from '../errors';
import { parseOrThrow } from './packages';

const DraftRequest = z.strictObject({
  /** What to teach, for whom and in which settings: notes, an outline or source material. */
  source: z.string().trim().min(40).max(MAX_DRAFT_SOURCE),
  experience_id: Slug,
  activity: z.string().max(60).default('set-selection.v1'),
});

/**
 * Drafts a package with a decision model, validated and repaired against the engine. A builder tool: the
 * result is returned for review and is never stored or published by this route.
 */
export function draftRoutes(
  app: FastifyInstance,
  deps: {
    registry: ComponentRegistry;
    tiers: TierConfig[];
    reference: unknown;
    auth: ReturnType<typeof authenticator>;
  },
) {
  app.post(
    '/v1/package-drafts',
    { preHandler: deps.auth('packages:write'), config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request) => {
      requireAuth(request);
      if (deps.tiers.length === 0) {
        throw new ApiError(503, 'no_model', 'No decision model is configured, so drafts are unavailable.');
      }
      const body = parseOrThrow(DraftRequest, request.body, 'draft request');
      if (!deps.registry.activity(body.activity)) {
        throw new ApiError(400, 'unknown_activity', `No activity "${body.activity}" is registered.`);
      }
      const result = await draftPackage(deps.tiers, deps.registry, deps.reference, {
        source: body.source,
        experienceId: body.experience_id,
        activityRef: body.activity,
      });
      return {
        ...result,
        note: 'Draft only, not stored. Review every fact and text, then import and publish it as usual.',
      };
    },
  );
}
