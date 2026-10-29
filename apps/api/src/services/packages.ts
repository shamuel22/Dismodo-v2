import { createHash } from 'node:crypto';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import { canonicalJson, type ComponentRegistry, type ExperiencePackage } from '@dismodo/contracts';
import { validatePackage, type PackageValidationSummary } from '@dismodo/engine';
import type { Database } from '../db/client';
import { packages } from '../db/schema';
import { ApiError } from '../errors';

export function contentHash(value: unknown): string {
  return 'sha256:' + createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export interface Attestation {
  reviewer: string;
  statement: string;
}

/** Statement a reviewer must send verbatim to publish; validation cannot vouch for meaning. */
export const ATTESTATION_STATEMENT =
  'I reviewed this package: its facts, explanations and contexts are accurate and respectful for its audience.';

type PackageRow = typeof packages.$inferSelect;

export function describePackage(row: PackageRow) {
  const content = row.content as ExperiencePackage;
  return {
    experience_id: row.experienceId,
    version: row.version,
    ref: `${row.experienceId}@${row.version}`,
    status: row.status,
    visibility: row.visibility,
    title: content.title,
    objective: content.objective,
    locale: content.locale,
    skill: content.skill,
    content_hash: row.contentHash,
    components: { activity: row.activityRevision, evaluator: row.evaluatorRevision },
    validation: row.validationSummary as PackageValidationSummary,
    created_at: row.createdAt.toISOString(),
    published_at: row.publishedAt?.toISOString() ?? null,
  };
}

export function validateOrThrow(registry: ComponentRegistry, input: unknown) {
  const result = validatePackage(input, registry);
  if (!result.ok) {
    throw new ApiError(422, 'invalid_package', `The package has ${result.issues.length} problem(s).`, {
      issues: result.issues,
      ...(result.summary ? { summary: result.summary } : {}),
    });
  }
  return result;
}

/**
 * Stores a new immutable version. Re-sending identical content is idempotent (returns the existing row);
 * different content under an existing version is a conflict: versions never change.
 */
export async function importPackage(
  db: Database,
  registry: ComponentRegistry,
  tenantId: string,
  input: unknown,
): Promise<{ created: boolean; row: PackageRow }> {
  const { package: pkg, summary } = validateOrThrow(registry, input);
  const hash = contentHash(pkg);
  const [inserted] = await db
    .insert(packages)
    .values({
      tenantId,
      experienceId: pkg.experience_id,
      version: pkg.version,
      content: pkg,
      contentHash: hash,
      activityRevision: summary.components.activity,
      evaluatorRevision: summary.components.evaluator,
      validationSummary: summary,
    })
    .onConflictDoNothing({ target: [packages.tenantId, packages.experienceId, packages.version] })
    .returning();
  if (inserted) return { created: true, row: inserted };

  const existing = await findPackage(db, tenantId, pkg.experience_id, pkg.version);
  if (!existing) throw new ApiError(500, 'internal_error', 'Package vanished during import.');
  if (existing.contentHash !== hash) {
    throw new ApiError(
      409,
      'version_conflict',
      `${pkg.experience_id}@${pkg.version} already exists with different content. Versions are immutable; bump the version.`,
      { existing_hash: existing.contentHash, submitted_hash: hash },
    );
  }
  return { created: false, row: existing };
}

export async function findPackage(db: Database, tenantId: string, experienceId: string, version: string) {
  const [row] = await db
    .select()
    .from(packages)
    .where(
      and(
        eq(packages.tenantId, tenantId),
        eq(packages.experienceId, experienceId),
        eq(packages.version, version),
      ),
    );
  return row;
}

export async function publishPackage(
  db: Database,
  tenantId: string,
  experienceId: string,
  version: string,
  attestation: Attestation,
  expectedHash?: string,
): Promise<PackageRow> {
  const row = await findPackage(db, tenantId, experienceId, version);
  if (!row) throw new ApiError(404, 'not_found', `No package ${experienceId}@${version} in this tenant.`);
  if (expectedHash && expectedHash !== row.contentHash) {
    throw new ApiError(409, 'hash_mismatch', 'The stored content differs from the content you reviewed.', {
      stored_hash: row.contentHash,
    });
  }
  if (attestation.statement !== ATTESTATION_STATEMENT) {
    throw new ApiError(422, 'attestation_required', 'Publishing needs the review statement, sent verbatim.', {
      statement: ATTESTATION_STATEMENT,
    });
  }
  if (row.status === 'published') return row;
  const [updated] = await db
    .update(packages)
    .set({
      status: 'published',
      publishedAt: new Date(),
      attestation: { ...attestation, content_hash: row.contentHash, at: new Date().toISOString() },
    })
    .where(and(eq(packages.id, row.id), eq(packages.status, 'draft')))
    .returning();
  return updated ?? (await findPackage(db, tenantId, experienceId, version))!;
}

export async function listTenantPackages(db: Database, tenantId: string) {
  return db
    .select()
    .from(packages)
    .where(eq(packages.tenantId, tenantId))
    .orderBy(asc(packages.experienceId), desc(packages.createdAt));
}

/** Published packages a tenant may run: its own and public ones. */
export async function listRunnablePackages(db: Database, tenantId: string) {
  return db
    .select()
    .from(packages)
    .where(
      and(
        eq(packages.status, 'published'),
        or(eq(packages.tenantId, tenantId), eq(packages.visibility, 'public')),
      ),
    )
    .orderBy(asc(packages.experienceId), desc(packages.createdAt));
}
