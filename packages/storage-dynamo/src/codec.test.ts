import { ValidationError } from '@purr/domain';
import { describe, expect, it } from 'vitest';
import {
  assertRank,
  chunk,
  clampLimit,
  decodeCursor,
  encodeCursor,
  fromItem,
  keyOf,
  toItem,
} from './codec.js';
import { keys, pad } from './keys.js';

const partition = { attribute: 'PK', value: 'TASK#HOME-1' } as const;

describe('cursors', () => {
  it('round-trips a table key', () => {
    const key = { PK: 'TASK#HOME-1', SK: 'COMMENT#2026#a' };
    expect(decodeCursor(encodeCursor(key), partition, false)).toEqual(key);
  });

  it('round-trips an index key', () => {
    const key = { PK: 'a', SK: 'b', GSI1PK: 'P', GSI1SK: 'r#0000000001' };
    expect(decodeCursor(encodeCursor(key), { attribute: 'GSI1PK', value: 'P' }, true)).toEqual(key);
  });

  it('is undefined when absent', () => {
    expect(decodeCursor(undefined, partition, false)).toBeUndefined();
  });

  it.each([
    ['not base64 json', '!!!'],
    ['an array', Buffer.from('[]').toString('base64url')],
    ['a foreign partition', encodeCursor({ PK: 'TASK#OTHER-1', SK: 'x' })],
    ['an unknown attribute', encodeCursor({ PK: 'TASK#HOME-1', SK: 'x', Evil: 'y' })],
    ['a missing sort key', encodeCursor({ PK: 'TASK#HOME-1' })],
    [
      'index attributes on a table query',
      encodeCursor({ PK: 'TASK#HOME-1', SK: 'x', GSI1PK: 'a', GSI1SK: 'b' }),
    ],
  ])('rejects %s', (_name, cursor) => {
    expect(() => decodeCursor(cursor, partition, false)).toThrow(ValidationError);
  });
});

describe('items', () => {
  it('strips key attributes on the way out', () => {
    const item = toItem({ ref: 'HOME-1', title: 't' }, keys.task('HOME-1'), keys.taskIndex('p', 'a', 1));
    expect(item).toMatchObject({ PK: 'TASK#HOME-1', SK: 'META', GSI1PK: 'PROJECT#p#TASKS' });
    expect(fromItem(item)).toEqual({ ref: 'HOME-1', title: 't' });
  });

  it('keyOf takes the table key, plus the index key when asked', () => {
    const item = { PK: 'a', SK: 'b', GSI1PK: 'c', GSI1SK: 'd', other: 1 };
    expect(keyOf(item, false)).toEqual({ PK: 'a', SK: 'b' });
    expect(keyOf(item, true)).toEqual({ PK: 'a', SK: 'b', GSI1PK: 'c', GSI1SK: 'd' });
  });
});

describe('helpers', () => {
  it('clamps limits like the in-memory adapter', () => {
    expect(clampLimit(undefined)).toBe(100);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(5000)).toBe(1000);
    expect(clampLimit(7)).toBe(7);
  });

  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it('accepts only alphanumeric ranks, which sort after the # separator', () => {
    expect(assertRank('aB9')).toBe('aB9');
    expect(() => assertRank('a#b')).toThrow(ValidationError);
    expect(() => assertRank('')).toThrow(ValidationError);
  });

  it('pads sequences so they sort numerically', () => {
    expect(pad(2) < pad(10)).toBe(true);
  });

  it('orders rank#sequence sort keys as the ranks themselves order', () => {
    const k = (rank: string, seq: number) => keys.taskIndex('p', rank, seq).GSI1SK;
    expect(k('a', 9) < k('a5', 1)).toBe(true);
    expect(k('a', 1) < k('a', 2)).toBe(true);
  });
});
