import { useMemo, useState } from 'react';
import {
  ArrayStrip,
  CounterBar,
  Legend,
  Scrubber,
  StepControls,
  VizFrame,
  VizStack,
  useStepPlayer,
} from '../core/index.ts';
import { growthCosts, traceGrowth } from '../traces/dynamicArray.ts';

const PUSHES = 17;

/**
 * The arrays page's centrepiece: an array growing, drawn as real memory.
 *
 * Two things are visible here that a prose explanation of amortisation cannot
 * make concrete. First, the **reserved-but-unused slots** — the space you pay for
 * so that appends can be free. Second, the **cost profile**: a bar chart where
 * almost every append is one unit tall and a handful are enormous. Amortised
 * O(1) is exactly the claim that the area under that chart stays linear.
 */
export function DynamicArrayGrowth() {
  const [growthFactor, setGrowthFactor] = useState(2);

  const trace = useMemo(
    () => traceGrowth({ pushes: PUSHES, growthFactor }),
    [growthFactor],
  );
  const costs = useMemo(
    () => growthCosts({ pushes: PUSHES, growthFactor }),
    [growthFactor],
  );

  const player = useStepPlayer(trace.steps, { interval: 700 });
  const step = player.step;

  // How many appends have completed at the current step, for the cost chart.
  const pushesSoFar = useMemo(() => {
    const filled = (step?.cells ?? []).filter((c) => c.value !== '').length;
    return filled;
  }, [step]);

  const maxCost = Math.max(...costs.map((c) => c.copies + 1));

  return (
    <VizFrame
      title="A dynamic array growing"
      intro="Contiguous memory with real addresses. Dashed slots are reserved but unused — the space you buy so that most appends cost nothing."
      caption={step?.caption}
      footer={
        <>
          <StepControls player={player} />
          <Scrubber player={player} steps={trace.steps} />
        </>
      }
    >
      <div className="growth-plot__controls">
        <label>
          <span>
            growth factor <strong>{growthFactor}×</strong>
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.5}
            value={growthFactor}
            onChange={(e) => setGrowthFactor(Number(e.target.value))}
          />
        </label>
        <span className="viz-frame__intro">
          {growthFactor === 1
            ? 'Growing by a constant makes every append a full copy — quadratic.'
            : `Each resize reserves ${growthFactor}× the space, so copies get exponentially rarer.`}
        </span>
      </div>

      <VizStack>
        <ArrayStrip
          cells={step?.cells ?? []}
          memoryMode
          stride={8}
          label="one contiguous block"
          idPrefix="dyn-"
        />

        <div className="cost-chart" aria-hidden="true">
          <div className="cost-chart__label">cost per append (elements copied)</div>
          <div className="cost-chart__bars">
            {costs.map((cost) => (
              <span
                key={cost.push}
                className="cost-chart__bar"
                data-spent={cost.push <= pushesSoFar || undefined}
                data-resize={cost.copies > 0 || undefined}
                style={{ height: `${((cost.copies + 1) / maxCost) * 100}%` }}
                title={`append ${cost.push}: ${cost.copies} copies`}
              />
            ))}
          </div>
        </div>
      </VizStack>

      <CounterBar counters={step?.counters} spec={trace.counterSpec} />

      <Legend
        roles={['default', 'active', 'compare', 'swap', 'empty']}
        labels={{
          default: 'in use',
          active: 'just appended',
          compare: 'about to be copied out',
          swap: 'copied into new memory',
          empty: 'reserved, unused',
        }}
      />
    </VizFrame>
  );
}
