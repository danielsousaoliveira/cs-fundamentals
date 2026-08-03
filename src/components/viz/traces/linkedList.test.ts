import { describe, expect, it } from 'vitest';
import {
  finalList,
  makeList,
  traceAppend,
  traceDelete,
  tracePrepend,
} from './linkedList.ts';
import type { VizTrace } from '../core/types.ts';

const values = (trace: VizTrace) => finalList(trace).map((n) => n.value);
const hops = (trace: VizTrace) => trace.steps.at(-1)!.counters!.steps;

describe('tracePrepend', () => {
  it('puts the new value at the front', () => {
    expect(values(tracePrepend(makeList([2, 3, 4]), 1))).toEqual([1, 2, 3, 4]);
  });

  it('works on an empty list', () => {
    expect(values(tracePrepend([], 7))).toEqual([7]);
  });

  it('follows a constant number of pointers regardless of length', () => {
    const short = hops(tracePrepend(makeList([1, 2]), 0));
    const long = hops(
      tracePrepend(makeList(Array.from({ length: 50 }, (_, i) => i)), 0),
    );

    // This is the O(1) claim, checked rather than asserted.
    expect(short).toBe(long);
  });

  it('shows the new node before it is linked in', () => {
    // The teaching moment: a node that exists but is not yet part of the list.
    const trace = tracePrepend(makeList([2, 3]), 1);
    const step = trace.steps[1]!;
    const edgeTargets = step.edges!.map((e) => e.to);
    const newNodeId = step.nodes!.find((n) => n.value === 1)!.id;

    expect(edgeTargets).not.toContain(newNodeId);
    expect(step.edges!.map((e) => e.from)).not.toContain(newNodeId);
  });
});

describe('traceAppend', () => {
  it('puts the new value at the end', () => {
    expect(values(traceAppend(makeList([1, 2, 3]), 4))).toEqual([1, 2, 3, 4]);
  });

  it('walks the entire list — this is the O(n) that surprises people', () => {
    for (const n of [1, 5, 20, 100]) {
      const list = makeList(Array.from({ length: n }, (_, i) => i));
      expect(hops(traceAppend(list, 999))).toBe(n);
    }
  });
});

describe('traceDelete', () => {
  it('removes a value from the middle', () => {
    expect(values(traceDelete(makeList([1, 2, 3, 4]), 3))).toEqual([1, 2, 4]);
  });

  it('removes the head without any search', () => {
    const trace = traceDelete(makeList([1, 2, 3]), 1);
    expect(values(trace)).toEqual([2, 3]);
    expect(hops(trace)).toBe(0);
  });

  it('removes the tail', () => {
    expect(values(traceDelete(makeList([1, 2, 3]), 3))).toEqual([1, 2]);
  });

  it('leaves the list alone when the value is absent, after a full scan', () => {
    const trace = traceDelete(makeList([1, 2, 3]), 99);
    expect(values(trace)).toEqual([1, 2, 3]);
    expect(hops(trace)).toBe(3);
  });

  it('empties a single-element list', () => {
    expect(values(traceDelete(makeList([1]), 1))).toEqual([]);
  });

  it('shows the doomed node as detached before it disappears', () => {
    const trace = traceDelete(makeList([1, 2, 3, 4]), 3);
    const orphanStep = trace.steps.find((s) =>
      s.nodes!.some((n) => n.role === 'ghost'),
    );
    expect(orphanStep).toBeDefined();
    expect(orphanStep!.nodes!.find((n) => n.role === 'ghost')!.value).toBe(3);
  });
});

describe('trace invariants', () => {
  const traces: [string, VizTrace][] = [
    ['prepend', tracePrepend(makeList([2, 3, 4]), 1)],
    ['append', traceAppend(makeList([1, 2, 3]), 4)],
    ['delete', traceDelete(makeList([1, 2, 3, 4]), 3)],
  ];

  it.each(traces)('%s: every edge connects nodes that exist', (_n, trace) => {
    for (const step of trace.steps) {
      const ids = new Set(step.nodes!.map((n) => n.id));
      for (const edge of step.edges ?? []) {
        expect(ids.has(edge.from)).toBe(true);
        expect(ids.has(edge.to)).toBe(true);
      }
    }
  });

  it.each(traces)('%s: no node is ever its own successor', (_n, trace) => {
    for (const step of trace.steps) {
      for (const edge of step.edges ?? []) expect(edge.from).not.toBe(edge.to);
    }
  });

  it.each(traces)('%s: every pointer targets a node on screen', (_n, trace) => {
    for (const step of trace.steps) {
      const ids = new Set(step.nodes!.map((n) => n.id));
      for (const pointer of step.pointers ?? []) {
        expect(ids.has(pointer.target)).toBe(true);
      }
    }
  });
});
