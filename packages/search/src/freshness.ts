/**
 * On-demand index freshness. A search says how recent its index must be (`upUntil`);
 * the index is rebuilt only when the stored snapshot is older than that.
 *
 * Builds only ever move forward, so the build time this instance last saw is a lower
 * bound on the live one. That gives three steps, cheapest first:
 *  1. known >= upUntil: fresh enough, with no lookup at all;
 *  2. otherwise read the live build time (an S3 HEAD): if that is fresh enough,
 *     remember it and answer;
 *  3. only then rebuild, waiting up to `waitMs`. A rebuild already running elsewhere
 *     ('busy') is waited for rather than duplicated. If the wait runs out, the search
 *     answers from the index it has, and says so (`fresh: false`); the rebuild carries
 *     on regardless, so a later search finds it done.
 */

export interface FreshnessDeps {
  /** The stored snapshot's build time (ISO), read without fetching it. */
  liveBuiltAt(): Promise<string | undefined>;
  /**
   * Rebuild so the index covers `upUntil`. Resolves with the new build time, or
   * 'busy' when another rebuild is already running.
   */
  rebuild(upUntil: string): Promise<{ builtAt: string } | 'busy'>;
  /** Told whenever a newer build than the last known one is seen, so the engine reloads. */
  onNewer(builtAt: string): void;
  /** How long a search waits for a fresh index. Default 20 s. */
  waitMs?: number;
  /** How often to re-read the build time while another rebuild runs. Default 2 s. */
  pollMs?: number;
  now?: () => number;
  /** Waits between polls. */
  sleep?: (ms: number) => Promise<void>;
  /** Resolves when a search has waited long enough for a rebuild. Default: a real timer. */
  timeout?: (ms: number) => Promise<void>;
  log?: (message: string, error?: unknown) => void;
}

export interface FreshnessResult {
  /** The index holds everything written before this (ISO); undefined if no build is known. */
  indexedUntil?: string;
  /** Whether indexedUntil reaches the requested upUntil. */
  fresh: boolean;
}

export interface Freshness {
  ensure(upUntil: string): Promise<FreshnessResult>;
  /** The build time this instance knows of, if any. */
  known(): string | undefined;
}

const TIMED_OUT = Symbol('timed out');

export function createFreshness(deps: FreshnessDeps): Freshness {
  const waitMs = deps.waitMs ?? 20_000;
  const pollMs = deps.pollMs ?? 2_000;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeout = deps.timeout ?? sleep;
  const log = deps.log ?? ((m: string, e?: unknown) => console.warn(m, e ?? ''));
  let known: string | undefined;
  let inflight: Promise<void> | undefined;

  const learn = (builtAt: string | undefined) => {
    if (builtAt && (!known || builtAt > known)) {
      known = builtAt;
      deps.onNewer(builtAt);
    }
  };
  const covers = (upUntil: string) => known !== undefined && known >= upUntil;
  const result = (upUntil: string): FreshnessResult => ({
    ...(known ? { indexedUntil: known } : {}),
    fresh: covers(upUntil),
  });

  async function refresh(upUntil: string): Promise<void> {
    learn(await deps.liveBuiltAt());
    if (covers(upUntil)) return;

    const deadline = now() + waitMs;
    const outcome = await Promise.race([
      deps.rebuild(upUntil),
      timeout(waitMs).then((): typeof TIMED_OUT => TIMED_OUT),
    ]);
    if (outcome === TIMED_OUT) return;
    if (outcome !== 'busy') {
      learn(outcome.builtAt);
      return;
    }
    // Someone else is rebuilding: watch the live build time until it covers us.
    while (!covers(upUntil) && now() + pollMs <= deadline) {
      await sleep(pollMs);
      learn(await deps.liveBuiltAt());
    }
  }

  return {
    known: () => known,
    async ensure(rawUpUntil: string): Promise<FreshnessResult> {
      const upUntil = new Date(rawUpUntil).toISOString();
      if (covers(upUntil)) return result(upUntil);
      // One refresh at a time per instance; a search arriving meanwhile shares it,
      // then re-checks (its upUntil may be later than the one being served).
      while (inflight) {
        await inflight;
        if (covers(upUntil)) return result(upUntil);
      }
      inflight = refresh(upUntil)
        .catch((error) => log('search freshness check failed; answering from the current index', error))
        .finally(() => {
          inflight = undefined;
        });
      await inflight;
      return result(upUntil);
    },
  };
}

/** Midnight at the start of the day `now` falls in, London time, as ISO (UTC). */
export function startOfDayLondon(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const utcMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  // London is UTC or UTC+1; at UTC midnight its clock reads 00 or 01.
  const londonHour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(utcMidnight),
    ),
  );
  return new Date(utcMidnight - londonHour * 3_600_000).toISOString();
}
