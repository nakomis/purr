import { describe, expect, it } from 'vitest';
import { CATCHES, type Clip, clipSrc, nextDelay, pickNext } from './schedule';

/** A random source that replays the given values, then repeats the last. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] as number;
};

describe('pickNext', () => {
  it('never repeats the previous catch', () => {
    for (const previous of CATCHES) {
      for (let step = 0; step < 100; step++) {
        const pick = pickNext(previous, seq(0.5 + step / 200, step / 100));
        expect(pick).not.toBe(previous);
      }
    }
  });

  it('can reach every other catch', () => {
    const seen = new Set<Clip>();
    for (let step = 0; step < 4; step++) seen.add(pickNext('tau', seq(0.9, step / 4 + 0.01)));
    expect(seen).toEqual(new Set(['kappa', 'mu', 'chi']));
  });

  it('favours the mouse run: about half, the catches sharing the rest', () => {
    const counts: Record<string, number> = {};
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const pick = pickNext(null, seq((i + 0.5) / n, ((i * 0.618) % 1) + 0.0001));
      counts[pick] = (counts[pick] ?? 0) + 1;
    }
    expect((counts.run ?? 0) / n).toBeCloseTo(0.5, 1);
    for (const c of CATCHES) expect((counts[c] ?? 0) / n).toBeGreaterThan(0.1);
  });
});

describe('nextDelay', () => {
  it('is 20-40 s for the first play', () => {
    expect(nextDelay(true, () => 0)).toBe(20_000);
    expect(nextDelay(true, () => 0.5)).toBe(30_000);
    expect(nextDelay(true, () => 0.999999)).toBeLessThan(40_000);
  });

  it('is 60-180 s afterwards', () => {
    expect(nextDelay(false, () => 0)).toBe(60_000);
    expect(nextDelay(false, () => 0.5)).toBe(120_000);
    expect(nextDelay(false, () => 0.999999)).toBeLessThan(180_000);
  });
});

describe('clipSrc', () => {
  it('maps clips to their files', () => {
    expect(clipSrc('run')).toBe('/banner/purr-logo-2.mp4');
    expect(clipSrc('mu')).toBe('/banner/purr-logo-2-grab-mu.mp4');
  });
});
