import { describe, expect, it } from 'vitest';
import {
  BASELINE_SPANS,
  compareOptimisations,
  computeBudget,
} from './latencyBudget.ts';

describe('computeBudget', () => {
  it('sums every span into the total', () => {
    const result = computeBudget(BASELINE_SPANS);
    const expected = BASELINE_SPANS.reduce((sum, s) => sum + s.ms, 0);
    expect(result.totalMs).toBe(expected);
  });

  it('identifies the downstream call as dominant at baseline', () => {
    const result = computeBudget(BASELINE_SPANS);
    expect(result.dominantSpan).toBe('downstream call');
    expect(result.dominantShare).toBeGreaterThan(0.95);
  });

  it('shares sum to 1', () => {
    const result = computeBudget(BASELINE_SPANS);
    const sum = result.shares.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('re-ranks the dominant span once the downstream call is dragged down', () => {
    const fast = BASELINE_SPANS.map((s) => (s.adjustable ? { ...s, ms: 5 } : s));
    const result = computeBudget(fast);
    expect(result.dominantSpan).toBe('db query');
  });
});

describe('compareOptimisations -- the arithmetic the whole page rests on', () => {
  it('shaving 2ms off the fastest fixed span barely moves the total', () => {
    const cmp = compareOptimisations(BASELINE_SPANS, 2);
    const savedByOptimisingFixed = cmp.before - cmp.afterOptimisingFastestFixed;
    expect(savedByOptimisingFixed).toBeLessThanOrEqual(2);
  });

  it('shaving the same amount off the adjustable span saves the full amount', () => {
    const cmp = compareOptimisations(BASELINE_SPANS, 2);
    const savedByOptimisingAdjustable = cmp.before - cmp.afterOptimisingAdjustable;
    expect(savedByOptimisingAdjustable).toBe(2);
  });

  it('the two optimisations are not remotely comparable in effect', () => {
    const cmp = compareOptimisations(BASELINE_SPANS, 2);
    const savedFixed = cmp.before - cmp.afterOptimisingFastestFixed;
    const savedAdjustable = cmp.before - cmp.afterOptimisingAdjustable;
    expect(savedAdjustable).toBeGreaterThan(savedFixed);
  });
});
