import type { Rng } from '@dismodo/contracts';

/** Seeded PRNG (mulberry32) so a session's items can be replayed exactly. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    int,
    pick: (values) => {
      if (values.length === 0) throw new Error('Cannot pick from an empty list.');
      return values[int(0, values.length - 1)]!;
    },
    shuffle: (values) => {
      const out = [...values];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}
