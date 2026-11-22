import { useCallback, useEffect, useRef, useState } from 'react';
import { type Clip, clipSrc, nextDelay, pickNext, type Random } from './schedule';

const FADE_MS = 400;
// banner.png is the 1024 px artwork scaled to full width and cropped 320 px tall
// from y = 430 of 1024: 430 / (1024 - 320) = 61.08 % down the overflow. The
// videos are 1024 px square, so the same `cover` + position matches exactly.
const FRAMING = { objectPosition: '50% 61.08%' } as const;

const REDUCED = '(prefers-reduced-motion: reduce)';

const motionQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED) : undefined);

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => motionQuery()?.matches ?? false);
  useEffect(() => {
    const mq = motionQuery();
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function useHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const onChange = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return hidden;
}

/** The still banner, which now and then plays one of five short cat animations. */
export function Banner({ random = Math.random }: { random?: Random }) {
  const reduced = useReducedMotion();
  const hidden = useHidden();
  const [clip, setClip] = useState<Clip | null>(null);
  const [shown, setShown] = useState(false);
  const isFirst = useRef(true);
  const lastCatch = useRef<Clip | null>(null);
  const randomRef = useRef(random);
  randomRef.current = random;

  const play = useCallback(() => {
    const next = pickNext(lastCatch.current, randomRef.current);
    if (next !== 'run') lastCatch.current = next;
    isFirst.current = false;
    setShown(false);
    setClip(next);
  }, []);

  // Schedule the next play while idle, visible and motion is allowed.
  useEffect(() => {
    if (clip || hidden || reduced) return;
    const timer = setTimeout(play, nextDelay(isFirst.current, randomRef.current));
    return () => clearTimeout(timer);
  }, [clip, hidden, reduced, play]);

  // Fade back to the still, then drop the video element.
  const finish = useCallback(() => setShown(false), []);
  useEffect(() => {
    if (!clip || shown) return;
    const timer = setTimeout(() => setClip(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [clip, shown]);

  return (
    <button
      type="button"
      onClick={() => {
        if (!clip && !reduced) play();
      }}
      className="relative mx-auto block aspect-[16/5] w-full max-w-[1600px] cursor-pointer overflow-hidden border-0 bg-transparent p-0"
    >
      <img
        src="/banner.png"
        alt="Four cats peeking over a ledge"
        className="absolute inset-0 h-full w-full object-cover"
        style={FRAMING}
      />
      {clip && (
        <video
          key={clip}
          src={clipSrc(clip)}
          autoPlay
          muted
          playsInline
          preload="auto"
          onPlaying={() => setShown(true)}
          onEnded={finish}
          onError={() => setClip(null)}
          className="absolute inset-0 h-full w-full object-cover transition-opacity"
          style={{ ...FRAMING, opacity: shown ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
        />
      )}
      <span className="sr-only">Play a cat animation</span>
    </button>
  );
}
