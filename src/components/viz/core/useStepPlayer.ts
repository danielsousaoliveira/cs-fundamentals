import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VizStep } from './types.ts';

/**
 * Generic over the step type so widgets that extend `VizStep` — the hash table's
 * `buckets`, say — keep their own fields on `player.step` instead of having them
 * widened away. Everything else about playback is identical, which is the point:
 * a richer step shape should not mean a separate player.
 */
export interface StepPlayer<T extends VizStep = VizStep> {
  step: T | undefined;
  index: number;
  total: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (index: number) => void;
  reset: () => void;
  speed: number;
  setSpeed: (multiplier: number) => void;
}

export interface StepPlayerOptions {
  autoplay?: boolean;
  /** Milliseconds per step at 1× speed. */
  interval?: number;
}

/**
 * The single source of truth for playback. Every widget on the site drives its
 * animation through this hook, which is why the controls behave identically
 * everywhere.
 *
 * Playback stops at the last step rather than looping: an algorithm that has
 * finished should look finished.
 */
export function useStepPlayer<T extends VizStep>(
  steps: T[],
  { autoplay = false, interval = 900 }: StepPlayerOptions = {},
): StepPlayer<T> {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(1);
  const total = steps.length;

  // A new trace (different input, different algorithm) restarts playback rather
  // than leaving the index pointing into the middle of something else.
  const stepsRef = useRef(steps);
  useEffect(() => {
    if (stepsRef.current !== steps) {
      stepsRef.current = steps;
      setIndex(0);
      setPlaying(autoplay);
    }
  }, [steps, autoplay]);

  useEffect(() => {
    if (!playing || total === 0) return;

    const id = window.setInterval(() => {
      setIndex((current) => {
        if (current >= total - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, interval / speed);

    return () => window.clearInterval(id);
  }, [playing, total, interval, speed]);

  const clamp = useCallback(
    (value: number) => Math.max(0, Math.min(total - 1, value)),
    [total],
  );

  const next = useCallback(() => {
    setPlaying(false);
    setIndex((i) => clamp(i + 1));
  }, [clamp]);

  const prev = useCallback(() => {
    setPlaying(false);
    setIndex((i) => clamp(i - 1));
  }, [clamp]);

  const seek = useCallback(
    (value: number) => {
      setPlaying(false);
      setIndex(clamp(value));
    },
    [clamp],
  );

  const reset = useCallback(() => {
    setPlaying(false);
    setIndex(0);
  }, []);

  const play = useCallback(() => {
    // Pressing play on a finished run replays it, rather than doing nothing.
    setIndex((i) => (i >= total - 1 ? 0 : i));
    setPlaying(true);
  }, [total]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(
    () => (playing ? pause() : play()),
    [playing, play, pause],
  );

  return useMemo(
    () => ({
      step: steps[index],
      index,
      total,
      playing,
      play,
      pause,
      toggle,
      next,
      prev,
      seek,
      reset,
      speed,
      setSpeed,
    }),
    [steps, index, total, playing, play, pause, toggle, next, prev, seek, reset, speed],
  );
}
