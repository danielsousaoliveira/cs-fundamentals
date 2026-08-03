import type { CellState, VizStep, VizTrace } from '../core/types.ts';

/**
 * Two queue implementations, traced side by side.
 *
 * A queue is FIFO — that is the whole specification, and both implementations
 * honour it. What differs is what a dequeue costs: the naive version shifts every
 * remaining element down by one, while the ring buffer moves an index. Same
 * interface, same output, and O(n) versus O(1) underneath.
 *
 * This is the page's central point, and it is invisible unless you count the
 * element moves — which is exactly what the counter does.
 */

export type QueueKind = 'shift' | 'ring';

export interface QueueOp {
  type: 'enqueue' | 'dequeue';
  value?: number;
}

export const QUEUE_CODE: Record<QueueKind, { python: string; typescript: string }> = {
  shift: {
    python: `def dequeue(self):
    # list.pop(0) shifts every remaining element down one slot.
    return self.items.pop(0)          # O(n)

def enqueue(self, value):
    self.items.append(value)          # O(1) amortised`,
    typescript: `dequeue(): number | undefined {
  // Array#shift moves every remaining element down one slot.
  return this.items.shift();          // O(n)
}

enqueue(value: number): void {
  this.items.push(value);             // O(1) amortised
}`,
  },
  ring: {
    python: `def dequeue(self):
    value = self.buffer[self.head]
    self.buffer[self.head] = None
    self.head = (self.head + 1) % self.capacity   # move an INDEX
    self.size -= 1
    return value                                   # O(1)

def enqueue(self, value):
    self.buffer[self.tail] = value
    self.tail = (self.tail + 1) % self.capacity
    self.size += 1                                 # O(1)`,
    typescript: `dequeue(): number | undefined {
  const value = this.buffer[this.head];
  this.buffer[this.head] = undefined;
  this.head = (this.head + 1) % this.capacity;   // move an INDEX
  this.size--;
  return value;                                   // O(1)
}

enqueue(value: number): void {
  this.buffer[this.tail] = value;
  this.tail = (this.tail + 1) % this.capacity;
  this.size++;                                    // O(1)
}`,
  },
};

const CAPACITY = 8;

interface State {
  /** Slot contents; `null` means free. */
  slots: (number | null)[];
  head: number;
  tail: number;
  size: number;
}

function cellsOf(
  state: State,
  kind: QueueKind,
  highlight: Record<number, CellState['role']> = {},
): CellState[] {
  return state.slots.map((value, index) => {
    const inUse =
      kind === 'shift'
        ? index < state.size
        : state.size > 0 &&
          (state.head <= index
            ? index < state.head + state.size
            : index < (state.head + state.size) % CAPACITY);

    return {
      id: `slot-${index}`,
      value: value ?? '',
      index,
      role: highlight[index] ?? (inUse ? 'default' : 'empty'),
    };
  });
}

function pointersOf(state: State, kind: QueueKind) {
  if (kind === 'shift') {
    return state.size > 0
      ? [
          { label: 'front', target: 'slot-0', anchor: 'above' as const },
          {
            label: 'back',
            target: `slot-${state.size - 1}`,
            anchor: 'below' as const,
          },
        ]
      : [];
  }
  return [
    { label: 'head', target: `slot-${state.head}`, anchor: 'above' as const },
    { label: 'tail', target: `slot-${state.tail}`, anchor: 'below' as const },
  ];
}

/**
 * Run the same operation sequence against one implementation.
 * `moves` counts elements physically relocated — the quantity that differs.
 */
export function traceQueue(kind: QueueKind, ops: QueueOp[]): VizTrace {
  const state: State = {
    slots: Array.from({ length: CAPACITY }, () => null),
    head: 0,
    tail: 0,
    size: 0,
  };
  const counters = { moves: 0, size: 0 };
  const steps: VizStep[] = [];
  const emitted: number[] = [];

  const frame = (
    caption: string,
    highlight: Record<number, CellState['role']> = {},
    codeLine?: number | [number, number],
    phase?: string,
  ): VizStep => ({
    caption,
    codeLine,
    counters: { ...counters },
    phase,
    cells: cellsOf(state, kind, highlight),
    pointers: pointersOf(state, kind),
  });

  steps.push(
    frame(
      kind === 'shift'
        ? 'The naive queue: the front is always index 0, so dequeuing has to move everything else.'
        : 'The ring buffer: two indices chase each other around a fixed array. Nothing ever moves.',
      {},
      1,
      'start',
    ),
  );

  for (const op of ops) {
    if (op.type === 'enqueue') {
      const value = op.value!;

      if (kind === 'shift') {
        state.slots[state.size] = value;
      } else {
        state.slots[state.tail] = value;
        state.tail = (state.tail + 1) % CAPACITY;
      }
      state.size++;
      counters.size = state.size;

      steps.push(
        frame(
          kind === 'shift'
            ? `Enqueue ${value} at the back. Cheap in both implementations — appending was never the problem.`
            : `Enqueue ${value} at \`tail\`, then advance \`tail\` — wrapping with mod ${CAPACITY} when it runs off the end.`,
          {
            [kind === 'shift'
              ? state.size - 1
              : (state.tail + CAPACITY - 1) % CAPACITY]: 'active',
          },
          kind === 'shift' ? 5 : [8, 10],
        ),
      );
      continue;
    }

    if (state.size === 0) continue;

    if (kind === 'shift') {
      const value = state.slots[0]!;
      emitted.push(value);

      steps.push(
        frame(
          `Dequeue ${value} from index 0. Every one of the ${state.size - 1} elements behind it now has to move down a slot.`,
          {
            0: 'swap',
            ...Object.fromEntries(
              Array.from({ length: state.size - 1 }, (_, i) => [
                i + 1,
                'compare' as const,
              ]),
            ),
          },
          3,
        ),
      );

      for (let i = 0; i < state.size - 1; i++) state.slots[i] = state.slots[i + 1]!;
      state.slots[state.size - 1] = null;
      counters.moves += state.size - 1;
      state.size--;
      counters.size = state.size;

      steps.push(
        frame(
          `Shifted. That single dequeue moved ${Math.max(state.size, 0)} elements — running total ${counters.moves}. This is the O(n) hiding behind a one-line method.`,
          {},
          3,
        ),
      );
    } else {
      const value = state.slots[state.head]!;
      emitted.push(value);

      steps.push(
        frame(`Dequeue ${value} from \`head\`.`, { [state.head]: 'swap' }, [2, 3]),
      );

      state.slots[state.head] = null;
      state.head = (state.head + 1) % CAPACITY;
      state.size--;
      counters.size = state.size;

      steps.push(
        frame(
          `Advance \`head\`. Nothing moved — one index changed. Total elements relocated so far: ${counters.moves}.`,
          {},
          4,
        ),
      );
    }
  }

  steps.push(
    frame(
      kind === 'shift'
        ? `Done. ${counters.moves} element moves for ${ops.filter((o) => o.type === 'dequeue').length} dequeues — the cost grows with the queue's length.`
        : `Done. ${counters.moves} element moves, no matter how many operations ran or how long the queue got. That is the O(1).`,
      {},
      undefined,
      'done',
    ),
  );

  return {
    steps,
    code: QUEUE_CODE[kind],
    counterSpec: [
      { key: 'moves', label: 'elements relocated' },
      { key: 'size', label: 'queue length' },
    ],
  };
}

/** The values a run dequeues, in order — both implementations must agree. */
export function dequeuedValues(kind: QueueKind, ops: QueueOp[]): number[] {
  const state: number[] = [];
  const out: number[] = [];
  for (const op of ops) {
    if (op.type === 'enqueue') state.push(op.value!);
    else if (state.length) out.push(state.shift()!);
  }
  // `kind` is irrelevant by design: FIFO is the contract, not the implementation.
  void kind;
  return out;
}

export const DEMO_OPS: QueueOp[] = [
  { type: 'enqueue', value: 1 },
  { type: 'enqueue', value: 2 },
  { type: 'enqueue', value: 3 },
  { type: 'enqueue', value: 4 },
  { type: 'dequeue' },
  { type: 'dequeue' },
  { type: 'enqueue', value: 5 },
  { type: 'enqueue', value: 6 },
  { type: 'dequeue' },
  { type: 'enqueue', value: 7 },
];
