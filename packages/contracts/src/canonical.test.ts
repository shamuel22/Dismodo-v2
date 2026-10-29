import { describe, expect, it } from 'vitest';
import { canonicalJson, jsonDepth } from './canonical';

describe('canonical json', () => {
  it('ignores key order and formatting', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson(JSON.parse('{ "y": 2,\n "x": 1 }')));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('measures depth', () => {
    expect(jsonDepth(1)).toBe(0);
    expect(jsonDepth({ a: [{ b: 1 }] })).toBe(3);
  });
});
