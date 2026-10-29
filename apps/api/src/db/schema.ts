import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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

/** A learner as known to one tenant. external_ref is the builder's own (ideally pseudonymous) id. */
export const learners = pgTable(
  'learners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    externalRef: text('external_ref').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('learners_tenant_ref_uq').on(t.tenantId, t.externalRef)],
);

export const sessionStatus = pgEnum('session_status', ['active', 'paused', 'completed', 'abandoned']);
export const sessionPolicy = pgEnum('session_policy', ['adaptive', 'fixed']);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id),
    experienceRef: text('experience_ref').notNull(),
    contentHash: text('content_hash').notNull(),
    /** Evidence memory key: skill id plus the activity major it was measured with. */
    skillKey: text('skill_key').notNull(),
    policy: sessionPolicy('policy').notNull(),
    seed: integer('seed').notNull(),
    status: sessionStatus('status').notNull().default('active'),
    phase: text('phase').notNull(),
    lastSeq: integer('last_seq').notNull(),
    /** SHA-256 of the learner link token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('sessions_tenant_learner_idx').on(t.tenantId, t.learnerId, t.skillKey)],
);

/** Append-only session log. A trigger rejects UPDATE and DELETE. */
export const sessionEvents = pgTable(
  'session_events',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    seq: integer('seq').notNull(),
    actor: text('actor').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    clientEventId: text('client_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.seq] }),
    uniqueIndex('session_events_client_id_uq')
      .on(t.sessionId, t.clientEventId)
      .where(sql`${t.clientEventId} is not null`),
  ],
);

/**
 * Per-item evidence projected from session events, for memory across sessions. Rebuilt from the log,
 * never edited by hand: the event log stays the source of truth.
 */
export const observations = pgTable(
  'observations',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    itemId: text('item_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    learnerId: uuid('learner_id').notNull(),
    skillKey: text('skill_key').notNull(),
    experienceRef: text('experience_ref').notNull(),
    engineVersion: text('engine_version').notNull(),
    phase: text('phase').notNull(),
    identity: text('identity').notNull(),
    contextId: text('context_id').notNull(),
    correct: boolean('correct'),
    errorCode: text('error_code'),
    alternativeCodes: text('alternative_codes').array().notNull(),
    hintsUsed: integer('hints_used').notNull(),
    selfRating: text('self_rating'),
    unfamiliarReference: boolean('unfamiliar_reference').notNull(),
    /** Interventions shown earlier in the session, in order. */
    interventionsBefore: text('interventions_before').array().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.itemId] }),
    index('observations_memory_idx').on(t.tenantId, t.learnerId, t.skillKey),
  ],
);

/** Every call to a decision model, projected from session events for latency, cost and reliability views. */
export const modelCalls = pgTable(
  'model_calls',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    /** Event that carries the decision this call belonged to. */
    eventSeq: integer('event_seq').notNull(),
    attempt: integer('attempt').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    tier: text('tier').notNull(),
    status: text('status').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    error: text('error'),
    /** Source of the decision that resulted: model, or fallback when every attempt failed. */
    decisionSource: text('decision_source').notNull(),
    escalationReason: text('escalation_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.eventSeq, t.attempt] }),
    index('model_calls_tenant_idx').on(t.tenantId, t.createdAt),
  ],
);
