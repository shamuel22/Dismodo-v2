import { z } from 'zod';
import { InterventionId } from './interventions';
import { ComponentRef, Locale, SemVer, Slug } from './primitives';

export const PACKAGE_SCHEMA = 'dismodo.experience/1';
/** Largest accepted package document, in bytes of JSON. */
export const MAX_PACKAGE_BYTES = 256 * 1024;
/** Deepest nesting accepted in a package document. */
export const MAX_PACKAGE_DEPTH = 16;

const Text = (max: number) => z.string().trim().min(1).max(max);
/** Learner-facing text: plain text only, no markup. */
const PlainText = (max: number) =>
  Text(max).refine((value) => !/[<>]/.test(value), 'Use plain text; "<" and ">" are not allowed.');

/** Keys a builder may not use in dictionaries (prototype pollution guards). */
const RESERVED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'hasownproperty',
  'tostring',
  'valueof',
]);
const DictKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,40}$/)
  .refine((key) => !RESERVED_KEYS.has(key.toLowerCase()), 'This key name is reserved.');

const Identified = z.strictObject({ id: Slug, text: PlainText(400) });

export const ContextOption = z.strictObject({
  id: Slug,
  label: PlainText(60),
  /** Values for the activity's context slots, e.g. { item_singular: "task", item_plural: "tasks" }. */
  nouns: z.record(DictKey, PlainText(60)),
  /** Learner-facing scenario for an item; uses context slots and activity template variables. */
  scenario_template: PlainText(400),
  /** Where the reference stops matching the concept, so it is not overstretched. */
  limits: Text(400),
});
export type ContextOption = z.infer<typeof ContextOption>;

export const Confusion = z.strictObject({
  id: Slug,
  description: Text(300),
  /** Evaluator error codes that are evidence for this confusion. */
  signals: z.array(z.string().max(60)).min(1).max(10),
  /** Interventions to prefer when this confusion is suspected; must be allowed. */
  suggested: z.array(InterventionId).min(1).max(5),
});
export type Confusion = z.infer<typeof Confusion>;

export const EditorialContent = z.strictObject({
  title: PlainText(80),
  body_template: PlainText(800),
  steps_template: z.array(PlainText(200)).max(8).optional(),
});
export type EditorialContent = z.infer<typeof EditorialContent>;

export const SessionPolicy = z.strictObject({
  time_budget_minutes: z.int().min(2).max(30),
  /** Start with one unassisted diagnostic item before any explanation. */
  baseline: z.boolean(),
  practice_items: z.int().min(1).max(10),
  independent_items: z.int().min(1).max(5),
  max_hints_per_item: z.int().min(0).max(5),
  max_interventions: z.int().min(0).max(6),
});
export type SessionPolicy = z.infer<typeof SessionPolicy>;

export const ReservedCheck = z.strictObject({
  id: Slug,
  context_id: Slug,
  spec: z.unknown(),
});

export const PackageTest = z.strictObject({
  name: Text(120),
  spec: z.unknown(),
  response: z.unknown(),
  expect: z.strictObject({ correct: z.boolean(), error_code: z.string().max(60).nullable().optional() }),
});

export const ExperiencePackage = z.strictObject({
  schema: z.literal(PACKAGE_SCHEMA),
  experience_id: Slug,
  version: SemVer,
  locale: Locale,
  title: PlainText(80),
  /** One learner-facing sentence; it stays fixed while explanations adapt. */
  objective: PlainText(200),
  summary: Text(500),
  audience: z.strictObject({ description: Text(200), adults_only: z.literal(true) }),
  skill: z.strictObject({ id: Slug, name: PlainText(80) }),
  prerequisites: z.array(Identified).max(10),
  essential_facts: z.array(Identified).min(1).max(20),
  activity: z.strictObject({ ref: ComponentRef, params: z.unknown() }),
  evaluator: z.strictObject({ ref: ComponentRef, config: z.unknown() }),
  contexts: z.array(ContextOption).min(1).max(10),
  confusions: z.array(Confusion).max(12),
  interventions: z.strictObject({
    allowed: z.array(InterventionId).min(1).max(9),
    editorial: z.partialRecord(InterventionId, EditorialContent),
  }),
  tone: z.strictObject({
    must: z.array(Text(200)).max(10),
    must_not_phrases: z.array(Text(80)).max(40),
  }),
  session_policy: SessionPolicy,
  reserved_checks: z.array(ReservedCheck).min(1).max(32),
  tests: z.array(PackageTest).min(1).max(64),
});
export type ExperiencePackage = z.infer<typeof ExperiencePackage>;
