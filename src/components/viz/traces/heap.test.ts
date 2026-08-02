import { describe, expect, it } from 'vitest';
import {
  finalItems,
  isMinHeap,
  makeItems,
  traceBuildHeap,
  traceExtractMin,
  traceInsert,
} from './heap.ts';
import type { VizTrace } from '../core/types.ts';

/**
 * The point of these tests is not coverage. It is that a visualisation which
 * disagrees with the algorithm it claims to show is worse than no visualisation:
 * it teaches something false, convincingly, with an animation as evidence.
 *
 * So: every trace's final state must be a real heap, and every counter must
 * match an independently-derived count.
 */

const values = (trace: VizTrace) => finalItems(trace).map((item) => item.value);
const lastCounters = (trace: VizTrace) =>
  trace.steps[trace.steps.length - 1]!.counters!;

describe('traceInsert', () => {
  it('produces a valid heap', () => {
    const heap = makeItems([1, 3, 6, 5, 9, 8]);
    expect(isMinHeap(values(traceInsert(heap, 4)))).toBe(true);
    expect(isMinHeap(values(traceInsert(heap, 0)))).toBe(true);
    expect(isMinHeap(values(traceInsert(heap, 99)))).toBe(true);
  });

  it('bubbles a new minimum all the way to the root', () => {
    const trace = traceInsert(makeItems([1, 3, 6, 5, 9, 8]), 0);
    expect(values(trace)[0]).toBe(0);
  });

  it('never exceeds one comparison per level', () => {
    const heap = makeItems([1, 3, 6, 5, 9, 8, 7]);
    const trace = traceInsert(heap, 0);
    // 8 elements → height 3 → at most 3 comparisons on the way up.
    expect(lastCounters(trace).comparisons).toBeLessThanOrEqual(3);
    expect(lastCounters(trace).swaps).toBe(3);
  });

  it('stops immediately when the new value already belongs at the bottom', () => {
    const trace = traceInsert(makeItems([1, 3, 6, 5, 9, 8]), 99);
    expect(lastCounters(trace).comparisons).toBe(1);
    expect(lastCounters(trace).swaps).toBe(0);
  });
});

describe('traceExtractMin', () => {
  it('removes the smallest element and leaves a valid heap', () => {
    const trace = traceExtractMin(makeItems([1, 3, 6, 5, 9, 8]));
    const result = values(trace);
    expect(result).not.toContain(1);
    expect(result).toHaveLength(5);
    expect(isMinHeap(result)).toBe(true);
  });

  it('handles a single-element heap without crashing', () => {
    expect(values(traceExtractMin(makeItems([42])))).toEqual([]);
  });

  it('handles an empty heap', () => {
    const trace = traceExtractMin([]);
    expect(trace.steps).toHaveLength(1);
    expect(values(trace)).toEqual([]);
  });

  it('repeated extraction yields sorted order — i.e. it really is heapsort', () => {
    let items = makeItems([9, 4, 7, 1, 8, 2, 6, 3]);
    const out: number[] = [];

    while (items.length > 0) {
      const built = traceBuildHeap(items);
      items = finalItems(built);
      out.push(items[0]!.value);
      items = finalItems(traceExtractMin(items));
    }

    expect(out).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  });
});

describe('traceBuildHeap', () => {
  it('turns an arbitrary array into a heap', () => {
    expect(isMinHeap(values(traceBuildHeap(makeItems([9, 4, 7, 1, 8, 2, 6]))))).toBe(
      true,
    );
    expect(isMinHeap(values(traceBuildHeap(makeItems([5, 4, 3, 2, 1]))))).toBe(true);
  });

  it('preserves the multiset of values', () => {
    const input = [9, 4, 7, 1, 8, 2, 6, 3, 3];
    const result = values(traceBuildHeap(makeItems(input)));
    expect([...result].sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
  });

  /**
   * The claim the page derives is that Floyd's build-heap is O(n): the total work
   * is bounded by 2n comparisons, NOT n log n. If this assertion ever fails, the
   * page's derivation and its animation have diverged.
   */
  it('stays under the 2n comparison bound, well below n log n', () => {
    for (const n of [7, 15, 31, 63, 127]) {
      const input = Array.from({ length: n }, (_, i) => ((i * 37) % n) + 1);
      const trace = traceBuildHeap(makeItems(input));
      const comparisons = lastCounters(trace).comparisons;

      expect(isMinHeap(values(trace))).toBe(true);
      expect(comparisons).toBeLessThanOrEqual(2 * n);
      expect(comparisons).toBeLessThan(n * Math.log2(n));
    }
  });

  it('is a no-op on an array that is already a heap, apart from checks', () => {
    const trace = traceBuildHeap(makeItems([1, 2, 3, 4, 5, 6, 7]));
    expect(lastCounters(trace).swaps).toBe(0);
    expect(values(trace)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('trace invariants shared by every generator', () => {
  const traces: [string, VizTrace][] = [
    ['insert', traceInsert(makeItems([1, 3, 6, 5]), 2)],
    ['extract', traceExtractMin(makeItems([1, 3, 6, 5, 9]))],
    ['build', traceBuildHeap(makeItems([9, 4, 7, 1, 8]))],
  ];

  it.each(traces)('%s: every step carries a caption', (_name, trace) => {
    for (const step of trace.steps) {
      expect(step.caption.length).toBeGreaterThan(0);
    }
  });

  it.each(traces)('%s: cell ids stay unique within a step', (_name, trace) => {
    for (const step of trace.steps) {
      const ids = (step.cells ?? []).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it.each(traces)('%s: tree and array views never disagree', (_name, trace) => {
    for (const step of trace.steps) {
      const cells = [...(step.cells ?? [])].sort((a, b) => a.index - b.index);
      const nodes = step.nodes ?? [];
      expect(nodes.map((n) => n.id)).toEqual(cells.map((c) => c.id));
      expect(nodes.map((n) => n.value)).toEqual(cells.map((c) => c.value));
    }
  });

  it.each(traces)('%s: counters never decrease', (_name, trace) => {
    let comparisons = 0;
    let swaps = 0;
    for (const step of trace.steps) {
      expect(step.counters!.comparisons).toBeGreaterThanOrEqual(comparisons);
      expect(step.counters!.swaps).toBeGreaterThanOrEqual(swaps);
      comparisons = step.counters!.comparisons;
      swaps = step.counters!.swaps;
    }
  });

  it.each(traces)('%s: every pointer targets a cell that exists', (_name, trace) => {
    for (const step of trace.steps) {
      const ids = new Set((step.cells ?? []).map((c) => c.id));
      for (const pointer of step.pointers ?? []) {
        expect(ids.has(pointer.target)).toBe(true);
      }
    }
  });
});
