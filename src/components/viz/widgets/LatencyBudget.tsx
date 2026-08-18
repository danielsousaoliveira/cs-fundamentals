import { useState } from 'react';
import { VizFrame } from '../core/index.ts';
import {
  BASELINE_SPANS,
  compareOptimisations,
  computeBudget,
} from '../traces/latencyBudget.ts';

/**
 * A span waterfall you can drag.
 *
 * Everything except the downstream call is fixed on purpose -- the point is
 * not "everything is adjustable", it's "one span dominates, and dragging the
 * others does almost nothing to the total". The downstream call starts at
 * 3000ms, the real p95 this repository captured from the slow-dependency
 * fault (see `traces/latencyBudget.ts`).
 */

const COLORS = ['#6b7280', '#6b7280', '#6b7280', '#6b7280', '#ef4444', '#6b7280'];

export function LatencyBudget() {
  const [downstreamMs, setDownstreamMs] = useState(3000);
  const spans = BASELINE_SPANS.map((s) =>
    s.adjustable ? { ...s, ms: downstreamMs } : s,
  );
  const budget = computeBudget(spans);
  const cmp = compareOptimisations(spans, 2);

  return (
    <VizFrame
      title="One slow span dominates the whole request"
      intro="Drag the downstream call. Watch what happens to the total -- and what does not happen when you shrink anything else."
      caption={`Total: ${budget.totalMs}ms. ${budget.dominantSpan} is ${(budget.dominantShare * 100).toFixed(0)}% of it.`}
    >
      <div className="lb__waterfall" role="img" aria-label="Latency waterfall">
        {budget.spans.map((s, i) => (
          <div key={s.name} className="lb__row">
            <span className="lb__row-label">{s.name}</span>
            <div className="lb__row-track">
              <div
                className="lb__row-bar"
                style={{
                  width: `${Math.max(0.5, budget.shares[i]! * 100)}%`,
                  background: COLORS[i],
                }}
              />
            </div>
            <span className="lb__row-value">{s.ms}ms</span>
          </div>
        ))}
      </div>

      <label className="lb__slider">
        <span>downstream call duration</span>
        <input
          type="range"
          min={0}
          max={3000}
          step={50}
          value={downstreamMs}
          onChange={(e) => setDownstreamMs(Number(e.target.value))}
        />
        <span className="lb__slider-value">{downstreamMs}ms</span>
      </label>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>total request time</dt>
          <dd>
            <span className="viz-counters__value">{budget.totalMs}ms</span>
          </dd>
        </div>
      </dl>

      <p className="lb__arithmetic">
        Shaving 2ms off <strong>{cmp.targetOfFixedOptimisation}</strong> (the fastest
        fixed span) saves {cmp.before - cmp.afterOptimisingFastestFixed}ms off the
        total. Shaving the same 2ms off the downstream call saves{' '}
        {cmp.before - cmp.afterOptimisingAdjustable}ms. Same effort, different span, a
        completely different result.
      </p>
    </VizFrame>
  );
}
