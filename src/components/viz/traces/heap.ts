import type {
  CellState,
  EdgeState,
  NodeState,
  VizRole,
  VizStep,
  VizTrace,
} from '../core/types.ts';

/**
 * Heap trace generators.
 *
 * These are pure: array in, `VizStep[]` out. No React, no DOM, no randomness.
 * That is what lets `heap.test.ts` assert the visualisation tells the truth —
 * that the final array really is a heap, and that the comparison count really
 * matches the bound the prose derives.
 */

export interface HeapItem {
  /** Stable across the whole trace, so a swap animates as a slide. */
  id: string;
  value: number;
}

export function makeItems(values: number[], prefix = 'h'): HeapItem[] {
  return values.map((value, i) => ({ id: `${prefix}${i}-${value}`, value }));
}

const parentOf = (i: number) => (i - 1) >> 1;
const leftOf = (i: number) => 2 * i + 1;
const rightOf = (i: number) => 2 * i + 2;

/** Is this array a valid min-heap? Used by the tests, and worth having anyway. */
export function isMinHeap(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[parentOf(i)]! > values[i]!) return false;
  }
  return true;
}

interface FrameOptions {
  roles?: Record<number, VizRole>;
  caption: string;
  codeLine?: number | [number, number];
  counters: { comparisons: number; swaps: number };
  phase?: string;
  /** Indices to label with a named pointer, e.g. `{ 3: 'i', 1: 'parent' }`. */
  pointers?: Record<number, string>;
  /** Indices past the heap boundary — drawn as removed rather than absent. */
  ghostFrom?: number;
}

/**
 * Snapshot the array as both views at once.
 *
 * The tree and the array share node/cell ids on purpose: that shared identity is
 * what makes "a heap is a tree but stored as a flat array" a thing you can see
 * rather than a sentence you have to take on faith.
 */
function frame(items: HeapItem[], options: FrameOptions): VizStep {
  const { roles = {}, ghostFrom } = options;

  const roleAt = (i: number): VizRole => {
    if (ghostFrom !== undefined && i >= ghostFrom) return 'ghost';
    return roles[i] ?? 'default';
  };

  const cells: CellState[] = items.map((item, i) => ({
    id: item.id,
    value: item.value,
    index: i,
    role: roleAt(i),
  }));

  const nodes: NodeState[] = items.map((item, i) => ({
    id: item.id,
    value: item.value,
    role: roleAt(i),
  }));

  const edges: EdgeState[] = [];
  for (let i = 0; i < items.length; i++) {
    for (const child of [leftOf(i), rightOf(i)]) {
      if (child < items.length) {
        edges.push({
          from: items[i]!.id,
          to: items[child]!.id,
          role: ghostFrom !== undefined && child >= ghostFrom ? 'ghost' : 'default',
        });
      }
    }
  }

  return {
    caption: options.caption,
    codeLine: options.codeLine,
    counters: { ...options.counters },
    phase: options.phase,
    cells,
    nodes,
    edges,
    pointers: Object.entries(options.pointers ?? {}).map(([index, label]) => ({
      label,
      target: items[Number(index)]!.id,
      anchor: 'above' as const,
    })),
  };
}

export const SIFT_UP_CODE = {
  python: `def sift_up(heap, i):
    while i > 0:
        parent = (i - 1) // 2
        if heap[parent] <= heap[i]:
            break
        heap[i], heap[parent] = heap[parent], heap[i]
        i = parent`,
  typescript: `function siftUp(heap: number[], i: number) {
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent] <= heap[i])
      break;
    [heap[i], heap[parent]] = [heap[parent], heap[i]];
    i = parent;
  }
}`,
} as const;

export const SIFT_DOWN_CODE = {
  python: `def sift_down(heap, i, n):
    while True:
        smallest = i
        left, right = 2 * i + 1, 2 * i + 2
        if left < n and heap[left] < heap[smallest]:
            smallest = left
        if right < n and heap[right] < heap[smallest]:
            smallest = right
        if smallest == i:
            break
        heap[i], heap[smallest] = heap[smallest], heap[i]
        i = smallest`,
  typescript: `function siftDown(heap: number[], i: number, n: number) {
  while (true) {
    let smallest = i;
    const left = 2 * i + 1, right = 2 * i + 2;
    if (left < n && heap[left] < heap[smallest])
      smallest = left;
    if (right < n && heap[right] < heap[smallest])
      smallest = right;
    if (smallest === i)
      break;
    [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
    i = smallest;
  }
}`,
} as const;

export const BUILD_HEAP_CODE = {
  python: `def build_heap(a):
    # Leaves are already heaps, so start at the last internal node
    # and sift down. This is O(n), not O(n log n) — see the derivation.
    for i in range(len(a) // 2 - 1, -1, -1):
        sift_down(a, i, len(a))`,
  typescript: `function buildHeap(a: number[]) {
  // Leaves are already heaps, so start at the last internal node
  // and sift down. This is O(n), not O(n log n) — see the derivation.
  for (let i = (a.length >> 1) - 1; i >= 0; i--)
    siftDown(a, i, a.length);
}`,
} as const;

/* ------------------------------------------------------------------ insert -- */

export function traceInsert(base: HeapItem[], value: number): VizTrace {
  const items = [...base, { id: `n${Date.now()}-${value}`, value }];
  const counters = { comparisons: 0, swaps: 0 };
  const steps: VizStep[] = [];
  let i = items.length - 1;

  steps.push(
    frame(items, {
      caption: `Append ${value} at index ${i} — the only place that keeps the tree complete. The shape is right; the ordering probably isn't.`,
      codeLine: 1,
      counters,
      roles: { [i]: 'active' },
      pointers: { [i]: 'i' },
      phase: 'insert',
    }),
  );

  while (i > 0) {
    const parent = parentOf(i);
    counters.comparisons++;

    steps.push(
      frame(items, {
        caption: `Compare ${items[i]!.value} with its parent ${items[parent]!.value} at index ${parent}.`,
        codeLine: [3, 4],
        counters,
        roles: { [i]: 'compare', [parent]: 'compare' },
        pointers: { [i]: 'i', [parent]: 'parent' },
      }),
    );

    if (items[parent]!.value <= items[i]!.value) {
      steps.push(
        frame(items, {
          caption: `${items[parent]!.value} ≤ ${items[i]!.value}, so the heap property holds here. Everything above is already ordered, so we can stop — that early exit is why insert is usually much cheaper than its log n worst case.`,
          codeLine: 5,
          counters,
          roles: { [i]: 'sorted', [parent]: 'sorted' },
        }),
      );
      break;
    }

    counters.swaps++;
    [items[i], items[parent]] = [items[parent]!, items[i]!];

    steps.push(
      frame(items, {
        caption: `Parent was larger, so swap. Notice the array cells slide past each other while the tree nodes exchange places — one operation, two views of the same memory.`,
        codeLine: 6,
        counters,
        roles: { [i]: 'swap', [parent]: 'swap' },
        pointers: { [parent]: 'i' },
      }),
    );

    i = parent;
  }

  steps.push(
    frame(items, {
      caption: `Done. ${counters.swaps} swap${counters.swaps === 1 ? '' : 's'} and ${counters.comparisons} comparison${counters.comparisons === 1 ? '' : 's'} — at most one per level, which is why insert is O(log n).`,
      counters,
      roles: { 0: 'sorted' },
      phase: 'done',
    }),
  );

  return { steps, code: SIFT_UP_CODE, counterSpec: COUNTER_SPEC };
}

/* ----------------------------------------------------------------- extract -- */

export function traceExtractMin(base: HeapItem[]): VizTrace {
  const items = [...base];
  const counters = { comparisons: 0, swaps: 0 };
  const steps: VizStep[] = [];

  if (items.length === 0) {
    return {
      steps: [frame(items, { caption: 'The heap is empty.', counters })],
      code: SIFT_DOWN_CODE,
      counterSpec: COUNTER_SPEC,
    };
  }

  const min = items[0]!.value;

  steps.push(
    frame(items, {
      caption: `The minimum is always at index 0 — that is the one thing a heap guarantees. Reading it is O(1); removing it is the expensive part.`,
      counters,
      roles: { 0: 'active' },
      phase: 'extract',
    }),
  );

  // Move the last element to the root, then sift it down.
  const last = items.pop()!;
  if (items.length > 0) {
    items[0] = last;
    steps.push(
      frame(items, {
        caption: `Remove ${min}, then move the last element (${last.value}) into the root. That keeps the tree complete — but almost certainly breaks the ordering, which is what sift-down repairs.`,
        codeLine: 1,
        counters,
        roles: { 0: 'active' },
        pointers: { 0: 'i' },
      }),
    );
  } else {
    steps.push(
      frame(items, {
        caption: `Removed ${min}. The heap is now empty.`,
        counters,
        phase: 'done',
      }),
    );
    return { steps, code: SIFT_DOWN_CODE, counterSpec: COUNTER_SPEC };
  }

  siftDownSteps(items, 0, items.length, counters, steps);

  steps.push(
    frame(items, {
      caption: `Repaired. ${counters.comparisons} comparisons, ${counters.swaps} swaps. Sift-down does up to two comparisons per level, so extract is O(log n) — with a constant factor twice that of insert.`,
      counters,
      roles: { 0: 'sorted' },
      phase: 'done',
    }),
  );

  return { steps, code: SIFT_DOWN_CODE, counterSpec: COUNTER_SPEC };
}

/** Shared sift-down stepper, used by extract and by build-heap. */
function siftDownSteps(
  items: HeapItem[],
  start: number,
  n: number,
  counters: { comparisons: number; swaps: number },
  steps: VizStep[],
  ghostFrom?: number,
) {
  let i = start;

  for (;;) {
    let smallest = i;
    const left = leftOf(i);
    const right = rightOf(i);

    if (left < n) {
      counters.comparisons++;
      if (items[left]!.value < items[smallest]!.value) smallest = left;
    }
    if (right < n) {
      counters.comparisons++;
      if (items[right]!.value < items[smallest]!.value) smallest = right;
    }

    if (left < n) {
      steps.push(
        frame(items, {
          caption:
            right < n
              ? `Compare ${items[i]!.value} against both children, ${items[left]!.value} and ${items[right]!.value}. Sift-down costs two comparisons per level; sift-up costs one.`
              : `Compare ${items[i]!.value} against its only child, ${items[left]!.value}.`,
          codeLine: [4, 7],
          counters,
          roles: {
            [i]: 'active',
            [left]: 'compare',
            ...(right < n ? { [right]: 'compare' as VizRole } : {}),
          },
          pointers: { [i]: 'i' },
          ghostFrom,
        }),
      );
    }

    if (smallest === i) {
      steps.push(
        frame(items, {
          caption:
            left < n
              ? `${items[i]!.value} is already no larger than its children, so the heap property holds from here down.`
              : `Index ${i} is a leaf — nothing below it to violate.`,
          codeLine: 8,
          counters,
          roles: { [i]: 'sorted' },
          ghostFrom,
        }),
      );
      return;
    }

    counters.swaps++;
    [items[i], items[smallest]] = [items[smallest]!, items[i]!];

    steps.push(
      frame(items, {
        caption: `Swap with the smaller child and continue down.`,
        codeLine: 10,
        counters,
        roles: { [i]: 'swap', [smallest]: 'swap' },
        pointers: { [smallest]: 'i' },
        ghostFrom,
      }),
    );

    i = smallest;
  }
}

/* -------------------------------------------------------------- build heap -- */

/**
 * Floyd's build-heap: sift down from the last internal node backwards.
 *
 * The counter on this trace is the argument for the O(n) bound. Run it on 15
 * elements and watch the total settle well below 15·log₂15 ≈ 59 — because most
 * nodes are near the bottom and have almost no distance to fall.
 */
export function traceBuildHeap(base: HeapItem[]): VizTrace {
  const items = [...base];
  const counters = { comparisons: 0, swaps: 0 };
  const steps: VizStep[] = [];
  const n = items.length;
  const lastInternal = (n >> 1) - 1;

  steps.push(
    frame(items, {
      caption: `An arbitrary array. Half of it — every index past ${lastInternal} — is already a valid heap, because a leaf with no children cannot violate anything.`,
      codeLine: 1,
      counters,
      roles: Object.fromEntries(
        Array.from({ length: n - lastInternal - 1 }, (_, k) => [
          lastInternal + 1 + k,
          'sorted' as VizRole,
        ]),
      ),
      phase: 'build',
    }),
  );

  for (let i = lastInternal; i >= 0; i--) {
    steps.push(
      frame(items, {
        caption: `Sift down index ${i}. Its subtrees are already heaps, so one downward pass is enough to fix this whole subtree.`,
        codeLine: 4,
        counters,
        roles: { [i]: 'active' },
        pointers: { [i]: 'i' },
      }),
    );
    siftDownSteps(items, i, n, counters, steps);
  }

  steps.push(
    frame(items, {
      caption: `Heap built in ${counters.comparisons} comparisons — compare that with n·log₂n ≈ ${Math.round(n * Math.log2(Math.max(n, 2)))}. The gap is the whole point: build-heap is O(n), and the derivation below shows why.`,
      counters,
      roles: { 0: 'sorted' },
      phase: 'done',
    }),
  );

  return {
    steps,
    code: BUILD_HEAP_CODE,
    counterSpec: [
      {
        key: 'comparisons',
        label: 'comparisons',
        expected: { label: 'n log₂n', value: n * Math.log2(Math.max(n, 2)) },
      },
      { key: 'swaps', label: 'swaps' },
    ],
  };
}

const COUNTER_SPEC = [
  { key: 'comparisons', label: 'comparisons' },
  { key: 'swaps', label: 'swaps' },
];

/** A resting view with no operation in flight. */
export function traceIdle(items: HeapItem[]): VizTrace {
  return {
    steps: [
      frame(items, {
        caption:
          'Hover any node to light up the array cell holding it — and vice versa. Same values, one storage location, two ways of looking at it.',
        counters: { comparisons: 0, swaps: 0 },
      }),
    ],
    code: SIFT_UP_CODE,
    counterSpec: COUNTER_SPEC,
  };
}

/** Final array values after a trace — the base state for the next operation. */
export function finalItems(trace: VizTrace): HeapItem[] {
  const last = trace.steps[trace.steps.length - 1];
  return (last?.cells ?? [])
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((cell) => ({ id: cell.id, value: cell.value as number }));
}
