import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Banner } from './Banner';

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

const stubMotion = (reduce: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('reduce'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );

const video = () => document.querySelector('video');
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  stubMotion(false);
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Banner', () => {
  it('shows the still with its alt text and no video to begin with', () => {
    render(<Banner random={() => 0} />);
    expect(screen.getByAltText('Four cats peeking over a ledge')).toHaveAttribute('src', '/banner.png');
    expect(screen.getByRole('button', { name: /Play a cat animation/ })).toBeInTheDocument();
    expect(video()).toBeNull();
  });

  it('creates the video only when the first play comes due, 20 s in with random 0', () => {
    render(<Banner random={() => 0} />);
    tick(19_999);
    expect(video()).toBeNull();
    tick(1);
    const v = video();
    expect(v).not.toBeNull();
    expect(v?.getAttribute('src')).toBe('/banner/purr-logo-2.mp4');
    expect(v?.muted).toBe(true);
    expect(v?.hasAttribute('controls')).toBe(false);
  });

  it('fades back to the still when the video ends, then waits 60 s or more', () => {
    render(<Banner random={() => 0} />);
    tick(20_000);
    fireEvent.playing(video() as HTMLVideoElement);
    expect(video()).toHaveStyle({ opacity: '1' });
    fireEvent.ended(video() as HTMLVideoElement);
    expect(video()).toHaveStyle({ opacity: '0' });
    tick(500);
    expect(video()).toBeNull();
    tick(59_000);
    expect(video()).toBeNull();
    tick(1_000);
    expect(video()).not.toBeNull();
  });

  it('drops the video on error', () => {
    render(<Banner random={() => 0} />);
    tick(20_000);
    fireEvent.error(video() as HTMLVideoElement);
    expect(video()).toBeNull();
  });

  it('never plays when reduced motion is requested, even on click', () => {
    stubMotion(true);
    render(<Banner random={() => 0} />);
    tick(600_000);
    fireEvent.click(screen.getByRole('button'));
    expect(video()).toBeNull();
  });

  it('pauses the schedule while the tab is hidden and restarts it on return', () => {
    render(<Banner random={() => 0} />);
    tick(10_000);
    act(() => setVisibility('hidden'));
    tick(600_000);
    expect(video()).toBeNull();
    act(() => setVisibility('visible'));
    tick(19_999);
    expect(video()).toBeNull();
    tick(1);
    expect(video()).not.toBeNull();
  });

  it('plays one immediately when clicked, and ignores clicks while playing', () => {
    render(<Banner random={() => 0.9} />);
    fireEvent.click(screen.getByRole('button'));
    const first = video();
    expect(first).not.toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(video()).toBe(first);
  });

  it('does not repeat a catch twice in a row', () => {
    // 0.9 skips the mouse run, then picks the last available catch each time.
    render(<Banner random={() => 0.9} />);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button'));
      seen.push(video()?.getAttribute('src') ?? '');
      fireEvent.error(video() as HTMLVideoElement);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });
});
