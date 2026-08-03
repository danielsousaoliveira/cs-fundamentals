import { describe, expect, it } from 'vitest';
import {
  MAX_LOAD,
  bucketOf,
  findCollidingKey,
  finalState,
  hashOf,
  traceInsert,
  traceLookup,
  type HashState,
} from './hashTable.ts';

const empty = (capacity = 8): HashState => ({ capacity, entries: [] });

function insertAll(state: HashState, keys: string[]): HashState {
  return keys.reduce((acc, key, i) => finalState(traceInsert(acc, key, i), acc), state);
}

const keysOf = (state: HashState) => state.entries.map((e) => e.key).sort();

describe('hashOf', () => {
  it('is deterministic', () => {
    expect(hashOf('apple')).toBe(hashOf('apple'));
  });

  it('spreads similar keys into different buckets', () => {
    const buckets = ['a', 'b', 'c', 'd'].map((k) => bucketOf(k, 8));
    expect(new Set(buckets).size).toBeGreaterThan(1);
  });
});

describe('traceInsert', () => {
  it('adds a key', () => {
    const state = insertAll(empty(), ['apple']);
    expect(keysOf(state)).toEqual(['apple']);
  });

  it('keeps both keys when they collide', () => {
    const state = insertAll(empty(), ['apple']);
    const colliding = findCollidingKey(state)!;

    expect(colliding).not.toBeNull();
    expect(bucketOf(colliding, state.capacity)).toBe(bucketOf('apple', state.capacity));

    const after = finalState(traceInsert(state, colliding, 99), state);
    expect(keysOf(after)).toEqual(['apple', colliding].sort());
  });

  it('replaces rather than duplicates when the key already exists', () => {
    let state = insertAll(empty(), ['apple', 'banana']);
    state = finalState(traceInsert(state, 'apple', 42), state);

    expect(state.entries.filter((e) => e.key === 'apple')).toHaveLength(1);
    expect(state.entries.find((e) => e.key === 'apple')!.value).toBe(42);
  });

  it('reports a replacement as an update, never as a collision', () => {
    const state = insertAll(empty(), ['apple']);
    const trace = traceInsert(state, 'apple', 7);

    expect(trace.steps.some((s) => s.phase === 'collision')).toBe(false);
    expect(trace.steps.at(-1)!.counters!.entries).toBe(1);
  });

  it('grows once the load factor passes the threshold, and never before', () => {
    let state = empty(8);
    const capacities: number[] = [];

    for (let i = 0; i < 7; i++) {
      const before = state.capacity;
      state = finalState(traceInsert(state, `key${i}`, i), state);
      capacities.push(state.capacity);

      // Growth is allowed only when the load actually exceeded the threshold.
      if (state.capacity !== before) {
        expect(state.entries.length / before).toBeGreaterThan(MAX_LOAD);
      }
    }

    expect(Math.max(...capacities)).toBeGreaterThan(8);
  });

  it('loses no keys across a rehash', () => {
    const keys = Array.from({ length: 25 }, (_, i) => `key${i}`);
    const state = insertAll(empty(4), keys);

    expect(keysOf(state)).toEqual([...keys].sort());
    expect(state.capacity).toBeGreaterThan(4);
  });

  it('places every key in the bucket its hash demands, after rehashing', () => {
    const state = insertAll(
      empty(4),
      Array.from({ length: 20 }, (_, i) => `key${i}`),
    );

    // The invariant that makes lookup work at all.
    for (const entry of state.entries) {
      const trace = traceLookup(state, entry.key);
      expect(trace.steps.at(-1)!.caption).toContain('Found');
    }
  });
});

describe('traceLookup', () => {
  it('finds a present key', () => {
    const state = insertAll(empty(), ['apple', 'banana', 'cherry']);
    expect(traceLookup(state, 'banana').steps.at(-1)!.caption).toContain('Found');
  });

  it('reports a miss without claiming a find', () => {
    const state = insertAll(empty(), ['apple']);
    const trace = traceLookup(state, 'durian');

    expect(trace.steps.at(-1)!.caption).toContain('not in the table');
    expect(trace.steps.some((s) => s.caption.includes('Found'))).toBe(false);
  });

  it('walks the whole chain when keys collide', () => {
    let state = insertAll(empty(), ['apple']);
    const colliding = findCollidingKey(state)!;
    state = finalState(traceInsert(state, colliding, 1), state);

    const trace = traceLookup(state, colliding);
    // hash step, then one comparison per chain entry up to the hit.
    expect(trace.steps.length).toBeGreaterThanOrEqual(3);
  });
});

describe('trace invariants', () => {
  it('every step captions itself and counts consistently', () => {
    const state = insertAll(empty(4), ['a', 'b', 'c', 'd', 'e']);
    const trace = traceInsert(state, 'f', 6);

    for (const step of trace.steps) {
      expect(step.caption.length).toBeGreaterThan(0);

      const entriesShown = step.buckets.reduce((n, b) => n + b.entries.length, 0);
      expect(entriesShown).toBe(step.counters!.entries);
      expect(step.buckets).toHaveLength(step.counters!.capacity);
    }
  });
});
