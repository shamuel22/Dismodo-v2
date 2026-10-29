export interface Fraction {
  n: number;
  d: number;
}

export function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

export function sameValue(a: Fraction, b: Fraction): boolean {
  return a.n * b.d === b.n * a.d;
}

export function reduce(f: Fraction): Fraction {
  const g = gcd(f.n, f.d);
  return { n: f.n / g, d: f.d / g };
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
];
const DENOMINATORS: Record<number, [string, string]> = {
  2: ['half', 'halves'],
  3: ['third', 'thirds'],
  4: ['quarter', 'quarters'],
  5: ['fifth', 'fifths'],
  6: ['sixth', 'sixths'],
  7: ['seventh', 'sevenths'],
  8: ['eighth', 'eighths'],
  9: ['ninth', 'ninths'],
  10: ['tenth', 'tenths'],
  12: ['twelfth', 'twelfths'],
};

export const SUPPORTED_DENOMINATORS = Object.keys(DENOMINATORS).map(Number);

/** English words for a proper fraction, e.g. { n: 3, d: 4 } → "three quarters". */
export function fractionWords({ n, d }: Fraction): string {
  const names = DENOMINATORS[d];
  if (!names || n < 1 || n >= d) throw new Error(`No words for ${n}/${d}.`);
  return `${ONES[n]} ${n === 1 ? names[0] : names[1]}`;
}

export function fractionSymbol({ n, d }: Fraction): string {
  return `${n}/${d}`;
}
