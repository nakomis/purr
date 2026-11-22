import { ValidationError } from './errors.js';
import type { Rank } from './types.js';

/**
 * Fractional ranks: strings that sort lexically, so moving an item rewrites only
 * that item. Base 62 in ASCII order. A rank never ends in '0', which guarantees a
 * value exists between any two distinct ranks.
 *
 * Appending is cheap (about one character per 30 appends); repeatedly inserting at
 * the very same spot halves the gap each time (about one character per six
 * inserts), which is inherent in the technique and fine at Purr's scale.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function midpoint(a: string, b: string | undefined): string {
  if (b !== undefined && a >= b) {
    throw new ValidationError(`rank ${JSON.stringify(a)} is not before ${JSON.stringify(b)}`);
  }
  if (a.endsWith('0') || b?.endsWith('0')) {
    throw new ValidationError('a rank cannot end in 0');
  }
  if (b !== undefined) {
    // Shared prefix: keep it and recurse on the remainder.
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0] as string) : 0;
  if (b === undefined) {
    // Appending: start an empty list mid-range, then step one digit at a time, so
    // a long list of appends grows by one character per ~30 rather than halving.
    if (a === '') return DIGITS[DIGITS.length / 2] as string;
    if (digitA + 1 < DIGITS.length) return DIGITS[digitA + 1] as string;
    return (DIGITS[digitA] as string) + midpoint(a.slice(1), undefined);
  }
  const digitB = DIGITS.indexOf(b[0] as string);
  if (digitB - digitA > 1) {
    return DIGITS[Math.round((digitA + digitB) / 2)] as string;
  }
  if (b !== undefined && b.length > 1) return b.slice(0, 1);
  return (DIGITS[digitA] as string) + midpoint(a.slice(1), undefined);
}

/** A rank strictly between `before` and `after` (either may be omitted for an open end). */
export function rankBetween(before?: Rank, after?: Rank): Rank {
  for (const r of [before, after]) {
    if (r !== undefined && (r === '' || [...r].some((c) => !DIGITS.includes(c)))) {
      throw new ValidationError(`invalid rank ${JSON.stringify(r)}`);
    }
  }
  return midpoint(before ?? '', after);
}

/** The rank that places an item before `beforeRank` in an ordered list of ranks (at the end if omitted). */
export function rankBefore(sortedRanks: Rank[], beforeRank?: Rank): Rank {
  if (beforeRank === undefined) return rankBetween(sortedRanks.at(-1), undefined);
  const i = sortedRanks.indexOf(beforeRank);
  if (i < 0) throw new ValidationError(`no item with rank ${beforeRank} to place before`);
  return rankBetween(i > 0 ? sortedRanks[i - 1] : undefined, beforeRank);
}
