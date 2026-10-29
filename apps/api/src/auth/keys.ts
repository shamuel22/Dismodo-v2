import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SCOPES = ['packages:write', 'experiences:read', 'sessions:write', 'evidence:read'] as const;
export type Scope = (typeof SCOPES)[number];

const KEY_PATTERN = /^dsm_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;

/** API key shape: dsm_<12-char public prefix>_<256-bit secret, base64url>. */
export function generateApiKey(): { key: string; prefix: string; secretHash: string } {
  const prefix = randomBytes(9)
    .toString('base64url')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '0')
    .slice(0, 12);
  const key = `dsm_${prefix}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix, secretHash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function parseKey(key: string): { prefix: string } | null {
  const match = KEY_PATTERN.exec(key);
  return match ? { prefix: match[1]! } : null;
}

export function keyMatches(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashKey(key), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
