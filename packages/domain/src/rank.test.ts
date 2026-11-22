import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors.js';
import { rankBefore, rankBetween } from './rank.js';

describe('rankBetween', () => {
  it('returns a value for an empty list', () => {
    expect(rankBetween()).toMatch(/^[0-9A-Za-z]+$/);
  });

  it('returns a value strictly between two ranks', () => {
    for (const [a, b] of [
      ['a', 'b'],
      ['a', 'a1'],
      ['1', 'z'],
      ['Zz', 'a'],
    ]) {
      const r = rankBetween(a, b);
      expect(r > (a as string) && r < (b as string)).toBe(true);
    }
  });

  it('500 appends stay ordered and short', () => {
    const ranks: string[] = [];
    for (let i = 0; i < 500; i++) ranks.push(rankBetween(ranks.at(-1), undefined));
    expect([...ranks].sort()).toEqual(ranks);
    expect(Math.max(...ranks.map((r) => r.length))).toBeLessThan(32);
  });

  it('100 inserts at the same position stay ordered', () => {
    const low = rankBetween();
    let high = rankBetween(low, undefined);
    const made = [low, high];
    for (let i = 0; i < 100; i++) {
      high = rankBetween(low, high);
      made.push(high);
    }
    const sorted = [...new Set(made)].sort();
    expect(sorted).toHaveLength(made.length);
    expect(sorted[0]).toBe(low);
  });

  it('throws when before is not before after', () => {
    expect(() => rankBetween('b', 'a')).toThrow(ValidationError);
    expect(() => rankBetween('a', 'a')).toThrow(ValidationError);
    expect(() => rankBetween('a!', undefined)).toThrow(ValidationError);
  });
});

describe('rankBefore', () => {
  it('places at the end, or before a given rank', () => {
    const ranks = ['a', 'm'];
    expect(rankBefore(ranks) > 'm').toBe(true);
    const r = rankBefore(ranks, 'm');
    expect(r > 'a' && r < 'm').toBe(true);
    expect(rankBefore(ranks, 'a') < 'a').toBe(true);
    expect(() => rankBefore(ranks, 'q')).toThrow(ValidationError);
  });
});
