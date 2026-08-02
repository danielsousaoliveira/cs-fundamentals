import { useEffect, useRef } from 'react';
import type { StepPlayer } from './useStepPlayer.ts';

interface StepControlsProps {
  player: StepPlayer;
  showSpeed?: boolean;
}

/**
 * Prev / play / next / reset, plus a speed control.
 *
 * Keyboard support is not decoration here: a step-through visualisation is
 * useless if you have to move your hand to the mouse for every frame. Arrow keys
 * step, space toggles playback — but only while focus is inside this widget, so
 * pressing space to scroll the page still works everywhere else.
 */
export function StepControls({ player, showSpeed = true }: StepControlsProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!root.contains(document.activeElement)) return;

      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          player.next();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          player.prev();
          break;
        case ' ':
          event.preventDefault();
          player.toggle();
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [player]);

  const atStart = player.index === 0;
  const atEnd = player.index >= player.total - 1;

  return (
    <div className="viz-controls" ref={rootRef}>
      <button
        type="button"
        className="viz-btn"
        onClick={player.reset}
        disabled={atStart && !player.playing}
        aria-label="Reset to the first step"
      >
        ↺
      </button>
      <button
        type="button"
        className="viz-btn"
        onClick={player.prev}
        disabled={atStart}
        aria-label="Previous step"
      >
        ‹
      </button>
      <button
        type="button"
        className="viz-btn viz-btn--primary"
        onClick={player.toggle}
        aria-label={player.playing ? 'Pause' : 'Play'}
      >
        {player.playing ? '❚❚' : '▶'}
      </button>
      <button
        type="button"
        className="viz-btn"
        onClick={player.next}
        disabled={atEnd}
        aria-label="Next step"
      >
        ›
      </button>

      <span className="viz-controls__count" aria-live="polite">
        step {player.index + 1} / {player.total}
      </span>

      {showSpeed && (
        <label className="viz-controls__speed">
          <span className="sr-only">Playback speed</span>
          <select
            value={player.speed}
            onChange={(e) => player.setSpeed(Number(e.target.value))}
            aria-label="Playback speed"
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </label>
      )}
    </div>
  );
}
