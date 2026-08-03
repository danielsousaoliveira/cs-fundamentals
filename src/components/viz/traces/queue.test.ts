import { describe, expect, it } from 'vitest';
import { DEMO_OPS, dequeuedValues, traceQueue, type QueueOp } from './queue.ts';

const moves = (kind: 'shift' | 'ring', ops: QueueOp[]) =>
  traceQueue(kind, ops).steps.at(-1)!.counters!.moves;

describe('both implementations honour FIFO', () => {
  it('dequeues in insertion order', () => {
    expect(dequeuedValues('shift', DEMO_OPS)).toEqual([1, 2, 3]);
    expect(dequeuedValues('ring', DEMO_OPS)).toEqual([1, 2, 3]);
  });

  it('agree with each other — the interface is identical', () => {
    expect(dequeuedValues('shift', DEMO_OPS)).toEqual(dequeuedValues('ring', DEMO_OPS));
  });
});

describe('the cost difference', () => {
  it('the ring buffer never relocates an element', () => {
    expect(moves('ring', DEMO_OPS)).toBe(0);
  });

  it('the naive queue relocates elements on every dequeue', () => {
    expect(moves('shift', DEMO_OPS)).toBeGreaterThan(0);
  });

  it('naive cost grows with queue length; ring cost does not', () => {
    // n enqueues then n dequeues: the naive version pays (n-1) + (n-2) + ...
    const build = (n: number): QueueOp[] => [
      ...Array.from({ length: n }, (_, i) => ({ type: 'enqueue' as const, value: i })),
      ...Array.from({ length: n }, () => ({ type: 'dequeue' as const })),
    ];

    const small = moves('shift', build(4));
    const large = moves('shift', build(8));

    expect(large).toBeGreaterThan(small * 2); // quadratic, not linear
    expect(moves('ring', build(4))).toBe(0);
    expect(moves('ring', build(8))).toBe(0);
  });

  it('naive moves match the n(n-1)/2 sum exactly', () => {
    for (const n of [3, 5, 8]) {
      const ops: QueueOp[] = [
        ...Array.from({ length: n }, (_, i) => ({
          type: 'enqueue' as const,
          value: i,
        })),
        ...Array.from({ length: n }, () => ({ type: 'dequeue' as const })),
      ];
      expect(moves('shift', ops)).toBe((n * (n - 1)) / 2);
    }
  });
});

describe('the ring buffer wraps correctly', () => {
  it('reuses slots freed at the front', () => {
    // 8-slot buffer: fill it, drain half, refill past the wrap point.
    const ops: QueueOp[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ type: 'enqueue' as const, value: i })),
      ...Array.from({ length: 5 }, () => ({ type: 'dequeue' as const })),
      ...Array.from({ length: 5 }, (_, i) => ({
        type: 'enqueue' as const,
        value: 100 + i,
      })),
    ];

    const trace = traceQueue('ring', ops);
    const filled = trace.steps.at(-1)!.cells!.filter((c) => c.value !== '');

    expect(filled).toHaveLength(6); // 6 - 5 + 5
    expect(trace.steps.at(-1)!.counters!.moves).toBe(0);
  });
});

describe('trace invariants', () => {
  it.each(['shift', 'ring'] as const)('%s: every step captions itself', (kind) => {
    for (const step of traceQueue(kind, DEMO_OPS).steps) {
      expect(step.caption.length).toBeGreaterThan(0);
    }
  });

  it.each(['shift', 'ring'] as const)('%s: cell count stays fixed', (kind) => {
    // Both are backed by one fixed-capacity array; nothing should reallocate.
    for (const step of traceQueue(kind, DEMO_OPS).steps) {
      expect(step.cells).toHaveLength(8);
    }
  });

  it.each(['shift', 'ring'] as const)('%s: pointers target real cells', (kind) => {
    for (const step of traceQueue(kind, DEMO_OPS).steps) {
      const ids = new Set(step.cells!.map((c) => c.id));
      for (const pointer of step.pointers ?? []) {
        expect(ids.has(pointer.target)).toBe(true);
      }
    }
  });

  it.each(['shift', 'ring'] as const)('%s: relocation count never drops', (kind) => {
    let last = 0;
    for (const step of traceQueue(kind, DEMO_OPS).steps) {
      expect(step.counters!.moves).toBeGreaterThanOrEqual(last);
      last = step.counters!.moves;
    }
  });
});
