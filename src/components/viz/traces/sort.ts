import type { CellState, VizRole, VizStep, VizTrace } from '../core/types.ts';

/**
 * Sorting trace generators.
 *
 * The point of this file is the **comparison counter**. Everyone can recite that
 * bubble sort is O(n²) and merge sort is O(n log n); far fewer people have
 * watched 900 tick past on one side while the other stops at 300. Turning a
 * complexity class into a number you watch is the entire pedagogical move, and
 * it only works if the number is honest — hence `sort.test.ts`, which checks
 * every count against the analytic bound rather than against a recorded value.
 *
 * All generators here are pure: values in, `VizStep[]` out. No React, no DOM,
 * no randomness.
 */

export interface SortItem {
  /** Stable across the whole trace, so a swap animates as a slide. */
  id: string;
  value: number;
  /** Original position. Used only to detect whether a sort was stable. */
  origin: number;
}

export type SortName = 'bubble' | 'insertion' | 'selection' | 'merge' | 'quick';

export const SORT_LABELS: Record<SortName, string> = {
  bubble: 'bubble sort',
  insertion: 'insertion sort',
  selection: 'selection sort',
  merge: 'merge sort',
  quick: 'quicksort',
};

export function makeItems(values: number[], prefix = 's'): SortItem[] {
  return values.map((value, i) => ({ id: `${prefix}${i}-${value}`, value, origin: i }));
}

interface Counters {
  comparisons: number;
  writes: number;
}

interface FrameOptions {
  caption: string;
  codeLine?: number | [number, number];
  roles?: Record<number, VizRole>;
  pointers?: Record<number, string>;
  phase?: string;
  /** Indices already in their final position. */
  sortedFrom?: number;
  sortedUpTo?: number;
}

function frame(items: SortItem[], counters: Counters, o: FrameOptions): VizStep {
  const cells: CellState[] = items.map((item, i) => {
    let role: VizRole = o.roles?.[i] ?? 'default';
    if (role === 'default') {
      if (o.sortedFrom !== undefined && i >= o.sortedFrom) role = 'sorted';
      if (o.sortedUpTo !== undefined && i < o.sortedUpTo) role = 'sorted';
    }
    return { id: item.id, value: item.value, index: i, role };
  });

  return {
    caption: o.caption,
    codeLine: o.codeLine,
    phase: o.phase,
    counters: { ...counters },
    cells,
    pointers: Object.entries(o.pointers ?? {}).flatMap(([index, label]) => {
      const target = items[Number(index)];
      return target ? [{ label, target: target.id }] : [];
    }),
  };
}

/* ── the algorithms ──────────────────────────────────────────────────────── */

export const CODE: Record<SortName, { python: string; typescript: string }> = {
  bubble: {
    python: `def bubble_sort(a):
    n = len(a)
    for i in range(n):
        swapped = False
        for j in range(n - i - 1):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
                swapped = True
        if not swapped:      # already sorted — this is the O(n) best case
            return a
    return a`,
    typescript: `function bubbleSort(a: number[]): number[] {
  const n = a.length;
  for (let i = 0; i < n; i++) {
    let swapped = false;
    for (let j = 0; j < n - i - 1; j++) {
      if (a[j] > a[j + 1]) {
        [a[j], a[j + 1]] = [a[j + 1], a[j]];
        swapped = true;
      }
    }
    if (!swapped) return a;  // already sorted — this is the O(n) best case
  }
  return a;
}`,
  },
  insertion: {
    python: `def insertion_sort(a):
    for i in range(1, len(a)):
        key = a[i]
        j = i - 1
        while j >= 0 and a[j] > key:   # shift bigger elements right
            a[j + 1] = a[j]
            j -= 1
        a[j + 1] = key                 # drop the key into the gap
    return a`,
    typescript: `function insertionSort(a: number[]): number[] {
  for (let i = 1; i < a.length; i++) {
    const key = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > key) {     // shift bigger elements right
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = key;                    // drop the key into the gap
  }
  return a;
}`,
  },
  selection: {
    python: `def selection_sort(a):
    n = len(a)
    for i in range(n):
        smallest = i
        for j in range(i + 1, n):      # scan the whole rest, every time
            if a[j] < a[smallest]:
                smallest = j
        a[i], a[smallest] = a[smallest], a[i]
    return a`,
    typescript: `function selectionSort(a: number[]): number[] {
  const n = a.length;
  for (let i = 0; i < n; i++) {
    let smallest = i;
    for (let j = i + 1; j < n; j++) {  // scan the whole rest, every time
      if (a[j] < a[smallest]) smallest = j;
    }
    [a[i], a[smallest]] = [a[smallest], a[i]];
  }
  return a;
}`,
  },
  merge: {
    python: `def merge_sort(a):
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left = merge_sort(a[:mid])         # solve each half
    right = merge_sort(a[mid:])
    return merge(left, right)          # combine in linear time

def merge(left, right):
    out, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:        # <= is what makes it STABLE
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    return out + left[i:] + right[j:]`,
    typescript: `function mergeSort(a: number[]): number[] {
  if (a.length <= 1) return a;
  const mid = a.length >> 1;
  const left = mergeSort(a.slice(0, mid));   // solve each half
  const right = mergeSort(a.slice(mid));
  return merge(left, right);                 // combine in linear time
}

function merge(left: number[], right: number[]): number[] {
  const out: number[] = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) out.push(left[i++]);  // <= is what makes it STABLE
    else out.push(right[j++]);
  }
  return [...out, ...left.slice(i), ...right.slice(j)];
}`,
  },
  quick: {
    python: `def quicksort(a, lo=0, hi=None):
    if hi is None:
        hi = len(a) - 1
    if lo >= hi:
        return a
    p = partition(a, lo, hi)
    quicksort(a, lo, p - 1)            # no combine step — that is the trade
    quicksort(a, p + 1, hi)
    return a

def partition(a, lo, hi):
    pivot = a[hi]                      # last element: worst case on sorted input
    i = lo
    for j in range(lo, hi):
        if a[j] < pivot:
            a[i], a[j] = a[j], a[i]
            i += 1
    a[i], a[hi] = a[hi], a[i]
    return i`,
    typescript: `function quicksort(a: number[], lo = 0, hi = a.length - 1): number[] {
  if (lo >= hi) return a;
  const p = partition(a, lo, hi);
  quicksort(a, lo, p - 1);             // no combine step — that is the trade
  quicksort(a, p + 1, hi);
  return a;
}

function partition(a: number[], lo: number, hi: number): number {
  const pivot = a[hi];                 // last element: worst case on sorted input
  let i = lo;
  for (let j = lo; j < hi; j++) {
    if (a[j] < pivot) {
      [a[i], a[j]] = [a[j], a[i]];
      i++;
    }
  }
  [a[i], a[hi]] = [a[hi], a[i]];
  return i;
}`,
  },
};

function traceBubble(input: SortItem[]): VizStep[] {
  const a = [...input];
  const c: Counters = { comparisons: 0, writes: 0 };
  const steps: VizStep[] = [];
  const n = a.length;

  steps.push(
    frame(a, c, {
      caption:
        'Bubble sort: repeatedly swap adjacent pairs that are out of order. The largest element "bubbles" to the end on each pass.',
      codeLine: 2,
      phase: 'start',
    }),
  );

  for (let i = 0; i < n; i++) {
    let swapped = false;

    for (let j = 0; j < n - i - 1; j++) {
      c.comparisons++;
      const out = a[j]!.value > a[j + 1]!.value;
      steps.push(
        frame(a, c, {
          caption: `Compare ${a[j]!.value} and ${a[j + 1]!.value}. ${out ? 'Out of order — swap them.' : 'Already in order; move on.'}`,
          codeLine: [5, 6],
          roles: { [j]: 'compare', [j + 1]: 'compare' },
          pointers: { [j]: 'j' },
          sortedFrom: n - i,
        }),
      );

      if (out) {
        [a[j], a[j + 1]] = [a[j + 1]!, a[j]!];
        c.writes += 2;
        swapped = true;
        steps.push(
          frame(a, c, {
            caption: `Swapped. Every element only ever moves one position per comparison — which is exactly why this is slow.`,
            codeLine: 7,
            roles: { [j]: 'swap', [j + 1]: 'swap' },
            sortedFrom: n - i,
          }),
        );
      }
    }

    if (!swapped) {
      steps.push(
        frame(a, c, {
          caption: `A full pass with no swaps, so the array is already sorted. This early exit is the only reason bubble sort has an O(n) best case.`,
          codeLine: 9,
          sortedFrom: 0,
          phase: 'done',
        }),
      );
      return steps;
    }
  }

  steps.push(frame(a, c, { caption: 'Sorted.', sortedFrom: 0, phase: 'done' }));
  return steps;
}

function traceInsertion(input: SortItem[]): VizStep[] {
  const a = [...input];
  const c: Counters = { comparisons: 0, writes: 0 };
  const steps: VizStep[] = [];

  steps.push(
    frame(a, c, {
      caption:
        'Insertion sort: grow a sorted prefix on the left, inserting each new element into its place — the way most people sort a hand of cards.',
      codeLine: 2,
      sortedUpTo: 1,
      phase: 'start',
    }),
  );

  for (let i = 1; i < a.length; i++) {
    const key = a[i]!;
    // The key is lifted out of the array and carried, so `hole` is the slot it
    // will drop back into. Rendering the hole as the key is what keeps every
    // frame a true permutation: `a[hole] = a[j]` on its own would leave a
    // duplicate on screen, showing the reader a value that is not there.
    let hole = i;

    const display = () => {
      const view = [...a];
      view[hole] = key;
      return view;
    };

    steps.push(
      frame(display(), c, {
        caption: `Lift ${key.value} out as the key. Everything to its left is already sorted.`,
        codeLine: 3,
        roles: { [i]: 'active' },
        pointers: { [i]: 'key' },
        sortedUpTo: i,
      }),
    );

    while (hole > 0) {
      const j = hole - 1;
      c.comparisons++;
      const bigger = a[j]!.value > key.value;
      steps.push(
        frame(display(), c, {
          caption: `Is ${a[j]!.value} greater than ${key.value}? ${bigger ? 'Yes — shift it right into the hole.' : 'No, so the key belongs here. Stop.'}`,
          codeLine: 5,
          roles: { [j]: 'compare', [hole]: 'active' },
          pointers: { [j]: 'j' },
          sortedUpTo: i,
        }),
      );
      if (!bigger) break;

      a[hole] = a[j]!;
      c.writes++;
      hole = j;
    }

    a[hole] = key;
    c.writes++;
    steps.push(
      frame(a, c, {
        caption: `Drop ${key.value} into the hole. The sorted prefix is now ${i + 1} long. On nearly-sorted input the inner loop exits on its first comparison, which is why this is the fastest of the simple sorts in practice.`,
        codeLine: 8,
        roles: { [hole]: 'swap' },
        sortedUpTo: i + 1,
      }),
    );
  }

  steps.push(frame(a, c, { caption: 'Sorted.', sortedFrom: 0, phase: 'done' }));
  return steps;
}

function traceSelection(input: SortItem[]): VizStep[] {
  const a = [...input];
  const c: Counters = { comparisons: 0, writes: 0 };
  const steps: VizStep[] = [];
  const n = a.length;

  steps.push(
    frame(a, c, {
      caption:
        'Selection sort: find the smallest remaining element and swap it into place. Note it scans the entire remainder every time, regardless of what it finds.',
      codeLine: 2,
      phase: 'start',
    }),
  );

  for (let i = 0; i < n; i++) {
    let smallest = i;

    for (let j = i + 1; j < n; j++) {
      c.comparisons++;
      if (a[j]!.value < a[smallest]!.value) smallest = j;
      steps.push(
        frame(a, c, {
          caption: `Scanning for the smallest. Best so far is ${a[smallest]!.value}.`,
          codeLine: [5, 6],
          roles: { [j]: 'compare', [smallest]: 'active' },
          pointers: { [j]: 'j', [smallest]: 'min' },
          sortedUpTo: i,
        }),
      );
    }

    if (smallest !== i) {
      [a[i], a[smallest]] = [a[smallest]!, a[i]!];
      c.writes += 2;
    }

    steps.push(
      frame(a, c, {
        caption: `${a[i]!.value} is the smallest of what remains — swap it into position ${i}. That is one swap for a whole pass, which is selection sort's single virtue.`,
        codeLine: 7,
        roles: { [i]: 'swap' },
        sortedUpTo: i + 1,
      }),
    );
  }

  steps.push(frame(a, c, { caption: 'Sorted.', sortedFrom: 0, phase: 'done' }));
  return steps;
}

function traceMerge(input: SortItem[]): VizStep[] {
  const c: Counters = { comparisons: 0, writes: 0 };
  const steps: VizStep[] = [];
  // A working copy the frames read from, so the animation shows the array
  // being rebuilt in place even though the algorithm is out-of-place.
  const view = [...input];

  steps.push(
    frame(view, c, {
      caption:
        'Merge sort: split until the pieces are trivially sorted, then merge sorted pieces back together. The work is all in the merge.',
      codeLine: 2,
      phase: 'start',
    }),
  );

  const sort = (lo: number, hi: number, depth: number): SortItem[] => {
    if (hi - lo <= 1) return [view[lo]!];

    const mid = (lo + hi) >> 1;
    steps.push(
      frame(view, c, {
        caption: `Split [${lo}, ${hi}) into two halves. Splitting costs nothing — it is just arithmetic on indices.`,
        codeLine: 4,
        roles: Object.fromEntries(
          Array.from({ length: hi - lo }, (_, k) => [lo + k, 'compare' as VizRole]),
        ),
      }),
    );

    const left = sort(lo, mid, depth + 1);
    const right = sort(mid, hi, depth + 1);

    // Merge.
    const out: SortItem[] = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      c.comparisons++;
      // `<=` keeps equal elements in their original order — this single
      // character is what makes merge sort stable.
      if (left[i]!.value <= right[j]!.value) out.push(left[i++]!);
      else out.push(right[j++]!);
    }
    while (i < left.length) out.push(left[i++]!);
    while (j < right.length) out.push(right[j++]!);

    for (let k = 0; k < out.length; k++) {
      view[lo + k] = out[k]!;
      c.writes++;
    }

    steps.push(
      frame(view, c, {
        caption: `Merged two sorted runs of ${left.length} and ${right.length} into one of ${out.length}. Each merge is a single linear pass — that is where the n in n log n comes from, and the log n is the number of levels.`,
        codeLine: [11, 16],
        roles: Object.fromEntries(
          Array.from({ length: hi - lo }, (_, k) => [lo + k, 'sorted' as VizRole]),
        ),
      }),
    );

    return out;
  };

  sort(0, view.length, 0);
  steps.push(
    frame(view, c, {
      caption: 'Sorted — and stably, because the merge preferred the left run on ties.',
      sortedFrom: 0,
      phase: 'done',
    }),
  );
  return steps;
}

function traceQuick(input: SortItem[]): VizStep[] {
  const a = [...input];
  const c: Counters = { comparisons: 0, writes: 0 };
  const steps: VizStep[] = [];

  steps.push(
    frame(a, c, {
      caption:
        'Quicksort: pick a pivot, move everything smaller to its left and everything larger to its right, then recurse. There is no combine step — the partition did the work.',
      codeLine: 2,
      phase: 'start',
    }),
  );

  const sort = (lo: number, hi: number) => {
    if (lo >= hi) return;

    const pivot = a[hi]!;
    steps.push(
      frame(a, c, {
        caption: `Pivot on ${pivot.value} (the last element of this range). Choosing the last element is what makes already-sorted input the worst case.`,
        codeLine: 11,
        roles: { [hi]: 'active' },
        pointers: { [hi]: 'pivot' },
      }),
    );

    let i = lo;
    for (let j = lo; j < hi; j++) {
      c.comparisons++;
      const smaller = a[j]!.value < pivot.value;
      steps.push(
        frame(a, c, {
          caption: `${a[j]!.value} ${smaller ? '<' : '≥'} ${pivot.value}, so it belongs on the ${smaller ? 'left' : 'right'}.`,
          codeLine: [13, 14],
          roles: { [j]: 'compare', [hi]: 'active' },
          pointers: { [j]: 'j', [i]: 'i' },
        }),
      );
      if (smaller) {
        if (i !== j) {
          [a[i], a[j]] = [a[j]!, a[i]!];
          c.writes += 2;
        }
        i++;
      }
    }

    [a[i], a[hi]] = [a[hi]!, a[i]!];
    c.writes += 2;
    steps.push(
      frame(a, c, {
        caption: `Put the pivot at index ${i}. It is now in its final position and never moves again — that is what a partition buys you.`,
        codeLine: 17,
        roles: { [i]: 'sorted' },
      }),
    );

    sort(lo, i - 1);
    sort(i + 1, hi);
  };

  sort(0, a.length - 1);
  steps.push(
    frame(a, c, {
      caption:
        'Sorted — in place, with no extra array. That memory profile is why quicksort usually beats merge sort in practice despite the same average complexity.',
      sortedFrom: 0,
      phase: 'done',
    }),
  );
  return steps;
}

const GENERATORS: Record<SortName, (items: SortItem[]) => VizStep[]> = {
  bubble: traceBubble,
  insertion: traceInsertion,
  selection: traceSelection,
  merge: traceMerge,
  quick: traceQuick,
};

export function traceSort(name: SortName, items: SortItem[]): VizTrace {
  const n = items.length;
  return {
    steps: GENERATORS[name](items),
    code: CODE[name],
    counterSpec: [
      {
        key: 'comparisons',
        label: 'comparisons',
        // The analytic bound sits beside the live count, so the reader sees the
        // measured number converge on (or blow past) the predicted one.
        expected:
          name === 'merge' || name === 'quick'
            ? { label: 'n log₂n', value: n * Math.log2(Math.max(n, 2)) }
            : { label: 'n²/2', value: (n * n) / 2 },
      },
      { key: 'writes', label: 'writes' },
    ],
  };
}

/* ── helpers the tests and the widget share ──────────────────────────────── */

export function finalValues(trace: VizTrace): number[] {
  return (trace.steps.at(-1)!.cells ?? []).map((cell) => cell.value as number);
}

export function finalItems(trace: VizTrace): { value: number; id: string }[] {
  return (trace.steps.at(-1)!.cells ?? []).map((cell) => ({
    value: cell.value as number,
    id: cell.id,
  }));
}

export function lastCounters(trace: VizTrace): Record<string, number> {
  return trace.steps.at(-1)!.counters ?? {};
}

export function isSorted(values: number[]): boolean {
  return values.every((v, i) => i === 0 || values[i - 1]! <= v);
}

/**
 * Did this sort preserve the relative order of equal elements?
 *
 * `origin` is encoded in the item id by `makeItems`, so a trace's final cell
 * order is enough to check stability without threading extra state through.
 */
export function isStable(trace: VizTrace, input: SortItem[]): boolean {
  const originById = new Map(input.map((item) => [item.id, item.origin]));
  const final = finalItems(trace);

  for (let i = 1; i < final.length; i++) {
    if (final[i]!.value !== final[i - 1]!.value) continue;
    const prev = originById.get(final[i - 1]!.id);
    const curr = originById.get(final[i]!.id);
    if (prev === undefined || curr === undefined) return false;
    if (prev > curr) return false; // equal values came out reversed
  }
  return true;
}

/** Preset inputs, chosen so each one makes a different algorithm look bad. */
export const PRESETS = {
  random: [5, 2, 9, 1, 7, 3, 8, 4],
  sorted: [1, 2, 3, 4, 5, 6, 7, 8],
  reversed: [8, 7, 6, 5, 4, 3, 2, 1],
  duplicates: [3, 1, 3, 2, 1, 2, 3, 1],
} as const;

export type PresetName = keyof typeof PRESETS;
