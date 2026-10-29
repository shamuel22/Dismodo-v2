import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ExperiencePackage, INTERVENTIONS, type ComponentRegistry } from '@dismodo/contracts';

const toSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' });

/** Public, unauthenticated descriptions of the contract: for builders, editors and AI agents. */
export function catalogRoutes(
  app: FastifyInstance,
  deps: { registry: ComponentRegistry; publicBaseUrl: string },
) {
  const experienceSchema = {
    ...toSchema(ExperiencePackage),
    $id: `${deps.publicBaseUrl}/v1/schemas/experience.json`,
    title: 'DISMODO experience package',
  };

  const components = {
    activities: deps.registry.activities().map((a) => ({
      ref: a.ref,
      revision: a.revision,
      description: a.description,
      context_slots: a.contextSlots,
      explanation_variables: a.explanationVariables,
      params_schema: toSchema(a.paramsSchema),
      spec_schema: toSchema(a.specSchema),
      response_schema: toSchema(a.responseSchema),
    })),
    evaluators: deps.registry.evaluators().map((e) => ({
      ref: e.ref,
      revision: e.revision,
      description: e.description,
      activity_refs: e.activityRefs,
      error_codes: e.errorCodes,
      config_schema: toSchema(e.configSchema),
    })),
    interventions: Object.entries(INTERVENTIONS).map(([id, meta]) => ({ id, ...meta })),
  };

  app.get('/v1/schemas/experience.json', async () => experienceSchema);
  app.get('/v1/components', async () => components);
}
