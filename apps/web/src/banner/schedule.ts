/** The five banner animations: a mouse running past, and four cats catching it. */
export const MOUSE_RUN = 'run' as const;
export const CATCHES = ['kappa', 'tau', 'mu', 'chi'] as const;

export type Catch = (typeof CATCHES)[number];
export type Clip = typeof MOUSE_RUN | Catch;
export type Random = () => number;

/** Chance that the next animation is the mouse run rather than a catch. */
export const MOUSE_RUN_SHARE = 0.5;

/** Milliseconds before the first play after load: 20-40 s. */
export const FIRST_DELAY_MS = { min: 20_000, max: 40_000 };
/** Milliseconds between later plays: 60-180 s. */
export const LATER_DELAY_MS = { min: 60_000, max: 180_000 };

/**
 * Choose the next animation. The mouse run comes up about half the time; the
 * catches share the rest, and `previous` (the last catch played, if any) is
 * never repeated. A mouse run does not count as a catch, so callers keep
 * passing the last catch played even after a mouse run.
 */
export function pickNext(previous: Clip | null, random: Random): Clip {
  if (random() < MOUSE_RUN_SHARE) return MOUSE_RUN;
  const options = CATCHES.filter((c) => c !== previous);
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

/** How long to wait before the next play, in milliseconds. */
export function nextDelay(isFirst: boolean, random: Random): number {
  const { min, max } = isFirst ? FIRST_DELAY_MS : LATER_DELAY_MS;
  return min + random() * (max - min);
}

/** The video file for a clip, under `public/banner/`. */
export function clipSrc(clip: Clip): string {
  return clip === MOUSE_RUN ? '/banner/purr-logo-2.mp4' : `/banner/purr-logo-2-grab-${clip}.mp4`;
}
