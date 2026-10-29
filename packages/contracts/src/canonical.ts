/**
 * Canonical JSON: object keys sorted by code point, no whitespace, arrays in order. Used to hash packages
 * so identical content always yields the same digest regardless of key order or formatting.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Non-finite numbers are not allowed.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

/** Nesting depth of a JSON value (scalars are depth 0). */
export function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  let max = 0;
  for (const child of children) max = Math.max(max, jsonDepth(child));
  return max + 1;
}
