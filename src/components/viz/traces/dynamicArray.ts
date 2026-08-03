import type { CellState, VizStep, VizTrace } from '../core/types.ts';

/**
 * Dynamic array growth: the trace behind the arrays page's amortisation argument.
 *
 * The interesting quantity is not the final state but the *cost profile* — a
 * long run of free pushes punctuated by rare, expensive full copies. Counting
 * the copies as they happen is what turns "amortised O(1)" from a phrase into
 * something the reader watches converge.
 */

export interface DynamicArrayOptions {
  pushes: number;
  /** Capacity multiplier on resize. 2 is CPython's list and V8's; 1.5 is Java's. */
  growthFactor?: number;
  initialCapacity?: number;
}

export interface PushCost {
  /** 1-indexed push number. */
  push: number;
  /** Elements copied for this push. 0 for the common case. */
  copies: number;
  capacityAfter: number;
}

/** Per-push cost profile, independent of any rendering. */
export function growthCosts({
  pushes,
  growthFactor = 2,
  initialCapacity = 1,
}: DynamicArrayOptions): PushCost[] {
  const costs: PushCost[] = [];
  let capacity = initialCapacity;
  let length = 0;

  for (let push = 1; push <= pushes; push++) {
    let copies = 0;
    if (length === capacity) {
      // Full: allocate a bigger block and copy every existing element across.
      copies = length;
      capacity = Math.max(capacity + 1, Math.floor(capacity * growthFactor));
    }
    length++;
    costs.push({ push, copies, capacityAfter: capacity });
  }

  return costs;
}

/** Total element copies across n pushes — the sum the page derives as < 2n. */
export function totalCopies(options: DynamicArrayOptions): number {
  return growthCosts(options).reduce((sum, cost) => sum + cost.copies, 0);
}

const cellsFor = (
  values: number[],
  capacity: number,
  roles: Record<number, CellState['role']> = {},
  generation = 0,
): CellState[] =>
  Array.from({ length: capacity }, (_, i) => ({
    // Ids are namespaced by generation: after a resize this is a *different*
    // block of memory, and the cells should fade in rather than slide, because
    // nothing moved — everything was copied.
    id: `g${generation}-${i}`,
    value: i < values.length ? values[i]! : '',
    index: i,
    role: roles[i] ?? (i < values.length ? 'default' : 'empty'),
  }));

export function traceGrowth({
  pushes,
  growthFactor = 2,
  initialCapacity = 1,
}: DynamicArrayOptions): VizTrace {
  const steps: VizStep[] = [];
  const values: number[] = [];
  const counters = { copies: 0, capacity: initialCapacity, wasted: 0 };
  let capacity = initialCapacity;
  let generation = 0;

  steps.push({
    caption: `An empty array with capacity ${capacity}. Capacity is how many slots are reserved; length is how many are used. The gap between them is the price of cheap appends.`,
    counters: { ...counters },
    cells: cellsFor(values, capacity, {}, generation),
    phase: 'start',
  });

  for (let push = 1; push <= pushes; push++) {
    if (values.length === capacity) {
      const oldCapacity = capacity;
      capacity = Math.max(capacity + 1, Math.floor(capacity * growthFactor));

      steps.push({
        caption: `Full at ${oldCapacity}. There is no free memory after this block, so the array cannot simply extend — it must allocate a new block of ${capacity} somewhere else.`,
        counters: { ...counters },
        cells: cellsFor(
          values,
          oldCapacity,
          Object.fromEntries(values.map((_, i) => [i, 'compare' as const])),
          generation,
        ),
        phase: 'resize',
      });

      counters.copies += values.length;
      generation++;

      steps.push({
        caption: `Copy all ${values.length} elements into the new block — this single append costs O(n). Running total: ${counters.copies} copies across ${push - 1} appends.`,
        counters: { ...counters, capacity },
        cells: cellsFor(
          values,
          capacity,
          Object.fromEntries(values.map((_, i) => [i, 'swap' as const])),
          generation,
        ),
      });
    }

    values.push(push);
    counters.capacity = capacity;
    counters.wasted = capacity - values.length;

    steps.push({
      caption:
        values.length === capacity
          ? `Append ${push} into the last free slot. O(1) — but the array is now full, so the next append triggers a resize.`
          : `Append ${push} into a reserved slot. No allocation, no copying: a pointer bump and a length increment. O(1).`,
      counters: { ...counters },
      cells: cellsFor(values, capacity, { [values.length - 1]: 'active' }, generation),
    });
  }

  const copies = counters.copies;
  steps.push({
    caption: `${pushes} appends cost ${copies} element copies in total — under 2n, no matter how large n gets. That bound is what "amortised O(1)" means, and the derivation below shows where it comes from.`,
    counters: { ...counters },
    cells: cellsFor(values, capacity, {}, generation),
    phase: 'done',
  });

  return {
    steps,
    counterSpec: [
      {
        key: 'copies',
        label: 'elements copied',
        expected: { label: '2n', value: 2 * pushes },
      },
      { key: 'capacity', label: 'capacity' },
      { key: 'wasted', label: 'slots reserved but unused' },
    ],
  };
}
