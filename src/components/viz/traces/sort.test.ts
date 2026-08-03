import { describe, expect, it } from 'vitest';
import {
  PRESETS,
  SORT_LABELS,
  finalValues,
  isSorted,
  isStable,
  lastCounters,
  makeItems,
  traceSort,
  type SortName,
} from './sort.ts';

/**
 * Two jobs here.
 *
 * First, correctness: every trace must end in a sorted array. A visualisation
 * that disagrees with the algorithm it claims to show is worse than no
 * visualisation, and "it looked right when I clicked through it" does not scale
 * to five algorithms times four inputs.
 *
 * Second — and this is the one the sorting page actually leans on — the
 * comparison counts are checked against **analytic bounds**, not against
 * recorded values. A snapshot test would pass just as happily if the algorithm
 * were quadratic when the page claims it is linearithmic.
 */

const ALL: SortName[] = ['bubble', 'insertion', 'selection', 'merge', 'quick'];

const run = (name: SortName, values: readonly number[]) => {
  const items = makeItems([...values]);
  return { items, trace: traceSort(name, items) };
};

describe('every sort actually sorts', () => {
  for (const name of ALL) {
    for (const [preset, values] of Object.entries(PRESETS)) {
      it(`${name} sorts the ${preset} input`, () => {
        const { trace } = run(name, values);
        const out = finalValues(trace);

        expect(isSorted(out)).toBe(true);
        // Sorting is a permutation: same multiset in, same multiset out.
        expect([...out].sort((a, b) => a - b)).toEqual(
          [...values].sort((a, b) => a - b),
        );
      });
    }
  }
});

describe('cell identity is preserved, so the animation can be trusted', () => {
  for (const name of ALL) {
    it(`${name} never invents, drops or duplicates a cell`, () => {
      const { items, trace } = run(name, PRESETS.random);
      const expectedIds = new Set(items.map((i) => i.id));

      for (const step of trace.steps) {
        const ids = (step.cells ?? []).map((c) => c.id);
        // A swap must change two cells' index, never their id — that identity
        // is what makes the FLIP animation a slide rather than a redraw.
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toHaveLength(items.length);
        for (const id of ids) expect(expectedIds.has(id)).toBe(true);
      }
    });
  }
});

describe('stability is a real, checkable property', () => {
  it('bubble, insertion and merge are stable', () => {
    for (const name of ['bubble', 'insertion', 'merge'] as SortName[]) {
      const { items, trace } = run(name, PRESETS.duplicates);
      expect(isStable(trace, items), `${SORT_LABELS[name]} should be stable`).toBe(
        true,
      );
    }
  });

  it('selection sort is not stable, and this input proves it', () => {
    // The classic counter-example shape: the long-range swap that selection
    // sort performs can jump one equal element over another.
    const values = [3, 3, 1];
    const items = makeItems(values);
    const trace = traceSort('selection', items);

    expect(isSorted(finalValues(trace))).toBe(true);
    expect(isStable(trace, items)).toBe(false);
  });
});

describe('comparison counts match the analytic bounds', () => {
  const comparisons = (name: SortName, values: readonly number[]) =>
    lastCounters(run(name, values).trace).comparisons!;

  it('selection sort always makes exactly n(n-1)/2 comparisons', () => {
    // Exactly, for every input — it has no early exit and no data dependence.
    // That invariance is the whole reason it is the page's baseline.
    for (const values of Object.values(PRESETS)) {
      const n = values.length;
      expect(comparisons('selection', values)).toBe((n * (n - 1)) / 2);
    }
  });

  it('bubble sort hits its O(n) best case on sorted input', () => {
    const n = PRESETS.sorted.length;
    // One pass, no swaps, early exit.
    expect(comparisons('bubble', PRESETS.sorted)).toBe(n - 1);
  });

  it('bubble sort hits its worst case on reversed input', () => {
    const n = PRESETS.reversed.length;
    expect(comparisons('bubble', PRESETS.reversed)).toBe((n * (n - 1)) / 2);
  });

  it('insertion sort is linear on sorted input and quadratic on reversed', () => {
    const n = PRESETS.sorted.length;
    expect(comparisons('insertion', PRESETS.sorted)).toBe(n - 1);
    expect(comparisons('insertion', PRESETS.reversed)).toBe((n * (n - 1)) / 2);
  });

  it('merge sort stays within n⌈log₂n⌉ on every input', () => {
    for (const values of Object.values(PRESETS)) {
      const n = values.length;
      const bound = n * Math.ceil(Math.log2(n));
      expect(comparisons('merge', values)).toBeLessThanOrEqual(bound);
    }
  });

  it('merge sort is insensitive to input order, unlike the simple sorts', () => {
    const n = PRESETS.random.length;
    const spreadOf = (name: SortName) => {
      const counts = Object.values(PRESETS).map((v) => comparisons(name, v));
      return Math.max(...counts) - Math.min(...counts);
    };

    // The bound is principled rather than tuned: merge sort's whole selling
    // point is that its cost barely depends on the input, so its spread across
    // sorted, reversed and random should stay under one comparison per element.
    expect(spreadOf('merge')).toBeLessThan(n);

    // The input-sensitive sorts blow straight through that same bound — which
    // is the comparison the sorting page actually makes.
    expect(spreadOf('bubble')).toBeGreaterThan(n);
    expect(spreadOf('insertion')).toBeGreaterThan(n);

    // And selection sort is the other extreme: perfectly predictable, and
    // predictably bad.
    expect(spreadOf('selection')).toBe(0);
  });

  it('quicksort degrades to quadratic on already-sorted input', () => {
    // The page's central warning about last-element pivots, asserted rather
    // than claimed. Sorted input gives maximally unbalanced partitions.
    const n = PRESETS.sorted.length;
    expect(comparisons('quick', PRESETS.sorted)).toBe((n * (n - 1)) / 2);

    // And on random input it does far better than that worst case.
    expect(comparisons('quick', PRESETS.random)).toBeLessThan((n * (n - 1)) / 2);
  });

  it('merge sort beats the quadratic sorts on the reversed input', () => {
    expect(comparisons('merge', PRESETS.reversed)).toBeLessThan(
      comparisons('bubble', PRESETS.reversed),
    );
  });
});

describe('the frames themselves are well formed', () => {
  for (const name of ALL) {
    it(`${name} produces monotonically non-decreasing counters`, () => {
      const { trace } = run(name, PRESETS.random);
      let comparisons = 0;
      let writes = 0;

      for (const step of trace.steps) {
        // Counters are running totals. A decrease would mean a frame was built
        // from stale state, which would make the whole readout meaningless.
        expect(step.counters!.comparisons).toBeGreaterThanOrEqual(comparisons);
        expect(step.counters!.writes).toBeGreaterThanOrEqual(writes);
        comparisons = step.counters!.comparisons!;
        writes = step.counters!.writes!;
      }
    });

    it(`${name} captions every step and ends in a done phase`, () => {
      const { trace } = run(name, PRESETS.random);
      for (const step of trace.steps) expect(step.caption.length).toBeGreaterThan(0);
      expect(trace.steps.at(-1)!.phase).toBe('done');
    });
  }
});
