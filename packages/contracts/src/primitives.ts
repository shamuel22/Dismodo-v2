import { z } from 'zod';

/** Lowercase kebab-case identifier shared by experiences, skills and contexts. */
export const Slug = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
    'Use lowercase letters, digits and single hyphens (e.g. "parts-of-a-whole").',
  )
  .min(3)
  .max(64);
export type Slug = z.infer<typeof Slug>;

/** Strict semantic version without pre-release or build tags. */
export const SemVer = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Use a semantic version like "1.0.0".');
export type SemVer = z.infer<typeof SemVer>;

/** Reference to a registered, reviewed component (activity or evaluator), e.g. "set-selection.v1". */
export const ComponentRef = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.v[1-9]\d*$/,
    'Use a component reference with a major version, like "fraction-of-set.v1".',
  );
export type ComponentRef = z.infer<typeof ComponentRef>;

/** BCP 47 language tag, limited to language and optional region (e.g. "en", "es-DO"). */
export const Locale = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, 'Use a language tag like "en" or "es-DO".');
export type Locale = z.infer<typeof Locale>;

/** Pinned experience version, written "experience-id@1.2.3". */
export const ExperienceVersionRef = z
  .string()
  .refine((value) => parseExperienceVersionRef(value) !== null, 'Use "experience-id@1.0.0".');
export type ExperienceVersionRef = z.infer<typeof ExperienceVersionRef>;

export function parseExperienceVersionRef(value: string): { experienceId: Slug; version: SemVer } | null {
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const experienceId = Slug.safeParse(value.slice(0, at));
  const version = SemVer.safeParse(value.slice(at + 1));
  if (!experienceId.success || !version.success) return null;
  return { experienceId: experienceId.data, version: version.data };
}

export function formatExperienceVersionRef(experienceId: Slug, version: SemVer): ExperienceVersionRef {
  return `${experienceId}@${version}`;
}

/** Orders two semantic versions; negative when a < b. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
