import { describe, expect, it, vi } from 'vitest';
import { createFreshness, type FreshnessDeps, startOfDayLondon } from './freshness.js';

const H = 3_600_000;
const NOW = Date.parse('2026-11-23T15:00:00Z');
const ago = (hours: number) => new Date(NOW - hours * H).toISOString();

function setup(over: Partial<FreshnessDeps> & { live?: string | undefined } = {}) {
  let clock = NOW;
  let live = 'live' in over ? over.live : undefined;
  const deps = {
    liveBuiltAt: vi.fn(async () => live),
    rebuild: vi.fn(async () => {
      live = new Date(clock).toISOString();
      return { builtAt: live };
    }),
    onNewer: vi.fn(),
    // The wait for a rebuild never runs out unless a test says so.
    timeout: () => new Promise<void>(() => {}),
    now: () => clock,
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    ...over,
  };
  const setLive = (v: string) => {
    live = v;
  };
  return { f: createFreshness(deps), deps, setLive };
}

describe('createFreshness', () => {
  it('answers from the known build time with no lookup when it covers upUntil', async () => {
    const { f, deps } = setup({ live: ago(1) });
    await f.ensure(ago(2)); // learns ago(1) from the live lookup
    vi.mocked(deps.liveBuiltAt).mockClear();
    expect(await f.ensure(ago(3))).toEqual({ indexedUntil: ago(1), fresh: true });
    expect(deps.liveBuiltAt).not.toHaveBeenCalled();
    expect(deps.rebuild).not.toHaveBeenCalled();
  });

  it("Martin's case: cached 4 h ago, live 2 h ago, upUntil 3 h ago — learns the live time, no rebuild", async () => {
    const { f, deps, setLive } = setup({ live: ago(4) });
    await f.ensure(ago(5)); // the cache now holds ago(4)
    setLive(ago(2)); // another instance (or the nightly build) has since rebuilt
    expect(await f.ensure(ago(3))).toEqual({ indexedUntil: ago(2), fresh: true });
    expect(deps.rebuild).not.toHaveBeenCalled();
    expect(deps.onNewer).toHaveBeenLastCalledWith(ago(2));
  });

  it('rebuilds when even the live build is older than upUntil', async () => {
    const { f, deps } = setup({ live: ago(10) });
    const r = await f.ensure(ago(1));
    expect(deps.rebuild).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ indexedUntil: new Date(NOW).toISOString(), fresh: true });
  });

  it('rebuilds when there is no snapshot at all', async () => {
    const { f, deps } = setup({ live: undefined });
    expect((await f.ensure(ago(1))).fresh).toBe(true);
    expect(deps.rebuild).toHaveBeenCalledTimes(1);
  });

  it('answers stale, without failing, when the rebuild outlasts the wait', async () => {
    const { f } = setup({
      live: ago(10),
      waitMs: 20_000,
      rebuild: vi.fn(() => new Promise<never>(() => {})),
      timeout: async () => {},
    });
    expect(await f.ensure(ago(1))).toEqual({ indexedUntil: ago(10), fresh: false });
  });

  it("waits for someone else's rebuild instead of starting another", async () => {
    let polls = 0;
    const { f, deps } = setup({ live: ago(10), rebuild: vi.fn(async () => 'busy' as const) });
    vi.mocked(deps.liveBuiltAt).mockImplementation(async () =>
      ++polls >= 3 ? new Date(NOW).toISOString() : ago(10),
    );
    const r = await f.ensure(ago(1));
    expect(r.fresh).toBe(true);
    expect(deps.rebuild).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting on a busy rebuild at the deadline', async () => {
    const { f } = setup({
      live: ago(10),
      waitMs: 6_000,
      pollMs: 2_000,
      rebuild: vi.fn(async () => 'busy' as const),
    });
    expect(await f.ensure(ago(1))).toEqual({ indexedUntil: ago(10), fresh: false });
  });

  it('answers from the current index when the lookup or rebuild fails', async () => {
    const log = vi.fn();
    const { f } = setup({
      live: ago(10),
      log,
      rebuild: vi.fn(async () => Promise.reject(new Error('boom'))),
    });
    expect(await f.ensure(ago(1))).toEqual({ indexedUntil: ago(10), fresh: false });
    expect(log).toHaveBeenCalled();
  });

  it('shares one refresh between concurrent searches', async () => {
    const { f, deps } = setup({ live: ago(10) });
    const [a, b] = await Promise.all([f.ensure(ago(1)), f.ensure(ago(1))]);
    expect(a.fresh && b.fresh).toBe(true);
    expect(deps.rebuild).toHaveBeenCalledTimes(1);
  });
});

describe('startOfDayLondon', () => {
  it('is midnight UTC in winter (GMT)', () => {
    expect(startOfDayLondon(new Date('2026-11-23T15:00:00Z'))).toBe('2026-11-23T00:00:00.000Z');
  });

  it('is 23:00 UTC the day before in summer (BST)', () => {
    expect(startOfDayLondon(new Date('2026-07-01T12:00:00Z'))).toBe('2026-06-30T23:00:00.000Z');
  });

  it('uses the London date, not the UTC one, just after midnight BST', () => {
    // 23:30 UTC on 1 July is 00:30 BST on 2 July.
    expect(startOfDayLondon(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-01T23:00:00.000Z');
  });
});
