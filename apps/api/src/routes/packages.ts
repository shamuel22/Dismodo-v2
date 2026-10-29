import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { MAX_PACKAGE_BYTES, SemVer, Slug, type ComponentRegistry } from '@dismodo/contracts';
import { validatePackage } from '@dismodo/engine';
import { requireAuth, type authenticator } from '../auth/plugin';
import type { Database } from '../db/client';
import { ApiError } from '../errors';
import {
  ATTESTATION_STATEMENT,
  describePackage,
  findPackage,
  importPackage,
  listTenantPackages,
  publishPackage,
} from '../services/packages';

const PackageParams = z.strictObject({ experience_id: Slug, version: SemVer });
const PublishBody = z.strictObject({
  attestation: z.strictObject({
    reviewer: z.string().trim().min(2).max(120),
    statement: z.string().max(400),
  }),
  /** Hash of the content the reviewer looked at; publishing fails if the stored content differs. */
  content_hash: z.string().max(80).optional(),
});

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, 'bad_request', `Invalid ${what}.`, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

export function packageRoutes(
  app: FastifyInstance,
  deps: { db: Database; registry: ComponentRegistry; auth: ReturnType<typeof authenticator> },
) {
  const { db, registry, auth } = deps;
  const builder = { preHandler: auth('packages:write'), bodyLimit: MAX_PACKAGE_BYTES };

  app.post('/v1/packages/validate', builder, async (request) => {
    requireAuth(request);
    const result = validatePackage(request.body, registry);
    return { valid: result.ok, issues: result.issues, summary: result.summary ?? null };
  });

  app.post('/v1/packages', builder, async (request, reply) => {
    const { tenantId } = requireAuth(request);
    const { created, row } = await importPackage(db, registry, tenantId, request.body);
    return reply.status(created ? 201 : 200).send({ created, package: describePackage(row) });
  });

  app.get('/v1/packages', { preHandler: auth('packages:write') }, async (request) => {
    const { tenantId } = requireAuth(request);
    const rows = await listTenantPackages(db, tenantId);
    return { packages: rows.map(describePackage) };
  });

  app.get('/v1/packages/:experience_id/:version', { preHandler: auth('packages:write') }, async (request) => {
    const { tenantId } = requireAuth(request);
    const { experience_id, version } = parseOrThrow(PackageParams, request.params, 'package reference');
    const row = await findPackage(db, tenantId, experience_id, version);
    if (!row) throw new ApiError(404, 'not_found', `No package ${experience_id}@${version} in this tenant.`);
    return { package: describePackage(row), content: row.content };
  });

  app.post(
    '/v1/packages/:experience_id/:version/publish',
    { preHandler: auth('packages:write') },
    async (request) => {
      const { tenantId } = requireAuth(request);
      const { experience_id, version } = parseOrThrow(PackageParams, request.params, 'package reference');
      const body = parseOrThrow(PublishBody, request.body, 'publish request');
      const row = await publishPackage(
        db,
        tenantId,
        experience_id,
        version,
        body.attestation,
        body.content_hash,
      );
      return { package: describePackage(row) };
    },
  );

  app.get('/v1/packages/attestation', async () => ({ statement: ATTESTATION_STATEMENT }));
}
