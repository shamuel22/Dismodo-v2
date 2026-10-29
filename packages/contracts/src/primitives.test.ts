import { describe, expect, it } from 'vitest';
import {
  ComponentRef,
  ExperienceVersionRef,
  Locale,
  SemVer,
  Slug,
  compareSemVer,
  formatExperienceVersionRef,
  parseExperienceVersionRef,
} from './primitives';

describe('primitives', () => {
  it('accepts kebab-case slugs and rejects others', () => {
    expect(Slug.safeParse('parts-of-a-whole').success).toBe(true);
    for (const bad of ['Parts', 'a', 'double--hyphen', '-lead', 'trail-', 'has space']) {
      expect(Slug.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('accepts strict semver only', () => {
    expect(SemVer.safeParse('1.0.0').success).toBe(true);
    for (const bad of ['1.0', '01.0.0', '1.0.0-beta', 'v1.0.0']) {
      expect(SemVer.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('requires a major version on component references', () => {
    expect(ComponentRef.safeParse('fraction-of-set.v1').success).toBe(true);
    expect(ComponentRef.safeParse('fraction-of-set').success).toBe(false);
    expect(ComponentRef.safeParse('fraction-of-set.v0').success).toBe(false);
  });

  it('accepts language tags with optional region', () => {
    expect(Locale.safeParse('en').success).toBe(true);
    expect(Locale.safeParse('es-DO').success).toBe(true);
    expect(Locale.safeParse('english').success).toBe(false);
  });

  it('round-trips experience version references', () => {
    const ref = formatExperienceVersionRef('parts-of-a-whole', '1.0.0');
    expect(ref).toBe('parts-of-a-whole@1.0.0');
    expect(parseExperienceVersionRef(ref)).toEqual({ experienceId: 'parts-of-a-whole', version: '1.0.0' });
    expect(ExperienceVersionRef.safeParse('parts-of-a-whole@1.0').success).toBe(false);
    expect(parseExperienceVersionRef('@1.0.0')).toBeNull();
  });

  it('orders versions numerically', () => {
    expect(compareSemVer('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareSemVer('2.0.0', '2.0.0')).toBe(0);
    expect(compareSemVer('0.9.9', '1.0.0')).toBeLessThan(0);
  });
});
