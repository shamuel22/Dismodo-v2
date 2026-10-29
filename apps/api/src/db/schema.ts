import { sql } from 'drizzle-orm';
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** A product that builds on DISMODO. All data is partitioned by tenant. */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Public, non-secret part of the key used for lookup. */
    prefix: text('prefix').notNull().unique(),
    /** SHA-256 of the full key. Keys are 190+ bits of entropy, so a fast hash is appropriate. */
    secretHash: text('secret_hash').notNull(),
    label: text('label').notNull(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('api_keys_tenant_idx').on(t.tenantId)],
);

export const packageStatus = pgEnum('package_status', ['draft', 'published']);
export const packageVisibility = pgEnum('package_visibility', ['private', 'public']);

/** Immutable experience package versions. Content never changes after insert; only status moves forward. */
export const packages = pgTable(
  'packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    experienceId: text('experience_id').notNull(),
    version: text('version').notNull(),
    status: packageStatus('status').notNull().default('draft'),
    visibility: packageVisibility('visibility').notNull().default('private'),
    content: jsonb('content').notNull(),
    contentHash: text('content_hash').notNull(),
    activityRevision: text('activity_revision').notNull(),
    evaluatorRevision: text('evaluator_revision').notNull(),
    validationSummary: jsonb('validation_summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Who reviewed the content and what they attested; structural checks cannot establish that prose is true. */
    attestation: jsonb('attestation'),
  },
  (t) => [
    uniqueIndex('packages_tenant_experience_version_uq').on(t.tenantId, t.experienceId, t.version),
    index('packages_published_idx')
      .on(t.status, t.visibility)
      .where(sql`${t.status} = 'published'`),
  ],
);
