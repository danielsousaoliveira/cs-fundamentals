import { describe, expect, it } from 'vitest';
import { growthCosts, totalCopies, traceGrowth } from './dynamicArray.ts';

/**
 * The arrays page claims n appends cost fewer than 2n element copies, and that
 * this is what makes appending amortised O(1). The widget shows a counter that
 * is supposed to demonstrate it. These tests make sure the two agree — and that
 * the bound actually holds, rather than merely looking like it does at n = 16.
 */

describe('growthCosts', () => {
  it('only copies when the array is full', () => {
    const costs = growthCosts({ pushes: 16 });
    const copying = costs.filter((c) => c.copies > 0);

    // Doubling from capacity 1: resizes happen at lengths 1, 2, 4, 8, 16...
    expect(copying.map((c) => c.push)).toEqual([2, 3, 5, 9]);
  });

  it('never lets length exceed capacity', () => {
    let length = 0;
    for (const cost of growthCosts({ pushes: 100 })) {
      length++;
      expect(length).toBeLessThanOrEqual(cost.capacityAfter);
    }
  });

  it('makes progress even with a growth factor that would round down to 1', () => {
    // capacity 1 × 1.5 floors to 1, which would loop forever without the guard.
    const costs = growthCosts({ pushes: 5, growthFactor: 1.5 });
    expect(costs).toHaveLength(5);
    expect(costs.at(-1)!.capacityAfter).toBeGreaterThanOrEqual(5);
  });
});

describe('the amortised bound', () => {
  it('stays under 2n copies for doubling, at every scale', () => {
    for (const pushes of [1, 2, 10, 100, 1000, 10_000, 100_000]) {
      expect(totalCopies({ pushes })).toBeLessThan(2 * pushes);
    }
  });

  it('still amortises to a constant with a 1.5× growth factor', () => {
    // The series sums to n/(f-1); for f = 1.5 that is 2n, so 3n is a safe bound.
    for (const pushes of [100, 1000, 10_000]) {
      expect(totalCopies({ pushes, growthFactor: 1.5 })).toBeLessThan(3 * pushes);
    }
  });

  it('degrades to quadratic if the array grows by a constant instead', () => {
    // The counter-example that shows doubling is doing real work: growing by a
    // fixed +1 each time makes every append a full copy.
    const pushes = 200;
    const linearGrowth = growthCosts({ pushes, growthFactor: 1 }).reduce(
      (sum, c) => sum + c.copies,
      0,
    );
    expect(linearGrowth).toBeGreaterThan(pushes * pushes * 0.4);
  });
});

describe('traceGrowth', () => {
  it('ends holding every pushed value in order', () => {
    const trace = traceGrowth({ pushes: 10 });
    const last = trace.steps.at(-1)!;
    const filled = last.cells!.filter((c) => c.value !== '').map((c) => c.value);

    expect(filled).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('reports the same copy count the cost model does', () => {
    const trace = traceGrowth({ pushes: 33 });
    expect(trace.steps.at(-1)!.counters!.copies).toBe(totalCopies({ pushes: 33 }));
  });

  it('never shows more filled cells than the capacity', () => {
    for (const step of traceGrowth({ pushes: 20 }).steps) {
      const filled = step.cells!.filter((c) => c.value !== '').length;
      expect(filled).toBeLessThanOrEqual(step.cells!.length);
    }
  });

  it('gives cells from different allocations different ids', () => {
    // A resize is a copy into new memory, not a move — the ids must not be
    // reused, or the renderer animates a slide where nothing actually slid.
    const trace = traceGrowth({ pushes: 8 });
    const first = new Set(trace.steps[0]!.cells!.map((c) => c.id));
    const last = new Set(trace.steps.at(-1)!.cells!.map((c) => c.id));

    for (const id of last) expect(first.has(id)).toBe(false);
  });
});
