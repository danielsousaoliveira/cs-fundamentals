import type { StepPlayer } from './useStepPlayer.ts';
import type { VizStep } from './types.ts';

interface ScrubberProps {
  player: StepPlayer;
  steps: VizStep[];
}

/**
 * The timeline. Drag to any step; phase boundaries get a tick, so the shape of
 * the run (e.g. "build the heap" then "extract n times") is visible before you
 * play it.
 */
export function Scrubber({ player, steps }: ScrubberProps) {
  const last = Math.max(0, player.total - 1);

  return (
    <div className="viz-scrubber">
      <input
        type="range"
        min={0}
        max={last}
        value={player.index}
        onChange={(e) => player.seek(Number(e.target.value))}
        aria-label="Scrub through steps"
        className="viz-scrubber__range"
      />
      <div className="viz-scrubber__ticks" aria-hidden="true">
        {steps.map((step, i) =>
          step.phase ? (
            <span
              key={i}
              className="viz-scrubber__tick"
              style={{ left: `${last === 0 ? 0 : (i / last) * 100}%` }}
              title={step.phase}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}
