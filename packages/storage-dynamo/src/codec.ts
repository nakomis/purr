/**
 * Item encoding and opaque cursors. Domain objects are stored as the item's own
 * attributes, alongside the key attributes; reading strips the keys back off.
 */
import { ValidationError } from '@purr/domain';

export type Item = Record<string, unknown>;

const KEY_ATTRIBUTES = ['PK', 'SK', 'GSI1PK', 'GSI1SK'] as const;
const TABLE_KEY_ATTRIBUTES = ['PK', 'SK'] as const;

/** A domain object plus its key attributes, ready to Put. */
export function toItem<T extends object>(value: T, ...keySets: object[]): Item {
  return Object.assign({}, value, ...keySets) as Item;
}

/** The domain object without the key attributes. */
export function fromItem<T>(item: Item): T {
  const out: Item = { ...item };
  for (const k of KEY_ATTRIBUTES) delete out[k];
  return out as T;
}

/**
 * The key attributes of an item, for use as an ExclusiveStartKey: the table key
 * alone for a table query, plus the index key for a GSI1 query.
 */
export function keyOf(item: Item, indexed: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of indexed ? KEY_ATTRIBUTES : TABLE_KEY_ATTRIBUTES) {
    const v = item[k];
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function encodeCursor(key: Record<string, string>): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor and checks it belongs to the partition being queried, so a
 * cursor from one list can't be replayed against another.
 */
export function decodeCursor(
  cursor: string | undefined,
  partition: { attribute: 'PK' | 'GSI1PK'; value: string },
  indexed: boolean,
): Record<string, string> | undefined {
  if (!cursor) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('invalid cursor');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError('invalid cursor');
  }
  const expected = indexed ? KEY_ATTRIBUTES : TABLE_KEY_ATTRIBUTES;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!(expected as readonly string[]).includes(k) || typeof v !== 'string') {
      throw new ValidationError('invalid cursor');
    }
    out[k] = v;
  }
  if (expected.some((k) => out[k] === undefined) || out[partition.attribute] !== partition.value) {
    throw new ValidationError('invalid cursor');
  }
  return out;
}

/** The page size the in-memory adapter uses: 100 by default, between 1 and 1000. */
export function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 100, 1), 1000);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Ranks are base-62 strings; sort keys embed them, so anything else is refused up front. */
export function assertRank(rank: string): string {
  if (!/^[0-9A-Za-z]+$/.test(rank)) throw new ValidationError(`invalid rank ${JSON.stringify(rank)}`);
  return rank;
}
